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
 * Preset Store - Zustand
 *
 * Owns: loaded preset library, active preset id, A/B comparison state, emotion sub-preset state.
 *
 * Sprint 0: Stub with empty state only.
 * Sprint 5: Will be populated with full preset management logic.
 */

import { create } from 'zustand'
import type { Preset } from '../../shared/types'

interface PresetState {
  /** All loaded presets from presets.json */
  presets: Preset[]
  /** Currently active preset ID, or null if none loaded */
  activePresetId: string | null
  /** Set the full preset library (e.g. after loading from file) */
  setPresets: (presets: Preset[]) => void
}

export const usePresetStore = create<PresetState>((set) => ({
  presets: [],
  activePresetId: null,
  setPresets: (presets) => set({ presets }),
}))
