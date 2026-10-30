import type {
  TerminalPaneMoveToNewTabReply,
  TerminalPaneMoveToNewTabRequest,
  TerminalTabIntoPaneMoveReply,
  TerminalTabIntoPaneMoveRequest
} from '../../shared/terminal-leaf-move'

/** Main asks the window, which owns the layout, to make a paired client's pane move. */
export type TerminalPaneMoveUiEventApi = {
  onTerminalPaneMoveToNewTabRequest?: (
    callback: (request: TerminalPaneMoveToNewTabRequest) => void
  ) => () => void
  replyTerminalPaneMoveToNewTab?: (reply: TerminalPaneMoveToNewTabReply) => void
  onTerminalTabIntoPaneRequest?: (
    callback: (request: TerminalTabIntoPaneMoveRequest) => void
  ) => () => void
  replyTerminalTabIntoPane?: (reply: TerminalTabIntoPaneMoveReply) => void
}
