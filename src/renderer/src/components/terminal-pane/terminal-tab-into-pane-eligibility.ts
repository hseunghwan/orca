import type { AppState } from '@/store'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { collectLayoutLeafIdsInOrder } from '../../../../shared/workspace-layout/terminal-pane-tree'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { isWebClientLocation } from '@/lib/web-client-location'
import { isHostAuthoritativeLayout } from './terminal-live-layout-reconciliation'
import { isTerminalLeafMoveInFlight, isTerminalTabMoveInFlight } from './terminal-leaf-move-guard'

export type TerminalTabIntoPaneState = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'pendingStartupByTabId'
  | 'automaticAgentResumeClaimsByTabId'
  | 'pendingInitialCwdByTabId'
  | 'pendingIssueCommandSplitByTabId'
  | 'unverifiedPtyLossTabIds'
  | 'sleepingAgentSessionsByPaneKey'
  | 'pendingPtyShutdownIds'
>

export type TerminalTabIntoPaneRefusal =
  | 'layout_owner_build'
  | 'same_tab'
  | 'source_missing'
  | 'target_missing'
  | 'worktree_mismatch'
  | 'source_not_single_pane'
  | 'source_pane_missing'
  | 'source_chat'
  | 'target_chat'
  | 'target_pane_missing'
  | 'no_terminal'
  | 'pending_spawn'
  | 'launch_pending'
  | 'sleeping'
  | 'pty_exiting'
  | 'startup_pending'
  | 'unverified_pty_loss'
  | 'host_authoritative'
  | 'move_in_flight'

/** What joins the target: a whole tab, which must hold one pane, or one pane of a tab. */
export type TerminalJoinSource =
  | { kind: 'tab'; tabId: string }
  | { kind: 'pane'; tabId: string; leafId: string }

export type TerminalTabIntoPaneEligibility =
  | {
      ok: true
      worktreeId: string
      leafId: string
      ptyId: string
      targetLeafId: string
      /** Both tabs live on a paired host, which makes the join in its own window. */
      viaHost: boolean
      /** The source tab holds other panes, so it stays open without the moved one. */
      sourceKeepsPanes: boolean
    }
  | { ok: false; reason: TerminalTabIntoPaneRefusal }

const SOURCE_WIDE_REFUSALS: ReadonlySet<TerminalTabIntoPaneRefusal> = new Set([
  'layout_owner_build',
  'source_missing',
  'source_not_single_pane',
  'source_pane_missing',
  'source_chat',
  'no_terminal',
  'pending_spawn',
  'launch_pending',
  'sleeping',
  'pty_exiting',
  'startup_pending',
  'unverified_pty_loss'
])

/** Whether the refusal comes from the source tab alone, so it would repeat on every target. */
export function isSourceWideRefusal(reason: TerminalTabIntoPaneRefusal): boolean {
  return SOURCE_WIDE_REFUSALS.has(reason)
}

function findTab(state: TerminalTabIntoPaneState, tabId: string): TerminalTab | undefined {
  return Object.values(state.tabsByWorktree)
    .flat()
    .find((tab) => tab.id === tabId)
}

function hasQueuedTabWork(state: TerminalTabIntoPaneState, tabId: string): boolean {
  // closeTab drops each of these with the tab, so a move would silently lose the queued work.
  return [
    state.pendingStartupByTabId,
    state.automaticAgentResumeClaimsByTabId,
    state.pendingInitialCwdByTabId,
    state.pendingIssueCommandSplitByTabId
  ].some((byTabId) => tabId in byTabId)
}

/** The leaf that moves for this source, or why the source has none to give. */
function sourceLeafOf(
  source: TerminalJoinSource,
  leafIds: string[]
): { leafId: string } | { refusal: TerminalTabIntoPaneRefusal } | null {
  if (source.kind === 'pane') {
    return leafIds.includes(source.leafId)
      ? { leafId: source.leafId }
      : { refusal: 'source_pane_missing' }
  }
  if (leafIds.length > 1) {
    return { refusal: 'source_not_single_pane' }
  }
  return leafIds[0] ? { leafId: leafIds[0] } : null
}

/**
 * Whether `source` may join `targetTabId`'s pane. Pure over the store, so a drop target can show
 * its refusal reason and the move can recheck at the moment it runs. Main re-checks what it can
 * see; the checks here are the renderer-only ones it cannot.
 */
export function resolveTerminalTabIntoPaneEligibility(
  state: TerminalTabIntoPaneState,
  args: {
    source: TerminalJoinSource
    targetTabId: string
    targetLeafId?: string | null
    isWebClient?: boolean
    /** Whether the worktree's paired host joins host-owned tabs itself, as last probed. */
    hostJoinsTabs?: (worktreeId: string) => boolean
  }
): TerminalTabIntoPaneEligibility {
  const { source: joinSource, targetTabId } = args
  const sourceTabId = joinSource.tabId
  const refuse = (reason: TerminalTabIntoPaneRefusal): TerminalTabIntoPaneEligibility => ({
    ok: false,
    reason
  })
  if (ORCA_LAYOUT_OWNER_IS_MAIN) {
    // Layout-owner builds draw moves from main's frames; this window-applied join would land twice.
    return refuse('layout_owner_build')
  }
  if (sourceTabId === targetTabId) {
    return refuse('same_tab')
  }
  const source = findTab(state, sourceTabId)
  const target = findTab(state, targetTabId)
  if (!source) {
    return refuse('source_missing')
  }
  if (!target) {
    return refuse('target_missing')
  }
  if (source.worktreeId !== target.worktreeId) {
    return refuse('worktree_mismatch')
  }
  const sourceLayout = state.terminalLayoutsByTabId[sourceTabId]
  const targetLayout = state.terminalLayoutsByTabId[targetTabId]
  const sourceLeafIds = collectLayoutLeafIdsInOrder(sourceLayout?.root ?? null)
  const sourceLeaf = sourceLeafOf(joinSource, sourceLeafIds)
  if (sourceLeaf && 'refusal' in sourceLeaf) {
    return refuse(sourceLeaf.refusal)
  }
  const leafId = sourceLeaf?.leafId ?? null
  if (source.viewMode === 'chat' || (leafId && sourceLayout?.chatLeafId === leafId)) {
    return refuse('source_chat')
  }
  // The tab row's PTY stands in only for its only pane; with several it names another one.
  const ptyId = leafId
    ? (sourceLayout?.ptyIdsByLeafId?.[leafId] ?? (sourceLeafIds.length === 1 ? source.ptyId : null))
    : null
  if (!leafId || !ptyId) {
    return refuse('no_terminal')
  }
  const isWebClient = args.isWebClient ?? isWebClientLocation()
  const sourceOnHost = isHostAuthoritativeLayout({
    isWebClient,
    ptyIdsByLeafId: { ...sourceLayout?.ptyIdsByLeafId, [leafId]: ptyId }
  })
  const targetOnHost = isHostAuthoritativeLayout({
    isWebClient,
    ptyIdsByLeafId: targetLayout?.ptyIdsByLeafId
  })
  // A host-owned layout changes only on its host; a join this window drew alone would revert.
  const viaHost = sourceOnHost && targetOnHost && args.hostJoinsTabs?.(source.worktreeId) === true
  if ((sourceOnHost || targetOnHost) && !viaHost) {
    return refuse('host_authoritative')
  }
  if (source.pendingActivationSpawn) {
    return refuse('pending_spawn')
  }
  if (source.agentLaunchPane?.leafId === leafId && !source.agentLaunchPane.outcome) {
    return refuse('launch_pending')
  }
  if (makePaneKey(sourceTabId, leafId) in state.sleepingAgentSessionsByPaneKey) {
    return refuse('sleeping')
  }
  if (state.pendingPtyShutdownIds[ptyId]) {
    return refuse('pty_exiting')
  }
  if (hasQueuedTabWork(state, sourceTabId)) {
    return refuse('startup_pending')
  }
  if (sourceTabId in state.unverifiedPtyLossTabIds) {
    return refuse('unverified_pty_loss')
  }
  // After every source-only check, so an ineligible source reads the same over any target.
  if (target.viewMode === 'chat') {
    return refuse('target_chat')
  }
  const targetLeafIds = collectLayoutLeafIdsInOrder(targetLayout?.root ?? null)
  const targetLeafId =
    args.targetLeafId ??
    (targetLayout?.activeLeafId && targetLeafIds.includes(targetLayout.activeLeafId)
      ? targetLayout.activeLeafId
      : targetLeafIds[0])
  if (!targetLeafId || !targetLeafIds.includes(targetLeafId)) {
    return refuse('target_pane_missing')
  }
  // Why: createTab puts a chat tab's viewMode only on its tab-bar entry, so its row can pass the check above.
  if (targetLayout?.chatLeafId === targetLeafId) {
    return refuse('target_chat')
  }
  if (
    isTerminalLeafMoveInFlight(leafId) ||
    isTerminalTabMoveInFlight(sourceTabId) ||
    isTerminalTabMoveInFlight(targetTabId)
  ) {
    return refuse('move_in_flight')
  }
  return {
    ok: true,
    worktreeId: source.worktreeId,
    leafId,
    ptyId,
    targetLeafId,
    viaHost,
    sourceKeepsPanes: sourceLeafIds.length > 1
  }
}
