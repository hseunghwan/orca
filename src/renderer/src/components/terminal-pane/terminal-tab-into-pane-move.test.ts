import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { createStoreCascadesMockApi } from '@/store/slices/store-cascades-test-harness'
import { moveTerminalTabIntoPane } from './terminal-tab-into-pane-move'
import { createJoinHarness } from './terminal-tab-into-pane-move-harness'
import { A, B, C, P_A, P_B, SOURCE, TARGET, WT } from './terminal-tab-into-pane-fixture'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn<() => unknown[]>(() => [])
}))

const mockApi = createStoreCascadesMockApi()
Object.assign(mockApi, { session: { closeTerminalSurface: vi.fn().mockResolvedValue(undefined) } })

const join = { sourceTabId: SOURCE, targetTabId: TARGET, side: 'right' } as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('moveTerminalTabIntoPane apply order (spec 5.1)', () => {
  it('asks main with the live PTY, then the pane, its agent and focus all end up in the target', async () => {
    const h = createJoinHarness(createTestStore())
    h.store
      .getState()
      .setAgentStatus(`${SOURCE}:${A}`, { state: 'working', prompt: 'go', agentType: 'claude' })

    await expect(moveTerminalTabIntoPane(join, h.deps)).resolves.toBe('moved')

    expect(h.requests).toEqual([
      {
        worktreeId: WT,
        sourceTabId: SOURCE,
        targetTabId: TARGET,
        targetLeafId: C,
        leafId: A,
        ptyId: P_A,
        placement: { kind: 'beside', side: 'right' }
      }
    ])
    const state = h.store.getState()
    expect(state.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([TARGET])
    expect(state.terminalLayoutsByTabId[TARGET]?.ptyIdsByLeafId?.[A]).toBe(P_A)
    expect(state.agentStatusByPaneKey[`${SOURCE}:${A}`]).toBeUndefined()
    expect(state.agentStatusByPaneKey[`${TARGET}:${A}`]).toMatchObject({ tabId: TARGET })
    expect(h.splits.map((split) => split.newLeafId)).toEqual([A])
    expect(h.calls).toContain(`setActiveTab:${TARGET}`)
    expect(h.calls).toContain('graphSync')
  })

  it('the target owns the PTY before the source closes: no kill, layout and ownership kept', async () => {
    const h = createJoinHarness(createTestStore())

    await moveTerminalTabIntoPane(join, h.deps)
    await Promise.resolve()

    expect(mockApi.pty.kill).not.toHaveBeenCalled()
    const state = h.store.getState()
    expect(state.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([TARGET])
    expect(state.ptyIdsByTabId[TARGET]).toContain(P_A)
    expect(state.terminalLayoutsByTabId[TARGET]?.ptyIdsByLeafId?.[A]).toBe(P_A)
    expect(state.terminalLayoutsByTabId[SOURCE]).toBeUndefined()
  })

  it('R22: the target primary PTY stays although the moved leaf is now active', async () => {
    const h = createJoinHarness(createTestStore())

    await moveTerminalTabIntoPane(join, h.deps)

    const target = h.store.getState().tabsByWorktree[WT]?.find((tab) => tab.id === TARGET)
    expect(target?.ptyId).toBe(P_B)
    expect(h.store.getState().terminalLayoutsByTabId[TARGET]?.activeLeafId).toBe(A)
  })

  it.each([
    ['left', 'vertical', 'before'],
    ['right', 'vertical', 'after'],
    ['top', 'horizontal', 'before'],
    ['bottom', 'horizontal', 'after']
  ] as const)(
    'a %s join dispatches a %s split %s the target leaf, adopting the PTY',
    async (side, direction, placement) => {
      const h = createJoinHarness(createTestStore())

      await moveTerminalTabIntoPane({ ...join, side }, h.deps)

      expect(h.splits).toEqual([
        {
          tabId: TARGET,
          worktreeId: WT,
          paneRuntimeId: -1,
          sourceLeafId: C,
          newLeafId: A,
          ptyId: P_A,
          direction,
          placement
        }
      ])
    }
  )

  it('carries the source custom title to the moved pane when the leaf has none (decision 7)', async () => {
    const h = createJoinHarness(createTestStore())
    h.store.setState((s) => ({
      tabsByWorktree: {
        [WT]: s.tabsByWorktree[WT]!.map((tab) =>
          tab.id === SOURCE ? { ...tab, customTitle: 'My build' } : tab
        )
      }
    }))

    await moveTerminalTabIntoPane(join, h.deps)

    expect(h.store.getState().terminalLayoutsByTabId[TARGET]?.titlesByLeafId?.[A]).toBe('My build')
  })

  it('R41: the expanded target pane is collapsed by the time the split is dispatched', async () => {
    const h = createJoinHarness(createTestStore())
    h.store.setState({ expandedPaneByTabId: { [TARGET]: true } })

    await moveTerminalTabIntoPane(join, h.deps)

    expect(h.splits).toHaveLength(1)
    expect(h.expandedAtSplit).toEqual([false])
    expect(h.store.getState().expandedPaneByTabId[TARGET]).toBe(false)
  })

  it('splits beside another mounted leaf when the target leaf is no longer mounted', async () => {
    const h = createJoinHarness(createTestStore(), { mountedLeafIds: () => [B] })

    await moveTerminalTabIntoPane({ ...join, targetLeafId: C }, h.deps)

    expect(h.splits[0]?.sourceLeafId).toBe(B)
  })

  it('does not dispatch a split for an unmounted target: it restores from the stored layout', async () => {
    const h = createJoinHarness(createTestStore(), { mountedLeafIds: () => null })

    await expect(moveTerminalTabIntoPane(join, h.deps)).resolves.toBe('moved')

    expect(h.splits).toEqual([])
    expect(h.remount).not.toHaveBeenCalled()
    expect(h.store.getState().terminalLayoutsByTabId[TARGET]?.ptyIdsByLeafId?.[A]).toBe(P_A)
  })

  it('splits beside another leaf when the target leaf left the stored layout during the await', async () => {
    const h = createJoinHarness(createTestStore())
    h.answerWith(() => {
      h.store.setState((s) => ({
        terminalLayoutsByTabId: {
          ...s.terminalLayoutsByTabId,
          [TARGET]: {
            root: { type: 'leaf', leafId: B },
            activeLeafId: B,
            expandedLeafId: null,
            ptyIdsByLeafId: { [B]: P_B }
          }
        }
      }))
      return Promise.resolve({ status: 'moved', ptyId: P_A, sourceTabClosed: true })
    })

    await moveTerminalTabIntoPane({ ...join, targetLeafId: C }, h.deps)

    const layout = h.store.getState().terminalLayoutsByTabId[TARGET]
    expect(layout?.ptyIdsByLeafId?.[A]).toBe(P_A)
    expect(layout?.root?.type).toBe('split')
  })

  describe('post-dispatch check', () => {
    it('remounts the target from the store layout when the split handler dropped the pane', async () => {
      const h = createJoinHarness(createTestStore(), {
        mountedLeafIds: () => [B, C],
        dispatchSplit: () => {}
      })

      await moveTerminalTabIntoPane(join, h.deps)

      expect(h.calls).toContain(`remount:${TARGET}`)
      expect(h.calls.indexOf(`remount:${TARGET}`)).toBeLessThan(
        h.calls.indexOf(`closeTab:${SOURCE}`)
      )
    })

    it('does not remount when the new pane appeared', async () => {
      let mounted = [B, C]
      const h = createJoinHarness(createTestStore(), {
        mountedLeafIds: () => mounted,
        dispatchSplit: () => {
          mounted = [B, C, A]
        }
      })

      await moveTerminalTabIntoPane(join, h.deps)

      expect(h.remount).not.toHaveBeenCalled()
    })
  })
})
