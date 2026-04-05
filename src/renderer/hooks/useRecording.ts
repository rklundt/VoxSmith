/**
 * VoxSmith — Voice Processing for Indie Game Developers
 * Copyright (C) 2025 Ray Klundt w/ Claude Code Assist
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/agpl-3.0.txt>.
 */

/**
 * useRecording — Hook for mic input and recording workflow (Sprint 7)
 *
 * Orchestrates the full recording lifecycle:
 *  1. Mic device enumeration and selection
 *  2. Starting/stopping mic monitoring (live audio through effects chain)
 *  3. Count-in countdown before recording
 *  4. Recording audio from mic into takes
 *  5. Take management (audition, delete, load into engine)
 *  6. Punch-in recording (re-record a section of an existing take)
 *
 * ARCHITECTURE:
 * - Mic monitoring routes through AudioEngine's effects chain (Stage 2 only)
 * - Stage 1 controls (pitch/formant/tempo) are disabled during mic mode
 * - Recording captures raw (pre-effects) audio for flexibility
 * - Takes are stored as AudioBuffers in memory, with optional IPC save to disk
 * - Punch-in splices new audio into an existing take's buffer
 *
 * KEYBOARD SHORTCUTS:
 * - R: Start/stop recording
 * - Space: Play/stop (when not recording)
 * - P: Punch-in (when a take is selected and a region is marked)
 * Shortcuts are registered in the component, not in this hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioEngine } from './useAudioEngine'
import { useEngineStore } from '../stores/engineStore'
import { enumerateAudioInputDevices, splicePunchIn } from '../engine/MicInput'
import type { MicDevice, Take, PunchInRegion } from '../../shared/types'

/**
 * Generates a unique ID for takes. Uses a simple timestamp + random suffix
 * rather than a full UUID library since takes are session-scoped.
 */
function generateTakeId(): string {
  return `take-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useRecording() {
  const { getEngine, loadFile, play, stop } = useAudioEngine()
  const store = useEngineStore

  // ─── Local State ────────────────────────────────────────────────────

  // Available mic devices — refreshed on mount and when mic starts
  const [devices, setDevices] = useState<MicDevice[]>([])

  // Currently selected device ID (null = system default)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  // In-memory AudioBuffer storage for takes (keyed by take ID).
  // These are not in Zustand because AudioBuffers are non-serializable.
  const takeBuffers = useRef<Map<string, AudioBuffer>>(new Map())

  // Timer interval ref for updating recording duration in the store
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Count-in timer ref
  const countInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // B3: Punch-in timeout ref — used to cancel in-flight punches on re-entry
  const punchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // B2: Stable ref for startRecordingImmediate — avoids stale closure in startCountIn.
  // startCountIn uses useCallback([]) for stability, but needs to call the latest
  // version of startRecordingImmediate. This ref is updated whenever the callback changes.
  const startRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // ─── Device Enumeration ─────────────────────────────────────────────

  /**
   * Refreshes the list of available audio input devices.
   * Called on mount and after mic permission is granted.
   */
  const refreshDevices = useCallback(async () => {
    try {
      const deviceList = await enumerateAudioInputDevices()
      setDevices(deviceList)
    } catch (err) {
      console.warn('Failed to enumerate audio devices:', err)
    }
  }, [])

  // Enumerate devices on mount
  useEffect(() => {
    refreshDevices()

    // Listen for device changes (mic plugged in/unplugged)
    const handler = () => { refreshDevices() }
    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handler)
    }
  }, [refreshDevices])

  // ─── Mic Monitoring ─────────────────────────────────────────────────

  /**
   * Starts live mic monitoring through the effects chain.
   * The user hears their voice processed by Stage 2 effects in real time.
   * Stage 1 controls are disabled while mic is active.
   */
  const startMic = useCallback(async () => {
    const engine = getEngine()
    try {
      store.getState().setMicError(null)
      // noiseSuppression removed from getUserMedia options — Electron ignores it.
      // Sprint 7.2 will add RNNoise WASM AudioWorklet for real noise suppression.
      await engine.startMicInput({
        deviceId: selectedDeviceId ?? undefined,
      })
      store.getState().setMicActive(true)
      store.getState().setInputMode('mic')

      // Re-enumerate devices now that permission is granted (labels become available)
      await refreshDevices()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start microphone'

      // Detect permission denial specifically
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        store.getState().setMicError('Microphone permission denied. Please allow access in your system settings.')
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        store.getState().setMicError('No microphone found. Please connect a mic and try again.')
      } else {
        store.getState().setMicError(message)
      }
      console.error('Mic start failed:', err)
    }
  }, [getEngine, selectedDeviceId, refreshDevices])

  /**
   * Stops mic monitoring and returns to file input mode.
   * If recording is in progress, it's stopped first.
   */
  const stopMic = useCallback(() => {
    const engine = getEngine()
    engine.stopMicInput()
    store.getState().setMicActive(false)
    store.getState().setInputMode('file')
    store.getState().setRecordingState('idle')
    store.getState().setRecordingDurationMs(0)

    // Clear duration timer
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }, [getEngine])

  // ─── Count-In ───────────────────────────────────────────────────────

  /**
   * Starts the count-in countdown before recording.
   * Decrements countInBeats every ~600ms (≈100 BPM metronome feel).
   * When beats reach 0, recording starts automatically.
   */
  const startCountIn = useCallback(() => {
    const total = store.getState().countInTotal
    store.getState().setRecordingState('count-in')
    store.getState().setCountInBeats(total)

    let remaining = total
    const tick = () => {
      remaining--
      if (remaining <= 0) {
        // Count-in complete — start recording.
        // B2: Use startRecordingRef to call the latest version of startRecordingImmediate,
        // avoiding stale closure from the empty dependency array.
        store.getState().setCountInBeats(0)
        void startRecordingRef.current()
      } else {
        store.getState().setCountInBeats(remaining)
        countInTimerRef.current = setTimeout(tick, 600)
      }
    }

    // First tick after 600ms
    countInTimerRef.current = setTimeout(tick, 600)
  }, [])

  // ─── Recording ──────────────────────────────────────────────────────

  /**
   * Starts recording immediately (no count-in).
   * Called either directly or by the count-in completion callback.
   */
  const startRecordingImmediate = useCallback(async () => {
    const engine = getEngine()
    try {
      // startRecording() is async because it lazy-loads the AudioWorklet module
      // on first use (ctx.audioWorklet.addModule is async). Subsequent calls
      // resolve immediately since the module is cached.
      await engine.startRecording()
      store.getState().setRecordingState('recording')
      store.getState().setRecordingDurationMs(0)

      // Start a timer to update the recording duration in the store.
      // Updates every 100ms for a responsive duration display.
      durationTimerRef.current = setInterval(() => {
        store.getState().setRecordingDurationMs(engine.recordingDurationMs)
      }, 100)
    } catch (err) {
      console.error('Failed to start recording:', err)
      store.getState().setMicError(
        err instanceof Error ? err.message : 'Failed to start recording'
      )
      store.getState().setRecordingState('idle')
    }
  }, [getEngine])

  // B2: Keep the ref updated so startCountIn always calls the latest version
  useEffect(() => {
    startRecordingRef.current = startRecordingImmediate
  }, [startRecordingImmediate])

  /**
   * Starts recording with optional count-in.
   * If countInTotal > 0, plays a countdown first. Otherwise starts immediately.
   */
  const startRecording = useCallback(() => {
    const { countInTotal, micActive } = store.getState()
    if (!micActive) {
      store.getState().setMicError('Start mic monitoring first before recording')
      return
    }

    if (countInTotal > 0) {
      startCountIn()
    } else {
      startRecordingImmediate()
    }
  }, [startCountIn, startRecordingImmediate])

  /**
   * Stops recording and creates a new take from the captured audio.
   * The take is stored in memory and added to the take list.
   */
  const stopRecording = useCallback(() => {
    const engine = getEngine()

    // Clear the duration update timer
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }

    // Cancel count-in if we're still in the countdown
    if (countInTimerRef.current) {
      clearTimeout(countInTimerRef.current)
      countInTimerRef.current = null
    }

    const currentState = store.getState().recordingState
    if (currentState === 'count-in') {
      // Just cancel the count-in, don't create a take
      store.getState().setRecordingState('idle')
      store.getState().setCountInBeats(0)
      return
    }

    // Stop the engine recording and get the AudioBuffer
    const audioBuffer = engine.stopRecording()
    if (!audioBuffer || audioBuffer.length === 0) {
      store.getState().setRecordingState('idle')
      return
    }

    // Create a new take from the recorded audio
    const takeNumber = store.getState().takes.length + 1
    const take: Take = {
      id: generateTakeId(),
      name: `Take ${takeNumber}`,
      durationMs: (audioBuffer.length / audioBuffer.sampleRate) * 1000,
      createdAt: Date.now(),
    }

    // Store the AudioBuffer in memory
    takeBuffers.current.set(take.id, audioBuffer)

    // Add the take to the store
    store.getState().addTake(take)
    store.getState().selectTake(take.id)
    store.getState().setRecordingState('stopped')

    // Auto-load the recorded take into the AudioEngine so Stage 1 Apply works
    // immediately. Without this, the user would have to manually audition the
    // take before Stage 1 processing could find an originalBuffer.
    try {
      const wavBytes = audioBufferToWav(audioBuffer)
      // Stop mic monitoring — engine can only have one input source at a time
      if (engine.micActive) {
        engine.stopMicInput()
        store.getState().setMicActive(false)
      }
      void loadFile(wavBytes).then(() => {
        store.getState().setInputMode('file')
      })
    } catch (err) {
      console.error('[Recording] Failed to auto-load take into engine:', err)
    }
  }, [getEngine, loadFile])

  /**
   * Toggle recording on/off — convenience for keyboard shortcut.
   */
  const toggleRecording = useCallback(() => {
    const { recordingState } = store.getState()
    if (recordingState === 'recording' || recordingState === 'count-in') {
      stopRecording()
    } else {
      startRecording()
    }
  }, [startRecording, stopRecording])

  // ─── Monitor Mute ───────────────────────────────────────────────────

  /**
   * Toggles monitor mute on/off.
   * When muted, mic audio still records but nothing goes to speakers.
   * Prevents feedback when not using headphones.
   */
  const toggleMonitorMute = useCallback(() => {
    const engine = getEngine()
    const currentMuted = store.getState().monitorMuted
    const newMuted = !currentMuted
    engine.setMonitorMute(newMuted)
    store.getState().setMonitorMuted(newMuted)
  }, [getEngine])

  // ─── Take Management ────────────────────────────────────────────────

  /**
   * Loads a take into the AudioEngine for playback/audition.
   * Switches to file mode so the take can be played through the engine.
   */
  const auditionTake = useCallback(async (takeId: string) => {
    const buffer = takeBuffers.current.get(takeId)
    if (!buffer) {
      console.warn(`Take ${takeId} not found in memory`)
      return
    }

    // Stop mic monitoring before auditioning — the engine can only have one input source
    const engine = getEngine()
    if (engine.micActive) {
      engine.stopMicInput()
      store.getState().setMicActive(false)
    }

    // Encode the AudioBuffer as WAV bytes so we can load it through the normal
    // file loading pipeline. This ensures the take goes through the same path
    // as any other audio file and can have Stage 1 applied to it.
    // B4: Wrap in try/catch — audioBufferToWav can throw on invalid/empty buffers.
    try {
      const wavBytes = audioBufferToWav(buffer)
      await loadFile(wavBytes)
    } catch (err) {
      console.error('Failed to audition take:', err)
      store.getState().setMicError('Failed to load take for audition')
      return
    }
    store.getState().selectTake(takeId)
    store.getState().setInputMode('file')

    // Play automatically so the user hears it immediately
    play()
  }, [getEngine, loadFile, play])

  /**
   * Deletes a take by ID — removes from memory and store.
   */
  const deleteTake = useCallback((takeId: string) => {
    takeBuffers.current.delete(takeId)
    store.getState().removeTake(takeId)
  }, [])

  // ─── Punch-In ───────────────────────────────────────────────────────

  /**
   * Performs a punch-in recording over a specific region of the selected take.
   *
   * Records new audio from the mic, then splices it into the existing take
   * at the specified time region. The result replaces the original take buffer.
   *
   * @param region - The time range (in seconds) to re-record
   */
  const punchIn = useCallback(async (region: PunchInRegion) => {
    const { selectedTakeId, micActive } = store.getState()
    if (!selectedTakeId || !micActive) {
      store.getState().setMicError('Select a take and start mic to punch in')
      return
    }

    const originalBuffer = takeBuffers.current.get(selectedTakeId)
    if (!originalBuffer) return

    const engine = getEngine()

    // B3: Cancel any in-flight punch-in to prevent double-splice race condition.
    // If the user presses P again before the previous punch timeout fires,
    // we abort the previous punch and discard its audio.
    if (punchTimeoutRef.current) {
      clearTimeout(punchTimeoutRef.current)
      punchTimeoutRef.current = null
      engine.stopRecording() // Discard the aborted punch audio
      store.getState().setRecordingState('idle')
    }

    // Start recording the punch-in (async: loads worklet module on first use)
    await engine.startRecording()
    store.getState().setRecordingState('recording')

    // Calculate the expected duration of the punch region
    const punchDurationMs = (region.endTime - region.startTime) * 1000

    // Auto-stop after the punch region duration.
    // We use a timeout rather than requiring manual stop — the user knows
    // exactly how long the punch region is from the waveform markers.
    await new Promise<void>((resolve) => {
      punchTimeoutRef.current = setTimeout(() => {
        punchTimeoutRef.current = null
        const punchBuffer = engine.stopRecording()
        if (punchBuffer && punchBuffer.length > 0) {
          // Splice the punch-in into the original take.
          // splicePunchIn trims leading silence and fits the punch to
          // the exact region length so the total duration stays the same.
          const splicedBuffer = splicePunchIn(
            originalBuffer,
            punchBuffer,
            region.startTime,
            region.endTime,
            engine.audioContext,
          )

          // Replace the take buffer in memory
          takeBuffers.current.set(selectedTakeId, splicedBuffer)

          // Update the take duration in the store
          const takes = store.getState().takes.map((t) =>
            t.id === selectedTakeId
              ? { ...t, durationMs: (splicedBuffer.length / splicedBuffer.sampleRate) * 1000 }
              : t
          )
          const updatedTake = takes.find((t) => t.id === selectedTakeId)
          if (updatedTake) {
            store.getState().removeTake(selectedTakeId)
            store.getState().addTake(updatedTake)
            store.getState().selectTake(selectedTakeId)
          }

          // Reload the spliced buffer into the engine so the waveform
          // updates to show the new audio. loadFile just decodes and sets
          // the buffer — it doesn't touch the mic or effects chain.
          const wavBytes = audioBufferToWav(splicedBuffer)
          loadFile(wavBytes).catch((err) => {
            console.error('Failed to reload waveform after punch-in:', err)
          })
        }
        store.getState().setRecordingState('stopped')
        // Clear the punch-in region from the store — this also triggers
        // WaveformPanel to remove the visual region overlay.
        store.getState().setPunchInRegion(null)
        resolve()
      }, punchDurationMs)
    })
  }, [getEngine, loadFile])

  // ─── Cleanup ────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      // Clean up timers on unmount
      if (durationTimerRef.current) clearInterval(durationTimerRef.current)
      if (countInTimerRef.current) clearTimeout(countInTimerRef.current)
      // B3: Clean up punch-in timeout on unmount
      if (punchTimeoutRef.current) clearTimeout(punchTimeoutRef.current)
    }
  }, [])

  // ─── Return API ─────────────────────────────────────────────────────

  return {
    // Device management
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    refreshDevices,

    // Mic monitoring
    startMic,
    stopMic,
    toggleMonitorMute,

    // Recording
    startRecording,
    stopRecording,
    toggleRecording,

    // Take management
    auditionTake,
    deleteTake,

    // Punch-in
    punchIn,

    // Returns the current waveform cursor position in seconds.
    // Used by "Mark Start" / "Mark End" buttons to capture the seek position.
    getCursorTime: () => getEngine().currentTime,

    // Access to take buffers for advanced operations
    getTakeBuffer: (id: string) => takeBuffers.current.get(id) ?? null,
  }
}

// ─── Utility: AudioBuffer → WAV ──────────────────────────────────────────

/**
 * Encodes an AudioBuffer as a WAV ArrayBuffer (PCM 32-bit float).
 * Used to load recorded takes into the AudioEngine via the standard loadFile path.
 *
 * This is a minimal WAV encoder — mono, 32-bit float, no compression.
 * For export-quality encoding, use the wavEncoder module (Sprint 6).
 */
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const sampleRate = buffer.sampleRate
  const samples = buffer.getChannelData(0) // mono
  const numSamples = samples.length

  // WAV file = 44-byte header + raw PCM data
  const bytesPerSample = 4 // 32-bit float
  const dataSize = numSamples * bytesPerSample
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const arrayBuffer = new ArrayBuffer(totalSize)
  const view = new DataView(arrayBuffer)

  // ── RIFF header ──
  writeString(view, 0, 'RIFF')
  view.setUint32(4, totalSize - 8, true)         // file size minus RIFF header
  writeString(view, 8, 'WAVE')

  // ── fmt chunk ──
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)                    // fmt chunk size
  view.setUint16(20, 3, true)                     // format: 3 = IEEE float
  view.setUint16(22, 1, true)                     // channels: 1 (mono)
  view.setUint32(24, sampleRate, true)            // sample rate
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true)        // block align
  view.setUint16(34, 32, true)                    // bits per sample

  // ── data chunk ──
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)              // data size

  // ── PCM samples ──
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    view.setFloat32(offset, samples[i], true)
    offset += 4
  }

  return arrayBuffer
}

/** Helper: write an ASCII string into a DataView */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
