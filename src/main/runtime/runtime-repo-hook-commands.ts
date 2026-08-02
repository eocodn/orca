import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Repo } from '../../shared/types'
import type { IFilesystemProvider } from '../providers/types'
import { isENOENT } from '../ipc/filesystem-auth'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import {
  getDefaultTabCommandTrustContent,
  getEffectiveHooks,
  getEffectiveSetupRunPolicy,
  hasHooksFile,
  hasUnrecognizedOrcaYamlKeys,
  loadHooks,
  parseOrcaYaml,
  readIssueCommand,
  writeIssueCommand
} from '../hooks'
import { inspectSetupScriptImportCandidates } from '../../shared/setup-script-imports'
import { isFolderRepo } from '../../shared/repo-kind'
import { joinWorktreeRelativePath } from './runtime-relative-paths'
import { ensureRemoteOrcaDirectoryIgnored } from './remote-orca-directory-ignore'

export type RepoHookCommandsHost = {
  resolveRepoSelector(repoSelector: string): Promise<Repo>
}

export class RuntimeRepoHookCommands {
  constructor(private readonly host: RepoHookCommandsHost) {}

  async getRepoHooks(repoSelector: string) {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    if (repo.connectionId) {
      const fsProvider = getSshFilesystemProvider(repo.connectionId)
      if (!fsProvider) {
        return {
          hasHooksFile: false,
          hooks: null,
          setupRunPolicy: getEffectiveSetupRunPolicy(repo),
          source: null
        }
      }
      try {
        const result = await fsProvider.readFile(joinWorktreeRelativePath(repo.path, 'orca.yaml'))
        const hooks = result.isBinary ? null : parseOrcaYaml(result.content)
        return {
          hasHooksFile: Boolean(hooks),
          hooks,
          setupRunPolicy: getEffectiveSetupRunPolicy(repo),
          source: hooks ? 'orca.yaml' : null,
          setupTrust: this.getSharedSetupHookTrustPayload(
            repo,
            getDefaultTabCommandTrustContent(hooks)
          )
        }
      } catch {
        return {
          hasHooksFile: false,
          hooks: null,
          setupRunPolicy: getEffectiveSetupRunPolicy(repo),
          source: null
        }
      }
    }
    const hasFile = hasHooksFile(repo.path)
    const hooks = getEffectiveHooks(repo)
    const sharedHooks = hasFile ? loadHooks(repo.path) : null
    const setupRunPolicy = getEffectiveSetupRunPolicy(repo)
    return {
      hasHooksFile: hasFile,
      hooks,
      setupRunPolicy,
      source: hasFile ? 'orca.yaml' : hooks ? 'legacy' : null,
      setupTrust: this.getSharedSetupHookTrustPayload(
        repo,
        getDefaultTabCommandTrustContent(sharedHooks)
      )
    }
  }

  async checkRepoHooks(repoSelector: string) {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    if (isFolderRepo(repo)) {
      return { hasHooks: false, hooks: null, mayNeedUpdate: false }
    }
    if (repo.connectionId) {
      const fsProvider = getSshFilesystemProvider(repo.connectionId)
      if (!fsProvider) {
        return { hasHooks: false, hooks: null, mayNeedUpdate: false }
      }
      try {
        const result = await fsProvider.readFile(joinWorktreeRelativePath(repo.path, 'orca.yaml'))
        if (result.isBinary) {
          return { hasHooks: false, hooks: null, mayNeedUpdate: false }
        }
        return { hasHooks: true, hooks: parseOrcaYaml(result.content), mayNeedUpdate: false }
      } catch {
        return { hasHooks: false, hooks: null, mayNeedUpdate: false }
      }
    }
    const has = hasHooksFile(repo.path)
    const hooks = has ? loadHooks(repo.path) : null
    return {
      hasHooks: has,
      hooks,
      mayNeedUpdate: has && !hooks && hasUnrecognizedOrcaYamlKeys(repo.path)
    }
  }

  async inspectRepoSetupScriptImports(repoSelector: string) {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    if (isFolderRepo(repo)) {
      return []
    }
    return inspectSetupScriptImportCandidates(async (relativePath) => {
      const filePath = joinWorktreeRelativePath(repo.path, relativePath)
      if (repo.connectionId) {
        const fsProvider = getSshFilesystemProvider(repo.connectionId)
        if (!fsProvider) {
          return null
        }
        try {
          const result = await fsProvider.readFile(filePath)
          return result.isBinary ? null : result.content
        } catch {
          return null
        }
      }
      try {
        return await readFile(filePath, 'utf-8')
      } catch (error) {
        if (!isENOENT(error)) {
          console.warn('[runtime] Failed to inspect setup script import candidate:', error)
        }
        return null
      }
    })
  }

  async readRepoIssueCommand(repoSelector: string) {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    if (isFolderRepo(repo)) {
      return {
        localContent: null,
        sharedContent: null,
        effectiveContent: null,
        localFilePath: '',
        source: 'none' as const
      }
    }
    if (repo.connectionId) {
      const issueCommandPath = joinWorktreeRelativePath(repo.path, '.orca/issue-command')
      const fsProvider = getSshFilesystemProvider(repo.connectionId)
      if (!fsProvider) {
        return {
          localContent: null,
          sharedContent: null,
          effectiveContent: null,
          localFilePath: issueCommandPath,
          source: 'none' as const
        }
      }
      const localContent = await this.readRemoteIssueCommand(fsProvider, issueCommandPath)
      const sharedContent = await this.readRemoteSharedIssueCommand(fsProvider, repo.path)
      const effectiveContent = localContent ?? sharedContent
      return {
        localContent,
        sharedContent,
        effectiveContent,
        localFilePath: issueCommandPath,
        source: localContent
          ? ('local' as const)
          : sharedContent
            ? ('shared' as const)
            : ('none' as const)
      }
    }
    return readIssueCommand(repo.path)
  }

  async writeRepoIssueCommand(repoSelector: string, content: string): Promise<{ ok: true }> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    if (isFolderRepo(repo)) {
      return { ok: true }
    }
    if (repo.connectionId) {
      const issueCommandPath = joinWorktreeRelativePath(repo.path, '.orca/issue-command')
      const fsProvider = getSshFilesystemProvider(repo.connectionId)
      if (!fsProvider) {
        return { ok: true }
      }
      const trimmed = content.trim()
      if (!trimmed) {
        await fsProvider.deletePath(issueCommandPath, false).catch((error: unknown) => {
          if (!isENOENT(error)) {
            throw error
          }
        })
        return { ok: true }
      }
      await fsProvider.createDir(joinWorktreeRelativePath(repo.path, '.orca'))
      await ensureRemoteOrcaDirectoryIgnored(fsProvider, repo.path)
      await fsProvider.writeFile(issueCommandPath, `${trimmed}\n`)
      return { ok: true }
    }
    writeIssueCommand(repo.path, content)
    return { ok: true }
  }

  private getSetupHookTrustPayload(
    repo: Repo,
    scriptContentValue: string | undefined
  ): { contentHash: string; scriptContent: string } | undefined {
    const scriptContent = scriptContentValue?.trim()
    if (!scriptContent || repo.hookSettings?.commandSourcePolicy === 'local-only') {
      return undefined
    }
    return {
      contentHash: createHash('sha256').update(scriptContent).digest('hex'),
      scriptContent
    }
  }

  private getSharedSetupHookTrustPayload(
    repo: Repo,
    sharedSetupScript: string | undefined
  ): { contentHash: string; scriptContent: string } | undefined {
    if (repo.hookSettings?.commandSourcePolicy === 'local-only') {
      return undefined
    }
    return this.getSetupHookTrustPayload(repo, sharedSetupScript)
  }

  private async readRemoteIssueCommand(
    fsProvider: IFilesystemProvider,
    issueCommandPath: string
  ): Promise<string | null> {
    try {
      const result = await fsProvider.readFile(issueCommandPath)
      return result.isBinary ? null : result.content.trim() || null
    } catch {
      return null
    }
  }

  private async readRemoteSharedIssueCommand(
    fsProvider: IFilesystemProvider,
    repoPath: string
  ): Promise<string | null> {
    try {
      const result = await fsProvider.readFile(joinWorktreeRelativePath(repoPath, 'orca.yaml'))
      return result.isBinary ? null : parseOrcaYaml(result.content)?.issueCommand?.trim() || null
    } catch {
      return null
    }
  }
}
