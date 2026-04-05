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
 * Preset File System - Main Process (Sprint 5)
 *
 * Manages the presets.json file and portrait images on disk.
 *
 * STORAGE:
 * - presets.json lives in {projectRoot}/config/ (alongside settings.json)
 * - Portrait images live in {projectRoot}/portraits/
 * - Portrait paths in presets.json are relative (e.g. "portraits/finn.png")
 * - portraits/ is gitignored - image files are user-specific, not committed
 *
 * ATOMIC WRITES:
 * presets.json holds the entire preset library. A corrupted write means total
 * data loss. All writes use write-temp-then-rename:
 *   1. Write to presets.tmp.json in the same directory
 *   2. Rename atomically to presets.json
 * If a crash occurs during step 1, the original is untouched.
 * If presets.tmp.json exists on startup without presets.json, recover from it.
 *
 * PORTRAIT MANAGEMENT:
 * When a user adds a portrait, the image file is copied into {userData}/portraits/
 * with a name based on the preset ID (e.g. "abc123.png"). When a preset is deleted,
 * its portrait file is deleted in the same operation.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { Logger } from 'winston'
import type { Preset, PresetLibrary } from '../../shared/types'

// ─── Path Helpers ──────────────────────────────────────────────────────────

/**
 * Resolves the project root directory.
 * Same pattern as settings.ts:
 *   - Dev: app.getAppPath() returns the project root
 *   - Production: config is copied to extraResources
 */
function getProjectRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return app.getAppPath()
}

/** Returns the config directory where presets.json lives (alongside settings.json) */
function getPresetsDir(): string {
  return path.join(getProjectRoot(), 'config')
}

/** Full path to presets.json */
function getPresetsFilePath(): string {
  return path.join(getPresetsDir(), 'presets.json')
}

/** Full path to the temp file used during atomic writes */
function getPresetsTempPath(): string {
  return path.join(getPresetsDir(), 'presets.tmp.json')
}

/** Full path to the portraits directory (project root level, gitignored) */
function getPortraitsDir(): string {
  return path.join(getProjectRoot(), 'portraits')
}

// ─── Read / Write ──────────────────────────────────────────────────────────

/**
 * Loads all presets from disk.
 *
 * Recovery logic:
 * - If presets.json exists, load it normally
 * - If presets.json is missing but presets.tmp.json exists, recover from temp
 * - If neither exists, return an empty library (first launch)
 * - If presets.json is corrupted, return empty library and log a warning
 */
export function loadAllPresets(logger: Logger): PresetLibrary {
  const presetsPath = getPresetsFilePath()
  const tempPath = getPresetsTempPath()

  // Recovery: if temp exists but main doesn't, a crash happened during write
  if (!fs.existsSync(presetsPath) && fs.existsSync(tempPath)) {
    logger.warn('Found presets.tmp.json without presets.json - recovering from temp file')
    try {
      fs.renameSync(tempPath, presetsPath)
    } catch (err) {
      logger.error(`Failed to recover presets from temp file: ${err}`)
      return { presets: [] }
    }
  }

  if (!fs.existsSync(presetsPath)) {
    // First launch - no presets file yet
    logger.debug('No presets.json found - starting with empty library')
    return { presets: [] }
  }

  try {
    const raw = fs.readFileSync(presetsPath, 'utf-8')
    const data = JSON.parse(raw) as PresetLibrary
    // Validate basic structure
    if (!Array.isArray(data.presets)) {
      logger.warn('presets.json has invalid structure (presets is not an array) - starting fresh')
      return { presets: [] }
    }
    logger.info(`Loaded ${data.presets.length} presets from disk`)
    return data
  } catch (err) {
    logger.error(`Failed to read presets.json: ${err}`)
    return { presets: [] }
  }
}

/**
 * Writes the full preset library to disk using atomic write (temp + rename).
 *
 * @param library - The complete preset library to save
 * @param logger - Winston logger
 */
function writePresetLibrary(library: PresetLibrary, logger: Logger): void {
  const presetsPath = getPresetsFilePath()
  const tempPath = getPresetsTempPath()

  // Ensure the userData directory exists (it should, but be safe)
  const dir = getPresetsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Step 1: Write to temp file
  fs.writeFileSync(tempPath, JSON.stringify(library, null, 2), 'utf-8')

  // Step 2: Atomic rename - if this fails, presets.json is still the old version
  fs.renameSync(tempPath, presetsPath)

  logger.debug(`Wrote ${library.presets.length} presets to disk`)
}

// ─── CRUD Operations ───────────────────────────────────────────────────────

/**
 * Saves a preset (create or update).
 * If a preset with the same ID exists, it's replaced. Otherwise it's added.
 */
export function savePreset(preset: Preset, logger: Logger): void {
  const library = loadAllPresets(logger)

  const existingIndex = library.presets.findIndex((p) => p.id === preset.id)
  if (existingIndex >= 0) {
    // Update existing preset
    library.presets[existingIndex] = preset
    logger.info(`Updated preset: "${preset.name}" (id: ${preset.id})`)
  } else {
    // Add new preset
    library.presets.push(preset)
    logger.info(`Saved new preset: "${preset.name}" (id: ${preset.id})`)
  }

  writePresetLibrary(library, logger)
}

/**
 * Deletes a preset by ID and removes its portrait file if one exists.
 */
export function deletePreset(presetId: string, logger: Logger): void {
  const library = loadAllPresets(logger)

  const preset = library.presets.find((p) => p.id === presetId)
  if (!preset) {
    logger.warn(`Attempted to delete non-existent preset: ${presetId}`)
    return
  }

  // Delete portrait file if one is associated
  if (preset.portraitPath) {
    const fullPortraitPath = path.resolve(getProjectRoot(), preset.portraitPath)
    const portraitsDir = path.resolve(getPortraitsDir())

    // SECURITY (S2): Validate the resolved portrait path stays within the
    // portraits directory. A corrupted presets.json with portraitPath like
    // "../../important-file.txt" could otherwise delete arbitrary files.
    if (!fullPortraitPath.startsWith(portraitsDir)) {
      logger.error(`Portrait path escape attempt blocked: ${preset.portraitPath}`)
      // Do NOT delete — path is outside portraits dir. Continue with preset deletion.
    } else if (fs.existsSync(fullPortraitPath)) {
      try {
        fs.unlinkSync(fullPortraitPath)
        logger.debug(`Deleted portrait file: ${fullPortraitPath}`)
      } catch (err) {
        logger.warn(`Failed to delete portrait file ${fullPortraitPath}: ${err}`)
        // Continue with preset deletion even if portrait cleanup fails
      }
    }
  }

  library.presets = library.presets.filter((p) => p.id !== presetId)
  writePresetLibrary(library, logger)
  logger.info(`Deleted preset: "${preset.name}" (id: ${presetId})`)
}

// ─── Portrait Management ───────────────────────────────────────────────────

/**
 * Copies a portrait image file into the portraits directory.
 * Returns the relative path to store in the preset (e.g. "portraits/abc123.png").
 *
 * @param sourcePath - Absolute path to the image file the user selected
 * @param presetId - The preset ID, used to name the file uniquely
 * @param logger - Winston logger
 * @returns Relative path to the copied portrait, or null on failure
 */
export function savePortrait(sourcePath: string, presetId: string, logger: Logger): string | null {
  const portraitsDir = getPortraitsDir()

  // Ensure portraits directory exists
  if (!fs.existsSync(portraitsDir)) {
    fs.mkdirSync(portraitsDir, { recursive: true })
  }

  // SECURITY (S6): Whitelist image extensions to prevent non-image files
  // (e.g. .exe, .dll) from being copied into the portraits directory.
  const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
  const ext = path.extname(sourcePath).toLowerCase() || '.png'
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) {
    logger.warn(`Rejected portrait with invalid extension: ${ext} (source: ${sourcePath})`)
    return null
  }

  // Use preset ID + validated extension for the filename
  const filename = `${presetId}${ext}`
  const destPath = path.join(portraitsDir, filename)

  try {
    fs.copyFileSync(sourcePath, destPath)
    // Return relative path from userData root - this is what gets stored in presets.json
    const relativePath = path.join('portraits', filename)
    logger.debug(`Saved portrait: ${relativePath}`)
    return relativePath
  } catch (err) {
    logger.error(`Failed to save portrait from ${sourcePath}: ${err}`)
    return null
  }
}

/**
 * Resolves a relative portrait path to a full file:// URI for the renderer.
 * Returns null if the portrait file doesn't exist (graceful fallback).
 *
 * @param relativePath - Relative path stored in preset (e.g. "portraits/abc123.png")
 * @returns Full file:// URI or null if file doesn't exist
 */
export function resolvePortraitUri(relativePath: string): string | null {
  // Resolve relative to project root since portrait paths are "portraits/abc123.png"
  const fullPath = path.join(getProjectRoot(), relativePath)
  if (!fs.existsSync(fullPath)) {
    return null
  }
  // Extract just the filename from the relative path (e.g. "portraits/abc123.png" -> "abc123.png")
  // and build a portrait:// URI. We use a custom protocol because Electron's renderer
  // blocks file:// URIs when served from localhost (dev) or custom schemes (production).
  // The portrait:// protocol handler in index.ts maps this back to the local file.
  const filename = path.basename(fullPath)
  return `portrait://${filename}`
}
