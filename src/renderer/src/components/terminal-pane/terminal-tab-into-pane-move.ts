import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  TerminalLeafIntoTabRequest,
  TerminalLeafIntoTabResult
} from '../../../../shared/workspace-layout/terminal-leaf-move'
import { layoutContainsLeafId } from '../../../../shared/workspace-layout/terminal-pane-tree'
import {
  applyTerminalTabJoin,
  releaseFromSurvivingSource,
  sourceLayoutAfterMove
} from './terminal-tab-into-pane-apply'
import { resolveTerminalTabIntoPaneEligibility } from './terminal-tab-into-pane-eligibility'
import {
  holdTerminalMoveKeys,
  terminalLeafMoveKey,
  terminalTabMoveKey
} from './terminal-leaf-move-guard'
import type {
  TerminalTabIntoPaneArgs,
  TerminalTabIntoPaneDeps,
  TerminalTabIntoPaneOutcome
} from './terminal-tab-into-pane-types'

function reportMoveFailed(): void {
  toast.error(translate('terminal.paneMove.intoTabFailed', "Couldn't move the pane into that tab."))
}

/** Closes S here without touching its PTY: main already closed it, and T owns the PTY now. */
function closeSourceTab(deps: TerminalTabIntoPaneDeps, sourceTabId: string): void {
  deps.getStore().closeTab(sourceTabId, {
    reason: 'cleanup',
    recordInteraction: false,
    captureRecentlyClosed: false,
    localPtyTeardownOwnedExternally: true
  })
}

/** Main moved the pane: S lets go of it here, closing when it was S's last pane. */
function dropMovedPaneFromSource(
  deps: TerminalTabIntoPaneDeps,
  request: TerminalLeafIntoTabRequest,
  ptyId: string
): void {
  const store = deps.getStore()
  const sourceStillHere = Object.values(store.tabsByWorktree)
    .flat()
    .some((tab) => tab.id === request.sourceTabId)
  const layout = store.terminalLayoutsByTabId[request.sourceTabId]
  // A source that already let go of the pane keeps its other panes.
  if (!sourceStillHere || (layout && !layoutContainsLeafId(layout.root, request.leafId))) {
    return
  }
  const remaining = sourceLayoutAfterMove(deps, request)
  if (remaining) {
    releaseFromSurvivingSource(deps, request, ptyId, remaining)
  } else {
    closeSourceTab(deps, request.sourceTabId)
  }
}

/** Main committed but this window could not finish: say so, rebuild T, and drop the ghost pane from S. */
function recoverFromFailedApply(
  deps: TerminalTabIntoPaneDeps,
  request: TerminalLeafIntoTabRequest,
  ptyId: string,
  error: unknown
): void {
  console.warn('[terminal-tab-into-pane] applying a committed join failed', error)
  reportMoveFailed()
  try {
    deps.getStore().remountTerminalTabForRecovery(request.targetTabId)
    dropMovedPaneFromSource(deps, request, ptyId)
  } catch (recoveryError) {
    console.warn('[terminal-tab-into-pane] recovering from a failed join failed', recoveryError)
  }
}

/** The call never answered, so ask main whether it committed: the leaf is in the target and gone from the source. */
async function settleUnansweredMove(
  deps: TerminalTabIntoPaneDeps,
  request: TerminalLeafIntoTabRequest
): Promise<TerminalLeafIntoTabResult | null> {
  const session = await deps.readMainSession(request.worktreeId).catch(() => null)
  const layouts = session?.terminalLayoutsByTabId
  const inTarget = layoutContainsLeafId(
    layouts?.[request.targetTabId]?.root ?? null,
    request.leafId
  )
  const sourceLayout = layouts?.[request.sourceTabId]
  const inSource = layoutContainsLeafId(sourceLayout?.root ?? null, request.leafId)
  return inTarget && !inSource && request.ptyId
    ? { status: 'moved', ptyId: request.ptyId, sourceTabClosed: sourceLayout === undefined }
    : null
}

/** A host-owned source keeps showing a moved pane whose PTY lives on; once the host moved it, let it go here. */
function releaseHostMovedPane(
  deps: TerminalTabIntoPaneDeps,
  request: TerminalLeafIntoTabRequest,
  outcome: TerminalTabIntoPaneOutcome
): void {
  const { targetTabId, leafId, ptyId } = request
  const hostMoved =
    outcome === 'moved' ||
    (outcome === 'unknown' &&
      layoutContainsLeafId(
        deps.getStore().terminalLayoutsByTabId[targetTabId]?.root ?? null,
        leafId
      ))
  const remaining = hostMoved && ptyId ? sourceLayoutAfterMove(deps, request) : null
  if (remaining && ptyId) {
    releaseFromSurvivingSource(deps, request, ptyId, remaining)
  }
}

/**
 * Joins a tab, or one pane of a tab, into another tab's pane. Main commits first (closing a source
 * tab it empties in the same write); this window only rolls forward once main says `moved`. A
 * refusal or `not_held` changes nothing here, and a call that never answers is re-settled from
 * main, never refused.
 */
export async function moveTerminalTabIntoPane(
  args: TerminalTabIntoPaneArgs,
  deps: TerminalTabIntoPaneDeps
): Promise<TerminalTabIntoPaneOutcome> {
  const { source, targetTabId, side } = args
  const sourceTabId = source.tabId
  const eligibility = resolveTerminalTabIntoPaneEligibility(deps.getStore(), {
    ...args,
    hostJoinsTabs: deps.hostJoinsTabs
  })
  if (!eligibility.ok) {
    reportMoveFailed()
    return 'refused'
  }
  const { worktreeId, leafId, ptyId, targetLeafId, viaHost, sourceKeepsPanes } = eligibility
  // Only a mounted pane can let go of its PTY without killing it; main must not commit without one.
  if (sourceKeepsPanes && !viaHost && !deps.mountedLeafIds(sourceTabId)?.includes(leafId)) {
    reportMoveFailed()
    return 'refused'
  }
  // No await sits between the eligibility check and this hold.
  const release = holdTerminalMoveKeys([
    terminalLeafMoveKey(leafId),
    terminalLeafMoveKey(targetLeafId),
    terminalTabMoveKey(sourceTabId),
    terminalTabMoveKey(targetTabId)
  ])
  if (!release) {
    return 'refused'
  }
  try {
    const request: TerminalLeafIntoTabRequest = {
      worktreeId,
      sourceTabId,
      targetTabId,
      targetLeafId,
      leafId,
      ptyId,
      placement: { kind: 'beside', side },
      // Main must not close a source this window still shows with other panes.
      ...(sourceKeepsPanes ? { keepsSourcePane: true as const } : {})
    }
    if (viaHost) {
      // The host's window commits and applies the join; this window redraws from the host's tabs.
      const outcome = await deps.moveTabIntoPaneOnHost(request, source)
      if (outcome === 'refused') {
        reportMoveFailed()
      } else if (sourceKeepsPanes) {
        releaseHostMovedPane(deps, request, outcome)
      }
      return outcome
    }
    const answer =
      (await deps.moveLeafIntoTab(request).catch((error: unknown) => {
        console.warn('[terminal-tab-into-pane] main did not answer the move', error)
        return null
      })) ?? (await settleUnansweredMove(deps, request))
    if (answer?.status === 'moved') {
      try {
        if (applyTerminalTabJoin(deps, request, answer.ptyId)) {
          return 'moved'
        }
        // T's layout is gone here, so S is only a ghost of a pane main already moved.
        reportMoveFailed()
        dropMovedPaneFromSource(deps, request, answer.ptyId)
      } catch (error) {
        recoverFromFailedApply(deps, request, answer.ptyId, error)
      }
      return 'unknown'
    }
    reportMoveFailed()
    return answer ? 'refused' : 'unknown'
  } finally {
    release()
  }
}
