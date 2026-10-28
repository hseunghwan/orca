import { createContext } from 'react'
import type { MobileDictationMeter } from '../hooks/mobile-dictation-meter'

// The chat mic sits several composers deep (overlay, queued edits); it reads the live recording's meter and discard from here.
export type MobileDictationRecordingControls = {
  readonly meter: MobileDictationMeter
  readonly discard: () => void
}

export const MobileDictationRecordingContext =
  createContext<MobileDictationRecordingControls | null>(null)
