import type {
  TerminalLayoutSnapshot,
  TerminalTab
} from '../../../../shared/workspace-layout/terminal-tab-types'
import type { TerminalTabIntoPaneState } from './terminal-tab-into-pane-eligibility'

export const WT = 'repo1::/worktree'
export const SOURCE = 'tab-source'
export const TARGET = 'tab-target'
export const A = '11111111-1111-4111-8111-111111111111'
export const B = '22222222-2222-4222-8222-222222222222'
export const C = '33333333-3333-4333-8333-333333333333'
export const D = '44444444-4444-4444-8444-444444444444'
export const P_A = 'pty-a'
export const P_B = 'pty-b'
export const P_C = 'pty-c'
export const P_D = 'pty-d'

export function terminalTab(id: string, ptyId: string | null, patch: Partial<TerminalTab> = {}) {
  return {
    id,
    ptyId,
    worktreeId: WT,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    ...patch
  } satisfies TerminalTab
}

/** S is a single-leaf tab (leaf A, pty-a); T has two leaves (B, C) and its own primary pty-b. */
export function sourceLayout(): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId: A },
    activeLeafId: A,
    expandedLeafId: null,
    ptyIdsByLeafId: { [A]: P_A }
  }
}

/** S split in two: the moved leaf A (pty-a, S's primary) on the left, D (pty-d) on the right. */
export function splitSourceLayout(): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: A },
      second: { type: 'leaf', leafId: D }
    },
    activeLeafId: A,
    expandedLeafId: null,
    ptyIdsByLeafId: { [A]: P_A, [D]: P_D }
  }
}

export function targetLayout(): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: B },
      second: { type: 'leaf', leafId: C }
    },
    activeLeafId: C,
    expandedLeafId: null,
    ptyIdsByLeafId: { [B]: P_B, [C]: P_C }
  }
}

export function intoPaneState(
  patch: Partial<TerminalTabIntoPaneState> = {}
): TerminalTabIntoPaneState {
  return {
    tabsByWorktree: { [WT]: [terminalTab(SOURCE, P_A), terminalTab(TARGET, P_B)] },
    terminalLayoutsByTabId: { [SOURCE]: sourceLayout(), [TARGET]: targetLayout() },
    pendingStartupByTabId: {},
    automaticAgentResumeClaimsByTabId: {},
    pendingInitialCwdByTabId: {},
    pendingIssueCommandSplitByTabId: {},
    unverifiedPtyLossTabIds: {},
    sleepingAgentSessionsByPaneKey: {},
    pendingPtyShutdownIds: {},
    ...patch
  }
}
