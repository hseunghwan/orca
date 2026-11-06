// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneExternalDropTarget } from './pane-manager-types'

// Why: happy-dom has no canvas, so xterm cannot open; the drag never touches the terminal.
vi.mock('./pane-lifecycle', async (importOriginal) => {
  const actual: object = await importOriginal()
  return { ...actual, openTerminal: vi.fn() }
})

const { PaneManager } = await import('./pane-manager')

function pointer(type: string, clientX: number, clientY: number): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    button: 0,
    ctrlKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX,
    clientY
  })
}

function joinTarget(refused: boolean): PaneExternalDropTarget {
  return {
    id: `join:${String(refused)}`,
    rect: { left: 750, top: 32, width: 250, height: 568 },
    overlay: { kind: 'join', label: refused ? 'Chat view' : 'Join as split', refused }
  }
}

describe('the pane drag overlay over another tab pane edge', () => {
  let root: HTMLDivElement
  let manager: InstanceType<typeof PaneManager>
  let external: PaneExternalDropTarget | null
  const onExternalPaneDrop = vi.fn(() => true)

  function overlay(): HTMLElement {
    const element = document.body.querySelector<HTMLElement>('.pane-drop-overlay')
    if (!element) {
      throw new Error('no drop overlay')
    }
    return element
  }

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    external = null
    root = document.createElement('div')
    document.body.appendChild(root)
    manager = new PaneManager(root, {
      linkOpenHint: () => '',
      resolveExternalPaneDropTarget: () => external,
      onExternalPaneDrop
    })
    const first = manager.createInitialPane()
    manager.splitPane(first.id, 'vertical')
    const handle = root.querySelector<HTMLElement>('.pane-drag-handle')
    if (!handle) {
      throw new Error('no drag handle')
    }
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.hasPointerCapture = () => false
    handle.dispatchEvent(pointer('pointerdown', 0, 0))
  })

  afterEach(() => {
    manager.destroy()
    root.remove()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    onExternalPaneDrop.mockClear()
  })

  it('draws the orange join overlay on the half pane with "Join as split"', () => {
    external = joinTarget(false)
    window.dispatchEvent(pointer('pointermove', 800, 300))

    expect(overlay().dataset.paneDropOverlayKind).toBe('join')
    expect(overlay().classList.contains('tab-join-overlay')).toBe(true)
    expect(overlay().hasAttribute('data-disabled')).toBe(false)
    expect(overlay().textContent).toBe('Join as split')
    expect([overlay().style.left, overlay().style.width]).toEqual(['750px', '250px'])
  })

  it('shows a refused join as disabled with its reason, and a drop there still reaches the tab', () => {
    external = joinTarget(true)
    window.dispatchEvent(pointer('pointermove', 800, 300))

    expect(overlay().hasAttribute('data-disabled')).toBe(true)
    expect(overlay().textContent).toBe('Chat view')

    window.dispatchEvent(pointer('pointerup', 800, 300))
    expect(onExternalPaneDrop).toHaveBeenCalledWith(expect.any(Number), external)
  })

  it('goes back to the plain blue in-tab overlay over a pane of its own tab', () => {
    external = joinTarget(true)
    window.dispatchEvent(pointer('pointermove', 800, 300))
    const sibling = manager.getPanes()[1]!.container
    sibling.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
    window.dispatchEvent(pointer('pointermove', 50, 20))

    expect(overlay().dataset.paneDropOverlayKind).toBe('area')
    expect(overlay().classList.contains('tab-join-overlay')).toBe(false)
    expect(overlay().hasAttribute('data-disabled')).toBe(false)
    expect(overlay().textContent).toBe('')
  })
})
