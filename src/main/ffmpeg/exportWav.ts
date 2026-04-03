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
 * FFmpeg Export Pipeline - Stage 3
 *
 * Takes a WAV-encoded audio buffer from the renderer and produces a final
 * export-ready WAV file with the user's chosen settings:
 *
 *   1. Write the input buffer to a temporary WAV file
 *   2. Build the FFmpeg command with filters for:
 *      - Noise gate (if enabled)
 *      - Normalization to -1dBFS (if enabled)
 *      - Silence padding at start/end (if non-zero)
 *   3. Spawn FFmpeg as a child process
 *   4. Wait for completion, capture stdout/stderr
 *   5. Clean up the temp input file
 *   6. Return success/failure result
 *
 * WHY FFMPEG?
 * The renderer's Web Audio API handles real-time effects (Stage 2), but
 * post-processing like normalization, noise gating, bit depth conversion,
 * and silence padding are done more reliably by FFmpeg. FFmpeg also handles
 * WAV header writing correctly for all bit depths and sample rates.
 *
 * TEMP FILE STRATEGY:
 * We write the renderer's AudioBuffer to a temp file, process it, and delete
 * the temp. The output goes directly to the user's chosen path. If FFmpeg
 * fails, the temp is still cleaned up (finally block).
 */

import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Logger } from 'winston'
import type { ExportRequest, ExportResult } from '../../shared/types'
import { getFFmpegPath } from './binaryPath'

// ─── Bit Depth Codec Mapping ─────────────────────────────────────────────────

/**
 * Maps bit depth to the FFmpeg PCM codec name.
 * WAV files use raw PCM codecs - the "s" means signed, "le" means little-endian.
 * These are the standard WAV codecs that every game engine can read.
 */
function getCodecForBitDepth(bitDepth: 16 | 24 | 32): string {
  switch (bitDepth) {
    case 16: return 'pcm_s16le'  // 16-bit signed integer, little-endian
    case 24: return 'pcm_s24le'  // 24-bit signed integer, little-endian
    case 32: return 'pcm_f32le'  // 32-bit IEEE float, little-endian
  }
}

// ─── Filter Chain Builder ────────────────────────────────────────────────────

/**
 * Builds the FFmpeg audio filter chain string from export settings.
 *
 * FFmpeg filters are chained with commas: "filter1,filter2,filter3"
 * Order matters - we apply them in this sequence:
 *   1. Noise gate (removes silence/noise below threshold)
 *   2. Normalization (brings peak level to -1dBFS)
 *   3. Silence padding (adds silence at start and end)
 *
 * @returns The -af filter string, or null if no filters are needed
 */
function buildFilterChain(request: ExportRequest): string | null {
  const filters: string[] = []

  // ── Noise Gate ──────────────────────────────────────────────────────
  // FFmpeg's "agate" filter silences audio below a threshold.
  // threshold=0.01 (-40dB) catches most room noise without cutting off
  // quiet speech. attack/release smooth the gate transitions to avoid
  // audible "pumping" artifacts.
  if (request.noiseGate) {
    filters.push('agate=threshold=0.01:attack=5:release=50')
  }

  // ── Normalization ──────────────────────────────────────────────────
  // FFmpeg's "loudnorm" filter performs EBU R128 loudness normalization.
  // We target -1dBFS true peak to leave headroom and avoid intersample
  // clipping in game engines. "linear=true" uses linear normalization
  // (simple gain) instead of dynamic compression - preserves the voice's
  // natural dynamics.
  if (request.normalize) {
    filters.push('loudnorm=I=-14:TP=-1:LRA=11:linear=true')
  }

  // ── Silence Padding ────────────────────────────────────────────────
  // "adelay" adds silence at the start (in milliseconds).
  // "apad" with pad_dur adds silence at the end.
  // We apply these AFTER normalization so the padding is true silence (0 samples).
  if (request.padStartMs > 0) {
    // adelay takes milliseconds, applies to all channels ("|" separator for stereo)
    filters.push(`adelay=${request.padStartMs}|${request.padStartMs}`)
  }
  if (request.padEndMs > 0) {
    // apad's pad_dur is in seconds, so convert ms to seconds
    const padSec = (request.padEndMs / 1000).toFixed(4)
    filters.push(`apad=pad_dur=${padSec}`)
  }

  return filters.length > 0 ? filters.join(',') : null
}

// ─── Command Builder ─────────────────────────────────────────────────────────

/**
 * Builds the full FFmpeg argument array for a WAV export.
 * Separated from execution so the command string can be logged for diagnostics.
 *
 * @param inputPath - Path to the temp input WAV
 * @param outputPath - User's chosen output path
 * @param request - Export settings
 * @returns Array of FFmpeg arguments (without the ffmpeg binary itself)
 */
function buildFFmpegArgs(inputPath: string, outputPath: string, request: ExportRequest): string[] {
  const args: string[] = []

  // Overwrite output without asking (FFmpeg defaults to prompting)
  args.push('-y')

  // Input file
  args.push('-i', inputPath)

  // Audio filter chain (noise gate, normalization, padding)
  const filterChain = buildFilterChain(request)
  if (filterChain) {
    args.push('-af', filterChain)
  }

  // Output codec (bit depth)
  args.push('-acodec', getCodecForBitDepth(request.bitDepth))

  // Sample rate
  args.push('-ar', String(request.sampleRate))

  // Output format (WAV)
  args.push('-f', 'wav')

  // Output path
  args.push(outputPath)

  return args
}

// ─── Export Execution ────────────────────────────────────────────────────────

/**
 * Exports a single WAV file via FFmpeg.
 *
 * The full pipeline:
 * 1. Write the renderer's audio data to a temp WAV file
 * 2. Build and execute the FFmpeg command
 * 3. Clean up the temp file
 * 4. Return the result
 *
 * @param request - Export settings and audio data from the renderer
 * @param logger - Winston logger for diagnostic output
 * @returns ExportResult with success/failure and output path
 */
export async function exportWav(request: ExportRequest, logger: Logger): Promise<ExportResult> {
  const ffmpegPath = getFFmpegPath()
  logger.debug(`FFmpeg binary: ${ffmpegPath}`)

  // Create a temp file for the input audio.
  // We write to os.tmpdir() to avoid polluting the user's project directory.
  const tempDir = os.tmpdir()
  const tempInputPath = path.join(tempDir, `voxsmith-export-input-${Date.now()}.wav`)

  try {
    // ── Step 1: Write input audio to temp WAV ──────────────────────────
    // The renderer sends the audio as an ArrayBuffer containing raw WAV bytes.
    // We write it directly - no need to re-encode since it's already a valid WAV.
    logger.debug(`Writing temp input: ${tempInputPath} (${request.audioData.byteLength} bytes)`)
    const inputBuffer = Buffer.from(request.audioData)
    fs.writeFileSync(tempInputPath, inputBuffer)

    // ── Step 2: Build FFmpeg command ───────────────────────────────────
    const args = buildFFmpegArgs(tempInputPath, request.outputPath, request)
    const commandString = `"${ffmpegPath}" ${args.map((a) => a.includes(' ') ? `"${a}"` : a).join(' ')}`
    logger.debug(`FFmpeg command: ${commandString}`)

    // ── Step 3: Execute FFmpeg ─────────────────────────────────────────
    const result = await new Promise<ExportResult>((resolve) => {
      execFile(
        ffmpegPath,
        args,
        {
          // 5 minute timeout - should be more than enough for any single file export.
          // FFmpeg processes audio much faster than real time.
          timeout: 300000,
          // Capture stderr (FFmpeg writes progress/errors there, not stdout)
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer for FFmpeg's verbose output
        },
        (error, _stdout, stderr) => {
          if (error) {
            // FFmpeg failed - log the full stderr for diagnostics
            logger.error(`FFmpeg failed: ${error.message}`)
            if (stderr) {
              logger.error(`FFmpeg stderr: ${stderr}`)
            }
            resolve({
              success: false,
              error: `FFmpeg export failed: ${error.message}`,
            })
            return
          }

          // Verify the output file was actually created
          if (!fs.existsSync(request.outputPath)) {
            logger.error('FFmpeg completed but output file is missing')
            resolve({
              success: false,
              error: 'Export completed but output file was not created',
            })
            return
          }

          // Read output file stats for the result
          const stats = fs.statSync(request.outputPath)
          logger.debug(`Export complete: ${request.outputPath} (${stats.size} bytes)`)

          resolve({
            success: true,
            outputPath: request.outputPath,
          })
        }
      )
    })

    return result
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Export pipeline error: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg,
    }
  } finally {
    // ── Step 4: Clean up temp file ─────────────────────────────────────
    // Always clean up, even if FFmpeg failed. Orphaned temp files waste disk space.
    try {
      if (fs.existsSync(tempInputPath)) {
        fs.unlinkSync(tempInputPath)
        logger.debug(`Cleaned up temp input: ${tempInputPath}`)
      }
    } catch (cleanupErr) {
      // Not critical - log and move on
      logger.warn(`Failed to clean up temp file ${tempInputPath}: ${cleanupErr}`)
    }
  }
}
