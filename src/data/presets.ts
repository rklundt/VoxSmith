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
 * Preset Data Access - Renderer Side (Sprint 5)
 *
 * Provides typed access to preset operations via the window.voxsmith IPC bridge.
 * The renderer never reads/writes presets.json directly - all file I/O goes
 * through the main process via these IPC wrappers.
 */

import type { Preset, PresetLibrary } from '../shared/types'

/** Load all presets from main process */
export async function loadAllPresets(): Promise<PresetLibrary> {
  return window.voxsmith.loadAllPresets()
}

/** Save a preset via main process (create or update) */
export async function savePreset(preset: Preset): Promise<void> {
  return window.voxsmith.savePreset(preset)
}

/** Delete a preset and its associated portrait via main process */
export async function deletePreset(id: string): Promise<void> {
  return window.voxsmith.deletePreset(id)
}

/**
 * Copy a portrait image to the portraits directory and return
 * the relative path and file:// URI for display.
 *
 * @param sourcePath - Absolute path to the user's selected image file
 * @param presetId - The preset ID, used to name the file uniquely
 * @returns Object with relativePath and uri, or null on failure
 */
export async function savePortrait(
  sourcePath: string,
  presetId: string
): Promise<{ relativePath: string; uri: string } | null> {
  return window.voxsmith.savePortrait(sourcePath, presetId)
}

/** Open a file dialog for selecting an image file */
export async function openImageDialog(): Promise<string | null> {
  return window.voxsmith.openImageDialog()
}
