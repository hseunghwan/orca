import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MigrationUnsupportedPtyEntry } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import {
  clearMigrationUnsupportedPty,
  clearMigrationUnsupportedPtysByTabPrefix,
  getMigrationUnsupportedPtySnapshot,
  rekeyMigrationUnsupportedPtyPaneKey,
  setMigrationUnsupportedPty,
  setMigrationUnsupportedPtyListener,
  setMigrationUnsupportedPtyPersistenceListener
} from './migration-unsupported-pty-state'

const LEAF = '11111111-1111-4111-8111-111111111111'

function makeEntry(ptyId: string, paneKey: string): MigrationUnsupportedPtyEntry {
  return {
    ptyId,
    paneKey,
    tabId: paneKey.split(':')[0] ?? paneKey,
    worktreeId: 'wt-1',
    reason: 'legacy-numeric-pane-key',
    source: 'local',
    updatedAt: 1_000
  }
}

describe('migration unsupported PTY state', () => {
  afterEach(() => {
    setMigrationUnsupportedPtyListener(null)
    setMigrationUnsupportedPtyPersistenceListener(null)
    for (const entry of getMigrationUnsupportedPtySnapshot()) {
      clearMigrationUnsupportedPty(entry.ptyId)
    }
  })

  it('re-keys a PTY entry to the pane it moved to, once, and keeps it past the source tab close', () => {
    const listener = vi.fn()
    const persist = vi.fn()
    const moving = makeEntry('pty-1', `tab-source:${LEAF}`)
    const other = makeEntry('pty-2', 'tab-source:other-leaf')
    setMigrationUnsupportedPty(moving)
    setMigrationUnsupportedPty(other)
    setMigrationUnsupportedPtyListener(listener)
    setMigrationUnsupportedPtyPersistenceListener(persist)

    rekeyMigrationUnsupportedPtyPaneKey('pty-1', `tab-target:${LEAF}`)

    const rekeyed = { ...moving, paneKey: `tab-target:${LEAF}`, tabId: 'tab-target', leafId: LEAF }
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({ type: 'set', entry: rekeyed })
    expect(persist).toHaveBeenCalledOnce()
    clearMigrationUnsupportedPtysByTabPrefix('tab-source')
    expect(getMigrationUnsupportedPtySnapshot()).toEqual([rekeyed])
  })

  it('ignores a re-key for a PTY with no entry or an entry already at the pane', () => {
    const listener = vi.fn()
    const entry = makeEntry('pty-1', `tab-target:${LEAF}`)
    setMigrationUnsupportedPty(entry)
    setMigrationUnsupportedPtyListener(listener)

    rekeyMigrationUnsupportedPtyPaneKey('pty-missing', `tab-target:${LEAF}`)
    rekeyMigrationUnsupportedPtyPaneKey('pty-1', `tab-target:${LEAF}`)
    rekeyMigrationUnsupportedPtyPaneKey('pty-1', 'not-a-pane-key')

    expect(listener).not.toHaveBeenCalled()
    expect(getMigrationUnsupportedPtySnapshot()).toEqual([entry])
  })
})
