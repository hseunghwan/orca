import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hostJoinsTabsIntoPanes, moveWebRuntimeTabIntoPane } from './web-runtime-leaf-move'

import { stubRuntimeEnvironmentBridge } from './runtime-environment-bridge-fixture'
import { toWebTerminalSurfaceTabId } from '../../../shared/workspace-layout/terminal-surface-id'
const ENVIRONMENT_ID = 'web-env-1'
const WORKTREE_ID = 'repo::/worktree'
const store = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return { state }
})
const supports = vi.hoisted(() => vi.fn())
const cachedCapability = vi.hoisted(() => vi.fn())
const refresh = vi.hoisted(() => vi.fn())
vi.mock('../store', () => ({ useAppStore: { getState: () => store.state } }))
vi.mock('./runtime-rpc-client', () => ({
  runtimeEnvironmentSupportsCapability: supports,
  readCachedRuntimeEnvironmentCapability: cachedCapability
}))
vi.mock('./web-runtime-session-snapshot', () => ({
  refreshWebRuntimeSessionTabsSnapshot: refresh
}))
const REQUEST = {
  worktreeId: WORKTREE_ID,
  sourceTabId: toWebTerminalSurfaceTabId('host-source'),
  targetTabId: toWebTerminalSurfaceTabId('host-target'),
  leafId: '11111111-1111-4111-8111-111111111111',
  ptyId: 'remote:web-env-1@@term-1'
}
describe('moveWebRuntimeTabIntoPane', () => {
  beforeEach(() => {
    supports.mockReset()
    refresh.mockReset()
    store.state = {
      repos: [{ id: 'repo', executionHostId: `runtime:${ENVIRONMENT_ID}` }],
      worktreesByRepo: {
        repo: [
          {
            id: WORKTREE_ID,
            repoId: 'repo',
            hostId: `runtime:${ENVIRONMENT_ID}`,
            runtimeOwnerEnvironmentId: ENVIRONMENT_ID
          }
        ]
      }
    }
  })
  afterEach(() => vi.unstubAllGlobals())
  it('asks the host to join a tab into a pane by host tab ids, then draws the host tabs', async () => {
    const call = vi.fn().mockResolvedValue({ id: 'm', ok: true, result: { status: 'moved' } })
    stubRuntimeEnvironmentBridge({ call })
    supports.mockResolvedValue(true)
    const join = {
      ...REQUEST,
      targetLeafId: '22222222-2222-4222-8222-222222222222',
      placement: { kind: 'beside' as const, side: 'bottom' as const }
    }
    await expect(moveWebRuntimeTabIntoPane(join)).resolves.toBe('moved')
    expect(supports).toHaveBeenCalledWith(ENVIRONMENT_ID, 'session-tabs.move-tab-into-pane.v1')
    expect(call.mock.calls[0][0]).toMatchObject({
      method: 'session.tabs.moveTabIntoPane',
      params: {
        worktree: `id:${WORKTREE_ID}`,
        sourceTabId: 'host-source',
        targetTabId: 'host-target',
        targetLeafId: join.targetLeafId,
        side: 'bottom'
      }
    })
    expect(refresh).toHaveBeenCalledWith(ENVIRONMENT_ID, WORKTREE_ID, {
      acceptCurrentSnapshot: true
    })
  })
  it('a headless or older host leaves both tabs, and the menu offers the join only to a host that joins', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const call = vi.fn().mockResolvedValue({ id: 'm', ok: true, result: { status: 'not_held' } })
    stubRuntimeEnvironmentBridge({ call })
    supports.mockResolvedValue(true)
    const join = {
      ...REQUEST,
      targetLeafId: 'leaf-b',
      placement: { kind: 'beside' as const, side: 'right' as const }
    }
    await expect(moveWebRuntimeTabIntoPane(join)).resolves.toBe('refused')
    expect(refresh).not.toHaveBeenCalled()
    supports.mockResolvedValue(false)
    await expect(moveWebRuntimeTabIntoPane(join)).resolves.toBe('refused')
    expect(call).toHaveBeenCalledTimes(1)
    cachedCapability.mockReturnValue(true)
    expect(hostJoinsTabsIntoPanes(WORKTREE_ID)).toBe(true)
    cachedCapability.mockReturnValue(null)
    expect(hostJoinsTabsIntoPanes(WORKTREE_ID)).toBe(false)
  })
})
