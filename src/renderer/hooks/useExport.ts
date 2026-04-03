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
 * useExport - Hook for Audio Export Pipeline (Sprint 6)
 *
 * Orchestrates the Stage 3 export flow:
 *   1. Encode the active AudioBuffer to WAV format
 *   2. Open a save dialog for the user to choose the output path
 *   3. Send the WAV data + export settings to main process via IPC
 *   4. FFmpeg processes the file (noise gate, normalization, padding, bit depth)
 *   5. Return success/failure to the UI
 *
 * IMPORTANT: This exports the raw buffer (original or Stage 1-processed).
 * Stage 2 real-time effects (EQ, reverb, etc.) are NOT baked into the export
 * because they run on Web Audio nodes that don't have an offline render path
 * in this sprint. A future sprint could add OfflineAudioContext rendering
 * to capture Stage 2 effects into the export.
 */

import { useState, useCallback } from 'react'
import type { AudioEngine } from '../engine/AudioEngine'
import type { ExportResult } from '../../shared/types'
import { encodeAudioBufferToWav } from '../engine/wavEncoder'

// ─── Export Settings State ───────────────────────────────────────────────────

export interface ExportSettings {
  bitDepth: 16 | 24 | 32
  sampleRate: number
  normalize: boolean
  noiseGate: boolean
  padStartMs: number
  padEndMs: number
}

/** Default export settings - sensible for game audio */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  bitDepth: 24,          // Studio quality, recommended for game audio
  sampleRate: 44100,     // Standard for most game engines
  normalize: true,       // Consistent volume across all character exports
  noiseGate: false,      // Off by default - user enables if recording has noise
  padStartMs: 0,         // No padding by default
  padEndMs: 0,
}

// ─── Export Status ───────────────────────────────────────────────────────────

export type ExportStatus = 'idle' | 'encoding' | 'exporting' | 'success' | 'error'

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useExport(getEngine: () => AudioEngine) {
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS)
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)

  // ─── Update individual settings ─────────────────────────────────────

  const updateSetting = useCallback(<K extends keyof ExportSettings>(
    key: K,
    value: ExportSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ─── Export Flow ────────────────────────────────────────────────────

  /**
   * Runs the full export pipeline:
   * 1. Get the active AudioBuffer from the engine
   * 2. Encode it to WAV
   * 3. Open save dialog
   * 4. Send to main process for FFmpeg processing
   *
   * @param suggestedName - Optional suggested filename for the save dialog
   * @returns ExportResult or null if user cancelled
   */
  const exportAudio = useCallback(async (suggestedName?: string): Promise<ExportResult | null> => {
    setError(null)
    setLastExportPath(null)

    // ── Step 1: Get the active buffer ──────────────────────────────────
    const engine = getEngine()
    const buffer = engine.activeBuffer
    if (!buffer) {
      setStatus('error')
      setError('No audio loaded to export')
      return null
    }

    // ── Step 2: Open save dialog ───────────────────────────────────────
    const outputPath = await window.voxsmith.saveWavDialog(suggestedName ?? 'export.wav')
    if (!outputPath) {
      // User cancelled the save dialog
      return null
    }

    try {
      // ── Step 3: Encode AudioBuffer to WAV ────────────────────────────
      setStatus('encoding')
      console.debug('[useExport] Encoding AudioBuffer to WAV...')
      const wavData = encodeAudioBufferToWav(buffer)
      console.debug(`[useExport] Encoded ${wavData.byteLength} bytes`)

      // ── Step 4: Send to main process for FFmpeg processing ───────────
      setStatus('exporting')
      console.debug(`[useExport] Exporting to: ${outputPath}`)
      const result = await window.voxsmith.exportWav({
        audioData: wavData,
        outputPath,
        bitDepth: settings.bitDepth,
        sampleRate: settings.sampleRate,
        normalize: settings.normalize,
        noiseGate: settings.noiseGate,
        padStartMs: settings.padStartMs,
        padEndMs: settings.padEndMs,
      })

      if (result.success) {
        setStatus('success')
        setLastExportPath(result.outputPath ?? outputPath)
        console.debug(`[useExport] Export success: ${result.outputPath}`)
      } else {
        setStatus('error')
        setError(result.error ?? 'Export failed')
        console.error(`[useExport] Export failed: ${result.error}`)
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setStatus('error')
      setError(errorMsg)
      console.error(`[useExport] Export error: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  }, [getEngine, settings])

  // ─── Reset ──────────────────────────────────────────────────────────

  const resetStatus = useCallback(() => {
    setStatus('idle')
    setError(null)
  }, [])

  return {
    settings,
    updateSetting,
    setSettings,
    status,
    error,
    lastExportPath,
    exportAudio,
    resetStatus,
  }
}
