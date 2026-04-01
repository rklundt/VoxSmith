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
 * Stage 1 — Offline Audio Processing via Rubber Band CLI
 *
 * This module handles the entire Stage 1 pipeline:
 * 1. Receive an AudioProcessRequest (ArrayBuffer + parameters) from renderer via IPC
 * 2. Write the audio data to a temporary WAV file
 * 3. Spawn the Rubber Band CLI binary with pitch/formant/tempo parameters
 * 4. Read the processed output WAV file
 * 5. Clean up temp files
 * 6. Return the processed audio as an AudioProcessResult
 *
 * WHY OFFLINE?
 * The Sprint 1 spike proved that rubberband-web (WASM AudioWorklet) has three
 * fatal limitations: no formant control, broken real-time tempo, and buffer
 * overruns. The native CLI binary solves all three because it processes the
 * entire file at once — no 128-sample block constraints.
 *
 * SIGNAL FLOW:
 *   Renderer (IPC) → processAudio() → temp input.wav → rubberband CLI → temp output.wav → Renderer (IPC)
 *
 * TEMP FILE SAFETY:
 * - Temp files are created in os.tmpdir() with unique timestamps
 * - Cleanup runs in a finally block so files are removed even on error
 * - If the CLI crashes mid-write, the input file is still cleaned up
 */

import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Logger } from 'winston'
import type { AudioProcessRequest, AudioProcessResult } from '../../shared/types'
import { getRubberbandPath } from './binaryPath'

// ─── WAV File Utilities ──────────────────────────────────────────────────────

/**
 * Writes raw PCM audio data (from an ArrayBuffer) to a WAV file.
 *
 * The renderer sends audio as a flat Float32Array packed into an ArrayBuffer.
 * WAV files need a 44-byte header with format metadata, followed by the PCM data.
 * We write 16-bit PCM because rubberband CLI handles it reliably.
 *
 * @param filePath — Where to write the WAV file
 * @param audioData — Raw audio data as ArrayBuffer (Float32 interleaved samples)
 * @param sampleRate — Sample rate in Hz (e.g., 44100)
 * @param channels — Number of channels (1 = mono, 2 = stereo)
 */
function writeWavFile(filePath: string, audioData: ArrayBuffer, sampleRate: number, channels: number): void {
  const float32 = new Float32Array(audioData)
  const numSamples = float32.length

  // Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767] for WAV
  const int16 = new Int16Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    // Clamp to [-1, 1] to prevent overflow, then scale to Int16 range
    const clamped = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767
  }

  const byteRate = sampleRate * channels * 2  // 2 bytes per sample (16-bit)
  const blockAlign = channels * 2
  const dataSize = int16.length * 2  // 2 bytes per Int16 sample

  // WAV header is always 44 bytes for PCM format
  const header = Buffer.alloc(44)

  // RIFF chunk descriptor
  header.write('RIFF', 0)                        // ChunkID
  header.writeUInt32LE(36 + dataSize, 4)         // ChunkSize (file size minus 8)
  header.write('WAVE', 8)                        // Format

  // "fmt " sub-chunk — describes the audio format
  header.write('fmt ', 12)                       // Subchunk1ID
  header.writeUInt32LE(16, 16)                   // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20)                    // AudioFormat (1 = PCM, no compression)
  header.writeUInt16LE(channels, 22)             // NumChannels
  header.writeUInt32LE(sampleRate, 24)           // SampleRate
  header.writeUInt32LE(byteRate, 28)             // ByteRate
  header.writeUInt16LE(blockAlign, 32)           // BlockAlign
  header.writeUInt16LE(16, 34)                   // BitsPerSample (16-bit)

  // "data" sub-chunk — contains the actual audio samples
  header.write('data', 36)                       // Subchunk2ID
  header.writeUInt32LE(dataSize, 40)             // Subchunk2Size

  // Write header + PCM data to file
  const dataBuffer = Buffer.from(int16.buffer)
  const fileBuffer = Buffer.concat([header, dataBuffer])
  fs.writeFileSync(filePath, fileBuffer)
}

/**
 * Reads a WAV file and returns the audio data as a Float32 ArrayBuffer.
 *
 * Parses the WAV header to find the data chunk, then converts the PCM samples
 * back to Float32 [-1.0, 1.0] format for the renderer's AudioContext.decodeAudioData().
 *
 * Actually, we return the raw WAV file bytes — the renderer will use
 * AudioContext.decodeAudioData() which handles WAV parsing natively.
 *
 * @param filePath — Path to the WAV file to read
 * @returns The full WAV file as an ArrayBuffer (header + data)
 */
function readWavFileAsArrayBuffer(filePath: string): ArrayBuffer {
  const buffer = fs.readFileSync(filePath)
  // Return the raw WAV bytes — the renderer's decodeAudioData() handles parsing
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

/**
 * Estimates the duration of a WAV file from its header.
 *
 * @param filePath — Path to the WAV file
 * @returns Duration in seconds
 */
function getWavDuration(filePath: string): number {
  // Read just the 44-byte WAV header to extract duration info.
  // We open a file descriptor and read only the bytes we need,
  // rather than reading the entire file.
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(44)
  const bytesRead = fs.readSync(fd, buffer, 0, 44, 0)
  fs.closeSync(fd)
  if (bytesRead < 44) return 0

  const sampleRate = buffer.readUInt32LE(24)
  const byteRate = buffer.readUInt32LE(28)
  const dataSize = buffer.readUInt32LE(40)

  if (byteRate === 0) return 0
  return dataSize / byteRate
}

// ─── Rubber Band CLI Execution ───────────────────────────────────────────────

// Track the current child process so it can be cancelled via IPC
let activeProcess: ChildProcess | null = null

/**
 * Builds the Rubber Band CLI command arguments.
 *
 * Rubber Band CLI syntax:
 *   rubberband [options] input.wav output.wav
 *
 * Key flags for VoxSmith:
 *   --pitch N     Pitch shift in semitones (positive = up, negative = down)
 *   --formant     Preserve formants during pitch shift (THE critical flag)
 *   --tempo N     Time-stretch ratio (1.0 = no change)
 *   --fine        Higher quality processing (acceptable for offline use)
 *
 * @param request — The audio processing parameters from the renderer
 * @param inputPath — Path to the temp input WAV
 * @param outputPath — Path where the processed WAV will be written
 * @returns Array of CLI arguments
 */
function buildArgs(request: AudioProcessRequest, inputPath: string, outputPath: string): string[] {
  const args: string[] = []

  // Pitch shift in semitones
  if (request.pitch !== 0) {
    args.push('--pitch', request.pitch.toString())
  }

  // Formant preservation — this is the flag rubberband-web couldn't provide.
  // When enabled, pitch-shifting no longer causes the "chipmunk effect" because
  // the resonant character of the voice (formants) is preserved independently.
  if (request.preserveFormant) {
    args.push('--formant')
  }

  // Tempo/time-stretch ratio
  if (request.tempo !== 1.0) {
    args.push('--tempo', request.tempo.toString())
  }

  // High quality mode — slightly slower but produces cleaner output.
  // Acceptable for offline processing where latency doesn't matter.
  args.push('--fine')

  // Input and output file paths (positional arguments, must come last)
  args.push(inputPath, outputPath)

  return args
}

/**
 * Processes audio through the Rubber Band CLI.
 *
 * This is the main entry point called by the IPC handler.
 * It handles the full lifecycle: write temp → spawn CLI → read output → cleanup.
 *
 * @param request — Audio data and processing parameters from the renderer
 * @param logger — Winston logger for diagnostics
 * @returns AudioProcessResult with the processed audio or an error
 */
export async function processAudio(
  request: AudioProcessRequest,
  logger: Logger
): Promise<AudioProcessResult> {
  // Generate unique temp file paths using timestamp + random suffix
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const tempDir = os.tmpdir()
  const inputPath = path.join(tempDir, `voxsmith-input-${timestamp}-${random}.wav`)
  const outputPath = path.join(tempDir, `voxsmith-output-${timestamp}-${random}.wav`)

  let rubberbandPath: string
  try {
    rubberbandPath = getRubberbandPath()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Rubber Band CLI binary not found: ${errorMsg}`)
    return { success: false, error: errorMsg }
  }

  // Build the command string for logging before we start
  const args = buildArgs(request, inputPath, outputPath)
  const commandString = `${rubberbandPath} ${args.join(' ')}`
  logger.debug(`Stage 1 processing: ${commandString}`)

  try {
    // Step 1: Write the input audio to a temp WAV file
    logger.debug(`Writing temp input WAV: ${inputPath} (${request.audioData.byteLength} bytes, ${request.sampleRate}Hz, ${request.channels}ch)`)
    writeWavFile(inputPath, request.audioData, request.sampleRate, request.channels)

    // Step 2: Spawn the Rubber Band CLI and wait for it to complete
    const exitCode = await new Promise<number>((resolve, reject) => {
      const proc = spawn(rubberbandPath, args, {
        // Pipe stderr so we can log any warnings/errors from the CLI
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      activeProcess = proc

      let stderr = ''

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        activeProcess = null
        if (code === null) {
          // Process was killed (cancelled by user)
          reject(new Error('Processing cancelled'))
        } else {
          if (stderr.trim()) {
            logger.debug(`Rubber Band CLI stderr: ${stderr.trim()}`)
          }
          resolve(code)
        }
      })

      proc.on('error', (err) => {
        activeProcess = null
        reject(err)
      })
    })

    if (exitCode !== 0) {
      logger.error(`Rubber Band CLI exited with code ${exitCode}: ${commandString}`)
      return {
        success: false,
        error: `Rubber Band CLI exited with code ${exitCode}`,
        commandString,
      }
    }

    // Step 3: Read the processed output WAV
    if (!fs.existsSync(outputPath)) {
      logger.error(`Rubber Band CLI did not produce output file: ${outputPath}`)
      return {
        success: false,
        error: 'Processing completed but output file was not created',
        commandString,
      }
    }

    const processedData = readWavFileAsArrayBuffer(outputPath)
    const durationSeconds = getWavDuration(outputPath)

    logger.info(`Stage 1 processing complete: pitch=${request.pitch}, formant=${request.preserveFormant}, tempo=${request.tempo}, duration=${durationSeconds.toFixed(2)}s`)

    return {
      success: true,
      processedData,
      durationSeconds,
      commandString,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Stage 1 processing failed: ${errorMsg}`)
    return { success: false, error: errorMsg, commandString }
  } finally {
    // Step 4: Clean up temp files — runs even if processing fails or is cancelled
    if (fs.existsSync(inputPath)) {
      try { fs.unlinkSync(inputPath) } catch { /* best effort cleanup */ }
    }
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath) } catch { /* best effort cleanup */ }
    }
    logger.debug('Stage 1 temp files cleaned up')
  }
}

/**
 * Cancels any in-flight Stage 1 processing.
 *
 * Called when the renderer sends IPC.AUDIO_PROCESS_CANCEL.
 * Kills the child process, which causes the processAudio() promise
 * to reject with 'Processing cancelled'.
 */
export function cancelProcessing(logger: Logger): void {
  if (activeProcess) {
    logger.info('Stage 1 processing cancelled by user')
    activeProcess.kill('SIGTERM')
    activeProcess = null
  }
}
