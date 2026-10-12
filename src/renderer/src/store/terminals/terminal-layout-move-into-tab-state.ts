import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalSlice, TerminalStoreGet, TerminalStoreSet } from './terminal-state'
import { uniquePtyIds, withTerminalTabPtyId } from './terminal-pty-identities'

function withoutValue(record: Record<string, string>, key: string, value: string) {
  if (record[key] !== value) {
    return record
  }
  const next = { ...record }
  delete next[key]
  return next
}

export function createTerminalMoveIntoTabActions(
  set: TerminalStoreSet,
  get: TerminalStoreGet
): Pick<TerminalSlice, 'syncPaneMoveIntoTabPtyOwnership'> {
  return {
    syncPaneMoveIntoTabPtyOwnership: ({ movedLeafId, movedPtyId, sourceTabId, targetTabId }) => {
      set((s) => {
        const tabs = Object.values(s.tabsByWorktree).flat()
        const sourceScrollback = s.localOnlyScrollbackByTabId[sourceTabId]?.[movedLeafId]
        const sourceUnread = s.unreadTerminalTabs[sourceTabId]
        const { [sourceTabId]: sourceBuffers, ...otherScrollback } = s.localOnlyScrollbackByTabId
        const { [movedLeafId]: _moved, ...sourceBuffersLeft } = sourceBuffers ?? {}
        return {
          // The target owns the PTY before the source closes, so the close plan sees it as shared.
          ptyIdsByTabId: {
            ...s.ptyIdsByTabId,
            [sourceTabId]: (s.ptyIdsByTabId[sourceTabId] ?? []).filter((id) => id !== movedPtyId),
            [targetTabId]: uniquePtyIds([...(s.ptyIdsByTabId[targetTabId] ?? []), movedPtyId])
          },
          // R22: only the source row drops the moved PTY; the target primary is unchanged.
          tabsByWorktree: tabs.some((tab) => tab.id === sourceTabId && tab.ptyId === movedPtyId)
            ? withTerminalTabPtyId(s.tabsByWorktree, sourceTabId, null)
            : s.tabsByWorktree,
          lastKnownRelayPtyIdByTabId: withoutValue(
            s.lastKnownRelayPtyIdByTabId,
            sourceTabId,
            movedPtyId
          ),
          deferredSshSessionIdsByTabId: withoutValue(
            s.deferredSshSessionIdsByTabId,
            sourceTabId,
            movedPtyId
          ),
          pendingReconnectPtyIdByTabId: withoutValue(
            s.pendingReconnectPtyIdByTabId,
            sourceTabId,
            movedPtyId
          ),
          localOnlyScrollbackByTabId: {
            ...otherScrollback,
            ...(Object.keys(sourceBuffersLeft).length > 0
              ? { [sourceTabId]: sourceBuffersLeft }
              : {}),
            ...(sourceScrollback !== undefined
              ? {
                  [targetTabId]: {
                    ...s.localOnlyScrollbackByTabId[targetTabId],
                    [movedLeafId]: sourceScrollback
                  }
                }
              : {})
          },
          unreadTerminalTabs:
            sourceUnread !== undefined && !(targetTabId in s.unreadTerminalTabs)
              ? { ...s.unreadTerminalTabs, [targetTabId]: sourceUnread }
              : s.unreadTerminalTabs
        }
      })
      // Must run before the source closes: its sweep removes every `source:` pane key.
      get().transferAgentPaneAuthority({
        fromPaneKey: makePaneKey(sourceTabId, movedLeafId),
        toPaneKey: makePaneKey(targetTabId, movedLeafId),
        ptyId: movedPtyId
      })
    }
  }
}
