import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { translate } from '@/i18n/i18n'
import { describeTerminalTabIntoPaneRefusal } from '../terminal-pane/terminal-tab-into-pane-reasons'
import type { LeafJoinTarget } from './tab-drag-leaf-target'

/** The half of the pane on the side a joined tab would land on. */
function getHalfBounds({
  leafRect: rect,
  zone
}: LeafJoinTarget): Pick<CSSProperties, 'top' | 'left' | 'width' | 'height'> {
  switch (zone) {
    case 'up':
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height / 2 }
    case 'down':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left,
        width: rect.width,
        height: rect.height / 2
      }
    case 'left':
      return { top: rect.top, left: rect.left, width: rect.width / 2, height: rect.height }
    case 'right':
      return {
        top: rect.top,
        left: rect.left + rect.width / 2,
        width: rect.width / 2,
        height: rect.height
      }
  }
}

/** "Join as split" on the pane half a dragged terminal would join, or the reason it cannot. */
export default function TabLeafDropOverlay({
  target
}: {
  target: LeafJoinTarget
}): React.JSX.Element {
  return createPortal(
    <div
      aria-hidden="true"
      data-leaf-drop-overlay=""
      data-disabled={target.refusal ? '' : undefined}
      className="tab-join-overlay pointer-events-none fixed z-[10001]"
      style={getHalfBounds(target)}
    >
      <span className="tab-join-overlay__label absolute bottom-2 left-2 rounded-sm px-1.5 py-0.5 font-medium">
        {target.refusal
          ? describeTerminalTabIntoPaneRefusal(target.refusal)
          : translate('auto.components.tab.group.TabLeafDropOverlay.joinLabel', 'Join as split')}
      </span>
    </div>,
    document.body
  )
}
