import type { PaneExternalDropTarget } from '@/lib/pane-manager/pane-manager'
import {
  leafJoinHalfRect,
  readMountedLeafRects,
  resolveLeafEdgeUnderPointer,
  resolveLeafJoinTarget,
  type LeafJoinTarget,
  type LeafRect,
  type LeafTargetState
} from '../tab-group/tab-drag-leaf-target'
import type { TabGroupPanelGeometrySnapshot } from '../tab-group/tab-group-panel-split-target'
import { describeLeafJoinTarget } from '../tab-group/TabLeafDropOverlay'

/** A dragged pane over another shown tab's pane edge, where dropping joins it as a split. */
export type TerminalPaneJoinDropTarget = PaneExternalDropTarget & { join: LeafJoinTarget }

/** The join target for one pane of `sourceTabId` dragged to `pointer`, with the tab drag's geometry. */
export function resolveTerminalPaneJoinDropTarget({
  sourceTabId,
  leafId,
  pointer,
  worktreeId,
  state,
  geometry = null,
  readLeafRects = readMountedLeafRects
}: {
  sourceTabId: string
  leafId: string
  pointer: { x: number; y: number }
  worktreeId: string
  state: LeafTargetState
  /** Group geometry already measured; without it the groups are read from the DOM. */
  geometry?: TabGroupPanelGeometrySnapshot | null
  readLeafRects?: (tabId: string) => LeafRect[]
}): TerminalPaneJoinDropTarget | null {
  const hit = resolveLeafEdgeUnderPointer({
    pointer,
    worktreeId,
    sourceTabId,
    state,
    geometry,
    readLeafRects
  })
  const join = hit
    ? resolveLeafJoinTarget(state, { kind: 'pane', tabId: sourceTabId, leafId }, hit)
    : null
  if (!join) {
    return null
  }
  return {
    id: `join:${join.targetTabId}:${join.leafId}:${join.zone}`,
    rect: leafJoinHalfRect(join),
    overlay: { kind: 'join', label: describeLeafJoinTarget(join), refused: join.refusal !== null },
    join
  }
}

export function isTerminalPaneJoinDropTarget(
  target: PaneExternalDropTarget
): target is TerminalPaneJoinDropTarget {
  return 'join' in target && typeof target.join === 'object' && target.join !== null
}
