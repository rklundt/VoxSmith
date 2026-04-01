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
 * VoxSmith Shared Types
 *
 * Canonical type definitions shared across main, preload, and renderer processes.
 * architecture.md documents the shapes; this file enforces them.
 *
 * RULE: Any change to these types must start here. Update architecture.md
 * and new-character-preset.md to match.
 */

// ─── Audio Engine Types ──────────────────────────────────────────────────────

/**
 * Names of effects that support per-effect wet/dry mix control.
 * These are the effects with parallel dry routing in the effects chain.
 * Effects without wet/dry (HighPass, EQ, Compressor, RubberBand) are inline.
 */
export type EffectName = 'vibrato' | 'tremolo' | 'vocalFry' | 'breathiness' | 'reverb'

/**
 * A single band in the 4-band EQ.
 * Band 1 (Low): chest weight. Band 2 (Low-Mid): warmth.
 * Band 3 (High-Mid): presence. Band 4 (High): brightness.
 */
export interface EQBand {
  /** dB boost (positive) or cut (negative) for this band */
  gain: number
  /** Center frequency in Hz for this band */
  frequency: number
}

/**
 * Serializable snapshot of all AudioEngine parameter values.
 *
 * Used for:
 * - Preset storage (saved to presets.json)
 * - A/B comparison (swap between two snapshots)
 * - State recovery on crash (restore from engineStore)
 *
 * All values are plain numbers/booleans — no Web Audio nodes or references.
 */
export interface EngineSnapshot {
  pitch: number                          // -24 to +24 semitones
  formant: number                        // -2.0 to +2.0 octaves
  reverbAmount: number                   // 0.0 to 1.0
  reverbRoomSize: number                 // 0.0 to 1.0
  speed: number                          // 0.5 to 2.0
  vibratoRate: number                    // Hz
  vibratoDepth: number                   // 0.0 to 1.0
  tremoloRate: number                    // Hz
  tremoloDepth: number                   // 0.0 to 1.0
  vocalFryIntensity: number              // 0.0 to 1.0
  breathiness: number                    // 0.0 to 1.0
  eq: EQBand[]                           // exactly 4 bands
  compressorThreshold: number            // dB (negative, e.g. -24)
  compressorRatio: number                // ratio (e.g. 4 means 4:1)
  highPassFrequency: number              // Hz cutoff
  wetDryMix: Record<EffectName, number>  // 0.0 (full dry) to 1.0 (full wet)
  bypassed: boolean
}

// ─── Preset Types ────────────────────────────────────────────────────────────

/**
 * An emotion variant of a character preset.
 * The same character sounds different when angry vs whispering,
 * but still recognizably "themselves."
 */
export interface EmotionVariant {
  id: string
  /** e.g. "angry", "whisper", "sad", "default" */
  emotion: string
  engineSnapshot: EngineSnapshot
}

/**
 * A saved character preset with all metadata.
 * Stored in presets.json — one preset per character voice.
 */
export interface Preset {
  id: string
  /** Character name displayed in the preset panel */
  name: string
  /** Folder/category label (e.g. "Heroes", "Villains", "Creatures") */
  category: string
  /** Relative path in userData/portraits/ — no base64 */
  portraitPath?: string
  /** Free text performance notes (e.g. "nervous energy, speaks quickly") */
  notes?: string
  /** Sub-presets for different emotions */
  emotionVariants: EmotionVariant[]
  /** All parameter values for this character's default voice */
  engineSnapshot: EngineSnapshot
  /** ISO timestamp of creation */
  createdAt: string
  /** ISO timestamp of last modification */
  updatedAt: string
}

/** The full preset library loaded from presets.json */
export interface PresetLibrary {
  presets: Preset[]
}

// ─── Settings Types ──────────────────────────────────────────────────────────

export interface LoggingSettings {
  /** Maximum number of session log files to keep before purging oldest */
  maxSessionFiles: number
  /** Winston log level: 'error' | 'warn' | 'info' | 'debug' */
  logLevel: string
}

export interface ExportSettings {
  /** Default bit depth for WAV export */
  defaultBitDepth: 16 | 24 | 32
  /** Default sample rate for WAV export */
  defaultSampleRate: number
  /** Whether to normalize by default on export */
  defaultNormalize: boolean
  /** Template for naming exported files in batch export (Phase 3) */
  fileNamingTemplate: string
}

export interface UISettings {
  /** Whether the app starts in Advanced mode (false = Basic mode) */
  advancedModeDefault: boolean
  /** UI theme */
  theme: 'dark' | 'light'
}

/**
 * App-wide settings, merged from config/settings.json (defaults)
 * and config/userSettingsOverride.json (user changes).
 */
export interface AppSettings {
  logging: LoggingSettings
  export: ExportSettings
  ui: UISettings
}

// ─── Stage 1 — Offline Audio Processing Types ────────────────────────────

/**
 * Request sent from renderer to main for Stage 1 offline processing.
 *
 * The renderer sends the raw (or previously processed) audio as an ArrayBuffer
 * along with pitch, formant, and tempo parameters. Main writes it to a temp WAV,
 * runs the Rubber Band CLI binary, reads the output, and returns the processed buffer.
 *
 * This exists because rubberband-web (WASM AudioWorklet) lacks formant control
 * and has broken real-time tempo. The native CLI binary provides full formant
 * independence, proper time-stretch, and no buffer overruns.
 */
export interface AudioProcessRequest {
  /** Raw audio data as WAV-encoded ArrayBuffer */
  audioData: ArrayBuffer
  /** Sample rate of the input audio (needed for temp WAV header) */
  sampleRate: number
  /** Number of channels (1 = mono, 2 = stereo) */
  channels: number
  /** Pitch shift in semitones (e.g. -12 = octave down, +12 = octave up) */
  pitch: number
  /** Whether to preserve formants during pitch shift (the --formant flag) */
  preserveFormant: boolean
  /** Tempo ratio (1.0 = no change, 0.5 = half speed, 2.0 = double speed) */
  tempo: number
}

/**
 * Result returned from main to renderer after Stage 1 processing.
 */
export interface AudioProcessResult {
  /** Whether processing completed successfully */
  success: boolean
  /** Processed audio as WAV-encoded ArrayBuffer (on success) */
  processedData?: ArrayBuffer
  /** Duration of the processed audio in seconds */
  durationSeconds?: number
  /** The full Rubber Band CLI command that was executed (for diagnostics) */
  commandString?: string
  /** Error message on failure */
  error?: string
}

// ─── Export Types ─────────────────────────────────────────────────────────────

/**
 * Request sent from renderer to main to export processed audio.
 * The renderer encodes the AudioBuffer to a WAV ArrayBuffer in memory,
 * then sends it via IPC. Main writes to a temp file, runs FFmpeg, cleans up.
 */
export interface ExportRequest {
  /** WAV-encoded audio from renderer (ArrayBuffer transferred via IPC) */
  audioData: ArrayBuffer
  /** User-chosen destination path from save dialog */
  outputPath: string
  /** Bit depth for the exported WAV */
  bitDepth: 16 | 24 | 32
  /** Sample rate in Hz */
  sampleRate: number
  /** Whether to normalize peak to -1dBFS */
  normalize: boolean
  /** Whether to apply noise gate before export */
  noiseGate: boolean
  /** Silence padding at start in milliseconds */
  padStartMs: number
  /** Silence padding at end in milliseconds */
  padEndMs: number
}

export interface ExportResult {
  success: boolean
  /** Output file path on success */
  outputPath?: string
  /** Error message on failure */
  error?: string
  /** Duration of exported file in seconds */
  durationSeconds?: number
}

export interface BatchExportRequest {
  exports: ExportRequest[]
}

export interface BatchExportResult {
  results: ExportResult[]
  /** Number of successful exports */
  successCount: number
  /** Number of failed exports */
  failureCount: number
}
