import type { GlobalSettings } from '../../../../shared/types'
import { PrivacyDiagnosticsSection } from './PrivacyDiagnosticsSection'

type PrivacyPaneProps = {
  settings: GlobalSettings
}

export function PrivacyPane({ settings: _settings }: PrivacyPaneProps): React.JSX.Element {
  return <PrivacyDiagnosticsSection />
}
