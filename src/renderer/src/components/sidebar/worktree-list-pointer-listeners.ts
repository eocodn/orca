export function registerWorktreeListPointerListeners(
  onPointerMove: (event: PointerEvent) => void,
  onPointerUp: (event: PointerEvent) => void,
  onPointerCancel: (event: PointerEvent) => void
): () => void {
  window.addEventListener('pointermove', onPointerMove, { capture: true })
  window.addEventListener('pointerup', onPointerUp, { capture: true })
  window.addEventListener('pointercancel', onPointerCancel, { capture: true })
  return () => {
    window.removeEventListener('pointermove', onPointerMove, { capture: true })
    window.removeEventListener('pointerup', onPointerUp, { capture: true })
    window.removeEventListener('pointercancel', onPointerCancel, { capture: true })
  }
}
