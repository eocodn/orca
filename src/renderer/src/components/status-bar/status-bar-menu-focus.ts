import { useRef } from 'react'

export function useStatusBarMenuFocusHandoff(): {
  reset: () => void
  onPointerDownOutside: () => void
  onCloseAutoFocus: (event: Event) => void
} {
  const skipCloseAutoFocusRef = useRef(false)
  return {
    reset: () => {
      skipCloseAutoFocusRef.current = false
    },
    onPointerDownOutside: () => {
      skipCloseAutoFocusRef.current = true
    },
    onCloseAutoFocus: (event) => {
      if (!skipCloseAutoFocusRef.current) return
      skipCloseAutoFocusRef.current = false
      // Radix focus restoration can steal the first click from terminal surfaces.
      event.preventDefault()
    }
  }
}
