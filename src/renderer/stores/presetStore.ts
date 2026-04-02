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
 * Preset Store - Zustand (Sprint 5)
 *
 * Manages the full preset library state in the renderer process.
 *
 * RESPONSIBILITIES:
 * - Loaded preset library (from presets.json via IPC)
 * - Active preset tracking (which preset is currently loaded into the engine)
 * - A/B comparison state (two preset slots to toggle between)
 * - Category management (collapsible folders in the preset panel)
 * - Emotion sub-preset state
 *
 * DATA FLOW:
 * User action -> usePresets hook -> IPC -> main process -> presets.json
 *                                      -> presetStore (optimistic update)
 *
 * The store holds the in-memory view of the preset library. All mutations
 * are also persisted to disk via IPC (handled by the usePresets hook, not here).
 * The store is purely reactive state - it does not call IPC directly.
 */

import { create } from 'zustand'
import type { Preset, EmotionVariant, EngineSnapshot } from '../../shared/types'

// ─── A/B Toggle Types ─────────────────────────────────────────────────────

/**
 * A/B toggle lets the user load two presets and switch between them.
 * Slot 'A' and slot 'B' each hold a preset ID.
 * The "active slot" determines which preset is currently applied to the engine.
 * Stage 2 effects switch instantly; Stage 1 params require Apply to hear.
 */
export type ABSlot = 'A' | 'B'

// ─── Store Interface ──────────────────────────────────────────────────────

interface PresetState {
  /** All loaded presets from presets.json */
  presets: Preset[]

  /** Currently active preset ID, or null if none loaded into the engine */
  activePresetId: string | null

  /** Which categories are collapsed in the preset panel (by category name) */
  collapsedCategories: Set<string>

  // ─── A/B Toggle ─────────────────────────────────────────────────────

  /** Preset ID loaded into A/B slot A (null = empty slot) */
  abSlotA: string | null

  /** Preset ID loaded into A/B slot B (null = empty slot) */
  abSlotB: string | null

  /** Which A/B slot is currently active (applied to the engine) */
  abActiveSlot: ABSlot

  /** Whether A/B comparison mode is enabled */
  abEnabled: boolean

  // ─── Actions ─────────────────────────────────────────────────────────

  /** Replace the full preset library (e.g. after loading from disk) */
  setPresets: (presets: Preset[]) => void

  /** Add or update a single preset in the library (optimistic update) */
  upsertPreset: (preset: Preset) => void

  /** Remove a preset from the library by ID (optimistic update) */
  removePreset: (presetId: string) => void

  /** Set the active preset ID (the one loaded into the engine) */
  setActivePresetId: (id: string | null) => void

  /** Toggle a category's collapsed state */
  toggleCategory: (category: string) => void

  // ─── A/B Actions ─────────────────────────────────────────────────────

  /** Enable A/B mode, loading current active preset into slot A */
  enableAB: () => void

  /** Disable A/B mode, keeping whichever slot was active */
  disableAB: () => void

  /** Load a preset ID into a specific A/B slot */
  setABSlot: (slot: ABSlot, presetId: string | null) => void

  /** Toggle between A/B slots. Returns the preset ID of the newly active slot. */
  toggleABSlot: () => string | null

  // ─── Derived Getters ─────────────────────────────────────────────────

  /** Get the currently active preset object (resolved from activePresetId) */
  getActivePreset: () => Preset | null

  /** Get all unique category names from the preset library */
  getCategories: () => string[]

  /** Get presets filtered by category */
  getPresetsByCategory: (category: string) => Preset[]

  /** Get presets that have no category (uncategorized) */
  getUncategorizedPresets: () => Preset[]
}

export const usePresetStore = create<PresetState>((set, get) => ({
  presets: [],
  activePresetId: null,
  collapsedCategories: new Set<string>(),

  // A/B comparison starts disabled
  abSlotA: null,
  abSlotB: null,
  abActiveSlot: 'A',
  abEnabled: false,

  // ─── Library Actions ──────────────────────────────────────────────────

  setPresets: (presets) => set({ presets }),

  upsertPreset: (preset) => {
    const { presets } = get()
    const existingIndex = presets.findIndex((p) => p.id === preset.id)
    if (existingIndex >= 0) {
      // Update existing - create a new array to trigger re-render
      const updated = [...presets]
      updated[existingIndex] = preset
      set({ presets: updated })
    } else {
      // Add new
      set({ presets: [...presets, preset] })
    }
  },

  removePreset: (presetId) => {
    const { presets, activePresetId, abSlotA, abSlotB } = get()
    const updates: Partial<PresetState> = {
      presets: presets.filter((p) => p.id !== presetId),
    }
    // Clear active preset if it was the deleted one
    if (activePresetId === presetId) {
      updates.activePresetId = null
    }
    // Clear A/B slots if they referenced the deleted preset
    if (abSlotA === presetId) {
      updates.abSlotA = null
    }
    if (abSlotB === presetId) {
      updates.abSlotB = null
    }
    set(updates)
  },

  setActivePresetId: (id) => set({ activePresetId: id }),

  toggleCategory: (category) => {
    const { collapsedCategories } = get()
    const next = new Set(collapsedCategories)
    if (next.has(category)) {
      next.delete(category)
    } else {
      next.add(category)
    }
    set({ collapsedCategories: next })
  },

  // ─── A/B Actions ──────────────────────────────────────────────────────

  enableAB: () => {
    const { activePresetId } = get()
    // Load the current active preset into slot A when enabling A/B mode
    set({
      abEnabled: true,
      abSlotA: activePresetId,
      abSlotB: null,
      abActiveSlot: 'A',
    })
  },

  disableAB: () => {
    // Keep the currently active slot's preset as the active preset
    const { abActiveSlot, abSlotA, abSlotB } = get()
    const keepId = abActiveSlot === 'A' ? abSlotA : abSlotB
    set({
      abEnabled: false,
      activePresetId: keepId,
    })
  },

  setABSlot: (slot, presetId) => {
    const { abActiveSlot } = get()
    const updates: Partial<PresetState> = {}
    if (slot === 'A') {
      updates.abSlotA = presetId
    } else {
      updates.abSlotB = presetId
    }
    // If loading into the currently active slot, update activePresetId
    // so the preset list highlights the correct item
    if (slot === abActiveSlot) {
      updates.activePresetId = presetId
    }
    set(updates)
  },

  toggleABSlot: () => {
    const { abActiveSlot, abSlotA, abSlotB } = get()
    const nextSlot: ABSlot = abActiveSlot === 'A' ? 'B' : 'A'
    const nextPresetId = nextSlot === 'A' ? abSlotA : abSlotB
    set({
      abActiveSlot: nextSlot,
      activePresetId: nextPresetId,
    })
    return nextPresetId
  },

  // ─── Derived Getters ──────────────────────────────────────────────────

  getActivePreset: () => {
    const { presets, activePresetId } = get()
    if (!activePresetId) return null
    return presets.find((p) => p.id === activePresetId) ?? null
  },

  getCategories: () => {
    const { presets } = get()
    // Collect unique non-empty category names, sorted alphabetically
    const cats = new Set<string>()
    for (const p of presets) {
      if (p.category && p.category.trim()) {
        cats.add(p.category.trim())
      }
    }
    return Array.from(cats).sort()
  },

  getPresetsByCategory: (category) => {
    const { presets } = get()
    return presets.filter((p) => p.category === category)
  },

  getUncategorizedPresets: () => {
    const { presets } = get()
    return presets.filter((p) => !p.category || !p.category.trim())
  },
}))
