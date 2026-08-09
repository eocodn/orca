import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

const projectDir = resolve(import.meta.dirname, '../..')
const options = parseArgs(process.argv.slice(2))
const targetRoot = resolve(projectDir, 'src-tauri/target', options.target, 'release')
const installerDir = join(targetRoot, 'bundle/nsis')
const installers = readdirSync(installerDir)
  .filter((name) => name.endsWith('-setup.exe'))
  .map((name) => join(installerDir, name))
if (installers.length !== 1) throw new Error(`expected_one_nsis_installer:${installers.length}`)

const sources = [
  ['installer', installers[0], 'orca-ade-windows-x64-unsigned-setup.exe'],
  ['application', join(targetRoot, 'ade-tauri.exe'), 'orca-ade.exe'],
  [
    'native_worker',
    resolve(projectDir, `src-tauri/binaries/ade-worker-${options.target}.exe`),
    'ade-worker.exe'
  ],
  [
    'agent_control',
    resolve(projectDir, `src-tauri/binaries/ade-control-${options.target}.exe`),
    'ade-control.exe'
  ]
]

mkdirSync(options.output, { recursive: true })
const files = sources.map(([role, source, name]) => {
  const sourceStat = statSync(source)
  if (!sourceStat.isFile() || sourceStat.size === 0) throw new Error(`invalid_package_input:${role}`)
  const destination = join(options.output, name)
  copyFileSync(source, destination)
  const bytes = statSync(destination).size
  const sha256 = createHash('sha256').update(readFileSync(destination)).digest('hex')
  return { role, name: basename(destination), bytes, sha256 }
})

const tauriConfig = JSON.parse(readFileSync(join(projectDir, 'src-tauri/tauri.conf.json'), 'utf8'))
writeAtomic(
  join(options.output, 'windows-tauri-package.json'),
  `${JSON.stringify(
    {
      protocol_version: 1,
      product: tauriConfig.productName,
      version: tauriConfig.version,
      target: options.target,
      signed: false,
      files
    },
    null,
    2
  )}\n`
)
writeAtomic(
  join(options.output, 'SHA256SUMS'),
  `${files.map((file) => `${file.sha256}  ${file.name}`).join('\n')}\n`
)

console.log(
  JSON.stringify({
    service: 'windows-tauri-package',
    state: 'ready',
    target: options.target,
    output: options.output,
    files: files.length
  })
)

function parseArgs(args) {
  let target = null
  let output = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--target' || argument === '--output') {
      const value = args[index + 1]
      if (value === undefined) throw new Error(`missing_${argument.slice(2)}`)
      if (argument === '--target') {
        if (target !== null) throw new Error('duplicate_target')
        target = value
      } else {
        if (output !== null) throw new Error('duplicate_output')
        output = resolve(projectDir, value)
      }
      index += 1
      continue
    }
    throw new Error(`unknown_argument:${argument}`)
  }
  if (target !== 'x86_64-pc-windows-msvc') throw new Error('unsupported_package_target')
  if (output === null) throw new Error('missing_output')
  return { target, output }
}

function writeAtomic(path, contents) {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, contents, 'utf8')
  renameSync(temporary, path)
}
