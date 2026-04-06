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
 * Engine Store - Zustand
 *
 * Owns: current parameter values, playback state, Stage 1 processing state,
 * bypass state, input mode, and the "stale preview" indicator.
 *
 * Does NOT own: actual Web Audio nodes (those live in AudioEngine instance).
 *
 * STALE PREVIEW PATTERN:
 * Stage 1 parameters (pitch, formant, tempo) are processed offline by the
 * Rubber Band CLI. When the user changes any of these parameters, the preview
 * is "stale" - what they hear doesn't match what they've dialed in yet.
 * The stale indicator tells them to click "Apply" to re-process.
 * Stage 2 parameters (EQ, compressor, etc.) update in real time - no staleness.
 */

import { create } from 'zustand'
import type { EngineSnapshot, RecordingState, Take, PunchInRegion } from '../../shared/types'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../shared/constants'

// ─── Stage 1 Processing State ─────────────────────────────────────────────

export type Stage1Status = 'idle' | 'processing' | 'error'

/**
 * The Stage 1 parameters that were last "applied" (sent to Rubber Band CLI).
 * Compared against the current snapshot to determine if the preview is stale.
 */
export interface AppliedStage1Params {
  pitch: number
  formant: number
  speed: number
}

// ─── Store Interface ──────────────────────────────────────────────────────

interface EngineState {
  /** Current audio engine parameter values (all stages) */
  snapshot: EngineSnapshot

  /** Whether audio is currently playing */
  isPlaying: boolean

  /** Whether input is from file or mic */
  inputMode: 'file' | 'mic'

  /** Whether an audio file has been loaded */
  hasFile: boolean

  /** Whether Stage 1 has been applied (processedBuffer exists) */
  hasProcessed: boolean

  /** Current volume level (pre-effects, 0.0 to 2.0) */
  volume: number

  // ─── Stage 1 State ──────────────────────────────────────────────────

  /** Current Stage 1 processing status */
  stage1Status: Stage1Status

  /** Error message from last failed Stage 1 processing */
  stage1Error: string | null

  /** The Stage 1 params that are currently "baked" into the processedBuffer.
   *  null if no Stage 1 processing has been applied yet. */
  appliedStage1Params: AppliedStage1Params | null

  /** Whether current Stage 1 params differ from what's been applied.
   *  True = the user hears stale audio. They need to click "Apply". */
  isStale: boolean

  // ─── Mic / Recording State (Sprint 7) ────────────────────────────────

  /** Whether mic input is active (routing through effects chain) */
  micActive: boolean

  /** Current recording state machine position */
  recordingState: RecordingState

  /** Count-in beats remaining (0 = not counting in) */
  countInBeats: number

  /** Count-in total beats setting (1-4) */
  countInTotal: number

  /** List of recorded takes in the current session */
  takes: Take[]

  /** ID of the take currently selected for audition */
  selectedTakeId: string | null

  /** Recording duration in ms (updated live during recording) */
  recordingDurationMs: number

  /** Whether monitoring is muted (no audio to speakers during mic mode) */
  monitorMuted: boolean

  /** Mic input gain (software pre-amp). 0.0 to 4.0, 1.0 = unity.
   *  Boosts the raw mic signal before volume/effects. Also affects recorded takes. */
  micGain: number

  /** Whether noise suppression is enabled for mic input.
   *  Sprint 7.2: controls RNNoise WASM AudioWorklet in the signal chain.
   *  (WebRTC getUserMedia constraint was tested and doesn't work in Electron.) */
  noiseSuppression: boolean

  /** Noise suppression aggressiveness (VAD gate threshold).
   *  Controls how aggressively the post-RNNoise VAD gate attenuates residual noise.
   *  0.1 = gentle (only gate pure noise), 0.5 = moderate, 0.95 = very aggressive. */
  noiseSuppressionAggressiveness: number

  /** Mic permission error message, if any */
  micError: string | null

  /** Selected waveform region for punch-in recording (null = no region selected) */
  punchInRegion: PunchInRegion | null

  // ─── Actions ────────────────────────────────────────────────────────

  /** Update the full engine snapshot (e.g., preset load, reset) */
  setSnapshot: (snapshot: EngineSnapshot) => void

  /** Update a single parameter in the snapshot */
  updateParam: <K extends keyof EngineSnapshot>(key: K, value: EngineSnapshot[K]) => void

  /** Set playback state */
  setIsPlaying: (playing: boolean) => void

  /** Set whether a file is loaded */
  setHasFile: (hasFile: boolean) => void

  /** Set whether Stage 1 processing has been applied */
  setHasProcessed: (hasProcessed: boolean) => void

  /** Set volume level */
  setVolume: (volume: number) => void

  /** Mark Stage 1 as processing */
  setStage1Processing: () => void

  /** Mark Stage 1 as completed successfully with the applied params */
  setStage1Complete: (params: AppliedStage1Params) => void

  /** Mark Stage 1 as failed with an error */
  setStage1Error: (error: string) => void

  /** Reset Stage 1 state (e.g., when loading a new file) */
  resetStage1: () => void

  // ─── Mic / Recording Actions (Sprint 7) ─────────────────────────────

  /** Set mic active state */
  setMicActive: (active: boolean) => void

  /** Set input mode (file vs mic) */
  setInputMode: (mode: 'file' | 'mic') => void

  /** Set recording state */
  setRecordingState: (state: RecordingState) => void

  /** Set count-in beats remaining */
  setCountInBeats: (beats: number) => void

  /** Set count-in total beats setting */
  setCountInTotal: (total: number) => void

  /** Add a take to the list */
  addTake: (take: Take) => void

  /** Remove a take by ID */
  removeTake: (id: string) => void

  /** Select a take for audition */
  selectTake: (id: string | null) => void

  /** Update the live recording duration display */
  setRecordingDurationMs: (ms: number) => void

  /** Set monitor mute state */
  setMonitorMuted: (muted: boolean) => void

  /** Set mic error message */
  setMicError: (error: string | null) => void

  /** Set mic input gain level (software pre-amp) */
  setMicGain: (gain: number) => void

  /** Toggle noise suppression for mic input (Sprint 7.2: RNNoise WASM) */
  setNoiseSuppression: (enabled: boolean) => void

  /** Set noise suppression aggressiveness (VAD gate threshold, 0.1–0.95) */
  setNoiseSuppressionAggressiveness: (value: number) => void

  /** Set the punch-in region (waveform selection), or null to clear */
  setPunchInRegion: (region: PunchInRegion | null) => void
}

/**
 * Computes whether the preview is stale by comparing current Stage 1 params
 * against the last applied params. Returns true if any param has changed.
 *
 * Also considers the case where a processed buffer exists but all params are
 * back to defaults - the user reset and wants to "un-process" via Apply.
 */
export function computeIsStale(
  snapshot: EngineSnapshot,
  applied: AppliedStage1Params | null,
  hasProcessed: boolean
): boolean {
  if (!applied) {
    // No processing has been applied yet - stale if any Stage 1 param is non-default
    // (i.e., pitch !== 0, formant !== 0, or speed !== 1.0)
    return snapshot.pitch !== 0 || snapshot.formant !== 0 || snapshot.speed !== 1.0
  }

  const paramsAtDefaults = snapshot.pitch === 0 && snapshot.formant === 0 && snapshot.speed === 1.0

  // If a processed buffer exists but params are back to defaults, that's stale -
  // the user reset and needs to Apply to revert to the original unprocessed audio.
  if (paramsAtDefaults && hasProcessed) {
    return true
  }

  // Compare current dialed-in values against what was last processed
  return (
    snapshot.pitch !== applied.pitch ||
    snapshot.formant !== applied.formant ||
    snapshot.speed !== applied.speed
  )
}

export const useEngineStore = create<EngineState>((set, get) => ({
  snapshot: DEFAULT_ENGINE_SNAPSHOT,
  isPlaying: false,
  inputMode: 'file',
  hasFile: false,
  hasProcessed: false,
  volume: 1.0,

  stage1Status: 'idle',
  stage1Error: null,
  appliedStage1Params: null,
  isStale: false,

  // Mic / Recording (Sprint 7)
  micActive: false,
  monitorMuted: true,    // muted by default to prevent speaker→mic feedback
  micGain: 1.0,          // unity — no boost by default; user adjusts if OS mic is too quiet
  noiseSuppression: true, // ON by default — wired to RNNoise WASM AudioWorklet
  noiseSuppressionAggressiveness: 0.5, // moderate — VAD gate threshold (0.1=gentle, 0.95=very aggressive)
  recordingState: 'idle',
  countInBeats: 0,
  countInTotal: 3,       // default 3-beat count-in
  takes: [],
  selectedTakeId: null,
  recordingDurationMs: 0,
  micError: null,
  punchInRegion: null,

  setSnapshot: (snapshot) => set({
    snapshot,
    isStale: computeIsStale(snapshot, get().appliedStage1Params, get().hasProcessed),
  }),

  updateParam: (key, value) => {
    const newSnapshot = { ...get().snapshot, [key]: value }
    const stale = computeIsStale(newSnapshot, get().appliedStage1Params, get().hasProcessed)
    set({
      snapshot: newSnapshot,
      isStale: stale,
    })
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setHasFile: (hasFile) => set({ hasFile }),
  setHasProcessed: (hasProcessed) => set({ hasProcessed }),
  setVolume: (volume) => set({ volume }),

  setStage1Processing: () => set({ stage1Status: 'processing', stage1Error: null }),

  setStage1Complete: (params) => set({
    stage1Status: 'idle',
    stage1Error: null,
    appliedStage1Params: params,
    hasProcessed: true,
    // After applying, the preview matches the dialed-in params → not stale
    isStale: false,
  }),

  setStage1Error: (error) => set({
    stage1Status: 'error',
    stage1Error: error,
  }),

  resetStage1: () => set({
    stage1Status: 'idle',
    stage1Error: null,
    appliedStage1Params: null,
    hasProcessed: false,
    isStale: false,
  }),

  // Mic / Recording actions (Sprint 7)
  setMicActive: (active) => set({ micActive: active }),
  setInputMode: (mode) => set({ inputMode: mode }),
  setRecordingState: (state) => set({ recordingState: state }),
  setCountInBeats: (beats) => set({ countInBeats: beats }),
  setCountInTotal: (total) => set({ countInTotal: Math.max(0, Math.min(4, total)) }),
  addTake: (take) => set((s) => ({ takes: [...s.takes, take] })),
  removeTake: (id) => set((s) => ({
    takes: s.takes.filter((t) => t.id !== id),
    // Deselect if the removed take was selected
    selectedTakeId: s.selectedTakeId === id ? null : s.selectedTakeId,
  })),
  selectTake: (id) => set({ selectedTakeId: id }),
  setRecordingDurationMs: (ms) => set({ recordingDurationMs: ms }),
  setMonitorMuted: (muted) => set({ monitorMuted: muted }),
  setMicError: (error) => set({ micError: error }),
  setMicGain: (gain) => set({ micGain: gain }),
  setNoiseSuppression: (enabled) => set({ noiseSuppression: enabled }),
  setNoiseSuppressionAggressiveness: (value) => set({ noiseSuppressionAggressiveness: value }),
  setPunchInRegion: (region) => set({ punchInRegion: region }),
}))
