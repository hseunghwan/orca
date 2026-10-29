import { Text, View } from 'react-native'
import { colors, typography } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { themedStyleSheet } from '../theme/themed-styles'
import { TailClippedText } from '../components/TailClippedText'
import {
  mobileDictationStatusTitle,
  type MobileDictationStatusFlags
} from './MobileDictationStatusAnnouncement'

type MobileTerminalLiveInputStatusProps = {
  readonly dictation: MobileDictationStatusFlags
  // Words heard so far that will be typed into this terminal.
  readonly heard: string
  readonly dictationMode: string | undefined
  readonly isAttaching: boolean
  readonly liveInputText: string
}

export function MobileTerminalLiveInputStatus({
  dictation,
  dictationMode,
  heard,
  isAttaching,
  liveInputText
}: MobileTerminalLiveInputStatusProps) {
  useMobileColorScheme()
  const title = mobileDictationStatusTitle(dictation) ?? 'Live input'
  // Live input can't type into the terminal until the text is final, so the newest words show here.
  const detail =
    heard ||
    (dictation.isRecording
      ? dictationMode === 'hold'
        ? 'Release mic to stop'
        : 'Tap mic to stop'
      : dictation.isProcessing
        ? 'Transcribing on desktop'
        : dictation.isStarting
          ? 'Preparing microphone'
          : isAttaching
            ? 'Uploading image to host'
            : liveInputText || 'Tap to show keyboard')

  return (
    <View style={styles.status}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <TailClippedText style={heard ? [styles.detail, styles.heard] : styles.detail}>
        {detail}
      </TailClippedText>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  status: {
    flex: 1,
    gap: 1
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  detail: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  },
  heard: {
    color: colors.textPrimary
  }
}))
