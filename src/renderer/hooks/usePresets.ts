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
 * usePresets - Hook for Preset Management (Sprint 5)
 *
 * Bridges the PresetPanel UI to the IPC layer and Zustand stores.
 * All preset CRUD operations go through this hook, which:
 *   1. Calls IPC to persist changes to presets.json
 *   2. Updates the presetStore with the new state (optimistic update)
 *   3. Applies engine snapshots when loading a preset
 *
 * IMPORTANT: The hook does NOT hold any preset data itself. All state
 * lives in presetStore (reactive, triggers re-renders) and the engine
 * (audio parameters). The hook is purely imperative operations.
 */

import { useCallback, useEffect } from 'react'
import { usePresetStore } from '../stores/presetStore'
import { useEngineStore } from '../stores/engineStore'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../shared/constants'
import type { Preset, EmotionVariant, EngineSnapshot } from '../../shared/types'

/**
 * Generates a simple unique ID for presets and emotion variants.
 * Uses timestamp + random suffix to avoid collisions.
 * Not cryptographically secure - just needs to be unique within the library.
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}`
}

/**
 * Validates a preset name before saving.
 * Returns an error message string if invalid, or null if valid.
 */
export function validatePresetName(name: string, existingPresets: Preset[], excludeId?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'Preset name cannot be empty'
  }
  if (trimmed.length > 100) {
    return 'Preset name is too long (max 100 characters)'
  }
  // Check for duplicate names (case-insensitive), excluding the preset being edited
  const duplicate = existingPresets.find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase() && p.id !== excludeId
  )
  if (duplicate) {
    return `A preset named "${duplicate.name}" already exists`
  }
  return null
}

export function usePresets(applySnapshot: (snapshot: EngineSnapshot) => void) {
  const {
    presets,
    setPresets,
    upsertPreset,
    removePreset,
    setActivePresetId,
    activePresetId,
  } = usePresetStore()

  // ─── Initial Load ──────────────────────────────────────────────────────

  /**
   * Loads all presets from disk on mount.
   * Called once when the hook first initializes.
   */
  useEffect(() => {
    window.voxsmith.loadAllPresets()
      .then((library) => {
        setPresets(library.presets)
        console.debug(`[usePresets] Loaded ${library.presets.length} presets from disk`)
      })
      .catch((err) => {
        console.error('[usePresets] Failed to load presets:', err)
      })
  }, [setPresets])

  // ─── Save Preset ───────────────────────────────────────────────────────

  /**
   * Saves the current engine snapshot as a new preset with the given name,
   * category, and notes. Creates a new preset ID and timestamps.
   *
   * @returns The new preset object, or null if validation failed
   */
  const saveNewPreset = useCallback(async (
    name: string,
    category: string,
    notes: string
  ): Promise<Preset | null> => {
    const trimmedName = name.trim()
    const error = validatePresetName(trimmedName, presets)
    if (error) {
      console.warn(`[usePresets] Save rejected: ${error}`)
      return null
    }

    // Capture the current engine snapshot from the store
    const currentSnapshot = useEngineStore.getState().snapshot

    const now = new Date().toISOString()
    const preset: Preset = {
      id: generateId(),
      name: trimmedName,
      category: category.trim(),
      notes: notes.trim() || undefined,
      emotionVariants: [],
      engineSnapshot: { ...currentSnapshot },
      createdAt: now,
      updatedAt: now,
    }

    // Persist to disk via IPC
    await window.voxsmith.savePreset(preset)

    // Update store (optimistic - IPC already succeeded)
    upsertPreset(preset)
    setActivePresetId(preset.id)

    console.debug(`[usePresets] Saved new preset: "${preset.name}" (${preset.id})`)
    return preset
  }, [presets, upsertPreset, setActivePresetId])

  // ─── Update Preset ─────────────────────────────────────────────────────

  /**
   * Updates an existing preset's metadata (name, category, notes) and/or
   * its engine snapshot. Does not create a new ID.
   */
  const updatePreset = useCallback(async (
    presetId: string,
    updates: {
      name?: string
      category?: string
      notes?: string
      engineSnapshot?: EngineSnapshot
      portraitPath?: string
    }
  ): Promise<Preset | null> => {
    const existing = presets.find((p) => p.id === presetId)
    if (!existing) {
      console.warn(`[usePresets] Update failed: preset ${presetId} not found`)
      return null
    }

    // Validate name if it changed
    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim()
      const error = validatePresetName(trimmedName, presets, presetId)
      if (error) {
        console.warn(`[usePresets] Update rejected: ${error}`)
        return null
      }
    }

    const updated: Preset = {
      ...existing,
      name: updates.name !== undefined ? updates.name.trim() : existing.name,
      category: updates.category !== undefined ? updates.category.trim() : existing.category,
      notes: updates.notes !== undefined ? (updates.notes.trim() || undefined) : existing.notes,
      engineSnapshot: updates.engineSnapshot ?? existing.engineSnapshot,
      portraitPath: updates.portraitPath !== undefined ? updates.portraitPath : existing.portraitPath,
      updatedAt: new Date().toISOString(),
    }

    await window.voxsmith.savePreset(updated)
    upsertPreset(updated)

    console.debug(`[usePresets] Updated preset: "${updated.name}" (${updated.id})`)
    return updated
  }, [presets, upsertPreset])

  // ─── Save Current Settings to Existing Preset ──────────────────────────

  /**
   * Overwrites the active preset's engine snapshot with the current settings.
   * Useful for "Update preset with current settings" action.
   */
  const overwriteActivePreset = useCallback(async (): Promise<Preset | null> => {
    if (!activePresetId) {
      console.warn('[usePresets] No active preset to overwrite')
      return null
    }

    const currentSnapshot = useEngineStore.getState().snapshot
    return updatePreset(activePresetId, { engineSnapshot: { ...currentSnapshot } })
  }, [activePresetId, updatePreset])

  // ─── Load Preset ───────────────────────────────────────────────────────

  /**
   * Loads a preset's engine snapshot into the audio engine and marks it active.
   * This applies all Stage 2 parameters immediately. Stage 1 params (pitch/formant/speed)
   * will be marked stale and require an Apply click.
   */
  const loadPreset = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) {
      console.warn(`[usePresets] Load failed: preset ${presetId} not found`)
      return
    }

    // Apply the preset's engine snapshot to the audio engine.
    // This updates both the engine (real-time effects) and the engineStore (UI state).
    applySnapshot(preset.engineSnapshot)
    setActivePresetId(presetId)

    console.debug(`[usePresets] Loaded preset: "${preset.name}" (${preset.id})`)
  }, [presets, applySnapshot, setActivePresetId])

  // ─── Load Emotion Variant ──────────────────────────────────────────────

  /**
   * Loads an emotion variant's snapshot into the engine.
   * The parent preset stays active - this just swaps the parameter values.
   */
  const loadEmotionVariant = useCallback((presetId: string, variantId: string) => {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) return

    const variant = preset.emotionVariants.find((v) => v.id === variantId)
    if (!variant) {
      console.warn(`[usePresets] Variant ${variantId} not found in preset ${presetId}`)
      return
    }

    applySnapshot(variant.engineSnapshot)
    console.debug(`[usePresets] Loaded emotion variant: "${variant.emotion}" of "${preset.name}"`)
  }, [presets, applySnapshot])

  // ─── Delete Preset ─────────────────────────────────────────────────────

  /**
   * Deletes a preset from the library and disk. Also removes portrait file.
   */
  const deletePresetById = useCallback(async (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) {
      console.warn(`[usePresets] Delete failed: preset ${presetId} not found`)
      return
    }

    // Persist deletion to disk (also deletes portrait file)
    await window.voxsmith.deletePreset(presetId)

    // Update store
    removePreset(presetId)

    console.debug(`[usePresets] Deleted preset: "${preset.name}" (${presetId})`)
  }, [presets, removePreset])

  // ─── Portrait Management ───────────────────────────────────────────────

  /**
   * Opens a file dialog for the user to select a portrait image,
   * copies it to the portraits directory, and updates the preset.
   *
   * @returns The file:// URI of the saved portrait, or null if cancelled/failed
   */
  const setPortrait = useCallback(async (presetId: string): Promise<string | null> => {
    // Step 1: Open file dialog to let user pick an image
    const sourcePath = await window.voxsmith.openImageDialog()
    if (!sourcePath) {
      return null // User cancelled
    }

    // Step 2: Copy the image to portraits/ directory via IPC
    const result = await window.voxsmith.savePortrait(sourcePath, presetId)
    if (!result) {
      console.error('[usePresets] Failed to save portrait')
      return null
    }

    // Step 3: Update the preset with the new portrait path on disk
    const updatedPreset = await updatePreset(presetId, { portraitPath: result.relativePath })

    // Step 4: Attach the portrait:// URI to the in-memory preset so the
    // thumbnail renders immediately without needing to reload from disk.
    // The URI is a transient display-only field - not saved to presets.json.
    if (updatedPreset && result.uri) {
      ;(updatedPreset as Preset & { portraitUri?: string }).portraitUri = result.uri
      upsertPreset(updatedPreset)
    }

    console.debug(`[usePresets] Set portrait for preset ${presetId}: ${result.relativePath}`)
    return result.uri ?? null
  }, [updatePreset, upsertPreset])

  // ─── Emotion Variant CRUD ──────────────────────────────────────────────

  /**
   * Adds a new emotion variant to an existing preset.
   * Captures the current engine snapshot as the variant's settings.
   */
  const addEmotionVariant = useCallback(async (
    presetId: string,
    emotionName: string
  ): Promise<EmotionVariant | null> => {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) return null

    const trimmedEmotion = emotionName.trim()
    if (!trimmedEmotion) return null

    // Check for duplicate emotion names within this preset
    if (preset.emotionVariants.some((v) => v.emotion.toLowerCase() === trimmedEmotion.toLowerCase())) {
      console.warn(`[usePresets] Emotion "${trimmedEmotion}" already exists on preset "${preset.name}"`)
      return null
    }

    const currentSnapshot = useEngineStore.getState().snapshot
    const variant: EmotionVariant = {
      id: generateId(),
      emotion: trimmedEmotion,
      engineSnapshot: { ...currentSnapshot },
    }

    const updatedPreset: Preset = {
      ...preset,
      emotionVariants: [...preset.emotionVariants, variant],
      updatedAt: new Date().toISOString(),
    }

    await window.voxsmith.savePreset(updatedPreset)
    upsertPreset(updatedPreset)

    console.debug(`[usePresets] Added emotion variant "${trimmedEmotion}" to "${preset.name}"`)
    return variant
  }, [presets, upsertPreset])

  /**
   * Deletes an emotion variant from a preset.
   */
  const deleteEmotionVariant = useCallback(async (
    presetId: string,
    variantId: string
  ) => {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) return

    const updatedPreset: Preset = {
      ...preset,
      emotionVariants: preset.emotionVariants.filter((v) => v.id !== variantId),
      updatedAt: new Date().toISOString(),
    }

    await window.voxsmith.savePreset(updatedPreset)
    upsertPreset(updatedPreset)

    console.debug(`[usePresets] Deleted emotion variant ${variantId} from "${preset.name}"`)
  }, [presets, upsertPreset])

  return {
    presets,
    activePresetId,
    saveNewPreset,
    updatePreset,
    overwriteActivePreset,
    loadPreset,
    loadEmotionVariant,
    deletePresetById,
    setPortrait,
    addEmotionVariant,
    deleteEmotionVariant,
  }
}
