/**
 * VoxSmith - Voice Processing for Indie Game Developers
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
 * useAudioEngine - Hook for AudioEngine Lifecycle
 *
 * Creates and manages the singleton AudioEngine instance.
 * Provides methods for file loading, playback, and real-time parameter updates.
 *
 * WHY A HOOK?
 * The AudioEngine is a stateful object (owns AudioContext and Web Audio nodes).
 * React components shouldn't hold references to mutable objects directly.
 * This hook bridges the gap: it creates the engine once (via useRef), syncs
 * parameter changes between the Zustand store and the engine, and exposes
 * a clean API for components to call.
 *
 * USAGE:
 *   const { loadFile, play, stop, setVolume } = useAudioEngine()
 */

import { useCallback, useEffect } from 'react'
import { AudioEngine } from '../engine/AudioEngine'
import { useEngineStore } from '../stores/engineStore'
import type { EffectName } from '../../shared/types'

// Module-level singleton - ensures all components that call useAudioEngine()
// share the SAME AudioEngine instance. Previously each useRef created a separate
// engine per component, which meant the waveform/level meter and the controls
// would operate on different AudioContexts.
let singletonEngine: AudioEngine | null = null

// Reference count tracks how many mounted components are using the engine.
// The engine is only disposed when the LAST consumer unmounts (count drops to 0).
// Without this, conditionally rendered panels (e.g., RecordingPanel) would destroy
// the engine on hide — killing the originalBuffer and breaking Stage 1 Apply for
// ControlPanel which is still mounted.
let engineRefCount = 0

export function useAudioEngine() {
  // Lazy-initialize the singleton on first access from any component.
  // All subsequent calls return the same instance.
  const getEngine = useCallback((): AudioEngine => {
    if (!singletonEngine) {
      singletonEngine = new AudioEngine()
    }
    return singletonEngine
  }, [])

  // Track mount/unmount of each consumer. Only dispose the engine when the
  // last consumer unmounts (i.e., the app is shutting down). This prevents
  // RecordingPanel hide/show from destroying the shared AudioEngine.
  useEffect(() => {
    engineRefCount++
    return () => {
      engineRefCount--
      if (engineRefCount === 0) {
        singletonEngine?.dispose()
        singletonEngine = null
      }
    }
  }, [])

  // ─── File Loading ─────────────────────────────────────────────────────

  /**
   * Loads an audio file from an ArrayBuffer (e.g., from a file input or fetch).
   * Resets Stage 1 state since this is a new file.
   */
  const loadFile = useCallback(async (arrayBuffer: ArrayBuffer) => {
    const engine = getEngine()
    await engine.loadFile(arrayBuffer)

    // Update store: file is loaded, reset Stage 1 state
    const store = useEngineStore.getState()
    store.setHasFile(true)
    store.setHasProcessed(false)
    store.resetStage1()
  }, [getEngine])

  /**
   * Loads Stage 1-processed audio from the Rubber Band CLI output.
   * Called by useStage1Processing after IPC returns successfully.
   */
  const loadProcessedBuffer = useCallback(async (arrayBuffer: ArrayBuffer) => {
    const engine = getEngine()
    await engine.loadProcessedBuffer(arrayBuffer)
  }, [getEngine])

  // ─── Playback Controls ────────────────────────────────────────────────

  // B1: play() is now async (awaits ctx.resume() for suspended AudioContext).
  // We fire-and-forget the promise — setIsPlaying(true) happens immediately so the
  // UI updates without waiting for the AudioContext to resume.
  const play = useCallback(() => {
    const engine = getEngine()
    void engine.play(() => {
      // Callback when playback ends naturally
      useEngineStore.getState().setIsPlaying(false)
    })
    useEngineStore.getState().setIsPlaying(true)
  }, [getEngine])

  const pause = useCallback(() => {
    getEngine().pause()
    useEngineStore.getState().setIsPlaying(false)
  }, [getEngine])

  const stop = useCallback(() => {
    getEngine().stop()
    useEngineStore.getState().setIsPlaying(false)
  }, [getEngine])

  // ─── Seek (Sprint 4) ─────────────────────────────────────────────────

  /**
   * Seeks to a specific position in the audio buffer (in seconds).
   * During playback, this restarts from the new position seamlessly.
   * When paused/idle, it sets the start point for the next play().
   */
  const seek = useCallback((seconds: number) => {
    const engine = getEngine()
    const wasPlaying = engine.status === 'playing'
    engine.seek(seconds, wasPlaying ? () => {
      useEngineStore.getState().setIsPlaying(false)
    } : undefined)
  }, [getEngine])

  // ─── Level Metering (Sprint 4) ────────────────────────────────────────

  /**
   * Returns the current output peak level (0.0 to 1.0+).
   * Values above 1.0 indicate clipping.
   * Called on every animation frame by the level meter component.
   */
  const getOutputLevel = useCallback((): number => {
    return getEngine().getOutputLevel()
  }, [getEngine])

  /**
   * Returns the current playback position in seconds.
   * Used by the waveform playhead to track progress.
   */
  const getCurrentTime = useCallback((): number => {
    return getEngine().currentTime
  }, [getEngine])

  /**
   * Returns the duration of the active audio buffer in seconds.
   */
  const getDuration = useCallback((): number => {
    return getEngine().duration
  }, [getEngine])

  // ─── Volume ───────────────────────────────────────────────────────────

  const setVolume = useCallback((value: number) => {
    getEngine().setVolume(value)
    useEngineStore.getState().setVolume(value)
  }, [getEngine])

  // ─── Mic Gain & Input Level (Sprint 7.2) ─────────────────────────────

  /**
   * Sets the mic input gain (software pre-amp).
   * Syncs to both the AudioEngine GainNode and the Zustand store.
   */
  const setMicGain = useCallback((value: number) => {
    getEngine().setMicGain(value)
    useEngineStore.getState().setMicGain(value)
  }, [getEngine])

  /**
   * Returns the current mic input peak level (0.0 to 1.0+).
   * Called on every animation frame by the input level meter in RecordingPanel.
   */
  const getInputLevel = useCallback((): number => {
    return getEngine().getInputLevel()
  }, [getEngine])

  /**
   * Sets noise suppression aggressiveness (VAD gate threshold).
   * Sends the value to the RNNoise AudioWorklet and persists in store.
   */
  const setNoiseSuppressionAggressiveness = useCallback((value: number) => {
    getEngine().setNoiseSuppressionAggressiveness(value)
    useEngineStore.getState().setNoiseSuppressionAggressiveness(value)
  }, [getEngine])

  // ─── Real-Time Stage 2 Parameter Updates ──────────────────────────────

  const setEQBand = useCallback((index: number, gain: number, frequency: number) => {
    getEngine().setEQBand(index, gain, frequency)
  }, [getEngine])

  const setHighPassFrequency = useCallback((hz: number) => {
    getEngine().setHighPassFrequency(hz)
  }, [getEngine])

  const setCompressorThreshold = useCallback((db: number) => {
    getEngine().setCompressorThreshold(db)
  }, [getEngine])

  const setCompressorRatio = useCallback((ratio: number) => {
    getEngine().setCompressorRatio(ratio)
  }, [getEngine])

  const setOutputGain = useCallback((gain: number) => {
    getEngine().setOutputGain(gain)
  }, [getEngine])

  // ── Tone.js Effects ──────────────────────────────────────────────────

  /**
   * Updates vibrato in real time and syncs to the store.
   * Rate = LFO speed (Hz), Depth = 0-1 (intensity).
   */
  const setVibrato = useCallback((rate: number, depth: number) => {
    getEngine().setVibrato(rate, depth)
  }, [getEngine])

  /**
   * Updates tremolo in real time and syncs to the store.
   * Rate = LFO speed (Hz), Depth = 0-1 (intensity).
   */
  const setTremolo = useCallback((rate: number, depth: number) => {
    getEngine().setTremolo(rate, depth)
  }, [getEngine])

  /**
   * Updates reverb in real time.
   * roomSize = 0-1, amount = 0-1 (mix level).
   */
  const setReverb = useCallback((roomSize: number, amount: number) => {
    getEngine().setReverb(roomSize, amount)
  }, [getEngine])

  // ── Custom Effects ───────────────────────────────────────────────────

  /**
   * Updates vocal fry intensity (0-1) in real time.
   * Controls sub-audio AM modulation depth.
   */
  const setVocalFry = useCallback((intensity: number) => {
    getEngine().setVocalFry(intensity)
  }, [getEngine])

  /**
   * Updates breathiness amount (0-1) in real time.
   * Spectral reshaping - thins body, adds air.
   */
  const setBreathiness = useCallback((amount: number) => {
    getEngine().setBreathiness(amount)
  }, [getEngine])

  /**
   * Updates breathiness 2 amount (0-1) in real time.
   * Vocal processing method - layers a processed air track on top of the voice.
   */
  const setBreathiness2 = useCallback((amount: number) => {
    getEngine().setBreathiness2(amount)
  }, [getEngine])

  // ── Wet/Dry Mix ──────────────────────────────────────────────────────

  /**
   * Sets the wet/dry mix for a specific effect (0-1).
   */
  const setWetDry = useCallback((effect: EffectName, mix: number) => {
    getEngine().setWetDry(effect, mix)
  }, [getEngine])

  // ── Bypass ───────────────────────────────────────────────────────────

  /**
   * Enables/disables bypass mode (signal skips entire effects chain).
   */
  const setBypass = useCallback((bypassed: boolean) => {
    getEngine().setBypass(bypassed)
  }, [getEngine])

  // ── Loop ────────────────────────────────────────────────────────────

  /**
   * Enables/disables loop mode (audio restarts seamlessly at end).
   */
  const setLoop = useCallback((loop: boolean) => {
    getEngine().setLoop(loop)
  }, [getEngine])

  // ─── Snapshot ─────────────────────────────────────────────────────────

  /**
   * Applies a full snapshot (e.g., from a preset load).
   * Updates both the engine (Stage 2 nodes) and the store.
   */
  const applySnapshot = useCallback((snapshot: typeof useEngineStore.getState extends () => infer S ? S extends { snapshot: infer T } ? T : never : never) => {
    getEngine().applySnapshot(snapshot)
    useEngineStore.getState().setSnapshot(snapshot)
  }, [getEngine])

  return {
    getEngine,
    loadFile,
    loadProcessedBuffer,
    play,
    pause,
    stop,
    seek,
    getOutputLevel,
    getCurrentTime,
    getDuration,
    setVolume,
    setMicGain,
    getInputLevel,
    setNoiseSuppressionAggressiveness,
    setEQBand,
    setHighPassFrequency,
    setCompressorThreshold,
    setCompressorRatio,
    setOutputGain,
    setVibrato,
    setTremolo,
    setReverb,
    setVocalFry,
    setBreathiness,
    setBreathiness2,
    setWetDry,
    setBypass,
    setLoop,
    applySnapshot,
  }
}
