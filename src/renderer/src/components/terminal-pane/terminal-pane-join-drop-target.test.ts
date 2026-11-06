/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest'
import type { LeafTargetState } from '../tab-group/tab-drag-leaf-target'
import {
  A,
  C,
  geometrySnapshot,
  leafRectsFor,
  leafTargetState,
  SOURCE,
  SOURCE_UNIFIED,
  TARGET,
  WT
} from '../tab-group/tab-drag-leaf-target-fixture'
import { resolveTerminalPaneJoinDropTarget } from './terminal-pane-join-drop-target'
import { splitSourceLayout, targetLayout } from './terminal-tab-into-pane-fixture'

vi.mock('../../../../shared/layout-owner-switch', () => ({ ORCA_LAYOUT_OWNER_IS_MAIN: false }))
vi.mock('@/runtime/web-runtime-leaf-move', () => ({ hostJoinsTabsIntoPanes: () => false }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

/** S split into A and D is dragged from; the group shows T (B left, C right of a 1000px body). */
function splitSourceState(patch: Partial<LeafTargetState> = {}): LeafTargetState {
  return leafTargetState({
    terminalLayoutsByTabId: { [SOURCE]: splitSourceLayout(), [TARGET]: targetLayout() },
    ...patch
  })
}

function resolveAt(pointer: { x: number; y: number }, state = splitSourceState()) {
  return resolveTerminalPaneJoinDropTarget({
    sourceTabId: SOURCE,
    leafId: A,
    pointer,
    worktreeId: WT,
    state,
    geometry: geometrySnapshot(),
    readLeafRects: () => leafRectsFor('split')
  })
}

// Interior x 200..800; C spans x 500..1000 of the body (y 32..600), so its right band is x 700..800.
describe('resolveTerminalPaneJoinDropTarget', () => {
  it('joins the right half of another shown tab pane, with the tab drag geometry and label', () => {
    expect(resolveAt({ x: 750, y: 316 })).toEqual({
      id: `join:${TARGET}:${C}:right`,
      rect: { left: 750, top: 32, width: 250, height: 568 },
      overlay: { kind: 'join', label: 'Join as split', refused: false },
      join: expect.objectContaining({
        targetTabId: TARGET,
        leafId: C,
        side: 'right',
        refusal: null
      })
    })
  })

  it('is no target in the outer New split band or in a pane center', () => {
    expect(resolveAt({ x: 900, y: 316 })).toBeNull()
    expect(resolveAt({ x: 650, y: 316 })).toBeNull()
  })

  it("never targets the dragged pane's own tab: its own panes reorder in place", () => {
    const ownTabShown = splitSourceState({
      groupsByWorktree: {
        [WT]: [
          {
            id: 'group-1',
            worktreeId: WT,
            activeTabId: SOURCE_UNIFIED,
            tabOrder: [SOURCE_UNIFIED]
          }
        ]
      }
    })

    expect(resolveAt({ x: 750, y: 316 }, ownTabShown)).toBeNull()
  })

  it('shows a target that cannot take the pane as refused, with the reason', () => {
    const chatTarget = splitSourceState({
      tabsByWorktree: {
        [WT]: splitSourceState().tabsByWorktree[WT]!.map((tab) =>
          tab.id === TARGET ? { ...tab, viewMode: 'chat' as const } : tab
        )
      }
    })

    expect(resolveAt({ x: 750, y: 316 }, chatTarget)?.overlay).toEqual({
      kind: 'join',
      label: 'Chat view',
      refused: true
    })
  })
})
