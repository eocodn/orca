import { initializeMainProcessConfiguration } from './main-process-process-configuration'
import { installSyntheticTitlePaneTeardown } from './main-process-synthetic-title-lifecycle'
import { installMainProcessReadyLifecycle } from './main-process-ready-lifecycle'
import { installMainProcessShutdownLifecycle } from './main-process-shutdown-lifecycle'

// Keep registration order explicit: process gates, PTY teardown listener, app-ready, then quit handlers.
initializeMainProcessConfiguration()
installSyntheticTitlePaneTeardown()
installMainProcessReadyLifecycle()
installMainProcessShutdownLifecycle()
