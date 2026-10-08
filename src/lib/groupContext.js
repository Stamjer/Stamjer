let scope = { userId: null, groupId: null }
let generation = 0
const pending = new Set()
const writes = new Set()
export function hasPendingGroupWrites() { return writes.size > 0 }
export function getGroupContext() { return { ...scope, generation } }
export function groupCacheScope() { return [scope.userId, scope.groupId] }
export function setGroupContext(user) {
  const next = { userId: user?.id || null, groupId: user?.groupId || null }
  if (next.userId !== scope.userId || next.groupId !== scope.groupId) {
    generation++
    for (const controller of pending) controller.abort()
    pending.clear()
  }
  scope = next
}
export function trackGroupRequest(controller, method = 'GET') {
  pending.add(controller)
  if (!['GET', 'HEAD'].includes(method)) writes.add(controller)
  return () => { pending.delete(controller); writes.delete(controller) }
}
