import { describe, expect, it } from 'vitest'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'
import {
  A,
  B,
  FROM,
  intoRequest,
  intoTabSession,
  localPartition,
  sleepingRecord,
  SOURCE,
  TARGET,
  TO,
  WT
} from './terminal-leaf-move-into-tab-fixture'
import { planTerminalLeafMoveIntoTab } from './terminal-leaf-move-into-tab'

const D = '44444444-4444-4444-8444-444444444444'

/** S holds the moved leaf A (pty-a, S's primary) beside D (pty-d); T is the fixture's two-leaf tab. */
function splitSourceSession(patch: Partial<WorkspaceSessionState> = {}): WorkspaceSessionState {
  const session = intoTabSession({ terminalTopologyRevisionByRepoId: { 'repo-1': 4 }, ...patch })
  const single = session.terminalLayoutsByTabId[SOURCE]!
  session.terminalLayoutsByTabId[SOURCE] = {
    ...single,
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: A },
      second: { type: 'leaf', leafId: D }
    },
    ptyIdsByLeafId: { [A]: 'pty-a', [D]: 'pty-d' },
    titlesByLeafId: { [A]: 'agent title', [D]: 'd title' }
  }
  return session
}

function moved(
  session: WorkspaceSessionState,
  patch: Partial<typeof intoRequest> = {}
): WorkspaceSessionState {
  const planned = planTerminalLeafMoveIntoTab(localPartition(session), { ...intoRequest, ...patch })
  expect(planned.result).toEqual({ status: 'moved', ptyId: 'pty-a', sourceTabClosed: false })
  expect(planned.staleDroppedPtyIds).toEqual([])
  return planned.sessions[0]!.session
}

describe('moving one pane of a split tab into another tab', () => {
  it('grafts the pane into the target and keeps the source tab with its other pane', () => {
    const session = moved(splitSourceSession(), { keepsSourcePane: true })

    expect(session.terminalLayoutsByTabId[TARGET]?.ptyIdsByLeafId?.[A]).toBe('pty-a')
    expect(session.terminalLayoutsByTabId[TARGET]?.activeLeafId).toBe(A)
    expect(session.terminalLayoutsByTabId[SOURCE]).toMatchObject({
      root: { type: 'leaf', leafId: D },
      activeLeafId: D,
      ptyIdsByLeafId: { [D]: 'pty-d' },
      titlesByLeafId: { [D]: 'd title' }
    })
    expect(session.tabsByWorktree[WT]?.map((tab) => [tab.id, tab.ptyId])).toEqual([
      [SOURCE, 'pty-d'],
      [TARGET, 'pty-b']
    ])
    expect(session.unifiedTabs?.[WT]?.map((tab) => tab.id)).toEqual([SOURCE, TARGET])
    expect(session.closedTerminalTabTombstonesByTabId?.[SOURCE]).toBeUndefined()
    expect(session.terminalTopologyRevisionByRepoId?.['repo-1']).toBe(5)
  })

  it('does not name the moved pane after the source tab, which still names its other panes', () => {
    const session = splitSourceSession()
    session.tabsByWorktree[WT] = session.tabsByWorktree[WT]!.map((tab) =>
      tab.id === SOURCE ? { ...tab, customTitle: 'My build' } : tab
    )
    session.terminalLayoutsByTabId[SOURCE]!.titlesByLeafId = { [D]: 'd title' }

    expect(moved(session).terminalLayoutsByTabId[TARGET]?.titlesByLeafId?.[A]).toBeUndefined()
  })

  it('moves the pane-keyed records and its local scrollback off the surviving source', () => {
    const session = moved(
      splitSourceSession({
        sleepingAgentSessionsByPaneKey: { [FROM]: sleepingRecord(FROM, SOURCE) },
        localOnlyScrollbackByTabId: { [SOURCE]: { [A]: 'local-a', [D]: 'local-d' } }
      })
    )

    expect(session.terminalPtyIncarnationsByPaneKey).toEqual({
      [TO]: 'inc-a',
      [`${TARGET}:${B}`]: 'inc-b'
    })
    expect(session.sleepingAgentSessionsByPaneKey).toEqual({
      [TO]: expect.objectContaining({ paneKey: TO, tabId: TARGET })
    })
    expect(session.localOnlyScrollbackByTabId).toEqual({
      [SOURCE]: { [D]: 'local-d' },
      [TARGET]: { [A]: 'local-a' }
    })
  })

  it("hands the source's remote session to its remaining pane and leaves the target's alone", () => {
    const session = moved(
      splitSourceSession({ remoteSessionIdsByTabId: { [SOURCE]: 'pty-a', [TARGET]: 'pty-b' } })
    )

    expect(session.remoteSessionIdsByTabId).toEqual({ [SOURCE]: 'pty-d', [TARGET]: 'pty-b' })
  })
})
