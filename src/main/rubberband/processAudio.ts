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
 * Stage 1 - Offline Audio Processing via Rubber Band
 *
 * This module handles the entire Stage 1 pipeline:
 * 1. Receive an AudioProcessRequest (ArrayBuffer + parameters) from renderer via IPC
 * 2. Route to either the library API (Koffi FFI) or CLI binary depending on parameters
 * 3. Return the processed audio as an AudioProcessResult
 *
 * ROUTING LOGIC:
 * - If formant shift is requested → use the Rubber Band LIBRARY API (Koffi FFI)
 *   because the CLI cannot do independent formant shifting without robotic artifacts.
 *   The library's setFormantScale() provides true single-pass formant control.
 * - If only pitch/tempo → use the CLI binary (simpler, proven, no FFI overhead)
 * - If the library DLL is unavailable → fall back to CLI for all requests
 *   (formant shifting will be disabled in the UI)
 *
 * WHY OFFLINE?
 * The Sprint 1 spike proved that rubberband-web (WASM AudioWorklet) has three
 * fatal limitations: no formant control, broken real-time tempo, and buffer
 * overruns. Offline processing solves all three.
 *
 * SIGNAL FLOWS:
 *   Library path: Renderer (IPC) → processWithLibrary() → Koffi FFI → Renderer (IPC)
 *   CLI path:     Renderer (IPC) → temp input.wav → rubberband CLI → temp output.wav → Renderer (IPC)
 *
 * TEMP FILE SAFETY (CLI path only):
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
import { isLibraryAvailable, processWithLibrary } from './libraryBinding'

// ─── WAV File Utilities ──────────────────────────────────────────────────────

/**
 * Writes raw PCM audio data (from an ArrayBuffer) to a WAV file.
 *
 * The renderer sends audio as a flat Float32Array packed into an ArrayBuffer.
 * WAV files need a 44-byte header with format metadata, followed by the PCM data.
 * We write 32-bit IEEE float WAV (format code 3) to avoid quantization
 * artifacts. The old 16-bit PCM approach introduced audible quality loss,
 * especially when the two-pass formant shifting pipeline runs - each pass
 * would compound the 16-bit quantization noise, causing a "robotic" sound.
 * 32-bit float preserves the full precision of the original AudioBuffer data.
 *
 * Rubber Band CLI reads WAV via libsndfile, which supports 32-bit float natively.
 *
 * @param filePath - Where to write the WAV file
 * @param audioData - Raw audio data as ArrayBuffer (Float32 interleaved samples)
 * @param sampleRate - Sample rate in Hz (e.g., 44100)
 * @param channels - Number of channels (1 = mono, 2 = stereo)
 */
function writeWavFile(filePath: string, audioData: ArrayBuffer, sampleRate: number, channels: number): void {
  const float32 = new Float32Array(audioData)
  const numSamples = float32.length

  // 32-bit float: 4 bytes per sample, no conversion needed - Float32 data goes directly
  const bytesPerSample = 4
  const byteRate = sampleRate * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const dataSize = numSamples * bytesPerSample

  // WAV header is always 44 bytes for standard formats
  const header = Buffer.alloc(44)

  // RIFF chunk descriptor
  header.write('RIFF', 0)                        // ChunkID
  header.writeUInt32LE(36 + dataSize, 4)         // ChunkSize (file size minus 8)
  header.write('WAVE', 8)                        // Format

  // "fmt " sub-chunk - describes the audio format
  header.write('fmt ', 12)                       // Subchunk1ID
  header.writeUInt32LE(16, 16)                   // Subchunk1Size (16 for PCM/float)
  header.writeUInt16LE(3, 20)                    // AudioFormat (3 = IEEE float)
  header.writeUInt16LE(channels, 22)             // NumChannels
  header.writeUInt32LE(sampleRate, 24)           // SampleRate
  header.writeUInt32LE(byteRate, 28)             // ByteRate
  header.writeUInt16LE(blockAlign, 32)           // BlockAlign
  header.writeUInt16LE(32, 34)                   // BitsPerSample (32-bit float)

  // "data" sub-chunk - contains the actual audio samples
  header.write('data', 36)                       // Subchunk2ID
  header.writeUInt32LE(dataSize, 40)             // Subchunk2Size

  // Write header + Float32 data directly - no quantization conversion needed.
  // The Float32Array's underlying buffer is the raw IEEE 754 bytes.
  const dataBuffer = Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength)
  const fileBuffer = Buffer.concat([header, dataBuffer])
  fs.writeFileSync(filePath, fileBuffer)
}

/**
 * Reads a WAV file and returns the audio data as a Float32 ArrayBuffer.
 *
 * Parses the WAV header to find the data chunk, then converts the PCM samples
 * back to Float32 [-1.0, 1.0] format for the renderer's AudioContext.decodeAudioData().
 *
 * Actually, we return the raw WAV file bytes - the renderer will use
 * AudioContext.decodeAudioData() which handles WAV parsing natively.
 *
 * @param filePath - Path to the WAV file to read
 * @returns The full WAV file as an ArrayBuffer (header + data)
 */
function readWavFileAsArrayBuffer(filePath: string): ArrayBuffer {
  const buffer = fs.readFileSync(filePath)
  // Return the raw WAV bytes - the renderer's decodeAudioData() handles parsing
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

/**
 * Estimates the duration of a WAV file from its header.
 *
 * @param filePath - Path to the WAV file
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
 * Spawns the Rubber Band CLI with the given arguments and waits for completion.
 *
 * @param rubberbandPath - Resolved path to the rubberband executable
 * @param args - CLI arguments (flags + input/output paths)
 * @param logger - Winston logger
 * @returns Exit code from the CLI process
 * @throws Error if the process is killed (cancelled) or fails to spawn
 */
function runRubberband(
  rubberbandPath: string,
  args: string[],
  logger: Logger
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
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
}

/**
 * Processes audio through the Rubber Band CLI.
 *
 * This is the main entry point called by the IPC handler.
 * It handles the full lifecycle: write temp → spawn CLI → read output → cleanup.
 *
 * PROCESSING MODES:
 *
 * 1. SINGLE-PASS (no formant shift):
 *    When formantSemitones === 0, a single Rubber Band invocation handles
 *    pitch and/or tempo changes. If pitch is non-zero, --formant preserves
 *    the natural voice timbre (no chipmunk effect).
 *
 *    Command: rubberband --pitch P --formant --tempo T --fine in.wav out.wav
 *
 * 2. TWO-PASS (with formant shift):
 *    Independent formant shifting is not a native Rubber Band CLI feature.
 *    We achieve it with two sequential passes:
 *
 *    Pass 1: Shift everything by the formant amount (pitch + formants move together).
 *      Command: rubberband --pitch F [--tempo T] --fine in.wav mid.wav
 *
 *    Pass 2: Shift pitch back to the target with --formant preservation.
 *      The --formant flag locks formants at their current (shifted) position
 *      while the pitch moves to (P - F) semitones relative to pass 1 output.
 *      Net result: pitch = P, formants shifted by F from original.
 *      Command: rubberband --pitch (P - F) --formant --fine mid.wav out.wav
 *
 *    WHY THIS WORKS:
 *    - After pass 1: pitch = original + F, formants = original + F
 *    - After pass 2 with --formant: pitch = (original + F) + (P - F) = original + P
 *      formants preserved at (original + F) → net formant shift of F semitones
 *    - Tempo is applied only in pass 1 to avoid double time-stretching
 *
 * @param request - Audio data and processing parameters from the renderer
 * @param logger - Winston logger for diagnostics
 * @returns AudioProcessResult with the processed audio or an error
 */
export async function processAudio(
  request: AudioProcessRequest,
  logger: Logger
): Promise<AudioProcessResult> {
  const needsFormantShift = request.formantSemitones !== 0

  // ─── ROUTING DECISION ──────────────────────────────────────────────
  // If formant shifting is requested AND the library DLL is available,
  // use the Rubber Band library API (Koffi FFI) for true single-pass
  // formant control via setFormantScale(). This is the key Sprint 6 feature.
  //
  // If only pitch/tempo is needed, use the CLI (simpler, proven path).
  // If the DLL is missing, fall back to CLI for everything (formant disabled in UI).
  if (needsFormantShift && isLibraryAvailable()) {
    logger.debug('Stage 1: routing to library API (formant shift requested)')
    return processViaLibrary(request, logger)
  }

  // If formant was requested but DLL is unavailable, log a warning
  if (needsFormantShift && !isLibraryAvailable()) {
    logger.warn('Formant shift requested but Rubber Band library DLL not available — falling back to CLI (formant will be ignored)')
    // Zero out formant to avoid the robotic two-pass CLI path
    request = { ...request, formantSemitones: 0 }
  }

  logger.debug('Stage 1: routing to CLI (pitch/tempo only)')
  return processViaCli(request, logger)
}

/**
 * Processes audio through the Rubber Band library API (Koffi FFI).
 *
 * Uses setFormantScale() for true single-pass formant shifting — no two-pass
 * CLI workaround, no robotic artifacts. Pitch, formant, and tempo are all
 * applied in a single processing pass.
 *
 * The library operates directly on ArrayBuffer data (no temp files needed),
 * but the renderer expects WAV-encoded output for AudioContext.decodeAudioData().
 * So we wrap the processed PCM in a WAV header before returning.
 */
async function processViaLibrary(
  request: AudioProcessRequest,
  logger: Logger
): Promise<AudioProcessResult> {
  try {
    const result = await processWithLibrary({
      audioData: request.audioData,
      sampleRate: request.sampleRate,
      channels: request.channels,
      pitchSemitones: request.pitch,
      formantSemitones: request.formantSemitones,
      tempo: request.tempo,
    }, logger)

    if (!result.success || !result.processedData) {
      return {
        success: false,
        error: result.error || 'Library processing returned no data',
      }
    }

    // The library returns raw interleaved Float32 PCM data.
    // The renderer's AudioContext.decodeAudioData() expects a complete WAV file.
    // Wrap the PCM data in a WAV header before returning.
    const wavData = wrapPcmAsWav(
      result.processedData,
      request.sampleRate,
      request.channels
    )

    return {
      success: true,
      processedData: wavData,
      durationSeconds: result.durationSeconds,
      commandString: `[Library API] ${result.info || ''}`,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Library processing failed: ${errorMsg}`)
    return { success: false, error: errorMsg }
  }
}

/**
 * Wraps raw interleaved Float32 PCM data in a WAV header.
 *
 * This is the reverse of what writeWavFile does — instead of writing to disk,
 * we create an in-memory WAV file. The renderer expects WAV bytes because
 * AudioContext.decodeAudioData() handles WAV parsing natively.
 */
function wrapPcmAsWav(pcmData: ArrayBuffer, sampleRate: number, channels: number): ArrayBuffer {
  const float32 = new Float32Array(pcmData)
  const numSamples = float32.length
  const bytesPerSample = 4
  const byteRate = sampleRate * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const dataSize = numSamples * bytesPerSample

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(3, 20)           // IEEE float
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(32, 34)          // 32-bit
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  const dataBuffer = Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength)
  const fileBuffer = Buffer.concat([header, dataBuffer])
  return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength)
}

/**
 * Processes audio through the Rubber Band CLI binary.
 *
 * Used for pitch/tempo-only processing (no formant shift).
 * Writes temp WAV files, spawns the CLI, reads output, cleans up.
 */
async function processViaCli(
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

  const commandStrings: string[] = []

  try {
    // Write the input audio to a temp WAV file
    logger.debug(`Writing temp input WAV: ${inputPath} (${request.audioData.byteLength} bytes, ${request.sampleRate}Hz, ${request.channels}ch)`)
    writeWavFile(inputPath, request.audioData, request.sampleRate, request.channels)

    // ─── SINGLE-PASS MODE: Pitch/Tempo Only (no formant shift) ────────
    const args: string[] = []

    // Pitch shift in semitones
    if (request.pitch !== 0) {
      args.push('--pitch', request.pitch.toString())
    }

    // Formant preservation - prevents the "chipmunk effect" when pitch-shifting.
    // The --formant flag keeps the voice's resonant character (formants) at the
    // original position while only the pitch changes.
    if (request.preserveFormant) {
      args.push('--formant')
    }

    // Tempo/time-stretch ratio
    if (request.tempo !== 1.0) {
      args.push('--tempo', request.tempo.toString())
    }

    // High quality mode - slightly slower but cleaner output.
    args.push('--fine')

    // Input and output file paths (positional arguments, must come last)
    args.push(inputPath, outputPath)

    const commandString = `${rubberbandPath} ${args.join(' ')}`
    commandStrings.push(commandString)
    logger.debug(`Stage 1 processing (CLI single-pass): ${commandString}`)

    const exitCode = await runRubberband(rubberbandPath, args, logger)
    if (exitCode !== 0) {
      logger.error(`Rubber Band CLI exited with code ${exitCode}: ${commandString}`)
      return {
        success: false,
        error: `Rubber Band CLI exited with code ${exitCode}`,
        commandString,
      }
    }

    // Read the processed output WAV
    if (!fs.existsSync(outputPath)) {
      logger.error(`Rubber Band CLI did not produce output file: ${outputPath}`)
      return {
        success: false,
        error: 'Processing completed but output file was not created',
        commandString: commandStrings.join(' → '),
      }
    }

    const processedData = readWavFileAsArrayBuffer(outputPath)
    const durationSeconds = getWavDuration(outputPath)

    logger.info(`Stage 1 processing complete (CLI): pitch=${request.pitch}st, tempo=${request.tempo}x, duration=${durationSeconds.toFixed(2)}s`)

    return {
      success: true,
      processedData,
      durationSeconds,
      commandString: commandStrings.join(' → '),
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Stage 1 CLI processing failed: ${errorMsg}`)
    return { success: false, error: errorMsg, commandString: commandStrings.join(' → ') }
  } finally {
    // Clean up temp files - runs even if processing fails or is cancelled.
    for (const tempFile of [inputPath, outputPath]) {
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile) } catch { /* best effort cleanup */ }
      }
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
