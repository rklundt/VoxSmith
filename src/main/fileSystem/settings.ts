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
 * Settings Reader - Main Process
 *
 * Reads and merges app settings from two files:
 * 1. config/settings.json - committed defaults, shipped with the app
 * 2. config/userSettingsOverride.json - user-specific overrides, gitignored
 *
 * Shallow merge: override file wins on any conflicting key.
 * If settings.json is missing or corrupted, falls back to hardcoded defaults.
 * If override file doesn't exist, that's normal - it's created on first user change.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { AppSettings } from '../../shared/types'
import { DEFAULT_APP_SETTINGS, MIN_SESSION_FILES } from '../../shared/constants'

/**
 * Resolves the path to the config directory.
 * In dev: project root /config/
 * In production: alongside the app resources
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    // In production, config is copied to extraResources
    return path.join(process.resourcesPath, 'config')
  }
  // In dev, config is at project root
  return path.join(app.getAppPath(), 'config')
}

/**
 * Reads and parses a JSON file, returning null if it doesn't exist or is corrupted.
 */
function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Loads merged app settings.
 *
 * Merge order (later wins):
 * 1. Hardcoded DEFAULT_APP_SETTINGS (safety net)
 * 2. config/settings.json (shipped defaults)
 * 3. config/userSettingsOverride.json (user changes)
 *
 * Returns a fully populated AppSettings object - never partial.
 */
export function loadSettings(logger?: { warn: (msg: string) => void }): AppSettings {
  const configDir = getConfigDir()
  const defaultsPath = path.join(configDir, 'settings.json')
  const overridePath = path.join(configDir, 'userSettingsOverride.json')

  // Start with hardcoded fallback
  let settings: AppSettings = structuredClone(DEFAULT_APP_SETTINGS)

  // Layer 1: shipped defaults from settings.json
  const defaults = readJsonSafe(defaultsPath)
  if (defaults) {
    // Shallow merge each section to preserve nested structure
    settings = {
      logging: { ...settings.logging, ...(defaults.logging as object ?? {}) },
      export: { ...settings.export, ...(defaults.export as object ?? {}) },
      ui: { ...settings.ui, ...(defaults.ui as object ?? {}) },
    } as AppSettings
  } else {
    logger?.warn(`Settings file not found or corrupted at ${defaultsPath} - using hardcoded defaults`)
    // Recreate the defaults file so the user has a recoverable state
    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true })
      }
      fs.writeFileSync(defaultsPath, JSON.stringify(DEFAULT_APP_SETTINGS, null, 2), 'utf-8')
      logger?.warn(`Recreated settings.json with hardcoded defaults at ${defaultsPath}`)
    } catch {
      // If we can't write the file, continue - the app still works with in-memory defaults
    }
  }

  // Layer 2: user overrides
  const overrides = readJsonSafe(overridePath)
  if (overrides) {
    settings = {
      logging: { ...settings.logging, ...(overrides.logging as object ?? {}) },
      export: { ...settings.export, ...(overrides.export as object ?? {}) },
      ui: { ...settings.ui, ...(overrides.ui as object ?? {}) },
    } as AppSettings
  }
  // No warning if override file doesn't exist - that's normal for first launch

  // Safety: enforce minimum session file count so user can't set it to 0 or negative
  if (settings.logging.maxSessionFiles < MIN_SESSION_FILES) {
    logger?.warn(
      `maxSessionFiles was ${settings.logging.maxSessionFiles}, clamping to minimum ${MIN_SESSION_FILES}`
    )
    settings.logging.maxSessionFiles = MIN_SESSION_FILES
  }

  return settings
}

/**
 * Saves user settings overrides to config/userSettingsOverride.json.
 * Only the override file is written - settings.json is never modified at runtime.
 */
export function saveSettingsOverride(
  overrides: Partial<AppSettings>,
  logger?: { info: (msg: string) => void; error: (msg: string) => void }
): void {
  const configDir = getConfigDir()
  const overridePath = path.join(configDir, 'userSettingsOverride.json')

  try {
    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }

    // Read existing overrides to merge with new ones
    const existing = readJsonSafe(overridePath) ?? {}
    const merged = { ...existing, ...overrides }

    fs.writeFileSync(overridePath, JSON.stringify(merged, null, 2), 'utf-8')
    logger?.info('User settings override saved')
  } catch (err) {
    logger?.error(`Failed to save settings override: ${err}`)
  }
}
