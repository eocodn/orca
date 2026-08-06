import { CHECK_ICON, CHECK_COLOR } from './checks-panel-check-icons'
import { isFailedCheck } from './checks-panel-check-model'
import type { PRCheckDetail } from '../../../../shared/types'

export { CHECK_ICON, CHECK_COLOR }

export function getFailedChecksForDetails(checks: PRCheckDetail[]): PRCheckDetail[] {
  return checks.filter(isFailedCheck)
}

export { ChecksList } from './checks-panel-checks-list-view'
