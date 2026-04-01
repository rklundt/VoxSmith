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
 * useAudioEngine — Hook for AudioEngine Lifecycle
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

import { useRef, useCallback, useEffect } from 'react'
import { AudioEngine } from '../engine/AudioEngine'
import { useEngineStore } from '../stores/engineStore'

export function useAudioEngine() {
  // The engine lives for the entire app session — useRef ensures it's created once.
  // We don't use useState because we don't want React re-renders when engine
  // internals change. The Zustand store handles UI state separately.
  const engineRef = useRef<AudioEngine | null>(null)

  // Lazy-initialize the engine on first access
  const getEngine = useCallback((): AudioEngine => {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine()
    }
    return engineRef.current
  }, [])

  // Clean up the engine when the component (App) unmounts
  useEffect(() => {
    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
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

  const play = useCallback(() => {
    const engine = getEngine()
    engine.play(() => {
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

  // ─── Volume ───────────────────────────────────────────────────────────

  const setVolume = useCallback((value: number) => {
    getEngine().setVolume(value)
    useEngineStore.getState().setVolume(value)
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
    setVolume,
    setEQBand,
    setHighPassFrequency,
    setCompressorThreshold,
    setCompressorRatio,
    applySnapshot,
  }
}
