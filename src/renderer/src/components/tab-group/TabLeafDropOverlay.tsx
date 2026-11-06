import { createPortal } from 'react-dom'
import { translate } from '@/i18n/i18n'
import { describeTerminalTabIntoPaneRefusal } from '../terminal-pane/terminal-tab-into-pane-reasons'
import { leafJoinHalfRect, type LeafJoinTarget } from './tab-drag-leaf-target'

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
      style={leafJoinHalfRect(target)}
    >
      <span className="tab-join-overlay__label">{describeLeafJoinTarget(target)}</span>
    </div>,
    document.body
  )
}

/** The words a join overlay shows: the join itself, or why the drop would be refused. */
export function describeLeafJoinTarget(target: LeafJoinTarget): string {
  return target.refusal
    ? describeTerminalTabIntoPaneRefusal(target.refusal)
    : translate('auto.components.tab.group.TabLeafDropOverlay.joinLabel', 'Join as split')
}
