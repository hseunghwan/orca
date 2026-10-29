import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatComposerMic } from './MobileNativeChatComposerMic'
import { findAllByHostType } from '../../../test-support/react-test-renderer-host-nodes'
import { createMobileDictationMeter } from '../../../hooks/mobile-dictation-meter'
import { MobileDictationRecordingContext } from '../../mobile-dictation-recording-context'

const pressables = vi.hoisted(() => ({ unmounted: 0 }))

vi.mock('react-native', async () => {
  const { createElement: h, useEffect } = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} })
    },
    Pressable: (props: { children?: unknown }) => {
      useEffect(
        () => () => {
          pressables.unmounted += 1
        },
        []
      )
      return h('Pressable', props)
    },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View'
  }
})

vi.mock('lucide-react-native', () => ({ Mic: 'Mic', Square: 'Square', X: 'X' }))

describe('MobileNativeChatComposerMic', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows the mic busy while a stopped dictation is transcribing', () => {
    act(() => {
      renderer = create(
        createElement(MobileNativeChatComposerMic, {
          onMicPress: vi.fn(),
          micProcessing: true,
          disabled: false
        })
      )
    })
    const mic = renderer!.root.find(
      (node) =>
        String(node.type) === 'Pressable' &&
        node.props.accessibilityLabel === 'Transcribing dictation'
    )
    expect(findAllByHostType(mic, 'ActivityIndicator')).toHaveLength(1)
    expect(findAllByHostType(mic, 'Mic')).toHaveLength(0)
  })

  it('tells screen readers it is busy starting before recording begins', () => {
    act(() => {
      renderer = create(
        createElement(MobileNativeChatComposerMic, {
          onMicPress: vi.fn(),
          micActive: true,
          micStarting: true,
          disabled: false
        })
      )
    })
    const mic = renderer!.root.find(
      (node) =>
        String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Starting dictation'
    )
    expect(mic.props['aria-busy']).toBe(true)
  })

  it('adds discard and the meter beside the mic without remounting it under a held press', () => {
    const discard = vi.fn()
    const controls = { meter: createMobileDictationMeter(), discard }
    const render = (micStarting: boolean) =>
      createElement(
        MobileDictationRecordingContext.Provider,
        { value: controls },
        createElement(MobileNativeChatComposerMic, {
          onMicPress: vi.fn(),
          micActive: true,
          micStarting,
          dictationMode: 'hold',
          disabled: false
        })
      )
    act(() => {
      renderer = create(render(true))
    })
    const unmountedBefore = pressables.unmounted
    act(() => renderer!.update(render(false)))
    expect(pressables.unmounted).toBe(unmountedBefore)
    const discardButton = () =>
      renderer!.root.find(
        (node) =>
          String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Discard dictation'
      )
    act(() => discardButton().props.onPress())
    expect(discard).toHaveBeenCalledOnce()
  })
})
