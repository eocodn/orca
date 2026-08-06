export function haveSameTerminalIdSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id))
}
