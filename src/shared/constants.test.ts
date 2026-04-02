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
 * Constants unit tests
 *
 * Validates that shared constants are correctly defined.
 * These tests confirm the Vitest setup is working.
 */

import { describe, it, expect } from 'vitest'
import { IPC, DEFAULT_ENGINE_SNAPSHOT, DEFAULT_APP_SETTINGS, MIN_SESSION_FILES } from './constants'

describe('IPC channel constants', () => {
  it('defines all expected channels', () => {
    // Verify no channel names are empty or undefined
    for (const [key, value] of Object.entries(IPC)) {
      expect(value).toBeTruthy()
      expect(typeof value).toBe('string')
    }
  })

  it('has no duplicate channel names', () => {
    const values = Object.values(IPC)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })
})

describe('DEFAULT_ENGINE_SNAPSHOT', () => {
  it('has exactly 4 EQ bands', () => {
    expect(DEFAULT_ENGINE_SNAPSHOT.eq).toHaveLength(4)
  })

  it('has all wet/dry mix entries for every EffectName', () => {
    const expectedEffects = ['vibrato', 'tremolo', 'vocalFry', 'breathiness', 'reverb']
    for (const effect of expectedEffects) {
      expect(DEFAULT_ENGINE_SNAPSHOT.wetDryMix).toHaveProperty(effect)
    }
  })

  it('starts with bypass disabled', () => {
    expect(DEFAULT_ENGINE_SNAPSHOT.bypassed).toBe(false)
  })

  it('has pitch at 0 (no shift)', () => {
    expect(DEFAULT_ENGINE_SNAPSHOT.pitch).toBe(0)
  })

  it('has speed at 1.0 (normal playback)', () => {
    expect(DEFAULT_ENGINE_SNAPSHOT.speed).toBe(1.0)
  })
})

describe('DEFAULT_APP_SETTINGS', () => {
  it('has positive maxSessionFiles', () => {
    expect(DEFAULT_APP_SETTINGS.logging.maxSessionFiles).toBeGreaterThanOrEqual(MIN_SESSION_FILES)
  })

  it('defaults to dark theme', () => {
    expect(DEFAULT_APP_SETTINGS.ui.theme).toBe('dark')
  })

  it('defaults to 24-bit export', () => {
    expect(DEFAULT_APP_SETTINGS.export.defaultBitDepth).toBe(24)
  })
})
