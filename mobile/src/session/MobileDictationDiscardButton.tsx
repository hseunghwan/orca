import { useState } from 'react'
import { Pressable, type PressableProps } from 'react-native'
import { X } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'

type MobileDictationDiscardButtonProps = {
  readonly onDiscard: () => void
  readonly style: PressableProps['style']
  readonly iconSize: number
  readonly strokeWidth: number
}

// One tap only: recording stays up until the host's cancel lands, and a second tap would go idle before it, so a quick restart hits the session the host still holds.
export function MobileDictationDiscardButton({
  onDiscard,
  style,
  iconSize,
  strokeWidth
}: MobileDictationDiscardButtonProps) {
  const [discarding, setDiscarding] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Discard dictation"
      aria-busy={discarding}
      disabled={discarding}
      style={style}
      onPress={() => {
        setDiscarding(true)
        onDiscard()
      }}
    >
      <X size={iconSize} color={colors.textPrimary} strokeWidth={strokeWidth} />
    </Pressable>
  )
}
