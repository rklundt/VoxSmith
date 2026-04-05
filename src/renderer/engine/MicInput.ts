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
 * MicInput — Microphone capture and device management (Sprint 7)
 *
 * Handles:
 *  - Enumerating available audio input devices via navigator.mediaDevices
 *  - Acquiring a microphone stream via getUserMedia
 *  - Creating a MediaStreamSource node to feed into AudioEngine's effects chain
 *  - Recording audio via an AudioWorkletNode (recorder-processor.js)
 *
 * ARCHITECTURE:
 * Mic audio goes directly into the Stage 2 effects chain (real-time effects).
 * Stage 1 (pitch/formant/tempo via Rubber Band) is NOT applied during live
 * monitoring — those controls are disabled during mic mode. The user records
 * first, then applies Stage 1 to the recorded take.
 *
 * Recording uses a ScriptProcessorNode tapped into the effects chain input
 * (pre-effects) to capture the raw mic signal. The processed (post-effects)
 * audio goes to speakers for monitoring. This way the recorded take is "dry"
 * and can be re-processed with different settings later.
 */

import type { MicDevice } from '../../shared/types'

// ─── Device Enumeration ─────────────────────────────────────────────────────

/**
 * Lists all available audio input devices (microphones).
 *
 * Note: On first call, device labels may be empty strings if the user hasn't
 * granted microphone permission yet. After the first successful getUserMedia
 * call, labels become available. We handle this by showing "Microphone N"
 * as a fallback label.
 */
export async function enumerateAudioInputDevices(): Promise<MicDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()

  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, index) => ({
      deviceId: d.deviceId,
      // Labels are empty until permission is granted; show a fallback
      label: d.label || `Microphone ${index + 1}`,
    }))
}

// ─── Mic Stream Acquisition ─────────────────────────────────────────────────

/**
 * Options for acquiring a mic stream, beyond just device selection.
 */
export interface MicStreamOptions {
  /** Specific device ID, or undefined for system default */
  deviceId?: string
  // NOTE: noiseSuppression was removed here — Electron/Chromium silently ignores
  // the getUserMedia noiseSuppression constraint (track.getSettings() always
  // reports false). Sprint 7.2 will add real noise suppression via RNNoise WASM
  // AudioWorklet, which runs in the signal chain rather than as a getUserMedia
  // constraint. The store state (noiseSuppression toggle) is preserved for 7.2.
}

/**
 * Acquires a microphone MediaStream for the specified device.
 *
 * Audio constraints are tuned for voice recording:
 *  - echoCancellation OFF: we don't want the browser fighting our effects chain
 *     (echo cancellation tries to remove speaker output from the mic signal,
 *      which would strip out our monitoring audio and create artifacts)
 *  - noiseSuppression OFF: Electron/Chromium ignores this constraint entirely
 *     (tested: track.getSettings() always reports false). Sprint 7.2 adds real
 *     noise suppression via RNNoise WASM AudioWorklet in the signal chain.
 *  - autoGainControl OFF: gain is managed by our compressor and gain nodes
 *  - channelCount 1: mono — VoxSmith processes single-channel voice
 */
export async function acquireMicStream(options: MicStreamOptions = {}): Promise<MediaStream> {
  const { deviceId } = options

  const constraints: MediaStreamConstraints = {
    audio: {
      // Use the specific device if provided, otherwise system default
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // Echo cancellation OFF — it fights our effects chain monitoring path
      echoCancellation: false,
      // Noise suppression OFF — Electron ignores this constraint.
      // Real noise suppression handled by RNNoise AudioWorklet (Sprint 7.2).
      noiseSuppression: false,
      // Auto gain OFF — our compressor and gain nodes handle levels
      autoGainControl: false,
      // Mono recording — game dialogue is single-channel
      channelCount: 1,
    },
    video: false,
  }

  const stream = await navigator.mediaDevices.getUserMedia(constraints)

  // Log the actual constraint settings the browser applied
  const track = stream.getAudioTracks()[0]
  if (track) {
    const settings = track.getSettings()
    console.log('[MicInput] Actual track settings:', {
      echoCancellation: settings.echoCancellation,
      autoGainControl: settings.autoGainControl,
      sampleRate: settings.sampleRate,
      deviceId: settings.deviceId,
    })
  }

  return stream
}

/**
 * Releases all tracks on a MediaStream, freeing the microphone.
 * Always call this when switching away from mic input or closing the app.
 */
export function releaseMicStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

// ─── Recording Buffer Manager ───────────────────────────────────────────────

/**
 * RecordingBuffer collects raw PCM samples during recording.
 *
 * We use a manual buffer approach (collecting Float32Array chunks) rather than
 * MediaRecorder because:
 *  1. MediaRecorder outputs compressed formats (webm/opus) — we need raw PCM
 *  2. We need sample-accurate control for punch-in splicing
 *  3. We need access to the raw samples for waveform display during recording
 *
 * The buffer captures mono audio at the AudioContext's sample rate.
 */
export class RecordingBuffer {
  /** Collected audio chunks — each chunk is one ScriptProcessor callback */
  private chunks: Float32Array[] = []
  /** Total number of samples collected */
  private _sampleCount = 0
  /** Sample rate of the recording */
  private _sampleRate: number

  constructor(sampleRate: number) {
    this._sampleRate = sampleRate
  }

  /** Append a chunk of audio samples from the ScriptProcessor */
  addChunk(samples: Float32Array): void {
    // Copy the samples — the input buffer is reused by the ScriptProcessor
    const copy = new Float32Array(samples.length)
    copy.set(samples)
    this.chunks.push(copy)
    this._sampleCount += copy.length
  }

  /** Total duration in milliseconds */
  get durationMs(): number {
    return (this._sampleCount / this._sampleRate) * 1000
  }

  /** Total number of samples */
  get sampleCount(): number {
    return this._sampleCount
  }

  get sampleRate(): number {
    return this._sampleRate
  }

  /**
   * Concatenate all chunks into a single Float32Array.
   * Call this when recording is finished to get the complete audio.
   */
  toFloat32Array(): Float32Array {
    const result = new Float32Array(this._sampleCount)
    let offset = 0
    for (const chunk of this.chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  /**
   * Convert the recording to a mono AudioBuffer.
   * This is what gets loaded into the AudioEngine for playback/processing.
   */
  toAudioBuffer(context: BaseAudioContext): AudioBuffer {
    const samples = this.toFloat32Array()
    const buffer = context.createBuffer(1, this._sampleCount, this._sampleRate)
    // Explicit ArrayBuffer generic avoids TS strict ArrayBufferLike mismatch
    // (same pattern as AudioEngine.analyserData)
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    return buffer
  }

  /** Reset the buffer for a new recording */
  clear(): void {
    this.chunks = []
    this._sampleCount = 0
  }
}

// ─── Punch-In Splice ────────────────────────────────────────────────────────

/**
 * Splice a punch-in recording into an existing AudioBuffer.
 *
 * The punch-in replaces audio between startTime and endTime with the new
 * recording. Everything before startTime and after endTime is preserved
 * from the original buffer.
 *
 * @param original  The existing take's AudioBuffer (mono)
 * @param punchIn   The new recording for the punched region (mono)
 * @param startTime Start of the punch region in seconds
 * @param endTime   End of the punch region in seconds
 * @param context   AudioContext for creating the result buffer
 * @returns A new AudioBuffer with the punch-in spliced in
 */
export function splicePunchIn(
  original: AudioBuffer,
  punchIn: AudioBuffer,
  startTime: number,
  endTime: number,
  context: BaseAudioContext,
): AudioBuffer {
  const sampleRate = original.sampleRate

  // Calculate sample boundaries for the splice
  const startSample = Math.floor(startTime * sampleRate)
  const endSample = Math.min(Math.floor(endTime * sampleRate), original.length)
  const regionLength = endSample - startSample

  // Fit the punch audio exactly into the region length to keep the total
  // duration unchanged. If the punch recording is longer than the region
  // (setTimeout fired late), truncate the end. If shorter, pad with silence.
  // This ensures the splice is sample-accurate and nothing after the punch
  // point shifts in time.
  const punchChannel = punchIn.getChannelData(0)
  const fittedPunch = new Float32Array(regionLength)
  const copyLength = Math.min(punchChannel.length, regionLength)
  fittedPunch.set(punchChannel.subarray(0, copyLength), 0)
  // Any remaining samples stay at 0 (silence padding)

  // The result is: [original before punch] + [fitted punch] + [original after punch]
  // Total length is identical to the original — no time shifting.
  const result = context.createBuffer(1, original.length, sampleRate)
  const resultChannel = result.getChannelData(0)
  const originalChannel = original.getChannelData(0)

  // Copy: before region from original
  resultChannel.set(originalChannel.subarray(0, startSample), 0)

  // Copy: fitted punch-in recording (trimmed + truncated/padded to region length)
  resultChannel.set(fittedPunch, startSample)

  // Copy: after region from original
  resultChannel.set(originalChannel.subarray(endSample), endSample)

  return result
}
