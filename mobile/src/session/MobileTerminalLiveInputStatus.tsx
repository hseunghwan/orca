import { Text, View } from 'react-native'
import type { MobileDictationMeter } from '../hooks/mobile-dictation-meter'
import { colors, typography } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { themedStyleSheet } from '../theme/themed-styles'
import {
  mobileDictationStatusTitle,
  type MobileDictationStatusFlags
} from './MobileDictationStatusAnnouncement'
import { MobileDictationGrapes, MobileDictationTimer } from './MobileDictationMeter'

type MobileTerminalLiveInputStatusProps = {
  readonly dictation: MobileDictationStatusFlags
  readonly dictationMode: string | undefined
  readonly meter: MobileDictationMeter
  readonly isAttaching: boolean
  readonly liveInputText: string
}

export function MobileTerminalLiveInputStatus({
  dictation,
  dictationMode,
  meter,
  isAttaching,
  liveInputText
}: MobileTerminalLiveInputStatusProps) {
  useMobileColorScheme()
  const title = mobileDictationStatusTitle(dictation) ?? 'Live input'
  const detail = dictation.isRecording
    ? dictationMode === 'hold'
      ? 'Release mic to stop'
      : 'Tap mic to stop'
    : dictation.isProcessing
      ? 'Transcribing on desktop'
      : dictation.isStarting
        ? 'Preparing microphone'
        : isAttaching
          ? 'Uploading image to host'
          : liveInputText || 'Tap to show keyboard'

  return (
    <View style={styles.status}>
      <View style={[styles.titleRow, dictation.isRecording && styles.meterRow]}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {dictation.isRecording ? (
          <>
            <MobileDictationTimer meter={meter} />
            <View style={styles.spacer} />
            <MobileDictationGrapes meter={meter} dotSize={3.5} />
          </>
        ) : null}
      </View>
      <Text style={styles.detail} numberOfLines={1} ellipsizeMode="head">
        {detail}
      </Text>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  status: {
    flex: 1,
    gap: 1
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  // Pin the row so the taller meter doesn't push the second line down.
  meterRow: {
    height: 16
  },
  spacer: {
    flex: 1
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
  }
}))
