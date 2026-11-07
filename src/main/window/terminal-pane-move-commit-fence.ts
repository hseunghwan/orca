import type {
  TerminalLeafIntoTabResult,
  TerminalLeafMoveResult
} from '../../shared/workspace-layout/terminal-leaf-move'

// Why its own module: the plain-Node runtime commits leaf moves too, so this must stay Electron-free.

/** The renderer a move was asked of (its WebContents), compared by identity. */
export type PaneMoveRenderer = { readonly id: number }

/** A client's pane move its window is carrying out. */
export type RelayedPaneMove<Result> = {
  /** The renderer asked to make the move; only it may commit it. */
  sender: PaneMoveRenderer
  /** The client was told the move timed out, so the window may no longer commit it. */
  timedOut: boolean
  /** The window is committing, so neither the deadline nor the window going away decides the answer. */
  claim: (committed: Promise<Result>) => void
  /** Called with a commit that moved the pane. */
  answer: (result: Result) => void
}

/**
 * Client moves a window is still carrying out, by key. A move a client asked for commits nothing
 * once the client was told it timed out, so the client never hears a refusal for a pane the host moved.
 */
function createRelayedPaneMoveFence<Result extends { status: string }>(timedOutRefusal: Result) {
  const relayedMoves = new Map<string, RelayedPaneMove<Result>>()
  return {
    /** Fences the key for one move; null while another move still holds it. */
    hold(key: string, relayed: RelayedPaneMove<Result>): (() => void) | null {
      if (relayedMoves.has(key)) {
        return null
      }
      relayedMoves.set(key, relayed)
      return () => {
        if (relayedMoves.get(key) === relayed) {
          relayedMoves.delete(key)
        }
      }
    },
    commit(sender: PaneMoveRenderer, key: string, commit: () => Promise<Result>): Promise<Result> {
      const relayed = relayedMoves.get(key)
      if (!relayed || relayed.sender !== sender) {
        return commit()
      }
      if (relayed.timedOut) {
        return Promise.resolve(timedOutRefusal)
      }
      const committed = commit().then((result) => {
        if (result.status === 'moved') {
          relayed.answer(result)
        }
        return result
      })
      relayed.claim(committed)
      return committed
    }
  }
}

const paneMoveToNewTabFence = createRelayedPaneMoveFence<TerminalLeafMoveResult>({
  status: 'refused',
  reason: 'pane_unavailable'
})

/** Fences a client's pane-to-new-tab move by the new tab's id. */
export const holdRelayedPaneMove = paneMoveToNewTabFence.hold
/** Commits a window's pane-to-new-tab move; a committed one answers the client at once. */
export const commitRelayedPaneMove = paneMoveToNewTabFence.commit

const paneJoinFence = createRelayedPaneMoveFence<TerminalLeafIntoTabResult>({
  status: 'refused',
  reason: 'relay_timed_out'
})

/** A join is fenced by its source and target tabs; terminal tabs keep their host ids in the window. */
export function relayedPaneJoinKey(join: { sourceTabId: string; targetTabId: string }): string {
  return `${join.sourceTabId}\u0000${join.targetTabId}`
}

/** Fences a client's tab or pane join into another tab. */
export const holdRelayedPaneJoin = paneJoinFence.hold
/** Commits a window's join; after the client was told it timed out, it commits nothing. */
export const commitRelayedPaneJoin = paneJoinFence.commit
