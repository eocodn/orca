import { useEffect, useState } from 'react'
import { Keyboard } from 'react-native'

export function useMobileSourceControlKeyboardLift(): number {
  const [keyboardLift, setKeyboardLift] = useState(0)

  useEffect(() => {
    const showEvent = 'keyboardDidShow'
    const hideEvent = 'keyboardDidHide'

    const onShow = Keyboard.addListener(showEvent, (event) => {
      setKeyboardLift(Math.max(0, event.endCoordinates.height))
    })
    const onHide = Keyboard.addListener(hideEvent, () => setKeyboardLift(0))

    return () => {
      onShow.remove()
      onHide.remove()
    }
  }, [])

  return keyboardLift
}
