import React from 'react'
import { SourceControlAgentActionDialog } from './SourceControlAgentActionDialog'
import type { ComponentProps } from 'react'

export type ChecksPanelActionsSectionProps = ComponentProps<typeof SourceControlAgentActionDialog>

/** Keeps the AI action dialog boundary out of the checks/comments surface markup. */
export function ChecksPanelActionsSection(
  props: ChecksPanelActionsSectionProps
): React.JSX.Element {
  return <SourceControlAgentActionDialog {...props} />
}
