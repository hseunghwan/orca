import { useCallback } from 'react'
import type { PaneExternalDropTarget } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '../../store'
import {
  detachTerminalPaneToTab,
  isTerminalTabStripDropTarget,
  resolveTerminalTabStripDropTarget,
  type TerminalPaneNewTabTarget
} from './terminal-pane-tab-detach'
import {
  isTerminalPaneJoinDropTarget,
  resolveTerminalPaneJoinDropTarget,
  type TerminalPaneJoinDropTarget
} from './terminal-pane-join-drop-target'
import { moveTerminalTabIntoPaneInApp } from './terminal-tab-into-pane-deps'
import type { TerminalPaneBindingController } from './use-terminal-pane-layout-bindings'

/** Moving a pane out of its tab: by dragging it onto a tab strip or another tab's pane, or for another client. */
export function useTerminalPaneTabDetachActions(controller: TerminalPaneBindingController) {
  const { managerRef, paneCwdRef, paneTransportsRef, persistLayoutSnapshot, tabId, worktreeId } =
    controller
  const resolveExternalPaneDropTarget = useCallback(
    ({
      sourcePaneId,
      clientX,
      clientY
    }: {
      sourcePaneId: number
      clientX: number
      clientY: number
    }) => {
      const manager = managerRef.current
      const panes = manager?.getPanes() ?? []
      if (panes.length <= 1 || !panes.some((pane) => pane.id === sourcePaneId)) {
        return null
      }
      const state = useAppStore.getState()
      const leafId = manager?.getLeafId(sourcePaneId)
      return (
        resolveTerminalTabStripDropTarget({
          clientX,
          clientY,
          groupsByWorktree: state.groupsByWorktree,
          worktreeId
        }) ??
        (leafId
          ? resolveTerminalPaneJoinDropTarget({
              sourceTabId: tabId,
              leafId,
              pointer: { x: clientX, y: clientY },
              worktreeId,
              state
            })
          : null)
      )
    },
    [tabId, worktreeId, managerRef]
  )
  const detachPaneToNewTab = useCallback(
    (sourcePaneId: number, target: TerminalPaneNewTabTarget) => {
      const sourceTransport = paneTransportsRef.current.get(sourcePaneId)
      const livePtyId = sourceTransport?.getPtyId() ?? null
      const sourcePaneCwd = paneCwdRef.current.get(sourcePaneId)
      return detachTerminalPaneToTab({
        livePtyId,
        getStore: useAppStore.getState,
        manager: managerRef.current,
        persistLayoutSnapshot,
        sourcePaneId,
        ...(sourcePaneCwd ? { sourcePaneCwd } : {}),
        sourceConnectPending: sourceTransport?.isConnectPending?.() ?? false,
        sourceTabId: tabId,
        targetGroupId: target.groupId,
        targetIndex: target.index,
        ...(target.targetTabId ? { targetTabId: target.targetTabId } : {}),
        worktreeId
      })
    },
    [persistLayoutSnapshot, tabId, worktreeId, managerRef, paneCwdRef, paneTransportsRef]
  )
  const joinPaneIntoTab = useCallback(
    (sourcePaneId: number, { join }: TerminalPaneJoinDropTarget) => {
      const leafId = managerRef.current?.getLeafId(sourcePaneId)
      // A refused target showed why it cannot take the pane; dropping there changes nothing.
      if (join.refusal || !leafId) {
        return
      }
      persistLayoutSnapshot()
      void moveTerminalTabIntoPaneInApp({
        source: { kind: 'pane', tabId, leafId },
        targetTabId: join.targetTabId,
        targetLeafId: join.leafId,
        side: join.side
      }).catch((error) => console.warn('[terminal-pane-join] move failed', error))
    },
    [persistLayoutSnapshot, tabId, managerRef]
  )
  const handleExternalPaneDrop = useCallback(
    (sourcePaneId: number, target: PaneExternalDropTarget): boolean => {
      if (isTerminalPaneJoinDropTarget(target)) {
        joinPaneIntoTab(sourcePaneId, target)
        return true
      }
      if (!isTerminalTabStripDropTarget(target)) {
        return false
      }
      void detachPaneToNewTab(sourcePaneId, {
        groupId: target.groupId,
        index: target.insertionIndex
      }).catch((error) => console.warn('[terminal-pane-detach] move failed', error))
      return true
    },
    [detachPaneToNewTab, joinPaneIntoTab]
  )

  return { resolveExternalPaneDropTarget, handleExternalPaneDrop, detachPaneToNewTab }
}
