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
 * VoxSmith — Preload API Type Declarations
 *
 * Provides full TypeScript support for window.voxsmith in the renderer process.
 * This file is included in tsconfig.web.json so the renderer gets autocomplete
 * and type checking for all IPC bridge methods.
 *
 * RULE: Every method here must match a method exposed in src/preload/index.ts
 * and a handler registered in src/main/ipc/index.ts.
 */

import type {
  AppSettings,
  Preset,
  PresetLibrary,
  AudioProcessRequest,
  AudioProcessResult,
  ExportRequest,
  ExportResult,
  BatchExportRequest,
  BatchExportResult,
} from '../shared/types'

export interface VoxsmithAPI {
  // Settings
  getSettings(): Promise<AppSettings>
  saveSettings(settings: Partial<AppSettings>): Promise<void>

  // Presets
  loadAllPresets(): Promise<PresetLibrary>
  savePreset(preset: Preset): Promise<void>
  deletePreset(id: string): Promise<void>

  // Stage 1 — Offline Audio Processing (Rubber Band CLI)
  processAudio(request: AudioProcessRequest): Promise<AudioProcessResult>
  cancelProcessing(): Promise<void>

  // Export
  exportWav(request: ExportRequest): Promise<ExportResult>
  exportBatch(request: BatchExportRequest): Promise<BatchExportResult>

  // File Dialogs
  openWavDialog(): Promise<string | null>
  saveWavDialog(name: string): Promise<string | null>
  openImageDialog(): Promise<string | null>
}

declare global {
  interface Window {
    voxsmith: VoxsmithAPI
  }
}
