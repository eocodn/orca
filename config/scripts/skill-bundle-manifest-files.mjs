import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function compareCodeUnits(left, right) {
  return left === right ? 0 : left < right ? -1 : 1
}

function gitObjectSha(kind, bytes) {
  return createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest()
}

function normalizeText(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return Buffer.from(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8')
}

function classifyFile(bytes) {
  if (bytes.includes(0)) {
    return 'binary'
  }
  try {
    normalizeText(bytes)
    return 'text'
  } catch {
    return 'binary'
  }
}

function assertSafeRelativePath(relativePath) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Unsafe skill package path: ${relativePath}`)
  }
}

function describeFile(manifestPath, bytes, executable) {
  const classification = classifyFile(bytes)
  const exactSha256 = sha256(bytes)
  const textNormalizedSha256 = classification === 'text' ? sha256(normalizeText(bytes)) : null
  return {
    path: manifestPath,
    size: bytes.length,
    executable,
    classification,
    exactSha256,
    textNormalizedSha256,
    identitySha256: classification === 'text' && !executable ? textNormalizedSha256 : exactSha256,
    gitBlobSha: gitObjectSha('blob', bytes).toString('hex')
  }
}

function gitTreeSha(entries) {
  const root = { directories: new Map(), files: [] }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    const filename = parts.pop()
    let directory = root
    for (const part of parts) {
      let child = directory.directories.get(part)
      if (!child) {
        child = { directories: new Map(), files: [] }
        directory.directories.set(part, child)
      }
      directory = child
    }
    directory.files.push({ filename, ...entry })
  }

  function hashDirectory(directory) {
    const children = [
      ...[...directory.directories].map(([name, child]) => ({
        mode: '40000',
        name,
        hash: hashDirectory(child)
      })),
      ...directory.files.map((file) => ({
        mode: file.executable ? '100755' : '100644',
        name: file.filename,
        hash: Buffer.from(file.gitBlobSha, 'hex')
      }))
    ].sort((left, right) => {
      const leftName = left.mode === '40000' ? `${left.name}/` : left.name
      const rightName = right.mode === '40000' ? `${right.name}/` : right.name
      return Buffer.from(leftName).compare(Buffer.from(rightName))
    })
    const body = Buffer.concat(
      children.map(({ mode, name, hash }) =>
        Buffer.concat([Buffer.from(`${mode} ${name}\0`, 'utf8'), hash])
      )
    )
    return gitObjectSha('tree', body)
  }

  return hashDirectory(root).toString('hex')
}

// Why: kept in step with isOsMetadataSkillEntryName in src/main/skills/skill-package-identity.ts.
// The scanner ignores these because the OS writes them into a live install; the generator
// ignores them so a stray one in a working tree cannot be committed into the manifest as
// content no user could ever match. Skipped rather than rejected: the file is not the
// developer's doing, so failing the build over it would be hostile.
const OS_METADATA_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini'])

function isOsMetadataSkillEntryName(name) {
  const folded = name.toLocaleLowerCase('en-US')
  return OS_METADATA_FILE_NAMES.has(folded) || folded.startsWith('._')
}

async function collectPackageFiles(packageRoot) {
  const files = []
  const caseFoldedPaths = new Map()

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    // Why: build-time Node and packaged Electron may ship different ICU data;
    // package identity order must use the same locale-independent comparison.
    entries.sort((left, right) => compareCodeUnits(left.name, right.name))
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const fileStat = await lstat(absolutePath)
      // Only a plain file is OS-authored, so the type decides and not the name alone: a
      // directory or link wearing the name would otherwise drop its subtree out of the
      // manifest and skip the guards below. Decided before the case-fold map so two
      // spellings of one sidecar cannot collide.
      if (isOsMetadataSkillEntryName(entry.name) && fileStat.isFile()) {
        continue
      }
      const relativePath = path.relative(packageRoot, absolutePath)
      assertSafeRelativePath(relativePath)
      const manifestPath = relativePath.split(path.sep).join('/')
      const foldedPath = manifestPath.toLocaleLowerCase('en-US')
      const collision = caseFoldedPaths.get(foldedPath)
      if (collision && collision !== manifestPath) {
        throw new Error(`Case-colliding skill paths: ${collision} and ${manifestPath}`)
      }
      caseFoldedPaths.set(foldedPath, manifestPath)
      if (fileStat.isSymbolicLink()) {
        throw new Error(`Symlink is not allowed in a shipped skill: ${manifestPath}`)
      }
      if (fileStat.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!fileStat.isFile()) {
        throw new Error(`Special file is not allowed in a shipped skill: ${manifestPath}`)
      }
      // Why: Windows observation cannot see execute bits, so an executable file in
      // a shipped skill would misclassify every pristine Windows install as unrecognized.
      if ((fileStat.mode & 0o111) !== 0) {
        throw new Error(`Executable file is not allowed in a shipped skill: ${manifestPath}`)
      }
      files.push(describeFile(manifestPath, await readFile(absolutePath), false))
    }
  }

  await visit(packageRoot)
  return sortManifestFiles(files)
}

function collectGitSkillTreeEntries(treeSha) {
  const output = execFileSync('git', ['ls-tree', '-r', '-z', treeSha])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const packages = new Map()
  for (const line of output) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(line)
    if (!match) {
      throw new Error(`Unexpected git tree entry in ${treeSha}: ${line}`)
    }
    const [, mode, type, objectSha, sourcePath] = match
    const separator = sourcePath.indexOf('/')
    if (separator <= 0 || separator === sourcePath.length - 1) {
      throw new Error(`Unsupported shipped skill path in ${treeSha}: ${sourcePath}`)
    }
    const name = sourcePath.slice(0, separator)
    const manifestPath = sourcePath.slice(separator + 1)
    const entries = packages.get(name) ?? []
    entries.push({ mode, type, objectSha, manifestPath })
    packages.set(name, entries)
  }
  return packages
}

function readGitBlobs(objectShas) {
  const uniqueShas = [...new Set(objectShas)]
  if (uniqueShas.length === 0) {
    return new Map()
  }
  // Why: released history spans hundreds of tags. Batch mode avoids a Git
  // subprocess per historical file while remaining available on Git 2.25.
  const output = execFileSync('git', ['cat-file', '--batch'], {
    input: `${uniqueShas.join('\n')}\n`,
    maxBuffer: 64 * 1024 * 1024
  })
  const blobs = new Map()
  let offset = 0
  for (const requestedSha of uniqueShas) {
    const headerEnd = output.indexOf(10, offset)
    if (headerEnd < 0) {
      throw new Error(`Missing git cat-file header for ${requestedSha}`)
    }
    const header = output.subarray(offset, headerEnd).toString('utf8')
    const match = /^([a-f0-9]+) blob (\d+)$/.exec(header)
    if (!match || match[1] !== requestedSha) {
      throw new Error(`Unexpected git cat-file header for ${requestedSha}: ${header}`)
    }
    const size = Number(match[2])
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (contentEnd >= output.length || output[contentEnd] !== 10) {
      throw new Error(`Truncated git blob for ${requestedSha}`)
    }
    blobs.set(requestedSha, Buffer.from(output.subarray(contentStart, contentEnd)))
    offset = contentEnd + 1
  }
  return blobs
}

function collectGitPackageFiles(treeSha, name, entries, blobs) {
  const caseFoldedPaths = new Map()
  const files = entries.map(({ mode, type, objectSha, manifestPath }) => {
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new Error(`Unsupported shipped skill entry in ${treeSha}: ${name}/${manifestPath}`)
    }
    assertSafeRelativePath(manifestPath)
    const foldedPath = manifestPath.toLocaleLowerCase('en-US')
    const collision = caseFoldedPaths.get(foldedPath)
    if (collision && collision !== manifestPath) {
      throw new Error(`Case-colliding skill paths in ${treeSha}: ${collision} and ${manifestPath}`)
    }
    caseFoldedPaths.set(foldedPath, manifestPath)
    const bytes = blobs.get(objectSha)
    if (!bytes) {
      throw new Error(`Missing git blob ${objectSha} for ${name}/${manifestPath}`)
    }
    return describeFile(manifestPath, bytes, mode === '100755')
  })
  // Why: git ls-tree emits git byte-order, not the canonical walk order.
  return sortManifestFiles(files)
}

// Why: snapshot matching compares files by array index, so every producer —
// working-tree walk, git history, and runtime observation — must emit one
// canonical order. This mirrors the sorted depth-first filesystem walk.
function compareManifestPaths(left, right) {
  const leftParts = left.split('/')
  const rightParts = right.split('/')
  const shared = Math.min(leftParts.length, rightParts.length)
  for (let index = 0; index < shared; index += 1) {
    const order = compareCodeUnits(leftParts[index], rightParts[index])
    if (order !== 0) {
      return order
    }
  }
  return leftParts.length - rightParts.length
}

function sortManifestFiles(files) {
  return [...files].sort((left, right) => compareManifestPaths(left.path, right.path))
}

function packageDigest(files) {
  return sha256(
    Buffer.from(
      JSON.stringify(
        files.map((file) => ({
          path: file.path,
          executable: file.executable,
          classification: file.classification,
          identitySha256: file.identitySha256
        }))
      ),
      'utf8'
    )
  )
}


export {
  collectGitPackageFiles,
  collectGitSkillTreeEntries,
  collectPackageFiles,
  compareCodeUnits,
  describeFile,
  gitObjectSha,
  gitTreeSha,
  normalizeText,
  packageDigest,
  sha256,
  sortManifestFiles
}