import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { layoutContainsLeafId } from '../restoring-sessions/terminal-layout-normalization'

/**
 * The live tab that holds a leaf, for a hook key whose tab no longer does. Returns the given tab
 * while it still holds the leaf, the single other holder otherwise, and null for none or several.
 * A layout left behind by a removed tab row owns nothing.
 */
export function findLiveLeafOwnerTabId(
  sessions: readonly WorkspaceSessionState[],
  tabId: string,
  leafId: string
): string | null {
  const holders = new Set<string>()
  for (const session of sessions) {
    const liveTabIds = new Set(
      Object.values(session.tabsByWorktree ?? {}).flatMap((tabs) => tabs.map((tab) => tab.id))
    )
    for (const [layoutTabId, layout] of Object.entries(session.terminalLayoutsByTabId ?? {})) {
      if (liveTabIds.has(layoutTabId) && layoutContainsLeafId(layout?.root ?? null, leafId)) {
        holders.add(layoutTabId)
      }
    }
  }
  if (holders.has(tabId)) {
    return tabId
  }
  return holders.size === 1 ? ([...holders][0] ?? null) : null
}
