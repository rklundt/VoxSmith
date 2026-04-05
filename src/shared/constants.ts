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
 * VoxSmith Constants
 *
 * All IPC channel names and app-wide constants.
 * RULE: Never use magic strings for IPC channels - always reference IPC.* constants.
 * Every channel listed here must have a handler in main and a method on window.voxsmith.
 */

// ─── IPC Channel Names ──────────────────────────────────────────────────────

export const IPC = {
  // File system - preset operations
  PRESET_LOAD_ALL: 'preset:load-all',      // renderer → main: void → PresetLibrary
  PRESET_SAVE: 'preset:save',              // renderer → main: Preset → void
  PRESET_DELETE: 'preset:delete',          // renderer → main: presetId → void (also deletes portrait)
  PRESET_SAVE_PORTRAIT: 'preset:save-portrait', // renderer → main: { sourcePath, presetId } → string | null (relative path)

  // File system - settings operations
  SETTINGS_GET: 'settings:get',            // renderer → main: void → AppSettings
  SETTINGS_SAVE: 'settings:save',          // renderer → main: Partial<AppSettings> → void

  // Stage 1 - Offline audio processing (Rubber Band CLI in main process)
  // Pitch, formant, and tempo are processed offline because rubberband-web (WASM)
  // lacks formant control and has broken real-time tempo. The native CLI binary
  // provides full formant independence, proper time-stretch, and no buffer overruns.
  AUDIO_PROCESS: 'audio:process',          // renderer → main: AudioProcessRequest → AudioProcessResult
  AUDIO_PROCESS_CANCEL: 'audio:process-cancel', // renderer → main: void → void (kills in-flight child_process)

  // Stage 3 - Export operations (FFmpeg in main process)
  EXPORT_WAV: 'export:wav',                // renderer → main: ExportRequest → ExportResult
  EXPORT_BATCH: 'export:batch',            // renderer → main: BatchExportRequest → BatchExportResult

  // File dialog operations
  DIALOG_OPEN_WAV: 'dialog:open-wav',      // renderer → main: void → string (file path)
  DIALOG_SAVE_WAV: 'dialog:save-wav',      // renderer → main: string (suggested name) → string (path)
  DIALOG_OPEN_IMAGE: 'dialog:open-image',  // renderer → main: void → string (file path)

  // Recording / Take management (Sprint 7)
  // Takes are recorded in the renderer (MediaRecorder + Web Audio) and saved
  // to a temp directory in the main process for persistence across sessions.
  TAKE_SAVE: 'take:save',                  // renderer → main: TakeSaveRequest → TakeSaveResult
  TAKE_LOAD: 'take:load',                  // renderer → main: takeId → TakeLoadResult
  TAKE_DELETE: 'take:delete',              // renderer → main: takeId → { success: boolean }
  TAKE_LIST: 'take:list',                  // renderer → main: void → Take[]
} as const

// ─── Default Engine Snapshot ─────────────────────────────────────────────────

import type { EngineSnapshot } from './types'

/**
 * Default parameter values for a fresh AudioEngine.
 * Also used as the base for preset migration - any missing field
 * in a loaded preset falls back to these values.
 */
export const DEFAULT_ENGINE_SNAPSHOT: EngineSnapshot = {
  pitch: 0,                 // no pitch shift
  formant: 0,               // no formant shift
  reverbAmount: 0,          // no reverb
  reverbRoomSize: 0.5,      // medium room as default when reverb is turned up
  speed: 1.0,               // normal playback speed
  vibratoRate: 5,            // 5 Hz - moderate vibrato speed
  vibratoDepth: 0,          // vibrato off by default
  tremoloRate: 4,            // 4 Hz - moderate tremolo speed
  tremoloDepth: 0,          // tremolo off by default
  vocalFryIntensity: 0,     // vocal fry off by default
  breathiness: 0,           // breathiness off by default
  breathiness2: 0,          // breathiness 2 (vocal processing method) off by default
  eq: [
    { gain: 0, frequency: 200 },   // Band 1 (Low): chest weight
    { gain: 0, frequency: 800 },   // Band 2 (Low-Mid): warmth
    { gain: 0, frequency: 2500 },  // Band 3 (High-Mid): presence
    { gain: 0, frequency: 8000 },  // Band 4 (High): brightness
  ],
  compressorThreshold: -24,  // dB - moderate threshold
  compressorRatio: 4,        // 4:1 - moderate compression
  highPassFrequency: 80,     // Hz - just removes sub-bass rumble
  wetDryMix: {
    vibrato: 1.0,            // full wet when enabled (depth controls intensity)
    tremolo: 1.0,
    vocalFry: 1.0,
    breathiness: 1.0,
    breathiness2: 1.0,
    reverb: 0.0,             // 0% wet by default - matches reverbAmount=0 so no reverb at startup
  },
  bypassed: false,
}

// ─── Default App Settings ────────────────────────────────────────────────────

import type { AppSettings } from './types'

/**
 * Hardcoded fallback settings used when config/settings.json is missing or corrupted.
 * Normally the app reads from the JSON file - these are the last-resort defaults.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  logging: {
    maxSessionFiles: 5,
    logLevel: 'info',
  },
  export: {
    defaultBitDepth: 24,
    defaultSampleRate: 44100,
    defaultNormalize: true,
    fileNamingTemplate: '{character}_{scene}_{line}_{emotion}',
  },
  ui: {
    advancedModeDefault: false,
    theme: 'dark',
  },
}

// ─── Misc Constants ──────────────────────────────────────────────────────────

/** Minimum allowed value for maxSessionFiles to prevent accidental deletion of all logs */
export const MIN_SESSION_FILES = 1

/** App name used in window title and logging */
export const APP_NAME = 'VoxSmith'
