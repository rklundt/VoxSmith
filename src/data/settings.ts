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
 * Settings Data Access — Renderer Side
 *
 * Provides typed access to app settings via the window.voxsmith IPC bridge.
 * The renderer never reads files directly — all settings access goes through main via IPC.
 *
 * Sprint 0: Stub — getSettings and saveSettings are functional.
 */

import type { AppSettings } from '../shared/types'

/** Load merged settings from main process */
export async function getSettings(): Promise<AppSettings> {
  return window.voxsmith.getSettings()
}

/** Save user setting overrides via main process */
export async function saveSettings(overrides: Partial<AppSettings>): Promise<void> {
  return window.voxsmith.saveSettings(overrides)
}
