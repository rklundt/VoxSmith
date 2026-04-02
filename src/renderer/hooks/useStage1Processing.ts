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
 * useStage1Processing - Hook for Offline Audio Processing (Stage 1)
 *
 * Handles the "Apply" button workflow:
 * 1. User adjusts pitch/formant/tempo sliders (preview becomes "stale")
 * 2. User clicks "Apply"
 * 3. This hook sends the original audio + current params to main via IPC
 * 4. Main spawns Rubber Band CLI, processes the audio, returns the result
 * 5. The processed buffer is loaded into the AudioEngine for playback
 *
 * STALE PREVIEW PATTERN:
 * Stage 1 parameters are offline - they can't update in real time.
 * When the user changes pitch/formant/tempo without clicking Apply,
 * the audio they hear is "stale" (processed with old params).
 * The engineStore tracks this via isStale, which the UI shows as an indicator.
 *
 * CANCELLATION:
 * If the user clicks Apply again while processing is in flight, or
 * loads a new file, the in-flight processing is cancelled via IPC.
 */

import { useCallback } from 'react'
import { useEngineStore } from '../stores/engineStore'
import type { AudioProcessRequest } from '../../shared/types'

interface UseStage1ProcessingProps {
  /** Function to load the processed buffer into the AudioEngine */
  loadProcessedBuffer: (arrayBuffer: ArrayBuffer) => Promise<void>
  /** Function to get the AudioEngine instance (for reading originalBuffer) */
  getEngine: () => { originalBuffer: AudioBuffer | null; hasProcessed: boolean; clearProcessedBuffer: () => void }
}

export function useStage1Processing({ loadProcessedBuffer, getEngine }: UseStage1ProcessingProps) {
  /**
   * Triggers Stage 1 offline processing.
   * Sends the original audio buffer + current pitch/formant/tempo to the main process.
   * The main process writes a temp WAV, runs Rubber Band CLI, and returns the processed audio.
   */
  const applyStage1 = useCallback(async () => {
    const engine = getEngine()
    const store = useEngineStore.getState()

    if (!engine.originalBuffer) {
      console.warn('[Stage1] No audio file loaded - cannot apply')
      return
    }

    // Read the current Stage 1 parameters from the store
    const { snapshot } = store
    const pitch = snapshot.pitch
    const formant = snapshot.formant
    const speed = snapshot.speed

    // If all Stage 1 params are at default, skip processing -
    // clear the processed buffer so the original plays directly.
    // This handles the "reset → Apply" flow: the user wants to revert
    // to the unprocessed original without running Rubber Band.
    if (pitch === 0 && formant === 0 && speed === 1.0) {
      engine.clearProcessedBuffer()
      store.resetStage1()
      return
    }

    // Mark as processing (shows spinner in UI)
    store.setStage1Processing()

    try {
      // Convert the original AudioBuffer to an interleaved Float32Array.
      // The main process expects raw PCM data to write into a WAV file.
      const originalBuffer = engine.originalBuffer
      const numChannels = originalBuffer.numberOfChannels
      const length = originalBuffer.length
      const sampleRate = originalBuffer.sampleRate

      // Interleave channels: [L0, R0, L1, R1, L2, R2, ...]
      // WAV files store samples interleaved, not as separate channel arrays.
      const interleaved = new Float32Array(length * numChannels)
      const channelData: Float32Array[] = []
      for (let ch = 0; ch < numChannels; ch++) {
        channelData.push(originalBuffer.getChannelData(ch))
      }
      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          interleaved[i * numChannels + ch] = channelData[ch][i]
        }
      }

      // Build the IPC request.
      // Formant is stored in octaves (-2 to +2) in the UI but Rubber Band CLI
      // uses semitones, so convert: 1 octave = 12 semitones.
      const formantSemitones = formant * 12

      const request: AudioProcessRequest = {
        audioData: interleaved.buffer,
        sampleRate,
        channels: numChannels,
        pitch,
        formantSemitones,
        // preserveFormant is used in single-pass mode (formant=0, pitch!=0).
        // When formant is non-zero, the two-pass pipeline handles formant
        // positioning automatically and this flag is managed by processAudio().
        preserveFormant: formantSemitones === 0 && pitch !== 0,
        tempo: speed,
      }

      // Send to main process via IPC bridge
      const result = await window.voxsmith.processAudio(request)

      if (!result.success) {
        store.setStage1Error(result.error ?? 'Unknown processing error')
        console.error('[Stage1] Processing failed:', result.error)
        if (result.commandString) {
          console.debug('[Stage1] Command was:', result.commandString)
        }
        return
      }

      if (!result.processedData) {
        store.setStage1Error('Processing succeeded but returned no data')
        return
      }

      // Load the processed audio into the engine
      await loadProcessedBuffer(result.processedData)

      // Update store: processing complete, preview is no longer stale
      store.setStage1Complete({ pitch, formant, speed })

      console.debug(`[Stage1] Processing complete: pitch=${pitch}, formant=${formant}, speed=${speed}, duration=${result.durationSeconds?.toFixed(2)}s`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      store.setStage1Error(errorMsg)
      console.error('[Stage1] Processing error:', errorMsg)
    }
  }, [getEngine, loadProcessedBuffer])

  /**
   * Cancels in-flight Stage 1 processing.
   * Sends AUDIO_PROCESS_CANCEL to the main process, which kills the child process.
   */
  const cancelStage1 = useCallback(async () => {
    try {
      await window.voxsmith.cancelProcessing()
      useEngineStore.getState().resetStage1()
      console.debug('[Stage1] Processing cancelled')
    } catch (err) {
      console.error('[Stage1] Cancel error:', err)
    }
  }, [])

  return {
    applyStage1,
    cancelStage1,
  }
}
