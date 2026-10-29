import { Pressable, type PressableProps } from 'react-native'
import { X } from 'lucide-react-native'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'

type MobileDictationDiscardButtonProps = {
  readonly onDiscard: () => void
  readonly style: PressableProps['style']
  readonly iconSize: number
  readonly strokeWidth: number
}

// Chat and terminal share one discard control so its label and role stay alike.
export function MobileDictationDiscardButton({
  onDiscard,
  style,
  iconSize,
  strokeWidth
}: MobileDictationDiscardButtonProps) {
  const t = useMobileTranslation()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('session.dictation.discard', 'Discard dictation')}
      style={style}
      onPress={onDiscard}
    >
      <X size={iconSize} color={colors.textPrimary} strokeWidth={strokeWidth} />
    </Pressable>
  )
}
