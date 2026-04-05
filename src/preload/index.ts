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
 * VoxSmith - Preload Script
 *
 * The ONLY bridge between the main process and the renderer process.
 * Uses contextBridge.exposeInMainWorld to expose a typed window.voxsmith API.
 *
 * RULE: No raw ipcRenderer calls are permitted in the renderer.
 * All IPC goes through window.voxsmith.
 *
 * Every method here corresponds to an IPC channel in src/shared/constants.ts
 * and a handler registered in src/main/ipc/index.ts.
 */

import { contextBridge, ipcRenderer } from 'electron'

/**
 * IPC channel names — DUPLICATED from src/shared/constants.ts.
 *
 * WHY: The preload script runs in Electron's sandboxed context and cannot
 * import from src/shared/ (electron-vite builds preload as a separate entry).
 * These values MUST stay in exact sync with src/shared/constants.ts.
 *
 * SYNC CHECK: When adding/renaming IPC channels in constants.ts, you MUST
 * update this file too. A mismatch causes silent IPC failures (no error,
 * just undefined return values).
 *
 * TODO (A5): Investigate electron-vite's `resolve.alias` or a shared build
 * target to eliminate this duplication. See electron-vite docs on preload
 * script configuration.
 */
const IPC = {
  PRESET_LOAD_ALL: 'preset:load-all',
  PRESET_SAVE: 'preset:save',
  PRESET_DELETE: 'preset:delete',
  PRESET_SAVE_PORTRAIT: 'preset:save-portrait',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  AUDIO_PROCESS: 'audio:process',
  AUDIO_PROCESS_CANCEL: 'audio:process-cancel',
  EXPORT_WAV: 'export:wav',
  EXPORT_BATCH: 'export:batch',
  DIALOG_OPEN_WAV: 'dialog:open-wav',
  DIALOG_SAVE_WAV: 'dialog:save-wav',
  DIALOG_OPEN_IMAGE: 'dialog:open-image',
  TAKE_SAVE: 'take:save',
  TAKE_LOAD: 'take:load',
  TAKE_DELETE: 'take:delete',
  TAKE_LIST: 'take:list',
} as const

/**
 * Expose the VoxSmith API to the renderer via window.voxsmith.
 *
 * The renderer accesses all main process functionality exclusively
 * through this object. See src/preload/voxsmith.d.ts for the
 * TypeScript interface the renderer uses.
 */
contextBridge.exposeInMainWorld('voxsmith', {
  // ─── Settings ──────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (settings: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings),

  // ─── Presets ───────────────────────────────────────────────────────
  loadAllPresets: () => ipcRenderer.invoke(IPC.PRESET_LOAD_ALL),
  savePreset: (preset: unknown) => ipcRenderer.invoke(IPC.PRESET_SAVE, preset),
  deletePreset: (id: string) => ipcRenderer.invoke(IPC.PRESET_DELETE, id),
  savePortrait: (sourcePath: string, presetId: string) =>
    ipcRenderer.invoke(IPC.PRESET_SAVE_PORTRAIT, { sourcePath, presetId }),

  // ─── Stage 1 - Offline Audio Processing ────────────────────────────
  // Sends raw audio + parameters to main process for Rubber Band CLI processing.
  // Returns processed audio as ArrayBuffer or an error.
  processAudio: (request: unknown) => ipcRenderer.invoke(IPC.AUDIO_PROCESS, request),
  cancelProcessing: () => ipcRenderer.invoke(IPC.AUDIO_PROCESS_CANCEL),

  // ─── Export ────────────────────────────────────────────────────────
  exportWav: (request: unknown) => ipcRenderer.invoke(IPC.EXPORT_WAV, request),
  exportBatch: (request: unknown) => ipcRenderer.invoke(IPC.EXPORT_BATCH, request),

  // ─── File Dialogs ──────────────────────────────────────────────────
  openWavDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_WAV),
  saveWavDialog: (name: string) => ipcRenderer.invoke(IPC.DIALOG_SAVE_WAV, name),
  openImageDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_IMAGE),

  // ─── Take Management (Sprint 7) ───────────────────────────────────
  saveTake: (request: unknown) => ipcRenderer.invoke(IPC.TAKE_SAVE, request),
  loadTake: (takeId: string) => ipcRenderer.invoke(IPC.TAKE_LOAD, takeId),
  deleteTake: (takeId: string) => ipcRenderer.invoke(IPC.TAKE_DELETE, takeId),
  listTakes: () => ipcRenderer.invoke(IPC.TAKE_LIST),
})
