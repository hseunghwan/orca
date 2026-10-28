import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { launchPairedWebClient, type PairedWebClient } from './helpers/paired-electron-client'
import { focusActiveTerminalInput } from './helpers/terminal'

const ROUNDS = 3
const PROMPT = 'EARLY_TYPING_PROMPT$ '

async function terminalTabIds(page: Page, worktreeId: string): Promise<string[]> {
  return page.evaluate(
    (id) => (window.__store?.getState().tabsByWorktree[id] ?? []).map((tab) => tab.id),
    worktreeId
  )
}

function paneText(page: Page, tabId: string): Promise<string> {
  return page.evaluate((id) => {
    const manager = window.__paneManagers?.get(id)
    const buffer = (manager?.getActivePane?.() ?? manager?.getPanes?.()[0])?.terminal?.buffer.active
    if (!buffer) {
      return ''
    }
    const lines: string[] = []
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    return lines.join('\n')
  }, tabId)
}

function paneIsBound(page: Page, tabId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const manager = window.__paneManagers?.get(id)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    return Boolean(pane?.container?.dataset?.ptyId)
  }, tabId)
}

// Keys typed into a new remote terminal after it binds, while the host shell's rc file still runs,
// must all reach that shell: its tty keeps type-ahead for readline, and nothing may drop a prefix.
test('DIAG early output and early keys on a new remote terminal', async ({ testRepoPath }) => {
  // Three host terminals, each held at its rc file until the keys are in, plus host and client boot.
  test.setTimeout(240_000)
  const diagLog = path.join(os.tmpdir(), `orca-diag-early-${process.pid}.log`)
  rmSync(diagLog, { force: true })
  const host = await launchHeadlessPairedRuntimeHost({
    extraEnv: { SHELL: '/bin/bash', ORCA_DIAG_EARLY_LOG: diagLog }
  })
  const home = host.env.HOME
  if (!home) {
    throw new Error('The headless host launched without an isolated HOME')
  }
  const release = path.join(home, '.orca-e2e-release-rc')
  mkdirSync(home, { recursive: true })
  // Each shell waits in its rc file for the release file (bounded at ~120s, past the 60s bind wait).
  const rc = [
    "printf 'RC_BEFORE_WAIT\\n' >&2",
    'for _ in $(seq 2400); do [ -f "$HOME/.orca-e2e-release-rc" ] && break; sleep 0.05; done',
    "if read -t 0; then printf 'STDIN_PENDING=yes\\n' >&2; else printf 'STDIN_PENDING=no\\n' >&2; fi",
    "printf 'RC_AFTER_WAIT\\n' >&2",
    `PS1='${PROMPT}'`
  ].join('\n')
  writeFileSync(path.join(home, '.bash_profile'), `${rc}\n`)
  // Released until the rounds start: the host's own startup shell probes read this rc file too.
  writeFileSync(release, '')
  let client: PairedWebClient | null = null
  try {
    await host.client.call('repo.add', { path: testRepoPath, kind: 'git' })
    client = await launchPairedWebClient(host.app, host.offer)
    const page = client.page
    const consoleLines: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('[diag-early]')) {
        consoleLines.push(message.text())
      }
    })
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().allWorktrees()[0]?.id ?? null), {
        timeout: 30_000
      })
      .not.toBeNull()
    const worktreeId = await page.evaluate(
      () => window.__store?.getState().allWorktrees()[0]?.id ?? ''
    )
    await page.evaluate((id) => {
      const state = window.__store!.getState()
      state.setActiveView('terminal')
      state.setActiveWorktree(id)
    }, worktreeId)

    for (let round = 0; round < ROUNDS; round += 1) {
      rmSync(release, { force: true })
      const before = new Set(await terminalTabIds(page, worktreeId))
      await page.evaluate(async (id) => {
        const state = window.__store!.getState()
        await state.openNewTerminalTabInActiveWorkspace(state.activeGroupIdByWorktree[id]!)
      }, worktreeId)
      let tabId = ''
      await expect
        .poll(async () => {
          tabId = (await terminalTabIds(page, worktreeId)).find((id) => !before.has(id)) ?? ''
          return tabId
        })
        .not.toBe('')
      // Type into this tab even if the worktree's own first terminal opened alongside it.
      await page.evaluate((id) => window.__store!.getState().setActiveTab(id), tabId)
      await expect.poll(() => paneIsBound(page, tabId), { timeout: 60_000 }).toBe(true)
      expect(await paneText(page, tabId)).not.toContain(PROMPT)

      const beforeTyping = await paneText(page, tabId)
      await focusActiveTerminalInput(page)
      const typed = `echo EARLY_TYPING_${round}_$((40+2))`
      await page.keyboard.insertText(typed)
      await page.keyboard.press('Enter')
      expect(existsSync(release)).toBe(false)
      writeFileSync(release, '')

      const ran = new RegExp(`^EARLY_TYPING_${round}_42$`, 'gm')
      await expect
        .poll(async () => (await paneText(page, tabId)).match(ran)?.length ?? 0, {
          timeout: 30_000
        })
        .toBeGreaterThan(0)
      const after = await paneText(page, tabId)
      console.log(`DIAG round=${round} beforeTyping=${JSON.stringify(beforeTyping)}`)
      console.log(`DIAG round=${round} after=${JSON.stringify(after)}`)
      console.log(`DIAG round=${round} renderer:\n${consoleLines.splice(0).join('\n')}`)
    }
  } finally {
    console.log(`DIAG host log:\n${existsSync(diagLog) ? readFileSync(diagLog, 'utf8') : '(none)'}`)
    await client?.dispose()
    await host.dispose()
  }
})
