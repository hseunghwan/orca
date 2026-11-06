import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { TerminalPaneLayoutNode } from '../../src/shared/workspace-layout/terminal-tab-types'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { waitForActiveTerminalManager } from './helpers/terminal'
import { readLeafPane, readLeafShellPid } from './helpers/terminal-leaf-pane-probes'
import {
  dragPaneIntoPane,
  PANE_JOIN_OVERLAY,
  waitForBoundPanes
} from './helpers/terminal-layout-journeys'
import { splitActiveTerminalPane } from './helpers/terminal-pane-operations'
import { openTargetAndSourceTabs, seededRepoPath } from './helpers/terminal-tab-join-journey'
import { SORTABLE_TAB } from './helpers/terminal-tab-menu'

const BODIES = '[data-tab-group-body-id]:visible'

/** Drags a tab from the strip onto the right New split band, so it opens its own group. */
async function moveTabToNewRightGroup(page: Page, tabId: string): Promise<void> {
  const tab = (await page.locator(`${SORTABLE_TAB}[data-tab-id="${tabId}"]`).boundingBox())!
  const body = (await page.locator(BODIES).boundingBox())!
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2)
  await page.mouse.down()
  await page.mouse.move(body.x + body.width - 30, body.y + body.height / 2, { steps: 15 })
  await expect(page.getByText('New split', { exact: true })).toBeVisible()
  await page.mouse.up()
  await expect(page.locator(BODIES)).toHaveCount(2)
}

type TabLeaves = Record<string, Record<string, string | null>>

/** Each tab's leaves with their PTY bindings, as the window or main holds them. */
async function readTabLeaves(
  page: Page,
  tabIds: string[],
  from: 'window' | 'main'
): Promise<TabLeaves> {
  return page.evaluate(
    async ({ tabIds, from }) => {
      const leaves = (node: TerminalPaneLayoutNode | null | undefined): string[] =>
        !node
          ? []
          : node.type === 'leaf'
            ? [node.leafId]
            : [...leaves(node.first), ...leaves(node.second)]
      const layouts =
        from === 'main'
          ? ((await window.api.session.get()).terminalLayoutsByTabId ?? {})
          : window.__store!.getState().terminalLayoutsByTabId
      return Object.fromEntries(
        tabIds.map((tabId) => {
          const layout = layouts[tabId]
          const bound = leaves(layout?.root).map((leafId) => [
            leafId,
            layout?.ptyIdsByLeafId?.[leafId] ?? null
          ])
          return [tabId, Object.fromEntries(bound)]
        })
      )
    },
    { tabIds, from }
  )
}

test('drags one pane of a split tab onto another tab pane edge, keeping its shell across a relaunch', async (// oxlint-disable-next-line no-empty-pattern -- this test owns every Electron launch.
{}, testInfo) => {
  // Two Electron launches, each restoring the session, need more than the default timeout.
  test.setTimeout(300_000)
  const repoPath = seededRepoPath()
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null

  try {
    const first = await session.launch()
    app = first.app
    const page = first.page
    await page.setViewportSize({ width: 1400, height: 900 })
    // T is the left group's only tab; S opens its own group on the right and splits in two.
    const setup = await openTargetAndSourceTabs(page, repoPath)
    const { targetTabId, targetLeafId, sourceTabId, leafId, ptyId, pidBefore } = setup
    await moveTabToNewRightGroup(page, sourceTabId)
    await splitActiveTerminalPane(page, 'vertical')
    await waitForBoundPanes(page, 2)
    const sourceBefore = (await readTabLeaves(page, [sourceTabId], 'window'))[sourceTabId]!
    const otherLeafId = Object.keys(sourceBefore).find((id) => id !== leafId)!
    // Main moves only a pane it holds, and keeps S open only if it knows S's other pane.
    await expect
      .poll(async () => (await readTabLeaves(page, [sourceTabId], 'main'))[sourceTabId], {
        timeout: 30_000,
        message: "Main never recorded the source tab's split"
      })
      .toEqual(sourceBefore)

    await dragPaneIntoPane(page, {
      sourceLeafId: leafId,
      targetTabId,
      targetLeafId,
      side: 'right',
      onTheWay: async () => {
        await expect(page.locator(PANE_JOIN_OVERLAY)).toHaveCount(0)
      }
    })

    const expected = {
      [targetTabId]: { [targetLeafId]: expect.any(String), [leafId]: ptyId },
      [sourceTabId]: { [otherLeafId]: sourceBefore[otherLeafId] }
    }
    await expect
      .poll(() => readTabLeaves(page, [targetTabId, sourceTabId], 'window'), {
        timeout: 20_000,
        message: 'The window never showed the pane moved into the target tab'
      })
      .toEqual(expected)
    await expect(page.locator(`${SORTABLE_TAB}[data-tab-id="${sourceTabId}"]`)).toHaveCount(1)
    await expect
      .poll(async () => (await readLeafPane(page, targetTabId, leafId)).ptyId, {
        timeout: 20_000,
        message: 'The moved pane never mounted inside the target tab with its PTY'
      })
      .toBe(ptyId)
    expect(
      await readLeafShellPid(page, { tabId: targetTabId, leafId, ptyId, label: 'MOVED' })
    ).toBe(pidBefore)
    await expect
      .poll(() => readTabLeaves(page, [targetTabId, sourceTabId], 'main'), { timeout: 20_000 })
      .toEqual(expected)

    await session.close(app)
    app = null
    const relaunched = await session.launch()
    app = relaunched.app
    const next = relaunched.page
    await waitForSessionReady(next)
    await expect(next.locator(`${SORTABLE_TAB}[data-tab-id="${sourceTabId}"]`)).toHaveCount(1, {
      timeout: 30_000
    })
    const targetTab = next.locator(`${SORTABLE_TAB}[data-tab-id="${targetTabId}"]`)
    await targetTab.click({ force: true })
    await waitForActiveTerminalManager(next, 30_000)
    await expect
      .poll(async () => (await readLeafPane(next, targetTabId, leafId)).ptyId, {
        timeout: 30_000,
        message: 'After a relaunch the moved pane did not reattach its PTY in the target tab'
      })
      .toBe(ptyId)
    expect(await readTabLeaves(next, [targetTabId, sourceTabId], 'window')).toEqual(expected)
    expect(
      await readLeafShellPid(next, { tabId: targetTabId, leafId, ptyId, label: 'RELAUNCH' })
    ).toBe(pidBefore)
  } finally {
    if (app) {
      await session.close(app).catch(() => undefined)
    }
    await session.dispose()
  }
})
