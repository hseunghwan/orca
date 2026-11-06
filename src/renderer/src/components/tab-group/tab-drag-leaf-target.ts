import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import type { PaneSide } from '../../../../shared/workspace-layout/terminal-pane-tree'
import type { AppState } from '../../store/types'
import {
  isSourceWideRefusal,
  resolveTerminalTabIntoPaneEligibility,
  type TerminalJoinSource,
  type TerminalTabIntoPaneEligibility,
  type TerminalTabIntoPaneRefusal,
  type TerminalTabIntoPaneState
} from '../terminal-pane/terminal-tab-into-pane-eligibility'
import { hostJoinsTabsIntoPanes } from '@/runtime/web-runtime-leaf-move'
import type { TabDragItemData, TabDropZone } from './tab-drag-data'
import {
  escapeCssAttrValue,
  findTabGroupPanelUnderPointer,
  getTabGroupBodyRect,
  type TabGroupPanelGeometrySnapshot
} from './tab-group-panel-split-target'
import { paneColumnInteriorRect, resolveLeafDropZone, type PaneRect } from './tab-drop-zone'

export type LeafRect = { leafId: string; rect: PaneRect }

/** A shown tab's pane edge under the pointer; it names no drag source. */
export type LeafEdgeHit = {
  groupId: string
  targetTabId: string
  leafId: string
  zone: Exclude<TabDropZone, 'center'>
  side: PaneSide
  /** The visible leaf, clipped to its group body: the overlay is drawn on it. */
  leafRect: PaneRect
}

/** A pane edge a dragged terminal joins, with why a drop there would be refused (null: it joins). */
export type LeafJoinTarget = LeafEdgeHit & { refusal: TerminalTabIntoPaneRefusal | null }

export type LeafTargetState = TerminalTabIntoPaneState &
  Pick<AppState, 'groupsByWorktree' | 'unifiedTabsByWorktree'>

const SIDE_BY_ZONE: Record<Exclude<TabDropZone, 'center'>, PaneSide> = {
  left: 'left',
  right: 'right',
  up: 'top',
  down: 'bottom'
}

// Not about this leaf at all: the drag keeps today's behaviour and shows no leaf overlay.
const UNRELATED_REFUSALS: ReadonlySet<TerminalTabIntoPaneRefusal> = new Set([
  'same_tab',
  'target_missing',
  'worktree_mismatch'
])

/** Whether `source` may join `targetLeafId`, joining through a paired host that can. */
export function resolveDragJoinEligibility(
  state: TerminalTabIntoPaneState,
  args: { source: TerminalJoinSource; targetTabId: string; targetLeafId: string }
): TerminalTabIntoPaneEligibility {
  return resolveTerminalTabIntoPaneEligibility(state, {
    ...args,
    hostJoinsTabs: hostJoinsTabsIntoPanes
  })
}

/** Whether two targets name the same pane edge of the same shown tab. */
export function isSameJoinTarget(a: LeafJoinTarget, b: LeafJoinTarget | null): boolean {
  return (
    b !== null &&
    a.groupId === b.groupId &&
    a.targetTabId === b.targetTabId &&
    a.leafId === b.leafId &&
    a.zone === b.zone
  )
}

/** The mounted, visible panes of a terminal tab, in viewport coordinates. */
export function readMountedLeafRects(tabId: string): LeafRect[] {
  const roots = document.querySelectorAll<HTMLElement>(
    `[data-terminal-tab-id="${escapeCssAttrValue(tabId)}"]`
  )
  return Array.from(roots).flatMap((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('.pane[data-leaf-id]')).flatMap((pane) => {
      const { leafId } = pane.dataset
      const rect = pane.getBoundingClientRect()
      if (!leafId || rect.width <= 0 || rect.height <= 0) {
        return []
      }
      const { left, top, width, height } = rect
      return [{ leafId, rect: { left, top, width, height } }]
    })
  )
}

function intersect(a: PaneRect, b: PaneRect): PaneRect | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right <= left || bottom <= top) {
    return null
  }
  return { left, top, width: right - left, height: bottom - top }
}

function contains(rect: PaneRect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  )
}

/** The half of the pane on the side a joining terminal would land on. */
export function leafJoinHalfRect({ leafRect: rect, zone }: LeafEdgeHit): PaneRect {
  switch (zone) {
    case 'up':
      return { ...rect, height: rect.height / 2 }
    case 'down':
      return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 }
    case 'left':
      return { ...rect, width: rect.width / 2 }
    case 'right':
      return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 }
  }
}

/**
 * The pane edge of another shown terminal tab under the pointer, inside the group's interior (the
 * Level 1 band and a leaf's center are not edges). `sourceTabId` is never a target. Null in a
 * layout-owner build, which draws every move from main's frames.
 */
export function resolveLeafEdgeUnderPointer({
  pointer,
  worktreeId,
  sourceTabId,
  state,
  geometry,
  readLeafRects = readMountedLeafRects
}: {
  pointer: { x: number; y: number }
  worktreeId: string
  sourceTabId: string
  state: Pick<AppState, 'groupsByWorktree' | 'unifiedTabsByWorktree'>
  geometry: TabGroupPanelGeometrySnapshot | null
  readLeafRects?: (tabId: string) => LeafRect[]
}): LeafEdgeHit | null {
  if (ORCA_LAYOUT_OWNER_IS_MAIN) {
    return null
  }
  const panelHit = findTabGroupPanelUnderPointer(worktreeId, pointer, { geometry })
  if (!panelHit) {
    return null
  }
  const bodyRect =
    geometry?.byGroupId.get(panelHit.groupId)?.bodyRect ??
    getTabGroupBodyRect(panelHit.groupId, worktreeId)
  const interior = bodyRect ? paneColumnInteriorRect(panelHit.panelRect, { bodyRect }) : null
  if (!bodyRect || !interior || !contains(interior, pointer)) {
    return null
  }
  const group = (state.groupsByWorktree[worktreeId] ?? []).find((g) => g.id === panelHit.groupId)
  // During a tab drag the group's active tab is the preview, which is what is on screen.
  const shown = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.id === group?.activeTabId && tab.groupId === panelHit.groupId
  )
  if (!shown || shown.contentType !== 'terminal' || shown.entityId === sourceTabId) {
    return null
  }
  const leaf = readLeafRects(shown.entityId)
    .flatMap(({ leafId, rect }) => {
      const visible = intersect(rect, bodyRect)
      return visible ? [{ leafId, rect: visible }] : []
    })
    .find(({ rect }) => contains(rect, pointer))
  const effective = leaf ? intersect(leaf.rect, interior) : null
  const zone = effective ? resolveLeafDropZone(effective, pointer) : null
  if (!leaf || !zone || zone === 'center') {
    return null
  }
  return {
    groupId: panelHit.groupId,
    targetTabId: shown.entityId,
    leafId: leaf.leafId,
    zone,
    side: SIDE_BY_ZONE[zone],
    leafRect: leaf.rect
  }
}

/**
 * The join target `hit` is for a dragged `source`. Null when the source cannot join anything, or
 * the hit is not about it: the drag keeps today's behaviour. A target that cannot take the source
 * is still returned, with its refusal, so the overlay can say why.
 */
export function resolveLeafJoinTarget(
  state: TerminalTabIntoPaneState,
  source: TerminalJoinSource,
  hit: LeafEdgeHit
): LeafJoinTarget | null {
  const eligibility = resolveDragJoinEligibility(state, {
    source,
    targetTabId: hit.targetTabId,
    targetLeafId: hit.leafId
  })
  if (
    !eligibility.ok &&
    (isSourceWideRefusal(eligibility.reason) || UNRELATED_REFUSALS.has(eligibility.reason))
  ) {
    return null
  }
  return { ...hit, refusal: eligibility.ok ? null : eligibility.reason }
}

/** The pane edge a dragged terminal tab would join, or null; see `resolveLeafJoinTarget`. */
export function resolveTabDragLeafTarget({
  activeDrag,
  pointer,
  worktreeId,
  state,
  geometry,
  readLeafRects = readMountedLeafRects
}: {
  activeDrag: TabDragItemData
  pointer: { x: number; y: number } | null
  worktreeId: string
  state: LeafTargetState
  geometry: TabGroupPanelGeometrySnapshot | null
  readLeafRects?: (tabId: string) => LeafRect[]
}): LeafJoinTarget | null {
  if (!pointer || activeDrag.tabType !== 'terminal' || activeDrag.worktreeId !== worktreeId) {
    return null
  }
  const sourceTabId = activeDrag.visibleTabId
  const hit = resolveLeafEdgeUnderPointer({
    pointer,
    worktreeId,
    sourceTabId,
    state,
    geometry,
    readLeafRects
  })
  return hit ? resolveLeafJoinTarget(state, { kind: 'tab', tabId: sourceTabId }, hit) : null
}
