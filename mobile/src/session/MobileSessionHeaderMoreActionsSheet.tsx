import { ListChecks } from 'lucide-react-native'
import { ActionSheetModal } from '../components/ActionSheetModal'

type Props = {
  visible: boolean
  showChecks: boolean
  onOpenChecks: () => void
  onClose: () => void
}

export function MobileSessionHeaderMoreActionsSheet({
  visible,
  showChecks,
  onOpenChecks,
  onClose
}: Props) {
  return (
    <ActionSheetModal
      visible={visible}
      actions={[
        ...(showChecks
          ? [
              {
                label: 'Checks',
                hint: 'Open pull request checks',
                icon: ListChecks,
                onPress: onOpenChecks
              }
            ]
          : [])
      ]}
      onClose={onClose}
    />
  )
}
