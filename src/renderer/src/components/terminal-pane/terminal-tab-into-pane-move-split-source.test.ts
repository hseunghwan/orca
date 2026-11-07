import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { createStoreCascadesMockApi } from '@/store/slices/store-cascades-test-harness'
import type { TerminalLayoutSnapshot } from '../../../../shared/workspace-layout/terminal-tab-types'
import { moveTerminalTabIntoPane } from './terminal-tab-into-pane-move'
import { createJoinHarness } from './terminal-tab-into-pane-move-harness'
import type { TerminalTabIntoPaneDeps } from './terminal-tab-into-pane-types'
import {
  A,
  B,
  C,
  D,
  P_A,
  P_B,
  P_C,
  P_D,
  SOURCE,
  splitSourceLayout,
  TARGET,
  WT
} from './terminal-tab-into-pane-fixture'

vi.mock('../../../../shared/layout-owner-switch', () => ({ ORCA_LAYOUT_OWNER_IS_MAIN: false }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn<() => unknown[]>(() => [])
}))

const mockApi = createStoreCascadesMockApi()
Object.assign(mockApi, { session: { closeTerminalSurface: vi.fn().mockResolvedValue(undefined) } })

const paneJoin = {
  source: { kind: 'pane', tabId: SOURCE, leafId: A },
  targetTabId: TARGET,
  side: 'right'
} as const

const remainingSource: TerminalLayoutSnapshot = {
  root: { type: 'leaf', leafId: D },
  activeLeafId: D,
  expandedLeafId: null,
  ptyIdsByLeafId: { [D]: P_D }
}

/** S split into A and D, both mounted; T is the harness's mounted two-pane tab. */
function splitSourceHarness(overrides: Partial<TerminalTabIntoPaneDeps> = {}) {
  const h = createJoinHarness(createTestStore(), overrides)
  h.store.setState((s) => ({
    terminalLayoutsByTabId: { ...s.terminalLayoutsByTabId, [SOURCE]: splitSourceLayout() },
    ptyIdsByTabId: { ...s.ptyIdsByTabId, [SOURCE]: [P_A, P_D] }
  }))
  h.mountedByTab[SOURCE] = [A, D]
  return h
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('moving one pane of a split tab into another tab', () => {
  it('asks main to keep the source, then moves only that pane and keeps both tabs', async () => {
    const h = splitSourceHarness()
    h.answerWith(() => Promise.resolve({ status: 'moved', ptyId: P_A, sourceTabClosed: false }))

    await expect(moveTerminalTabIntoPane(paneJoin, h.deps)).resolves.toBe('moved')

    expect(h.requests).toEqual([expect.objectContaining({ leafId: A, keepsSourcePane: true })])
    const state = h.store.getState()
    expect(state.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([SOURCE, TARGET])
    expect(state.terminalLayoutsByTabId[SOURCE]).toMatchObject(remainingSource)
    expect(state.terminalLayoutsByTabId[TARGET]?.ptyIdsByLeafId).toEqual({
      [B]: P_B,
      [C]: P_C,
      [A]: P_A
    })
    expect(h.mountedByTab[SOURCE]).toEqual([D])
    expect(h.mountedByTab[TARGET]).toEqual([B, C, A])
    expect(h.calls).not.toContain(`closeTab:${SOURCE}`)
    expect(mockApi.pty.kill).not.toHaveBeenCalled()
  })

  it('lets go of the source pane before the target pane adopts the PTY', async () => {
    const h = splitSourceHarness()

    await moveTerminalTabIntoPane(paneJoin, h.deps)

    const released = h.calls.indexOf(`closePane:${SOURCE}:true`)
    expect(released).toBeGreaterThanOrEqual(0)
    expect(released).toBeLessThan(h.calls.indexOf('split'))
  })

  it('hands the PTY to the target, which keeps its own primary, and the source to its other pane', async () => {
    const h = splitSourceHarness()

    await moveTerminalTabIntoPane(paneJoin, h.deps)

    const state = h.store.getState()
    expect(state.ptyIdsByTabId[SOURCE]).toEqual([P_D])
    expect(state.ptyIdsByTabId[TARGET]).toContain(P_A)
    expect(state.tabsByWorktree[WT]?.map((tab) => [tab.id, tab.ptyId])).toEqual([
      [SOURCE, P_D],
      [TARGET, P_B]
    ])
  })

  it('does not ask main while the pane is not mounted here to let go of its PTY', async () => {
    const h = splitSourceHarness()
    delete h.mountedByTab[SOURCE]

    await expect(moveTerminalTabIntoPane(paneJoin, h.deps)).resolves.toBe('refused')

    expect(h.requests).toEqual([])
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('changes nothing when main refuses to empty a source this window still splits', async () => {
    const h = splitSourceHarness()
    h.answerWith(() => Promise.resolve({ status: 'refused', reason: 'last_pane' }))

    await expect(moveTerminalTabIntoPane(paneJoin, h.deps)).resolves.toBe('refused')

    expect(h.store.getState().terminalLayoutsByTabId[SOURCE]).toEqual(splitSourceLayout())
    expect(h.mountedByTab[SOURCE]).toEqual([A, D])
    expect(h.calls).toEqual([])
  })

  it('settles a lost reply from main: the pane in the target and gone from the kept source', async () => {
    const h = splitSourceHarness({
      readMainSession: () =>
        Promise.resolve({
          terminalLayoutsByTabId: {
            [SOURCE]: remainingSource,
            [TARGET]: { ...splitSourceLayout(), root: { type: 'leaf', leafId: A } }
          }
        })
    })
    h.answerWith(() => Promise.reject(new Error('lost')))

    await expect(moveTerminalTabIntoPane(paneJoin, h.deps)).resolves.toBe('moved')

    expect(h.store.getState().tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([SOURCE, TARGET])
    expect(h.store.getState().terminalLayoutsByTabId[SOURCE]).toMatchObject(remainingSource)
  })

  describe('on a paired host', () => {
    /** Both tabs host-owned; the host answers `outcome`, after its snapshot drew `snapshot` here. */
    function pairedHarness(
      outcome: 'moved' | 'unknown',
      snapshot: { sourceLeft: boolean; targetHolds: boolean }
    ) {
      const remote = (ptyId: string) => `remote:env-1@@${ptyId}`
      const moveTabIntoPaneOnHost = vi.fn(() => {
        h.store.setState((s) => ({
          terminalLayoutsByTabId: {
            ...s.terminalLayoutsByTabId,
            ...(snapshot.sourceLeft
              ? { [SOURCE]: { ...remainingSource, ptyIdsByLeafId: { [D]: remote(P_D) } } }
              : {}),
            ...(snapshot.targetHolds
              ? {
                  [TARGET]: {
                    ...s.terminalLayoutsByTabId[TARGET]!,
                    root: {
                      type: 'split' as const,
                      direction: 'vertical' as const,
                      first: s.terminalLayoutsByTabId[TARGET]!.root!,
                      second: { type: 'leaf' as const, leafId: A }
                    }
                  }
                }
              : {})
          }
        }))
        return Promise.resolve(outcome)
      })
      const h = splitSourceHarness({ hostJoinsTabs: () => true, moveTabIntoPaneOnHost })
      h.store.setState((s) => ({
        ptyIdsByTabId: { ...s.ptyIdsByTabId, [SOURCE]: [remote(P_A), remote(P_D)] },
        terminalLayoutsByTabId: Object.fromEntries(
          Object.entries(s.terminalLayoutsByTabId).map(([tabId, layout]) => [
            tabId,
            {
              ...layout,
              ptyIdsByLeafId: Object.fromEntries(
                Object.entries(layout.ptyIdsByLeafId ?? {}).map(([leafId, ptyId]) => [
                  leafId,
                  remote(ptyId)
                ])
              )
            }
          ])
        )
      }))
      return { h, moveTabIntoPaneOnHost }
    }

    it('names the pane to the host and does not ask its own main', async () => {
      const { h, moveTabIntoPaneOnHost } = pairedHarness('moved', {
        sourceLeft: false,
        targetHolds: false
      })

      await expect(moveTerminalTabIntoPane(paneJoin, h.deps)).resolves.toBe('moved')

      expect(moveTabIntoPaneOnHost).toHaveBeenCalledWith(
        expect.objectContaining({ leafId: A, keepsSourcePane: true }),
        paneJoin.source
      )
      expect(h.requests).toEqual([])
    })

    it.each([
      ['moved, its layout already redrawn without the pane', 'moved', true, true],
      ['moved, before its layout arrives', 'moved', false, false],
      ['answer lost, but its target already holds the pane', 'unknown', false, true]
    ] as const)(
      'lets go of the mirrored pane when the host %s',
      async (_case, outcome, sourceLeft, targetHolds) => {
        const { h } = pairedHarness(outcome, { sourceLeft, targetHolds })

        await moveTerminalTabIntoPane(paneJoin, h.deps)

        expect(h.mountedByTab[SOURCE]).toEqual([D])
        expect(h.store.getState().ptyIdsByTabId[SOURCE]).toEqual(['remote:env-1@@pty-d'])
        expect(h.store.getState().tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([
          SOURCE,
          TARGET
        ])
      }
    )

    it('keeps the pane when the answer was lost and the host still shows it in its tab', async () => {
      const { h } = pairedHarness('unknown', { sourceLeft: false, targetHolds: false })

      await expect(moveTerminalTabIntoPane(paneJoin, h.deps)).resolves.toBe('unknown')

      expect(h.mountedByTab[SOURCE]).toEqual([A, D])
      expect(h.calls).toEqual([])
    })
  })
})
