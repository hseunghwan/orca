export type TerminalMoveIntoTabActions = {
  /**
   * A single-pane tab's live PTY joins another tab's layout: ownership, the SSH ledger, scrollback,
   * unread and agent identity follow the pane. Runs before the source tab closes.
   */
  syncPaneMoveIntoTabPtyOwnership: (args: {
    movedLeafId: string
    movedPtyId: string
    sourceTabId: string
    targetTabId: string
  }) => void
}
