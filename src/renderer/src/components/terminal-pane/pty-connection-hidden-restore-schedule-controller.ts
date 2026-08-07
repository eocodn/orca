import {
  cancelScheduledHiddenOutputRestore,
  scheduleHiddenOutputRestore
} from './hidden-output-restore-scheduler'

export function createPtyConnectionHiddenRestoreScheduleController(target: object) {
  let scheduled = false

  return {
    scheduleInactive(requestRestore: () => void): boolean {
      if (scheduled) {
        return false
      }
      scheduled = true
      scheduleHiddenOutputRestore(
        target,
        () => {
          scheduled = false
          requestRestore()
        },
        'inactive'
      )
      return true
    },
    cancel(): void {
      scheduled = false
      cancelScheduledHiddenOutputRestore(target)
    }
  }
}
