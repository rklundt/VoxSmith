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
 * IPC Handler Registration — Main Process
 *
 * Registers all IPC handlers that the renderer can invoke via window.voxsmith.
 * Each handler corresponds to a channel constant in src/shared/constants.ts.
 *
 * Sprint 0: Only SETTINGS_GET and SETTINGS_SAVE are functional.
 * All other handlers are stubs that log the call and return placeholder responses.
 * They will be implemented in their respective sprints.
 */

import { ipcMain } from 'electron'
import type winston from 'winston'
import { IPC } from '../../shared/constants'
import type { AppSettings, AudioProcessRequest } from '../../shared/types'
import { loadSettings, saveSettingsOverride } from '../fileSystem/settings'
import { processAudio, cancelProcessing } from '../rubberband/processAudio'

/**
 * Registers all IPC handlers.
 * Call this once during app initialization, before creating the BrowserWindow.
 */
export function registerIpcHandlers(logger: winston.Logger): void {

  // ─── Settings (functional in Sprint 0) ───────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    logger.debug(`IPC: ${IPC.SETTINGS_GET} — loading merged settings`)
    try {
      const settings = loadSettings(logger)
      logger.debug(`IPC: ${IPC.SETTINGS_GET} — success`)
      return settings
    } catch (err) {
      logger.error(`IPC: ${IPC.SETTINGS_GET} — failed: ${err}`)
      throw err
    }
  })

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, overrides: Partial<AppSettings>) => {
    logger.debug(`IPC: ${IPC.SETTINGS_SAVE} — saving user overrides`)
    try {
      saveSettingsOverride(overrides, logger)
      logger.debug(`IPC: ${IPC.SETTINGS_SAVE} — success`)
    } catch (err) {
      logger.error(`IPC: ${IPC.SETTINGS_SAVE} — failed: ${err}`)
      throw err
    }
  })

  // ─── Presets (stubs — Sprint 5) ──────────────────────────────────────

  ipcMain.handle(IPC.PRESET_LOAD_ALL, async () => {
    logger.debug(`IPC: ${IPC.PRESET_LOAD_ALL} — stub`)
    return { presets: [] }
  })

  ipcMain.handle(IPC.PRESET_SAVE, async (_event, preset) => {
    logger.debug(`IPC: ${IPC.PRESET_SAVE} — stub (preset: ${preset?.name ?? 'unknown'})`)
  })

  ipcMain.handle(IPC.PRESET_DELETE, async (_event, presetId: string) => {
    logger.debug(`IPC: ${IPC.PRESET_DELETE} — stub (id: ${presetId})`)
  })

  // ─── Export (stubs — Sprint 6) ───────────────────────────────────────

  ipcMain.handle(IPC.EXPORT_WAV, async () => {
    logger.debug(`IPC: ${IPC.EXPORT_WAV} — stub`)
    return { success: false, error: 'Export not implemented yet' }
  })

  ipcMain.handle(IPC.EXPORT_BATCH, async () => {
    logger.debug(`IPC: ${IPC.EXPORT_BATCH} — stub`)
    return { results: [], successCount: 0, failureCount: 0 }
  })

  // ─── Stage 1 — Offline Audio Processing (Sprint 2) ────────────────────
  // Pitch, formant, and tempo are processed offline via the Rubber Band CLI.
  // The renderer sends raw audio + parameters, main writes a temp WAV, spawns
  // the CLI binary, reads the output, cleans up temps, and returns the result.

  ipcMain.handle(IPC.AUDIO_PROCESS, async (_event, request: AudioProcessRequest) => {
    logger.debug(`IPC: ${IPC.AUDIO_PROCESS} — pitch=${request.pitch}, formant=${request.preserveFormant}, tempo=${request.tempo}`)
    try {
      const result = await processAudio(request, logger)
      if (result.success) {
        logger.debug(`IPC: ${IPC.AUDIO_PROCESS} — success (${result.durationSeconds?.toFixed(2)}s)`)
      } else {
        logger.error(`IPC: ${IPC.AUDIO_PROCESS} — failed: ${result.error}`)
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`IPC: ${IPC.AUDIO_PROCESS} — unhandled error: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle(IPC.AUDIO_PROCESS_CANCEL, async () => {
    logger.debug(`IPC: ${IPC.AUDIO_PROCESS_CANCEL} — cancelling in-flight processing`)
    cancelProcessing(logger)
  })

  // ─── File Dialogs (stubs — Sprint 2) ─────────────────────────────────

  ipcMain.handle(IPC.DIALOG_OPEN_WAV, async () => {
    logger.debug(`IPC: ${IPC.DIALOG_OPEN_WAV} — stub`)
    return null
  })

  ipcMain.handle(IPC.DIALOG_SAVE_WAV, async () => {
    logger.debug(`IPC: ${IPC.DIALOG_SAVE_WAV} — stub`)
    return null
  })

  ipcMain.handle(IPC.DIALOG_OPEN_IMAGE, async () => {
    logger.debug(`IPC: ${IPC.DIALOG_OPEN_IMAGE} — stub`)
    return null
  })

  logger.info('All IPC handlers registered')
}
