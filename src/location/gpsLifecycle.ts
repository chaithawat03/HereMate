/** Android system permission activities may report background before returning. */
export function shouldCancelForAppState(next: string, permissionPending: boolean): boolean {
  return next === 'background' && !permissionPending;
}
