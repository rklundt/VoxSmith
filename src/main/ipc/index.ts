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
 * IPC Handler Registration - Main Process
 *
 * Registers all IPC handlers that the renderer can invoke via window.voxsmith.
 * Each handler corresponds to a channel constant in src/shared/constants.ts.
 *
 * Sprint 5: Settings, presets (full CRUD + portraits), Stage 1 audio processing,
 * and image file dialog are functional. Export and WAV dialogs are stubs.
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import type winston from 'winston'
import fs from 'fs'
import path from 'path'
import { IPC } from '../../shared/constants'
import type { AppSettings, Preset, AudioProcessRequest, ExportRequest, TakeSaveRequest, Take } from '../../shared/types'
import { loadSettings, saveSettingsOverride } from '../fileSystem/settings'
import { processAudio, cancelProcessing } from '../rubberband/processAudio'
import { loadAllPresets, savePreset, deletePreset, savePortrait, resolvePortraitUri } from '../fileSystem/presets'
import { exportWav } from '../ffmpeg/exportWav'

/**
 * Registers all IPC handlers.
 * Call this once during app initialization, before creating the BrowserWindow.
 */
export function registerIpcHandlers(logger: winston.Logger): void {

  // ─── Settings (functional in Sprint 0) ───────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    logger.debug(`IPC: ${IPC.SETTINGS_GET} - loading merged settings`)
    try {
      const settings = loadSettings(logger)
      logger.debug(`IPC: ${IPC.SETTINGS_GET} - success`)
      return settings
    } catch (err) {
      logger.error(`IPC: ${IPC.SETTINGS_GET} - failed: ${err}`)
      throw err
    }
  })

  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, overrides: Partial<AppSettings>) => {
    logger.debug(`IPC: ${IPC.SETTINGS_SAVE} - saving user overrides`)
    try {
      saveSettingsOverride(overrides, logger)
      logger.debug(`IPC: ${IPC.SETTINGS_SAVE} - success`)
    } catch (err) {
      logger.error(`IPC: ${IPC.SETTINGS_SAVE} - failed: ${err}`)
      throw err
    }
  })

  // ─── Presets (Sprint 5) ──────────────────────────────────────────────

  ipcMain.handle(IPC.PRESET_LOAD_ALL, async () => {
    logger.debug(`IPC: ${IPC.PRESET_LOAD_ALL} - loading all presets`)
    try {
      const library = loadAllPresets(logger)
      // Resolve portrait URIs so the renderer can display images via file:// protocol.
      // The stored paths are relative (e.g. "portraits/abc123.png") and need to be
      // converted to full file:// URIs for the renderer's <img> tags.
      for (const preset of library.presets) {
        if (preset.portraitPath) {
          const uri = resolvePortraitUri(preset.portraitPath)
          if (uri) {
            // Attach the resolved URI as a transient field for the renderer.
            // The relative path stays in presets.json; the URI is only for display.
            ;(preset as Preset & { portraitUri?: string }).portraitUri = uri
          }
        }
      }
      logger.debug(`IPC: ${IPC.PRESET_LOAD_ALL} - success (${library.presets.length} presets)`)
      return library
    } catch (err) {
      logger.error(`IPC: ${IPC.PRESET_LOAD_ALL} - failed: ${err}`)
      throw err
    }
  })

  ipcMain.handle(IPC.PRESET_SAVE, async (_event, preset: Preset) => {
    // SECURITY (S3): Validate input before processing
    if (!preset || typeof preset !== 'object' || !preset.id || !preset.name) {
      throw new Error('Invalid preset: must have id and name')
    }
    logger.debug(`IPC: ${IPC.PRESET_SAVE} - saving preset: "${preset.name}"`)
    try {
      savePreset(preset, logger)
      logger.debug(`IPC: ${IPC.PRESET_SAVE} - success`)
    } catch (err) {
      logger.error(`IPC: ${IPC.PRESET_SAVE} - failed: ${err}`)
      throw err
    }
  })

  ipcMain.handle(IPC.PRESET_DELETE, async (_event, presetId: string) => {
    // SECURITY (S3): Validate input before processing
    if (!presetId || typeof presetId !== 'string') {
      throw new Error('Invalid presetId: must be a non-empty string')
    }
    logger.debug(`IPC: ${IPC.PRESET_DELETE} - deleting preset: ${presetId}`)
    try {
      deletePreset(presetId, logger)
      logger.debug(`IPC: ${IPC.PRESET_DELETE} - success`)
    } catch (err) {
      logger.error(`IPC: ${IPC.PRESET_DELETE} - failed: ${err}`)
      throw err
    }
  })

  ipcMain.handle(IPC.PRESET_SAVE_PORTRAIT, async (_event, args: { sourcePath: string; presetId: string }) => {
    // SECURITY (S3): Validate input before processing
    if (!args || !args.sourcePath || !args.presetId) {
      throw new Error('Invalid portrait args: must have sourcePath and presetId')
    }
    logger.debug(`IPC: ${IPC.PRESET_SAVE_PORTRAIT} - copying portrait for preset ${args.presetId}`)
    try {
      const relativePath = savePortrait(args.sourcePath, args.presetId, logger)
      if (relativePath) {
        // Also return the resolved file:// URI so the renderer can display it immediately
        const uri = resolvePortraitUri(relativePath)
        logger.debug(`IPC: ${IPC.PRESET_SAVE_PORTRAIT} - success: ${relativePath}`)
        return { relativePath, uri }
      }
      // savePortrait returns null when extension is rejected (S6) — propagate as null
      // (not an error, just a validation rejection the renderer handles gracefully)
      return null
    } catch (err) {
      // A2: Standardize to throw on error (not swallow as null).
      // Sprint 8 will layer user-facing error messaging on top of thrown errors.
      logger.error(`IPC: ${IPC.PRESET_SAVE_PORTRAIT} - failed: ${err}`)
      throw err instanceof Error ? err : new Error(String(err))
    }
  })

  // ─── Export (Sprint 6) ───────────────────────────────────────────────

  ipcMain.handle(IPC.EXPORT_WAV, async (_event, request: ExportRequest) => {
    logger.info(`IPC: ${IPC.EXPORT_WAV} - exporting to "${request.outputPath}" (${request.bitDepth}-bit, ${request.sampleRate}Hz)`)
    try {
      const result = await exportWav(request, logger)
      if (result.success) {
        logger.info(`IPC: ${IPC.EXPORT_WAV} - success: ${result.outputPath}`)
      } else {
        logger.error(`IPC: ${IPC.EXPORT_WAV} - failed: ${result.error}`)
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`IPC: ${IPC.EXPORT_WAV} - unhandled error: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle(IPC.EXPORT_BATCH, async (_event, request: { exports: ExportRequest[] }) => {
    logger.info(`IPC: ${IPC.EXPORT_BATCH} - batch exporting ${request.exports.length} files`)
    const results = []
    let successCount = 0
    let failureCount = 0

    for (const exportReq of request.exports) {
      try {
        const result = await exportWav(exportReq, logger)
        results.push(result)
        if (result.success) {
          successCount++
        } else {
          failureCount++
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        results.push({ success: false, error: errorMsg })
        failureCount++
      }
    }

    logger.info(`IPC: ${IPC.EXPORT_BATCH} - complete (${successCount} success, ${failureCount} failed)`)
    return { results, successCount, failureCount }
  })

  // ─── Stage 1 - Offline Audio Processing (Sprint 2) ────────────────────
  // Pitch, formant, and tempo are processed offline via the Rubber Band CLI.
  // The renderer sends raw audio + parameters, main writes a temp WAV, spawns
  // the CLI binary, reads the output, cleans up temps, and returns the result.

  ipcMain.handle(IPC.AUDIO_PROCESS, async (_event, request: AudioProcessRequest) => {
    // SECURITY (S5): Validate audio processing request parameters.
    // Invalid values could crash Rubber Band or hang the main process.
    if (!request || !request.audioData || request.audioData.byteLength === 0) {
      return { success: false, error: 'No audio data provided' }
    }
    if (request.sampleRate < 8000 || request.sampleRate > 192000) {
      return { success: false, error: `Invalid sample rate: ${request.sampleRate}` }
    }
    if (request.channels < 1 || request.channels > 2) {
      return { success: false, error: `Invalid channel count: ${request.channels}` }
    }
    logger.debug(`IPC: ${IPC.AUDIO_PROCESS} - pitch=${request.pitch}, formant=${request.preserveFormant}, tempo=${request.tempo}`)
    try {
      const result = await processAudio(request, logger)
      if (result.success) {
        logger.debug(`IPC: ${IPC.AUDIO_PROCESS} - success (${result.durationSeconds?.toFixed(2)}s)`)
      } else {
        logger.error(`IPC: ${IPC.AUDIO_PROCESS} - failed: ${result.error}`)
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`IPC: ${IPC.AUDIO_PROCESS} - unhandled error: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle(IPC.AUDIO_PROCESS_CANCEL, async () => {
    logger.debug(`IPC: ${IPC.AUDIO_PROCESS_CANCEL} - cancelling in-flight processing`)
    cancelProcessing(logger)
  })

  // ─── File Dialogs (stubs - Sprint 2) ─────────────────────────────────

  // TODO Sprint 8: Implement File > Open dialog for WAV import.
  // Currently files are loaded via drag-and-drop only. This stub exists so the
  // IPC channel is registered and ready when a menu bar "Open" item is added.
  ipcMain.handle(IPC.DIALOG_OPEN_WAV, async () => {
    logger.debug(`IPC: ${IPC.DIALOG_OPEN_WAV} - stub (not yet implemented)`)
    return null
  })

  ipcMain.handle(IPC.DIALOG_SAVE_WAV, async (_event, suggestedName: string) => {
    logger.debug(`IPC: ${IPC.DIALOG_SAVE_WAV} - opening save dialog (suggested: ${suggestedName})`)
    try {
      const win = BrowserWindow.getFocusedWindow()
      const dialogOptions: Electron.SaveDialogOptions = {
        title: 'Export Audio',
        defaultPath: suggestedName || 'export.wav',
        filters: [
          { name: 'WAV Audio', extensions: ['wav'] },
        ],
      }

      const result = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)

      if (result.canceled || !result.filePath) {
        logger.debug(`IPC: ${IPC.DIALOG_SAVE_WAV} - user cancelled`)
        return null
      }

      logger.debug(`IPC: ${IPC.DIALOG_SAVE_WAV} - selected: ${result.filePath}`)
      return result.filePath
    } catch (err) {
      logger.error(`IPC: ${IPC.DIALOG_SAVE_WAV} - failed: ${err}`)
      return null
    }
  })

  ipcMain.handle(IPC.DIALOG_OPEN_IMAGE, async () => {
    logger.debug(`IPC: ${IPC.DIALOG_OPEN_IMAGE} - opening image file dialog`)
    try {
      // Get the focused window so the dialog is modal to it.
      // If no window is focused (unlikely), showOpenDialog works without a parent.
      const win = BrowserWindow.getFocusedWindow()
      const dialogOptions: Electron.OpenDialogOptions = {
        title: 'Select Character Portrait',
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        ],
        properties: ['openFile'],
      }

      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        logger.debug(`IPC: ${IPC.DIALOG_OPEN_IMAGE} - user cancelled`)
        return null
      }

      const selectedPath = result.filePaths[0]
      logger.debug(`IPC: ${IPC.DIALOG_OPEN_IMAGE} - selected: ${selectedPath}`)
      return selectedPath
    } catch (err) {
      logger.error(`IPC: ${IPC.DIALOG_OPEN_IMAGE} - failed: ${err}`)
      return null
    }
  })

  // ─── Take Management (Sprint 7) ──────────────────────────────────────
  // Takes are stored as WAV files in a "takes" directory under userData.
  // This provides persistence across sessions without cluttering the project.

  const takesDir = path.join(app.getPath('userData'), 'takes')

  ipcMain.handle(IPC.TAKE_SAVE, async (_event, request: TakeSaveRequest) => {
    logger.debug(`IPC: ${IPC.TAKE_SAVE} - saving take "${request.take.name}" (${request.take.id})`)
    try {
      // SECURITY (S7): Enforce file size limit to prevent disk exhaustion.
      // 500 MB is generous — a 30-minute mono 48kHz 32-bit float WAV is ~330 MB.
      const MAX_TAKE_SIZE_BYTES = 500 * 1024 * 1024
      if (request.audioData.byteLength > MAX_TAKE_SIZE_BYTES) {
        const sizeMB = (request.audioData.byteLength / (1024 * 1024)).toFixed(1)
        return { success: false, error: `Take too large: ${sizeMB} MB exceeds 500 MB limit` }
      }

      // Ensure takes directory exists
      fs.mkdirSync(takesDir, { recursive: true })

      const filePath = path.join(takesDir, `${request.take.id}.wav`)

      // Write the WAV data to disk
      const buffer = Buffer.from(request.audioData)
      fs.writeFileSync(filePath, buffer)

      logger.debug(`IPC: ${IPC.TAKE_SAVE} - success: ${filePath}`)
      return { success: true, filePath }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`IPC: ${IPC.TAKE_SAVE} - failed: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle(IPC.TAKE_LOAD, async (_event, takeId: string) => {
    logger.debug(`IPC: ${IPC.TAKE_LOAD} - loading take ${takeId}`)
    try {
      const filePath = path.join(takesDir, `${takeId}.wav`)
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `Take file not found: ${takeId}` }
      }

      const data = fs.readFileSync(filePath)
      // Convert Node Buffer to ArrayBuffer for IPC transfer
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)

      logger.debug(`IPC: ${IPC.TAKE_LOAD} - success (${data.length} bytes)`)
      return { success: true, audioData: arrayBuffer }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`IPC: ${IPC.TAKE_LOAD} - failed: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle(IPC.TAKE_DELETE, async (_event, takeId: string) => {
    logger.debug(`IPC: ${IPC.TAKE_DELETE} - deleting take ${takeId}`)
    try {
      const filePath = path.join(takesDir, `${takeId}.wav`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        logger.debug(`IPC: ${IPC.TAKE_DELETE} - success`)
      } else {
        logger.debug(`IPC: ${IPC.TAKE_DELETE} - file not found (may be memory-only take)`)
      }
      return { success: true }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error(`IPC: ${IPC.TAKE_DELETE} - failed: ${errorMsg}`)
      return { success: false }
    }
  })

  ipcMain.handle(IPC.TAKE_LIST, async () => {
    logger.debug(`IPC: ${IPC.TAKE_LIST} - listing takes`)
    try {
      if (!fs.existsSync(takesDir)) {
        return []
      }

      // S8: Use async I/O to avoid blocking the main process.
      // Limit to 1000 files to prevent hangs on directories with many files.
      const allFiles = await fs.promises.readdir(takesDir)
      const wavFiles = allFiles.filter((f) => f.endsWith('.wav')).slice(0, 1000)
      const takes: Take[] = []

      for (const filename of wavFiles) {
        const filePath = path.join(takesDir, filename)
        const stat = await fs.promises.stat(filePath)
        const id = filename.replace('.wav', '')
        takes.push({
          id,
          name: id,
          durationMs: 0, // Duration is stored in renderer memory, not on disk metadata
          createdAt: stat.mtimeMs,
          filePath,
        })
      }

      logger.debug(`IPC: ${IPC.TAKE_LIST} - found ${takes.length} takes`)
      return takes
    } catch (err) {
      logger.error(`IPC: ${IPC.TAKE_LIST} - failed: ${err}`)
      return []
    }
  })

  logger.info('All IPC handlers registered')
}
