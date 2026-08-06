/* Localized copy and option builders for RepositoryHooksSection. */
import type { HookCommandSourcePolicy, SetupRunPolicy } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import type {
  LocalHookField,
  PolicyOption
} from './repository-hooks-model-repository-hooks-section-props'

export const YAML_STATE_STYLES: Record<string, { card: string; titleClassName: string }> = {
  loaded: {
    card: 'border-emerald-500/20 bg-emerald-500/5',
    titleClassName: 'text-emerald-700 dark:text-emerald-300'
  },
  'update-available': {
    card: 'border-amber-500/20 bg-amber-500/5',
    titleClassName: 'text-amber-700 dark:text-amber-300'
  },
  invalid: {
    card: 'border-amber-500/20 bg-amber-500/5',
    titleClassName: 'text-amber-700 dark:text-amber-300'
  },
  missing: {
    card: 'border-border/50 bg-muted/20',
    titleClassName: 'text-foreground'
  }
}

export function getSetupRunPolicyOptions(): PolicyOption<SetupRunPolicy>[] {
  return [
    {
      policy: 'ask',
      label: translate(
        'auto.components.settings.RepositoryHooksSection.e03d9a8f38',
        'Ask every time'
      ),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.90b1f50137',
        'Prompt before running setup.'
      )
    },
    {
      policy: 'run-by-default',
      label: translate(
        'auto.components.settings.RepositoryHooksSection.d3ef1ab247',
        'Run by default'
      ),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.022ba10cf2',
        'Run setup automatically.'
      )
    },
    {
      policy: 'skip-by-default',
      label: translate(
        'auto.components.settings.RepositoryHooksSection.15debc1fd9',
        'Skip by default'
      ),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.99e3264a49',
        'Only run setup when chosen.'
      )
    }
  ]
}

export function getCommandSourcePolicyOptions(): PolicyOption<HookCommandSourcePolicy>[] {
  return [
    {
      policy: 'shared-only',
      label: translate(
        'auto.components.settings.RepositoryHooksSection.d88b6ff88f',
        'orca.yaml only'
      ),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.29397e8bbc',
        'Use only shared commands from orca.yaml.'
      )
    },
    {
      policy: 'local-only',
      label: translate('auto.components.settings.RepositoryHooksSection.83dc78202a', 'Local only'),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.0e8b2a520d',
        'Ignore orca.yaml; run only your local commands.'
      )
    },
    {
      policy: 'run-both',
      label: translate('auto.components.settings.RepositoryHooksSection.8d6c56bff8', 'Run both'),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.8561b0665f',
        'orca.yaml first, then your local commands.'
      )
    }
  ]
}

export function getCommandSourceLabel(policy: HookCommandSourcePolicy): string {
  switch (policy) {
    case 'shared-only':
      return translate(
        'auto.components.settings.RepositoryHooksSection.d88b6ff88f',
        'orca.yaml only'
      )
    case 'local-only':
      return translate('auto.components.settings.RepositoryHooksSection.83dc78202a', 'Local only')
    case 'run-both':
      return translate('auto.components.settings.RepositoryHooksSection.8d6c56bff8', 'Run both')
  }
}

export function getLocalHookFields(): readonly [LocalHookField, LocalHookField] {
  return [
    {
      name: 'setup',
      label: translate(
        'auto.components.settings.RepositoryHooksSection.52b31baf02',
        'Setup Script'
      ),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.f0710e1c83',
        'Runs after a new worktree is created; install deps, copy env files, run migrations.'
      ),
      placeholder: translate(
        'auto.components.settings.RepositoryHooksSection.a3fc966677',
        '# e.g. pnpm install cp "$ORCA_ROOT_PATH/.env" "$ORCA_WORKTREE_PATH/.env"'
      )
    },
    {
      name: 'archive',
      label: translate(
        'auto.components.settings.RepositoryHooksSection.9a100323ff',
        'Archive Script'
      ),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.6f90ebe3fd',
        'Runs before a worktree is archived or removed.'
      ),
      placeholder: translate(
        'auto.components.settings.RepositoryHooksSection.9b821fa19d',
        '# e.g. echo "Cleaning up $ORCA_WORKSPACE_NAME"'
      )
    }
  ]
}

export function getEnvVars(): readonly { name: string; description: string }[] {
  return [
    {
      name: '$ORCA_ROOT_PATH',
      description: translate(
        'auto.components.settings.RepositoryHooksSection.30952c4aa4',
        'Path to the main repo checkout. Useful for copying shared files, like .env, into a worktree.'
      )
    },
    {
      name: '$ORCA_WORKTREE_PATH',
      description: translate(
        'auto.components.settings.RepositoryHooksSection.54c73d88d0',
        'Path to the worktree being created. Setup commands run from this directory.'
      )
    },
    {
      name: '$ORCA_WORKSPACE_NAME',
      description: translate(
        'auto.components.settings.RepositoryHooksSection.0fa21e19ec',
        'Name of the workspace, usually based on the branch name.'
      )
    }
  ]
}

export function getYamlStateCopy(yamlState: string): { heading: string; description: string } {
  switch (yamlState) {
    case 'loaded':
      return {
        heading: translate(
          'auto.components.settings.RepositoryHooksSection.56f9a4a1d0',
          'Using `orca.yaml`'
        ),
        description: translate(
          'auto.components.settings.RepositoryHooksSection.ca424ff135',
          'Shared hook and issue-automation defaults are defined in the repo and available to everyone who uses it.'
        )
      }
    case 'update-available':
      return {
        heading: translate(
          'auto.components.settings.RepositoryHooksSection.623e0c9f31',
          '`orca.yaml` could not be parsed'
        ),
        description: translate(
          'auto.components.settings.RepositoryHooksSection.aba825233f',
          'The file contains configuration keys that this version of Orca does not recognize. You may need to update Orca, or check the file for typos.'
        )
      }
    case 'invalid':
      return {
        heading: translate(
          'auto.components.settings.RepositoryHooksSection.623e0c9f31',
          '`orca.yaml` could not be parsed'
        ),
        description: translate(
          'auto.components.settings.RepositoryHooksSection.0cc712b823',
          'The core configuration file exists in the repo root, but Orca could not parse the supported hook definitions yet.'
        )
      }
    default:
      return {
        heading: translate(
          'auto.components.settings.RepositoryHooksSection.5a67e4793d',
          'No `orca.yaml` detected'
        ),
        description: translate(
          'auto.components.settings.RepositoryHooksSection.b20c5df6ca',
          'Add an `orca.yaml` file to enable shared setup, archive, or issue-automation defaults for this repo. Example template:'
        )
      }
  }
}
