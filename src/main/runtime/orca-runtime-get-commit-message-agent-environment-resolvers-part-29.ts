import { type CommitMessageAgentEnvironmentResolvers } from './orca-runtime-symbols'
import { OrcaRuntimeResolveTerminalCwdPart28 } from './orca-runtime-resolve-terminal-cwd-part-28'

export class OrcaRuntimeGetCommitMessageAgentEnvironmentResolversPart29 extends OrcaRuntimeResolveTerminalCwdPart28 {
  getCommitMessageAgentEnvironmentResolvers(): CommitMessageAgentEnvironmentResolvers | undefined {
    return this.commitMessageAgentEnv ?? undefined
  }

}
