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
 * WAV Encoder - Renderer Side
 *
 * Converts a Web Audio API AudioBuffer into a WAV-encoded ArrayBuffer
 * suitable for sending to the main process via IPC.
 *
 * WHY THIS EXISTS:
 * The renderer holds the active AudioBuffer (original or Stage 1-processed)
 * but IPC can only transfer serializable data (ArrayBuffer, not AudioBuffer).
 * We encode to 32-bit float WAV to preserve full precision. FFmpeg in the
 * main process will then convert to the user's chosen bit depth on export.
 *
 * IMPORTANT: This encodes the RAW buffer, not the Stage 2 effects output.
 * Stage 2 effects (EQ, reverb, etc.) are real-time Web Audio nodes and
 * cannot be "baked" into the buffer. For the export pipeline, the renderer
 * first renders the audio through an OfflineAudioContext with the effects
 * chain applied, THEN encodes the result. (See useExport hook.)
 */

/**
 * Encodes an AudioBuffer as a 32-bit float WAV ArrayBuffer.
 *
 * Interleaves channels if stereo, writes a standard 44-byte WAV header,
 * and returns the complete WAV file as an ArrayBuffer ready for IPC transfer.
 *
 * @param buffer - Web Audio AudioBuffer to encode
 * @returns WAV-encoded ArrayBuffer
 */
export function encodeAudioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length

  // Interleave channels: Web Audio stores each channel separately,
  // but WAV format expects interleaved samples (L, R, L, R, ...).
  // For mono, this is just a straight copy.
  const interleaved = new Float32Array(numFrames * numChannels)

  if (numChannels === 1) {
    // Mono - direct copy, no interleaving needed
    interleaved.set(buffer.getChannelData(0))
  } else {
    // Multi-channel - interleave samples from each channel
    const channels: Float32Array[] = []
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch))
    }
    for (let frame = 0; frame < numFrames; frame++) {
      for (let ch = 0; ch < numChannels; ch++) {
        interleaved[frame * numChannels + ch] = channels[ch][frame]
      }
    }
  }

  // Calculate sizes for the WAV header
  const bytesPerSample = 4 // 32-bit float = 4 bytes
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = interleaved.length * bytesPerSample

  // WAV file = 44-byte header + PCM data
  const wavBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(wavBuffer)

  // ── RIFF Chunk Descriptor ──────────────────────────────────────────
  writeString(view, 0, 'RIFF')              // ChunkID
  view.setUint32(4, 36 + dataSize, true)    // ChunkSize (file size minus 8 bytes)
  writeString(view, 8, 'WAVE')              // Format

  // ── "fmt " Sub-chunk ───────────────────────────────────────────────
  // Describes the audio format so any player/tool knows how to read it
  writeString(view, 12, 'fmt ')             // Subchunk1ID
  view.setUint32(16, 16, true)              // Subchunk1Size (16 for PCM/float)
  view.setUint16(20, 3, true)               // AudioFormat: 3 = IEEE 754 float
  view.setUint16(22, numChannels, true)     // NumChannels
  view.setUint32(24, sampleRate, true)      // SampleRate
  view.setUint32(28, byteRate, true)        // ByteRate
  view.setUint16(32, blockAlign, true)      // BlockAlign
  view.setUint16(34, 32, true)              // BitsPerSample (32-bit float)

  // ── "data" Sub-chunk ───────────────────────────────────────────────
  // Contains the actual audio samples
  writeString(view, 36, 'data')             // Subchunk2ID
  view.setUint32(40, dataSize, true)        // Subchunk2Size

  // Write the interleaved Float32 samples into the data section.
  // We use a Float32Array view starting at byte 44 (after the header).
  const outputSamples = new Float32Array(wavBuffer, 44)
  outputSamples.set(interleaved)

  return wavBuffer
}

/**
 * Writes an ASCII string into a DataView at the given offset.
 * Used for WAV header chunk IDs ('RIFF', 'WAVE', 'fmt ', 'data').
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
