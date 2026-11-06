import { retireLeavesFromTerminalLayout } from '../../../shared/workspace-layout/terminal-layout-leaf-retirement'
import type { TerminalLayoutSnapshot } from '../../../shared/workspace-layout/terminal-tab-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'

/**
 * The session with a moved leaf gone from its source tab. The source row and its remote session
 * move off the leaf's PTY onto a remaining pane's; the layout goes when no leaf remains, the row stays.
 */
export function pruneMovedLeafFromSourceTab(
  session: WorkspaceSessionState,
  move: { worktreeId: string; sourceTabId: string; leafId: string },
  sourceLayout: TerminalLayoutSnapshot,
  ptyId: string | null
): WorkspaceSessionState {
  const { worktreeId, sourceTabId, leafId } = move
  const remainingLayout = retireLeavesFromTerminalLayout(sourceLayout, new Set([leafId]))
  const survivorPtyId = Object.values(remainingLayout?.ptyIdsByLeafId ?? {})[0] ?? null
  const tabs = (session.tabsByWorktree?.[worktreeId] ?? []).map((tab) =>
    tab.id === sourceTabId && tab.ptyId === ptyId ? { ...tab, ptyId: survivorPtyId } : tab
  )
  const terminalLayoutsByTabId = { ...session.terminalLayoutsByTabId }
  if (remainingLayout) {
    terminalLayoutsByTabId[sourceTabId] = remainingLayout
  } else {
    // A sibling never bound here can recreate its layout when its own binding arrives.
    delete terminalLayoutsByTabId[sourceTabId]
  }
  const remoteSessionIdsByTabId = { ...session.remoteSessionIdsByTabId }
  if (ptyId && remoteSessionIdsByTabId[sourceTabId] === ptyId) {
    if (survivorPtyId) {
      remoteSessionIdsByTabId[sourceTabId] = survivorPtyId
    } else {
      delete remoteSessionIdsByTabId[sourceTabId]
    }
  }
  return {
    ...session,
    tabsByWorktree: { ...session.tabsByWorktree, [worktreeId]: tabs },
    terminalLayoutsByTabId,
    ...(session.remoteSessionIdsByTabId ? { remoteSessionIdsByTabId } : {})
  }
}
