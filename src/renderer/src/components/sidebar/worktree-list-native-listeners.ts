export function registerWorktreeListDocumentDropListener(
  onDrop: (event: DragEvent) => void
): () => void {
  document.addEventListener('drop', onDrop, true)
  return () => document.removeEventListener('drop', onDrop, true)
}

export function registerWorktreeListDragEndListener(onDragEnd: () => void): () => void {
  document.addEventListener('dragend', onDragEnd, true)
  return () => document.removeEventListener('dragend', onDragEnd, true)
}

export function registerWorktreeListVisibilityListener(onVisibilityChange: () => void): () => void {
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
}
