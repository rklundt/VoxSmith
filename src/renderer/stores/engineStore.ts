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
import type { EngineSnapshot } from '../../shared/types'
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
}))
