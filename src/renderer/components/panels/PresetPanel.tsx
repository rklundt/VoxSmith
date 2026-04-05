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
 * PresetPanel - Character Preset Library UI (Sprint 5)
 *
 * Left sidebar panel that displays the full preset library organized by categories.
 * Provides all preset management features:
 *
 * - Save current settings as a new named character preset
 * - Load a preset (applies its engine snapshot to the audio engine)
 * - Rename a preset
 * - Delete a preset (including its portrait file)
 * - Organize presets into collapsible category folders
 * - Add/view portrait images for visual identification
 * - Add/edit performance notes
 * - Create emotion sub-presets (angry, whisper, sad, etc.)
 * - A/B comparison toggle between two presets
 *
 * ARCHITECTURE:
 * This component handles display and user interaction ONLY.
 * All data operations flow through the usePresets hook, which
 * handles IPC calls and store updates. No direct IPC here.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { usePresetStore, type ABSlot } from '../../stores/presetStore'
import { TOOLTIPS } from '../../../shared/tooltips'
import type { Preset, EngineSnapshot } from '../../../shared/types'
import { PresetItem } from './PresetItem'

// ─── Props ────────────────────────────────────────────────────────────────

interface PresetPanelProps {
  /** Save current engine settings as a new preset */
  onSaveNew: (name: string, category: string, notes: string) => Promise<Preset | null>
  /** Load a preset's snapshot into the engine */
  onLoad: (presetId: string) => void
  /** Update a preset's metadata or snapshot */
  onUpdate: (presetId: string, updates: {
    name?: string
    category?: string
    notes?: string
    engineSnapshot?: EngineSnapshot
  }) => Promise<Preset | null>
  /** Overwrite the active preset with current engine settings */
  onOverwrite: () => Promise<Preset | null>
  /** Delete a preset by ID */
  onDelete: (presetId: string) => Promise<void>
  /** Open portrait dialog and save for a preset */
  onSetPortrait: (presetId: string) => Promise<string | null>
  /** Add an emotion variant to a preset */
  onAddEmotion: (presetId: string, emotionName: string) => Promise<unknown>
  /** Delete an emotion variant */
  onDeleteEmotion: (presetId: string, variantId: string) => Promise<void>
  /** Load an emotion variant's snapshot */
  onLoadEmotion: (presetId: string, variantId: string) => void
  /** Apply a snapshot to the engine (for A/B switching) */
  applySnapshot: (snapshot: EngineSnapshot) => void
  /** Close the preset panel */
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────

export function PresetPanel(props: PresetPanelProps): React.ReactElement {
  const {
    onSaveNew,
    onLoad,
    onUpdate,
    onOverwrite,
    onDelete,
    onSetPortrait,
    onAddEmotion,
    onDeleteEmotion,
    onLoadEmotion,
    applySnapshot,
    onClose,
  } = props

  // ─── Store State ────────────────────────────────────────────────────

  const presets = usePresetStore((s) => s.presets)
  const activePresetId = usePresetStore((s) => s.activePresetId)
  const collapsedCategories = usePresetStore((s) => s.collapsedCategories)
  const toggleCategory = usePresetStore((s) => s.toggleCategory)
  const getCategories = usePresetStore((s) => s.getCategories)
  const getPresetsByCategory = usePresetStore((s) => s.getPresetsByCategory)
  const getUncategorizedPresets = usePresetStore((s) => s.getUncategorizedPresets)

  // A/B state
  const abEnabled = usePresetStore((s) => s.abEnabled)
  const abSlotA = usePresetStore((s) => s.abSlotA)
  const abSlotB = usePresetStore((s) => s.abSlotB)
  const abActiveSlot = usePresetStore((s) => s.abActiveSlot)
  const enableAB = usePresetStore((s) => s.enableAB)
  const disableAB = usePresetStore((s) => s.disableAB)
  const setABSlot = usePresetStore((s) => s.setABSlot)
  const toggleABSlot = usePresetStore((s) => s.toggleABSlot)
  const setActivePresetId = usePresetStore((s) => s.setActivePresetId)

  // ─── Local UI State ─────────────────────────────────────────────────

  // "Save New" form
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCategory, setSaveCategory] = useState('')
  const [saveNotes, setSaveNotes] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Editing state (inline rename, notes edit)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editNotes, setEditNotes] = useState('')

  // Expanded preset detail (shows notes, emotions, portrait)
  const [expandedPresetId, setExpandedPresetId] = useState<string | null>(null)

  // New emotion variant form
  const [emotionPresetId, setEmotionPresetId] = useState<string | null>(null)
  const [emotionName, setEmotionName] = useState('')

  // Edit error (shown inline when rename/update fails validation)
  const [editError, setEditError] = useState<string | null>(null)

  // Flash confirmation (brief "Saved!" message after successful update)
  const [flashPresetId, setFlashPresetId] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Show a brief confirmation flash on a preset, auto-clears after 2 seconds */
  const showFlash = useCallback((presetId: string) => {
    // Clear any existing timer so rapid updates don't leave stale flashes
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setFlashPresetId(presetId)
    flashTimerRef.current = setTimeout(() => setFlashPresetId(null), 2000)
  }, [])

  // Clean up timer on unmount
  useEffect(() => {
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current) }
  }, [])

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // ─── Handlers ───────────────────────────────────────────────────────

  const handleSaveNew = useCallback(async () => {
    setSaveError(null)
    const result = await onSaveNew(saveName, saveCategory, saveNotes)
    if (result) {
      // Success - reset form
      setShowSaveForm(false)
      setSaveName('')
      setSaveCategory('')
      setSaveNotes('')
    } else {
      setSaveError('Failed to save preset. Check the name is not empty or duplicate.')
    }
  }, [saveName, saveCategory, saveNotes, onSaveNew])

  const handleStartEdit = useCallback((preset: Preset) => {
    setEditingPresetId(preset.id)
    setEditName(preset.name)
    setEditCategory(preset.category)
    setEditNotes(preset.notes ?? '')
    setEditError(null)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingPresetId) return
    setEditError(null)
    const result = await onUpdate(editingPresetId, {
      name: editName,
      category: editCategory,
      notes: editNotes,
    })
    if (result) {
      // Success - exit edit mode
      setEditingPresetId(null)
      setEditError(null)
    } else {
      // Validation failed (empty name, duplicate, etc.) - stay in edit mode
      setEditError('Name is empty or already taken by another preset.')
    }
  }, [editingPresetId, editName, editCategory, editNotes, onUpdate])

  const handleCancelEdit = useCallback(() => {
    setEditingPresetId(null)
    setEditError(null)
  }, [])

  const handleDelete = useCallback(async (presetId: string) => {
    await onDelete(presetId)
    setConfirmDeleteId(null)
    if (expandedPresetId === presetId) {
      setExpandedPresetId(null)
    }
  }, [onDelete, expandedPresetId])

  const handleToggleExpand = useCallback((presetId: string) => {
    setExpandedPresetId((prev) => prev === presetId ? null : presetId)
  }, [])

  const handleAddEmotion = useCallback(async () => {
    if (!emotionPresetId || !emotionName.trim()) return
    await onAddEmotion(emotionPresetId, emotionName)
    setEmotionName('')
    setEmotionPresetId(null)
  }, [emotionPresetId, emotionName, onAddEmotion])

  // A/B toggle handler - swap active slot and apply the new slot's snapshot
  const handleABToggle = useCallback(() => {
    const nextPresetId = toggleABSlot()
    if (nextPresetId) {
      const preset = presets.find((p) => p.id === nextPresetId)
      if (preset) {
        applySnapshot(preset.engineSnapshot)
      }
    }
  }, [toggleABSlot, presets, applySnapshot])

  /**
   * Loads a preset into a specific A/B slot and applies it if that slot is active.
   * This is used by the slot buttons in the A/B panel and by the smart-click logic.
   */
  const handleLoadIntoSlot = useCallback((slot: ABSlot, presetId: string) => {
    setABSlot(slot, presetId)
    // If loading into the currently active slot, apply its snapshot immediately
    // so the user hears the change right away
    if (slot === abActiveSlot) {
      const preset = presets.find((p) => p.id === presetId)
      if (preset) {
        applySnapshot(preset.engineSnapshot)
        setActivePresetId(presetId)
      }
    }
  }, [setABSlot, abActiveSlot, presets, applySnapshot, setActivePresetId])

  /**
   * Smart preset click when A/B is enabled.
   * - If slot A is empty, load there
   * - If slot A is full but B is empty, load into B
   * - If both are full, replace the currently active slot
   * After loading, apply the snapshot if the loaded slot is active.
   */
  const handleABPresetClick = useCallback((presetId: string) => {
    if (!abSlotA) {
      // A is empty - fill it first
      handleLoadIntoSlot('A', presetId)
    } else if (!abSlotB) {
      // A is full, B is empty - fill B
      handleLoadIntoSlot('B', presetId)
    } else {
      // Both full - replace whichever slot is currently active
      handleLoadIntoSlot(abActiveSlot, presetId)
    }
  }, [abSlotA, abSlotB, abActiveSlot, handleLoadIntoSlot])

  // ─── Render Helpers ─────────────────────────────────────────────────

  /**
   * A1: Renders a PresetItem component for a single preset.
   * The extracted PresetItem is wrapped in React.memo — only re-renders
   * when this specific preset's data or UI state changes.
   */
  const renderPresetItem = (preset: Preset) => (
    <PresetItem
      key={preset.id}
      preset={preset}
      isActive={preset.id === activePresetId}
      isExpanded={preset.id === expandedPresetId}
      isEditing={preset.id === editingPresetId}
      isConfirmingDelete={preset.id === confirmDeleteId}
      isInSlotA={abEnabled && preset.id === abSlotA}
      isInSlotB={abEnabled && preset.id === abSlotB}
      abEnabled={abEnabled}
      isFlashing={preset.id === flashPresetId}
      isAddingEmotion={emotionPresetId === preset.id}
      editName={editName}
      editCategory={editCategory}
      editNotes={editNotes}
      editError={editError}
      emotionName={emotionName}
      onLoad={onLoad}
      onABClick={handleABPresetClick}
      onToggleExpand={handleToggleExpand}
      onStartEdit={handleStartEdit}
      onSaveEdit={handleSaveEdit}
      onCancelEdit={handleCancelEdit}
      onSetPortrait={onSetPortrait}
      onOverwrite={onOverwrite}
      onDelete={handleDelete}
      onConfirmDelete={setConfirmDeleteId}
      onCancelDelete={() => setConfirmDeleteId(null)}
      onShowFlash={showFlash}
      onSetEditName={setEditName}
      onSetEditCategory={setEditCategory}
      onSetEditNotes={setEditNotes}
      onLoadEmotion={onLoadEmotion}
      onDeleteEmotion={onDeleteEmotion}
      onStartAddEmotion={setEmotionPresetId}
      onCancelAddEmotion={() => { setEmotionPresetId(null); setEmotionName('') }}
      onSetEmotionName={setEmotionName}
      onAddEmotion={handleAddEmotion}
    />
  )

  // ─── Main Render ────────────────────────────────────────────────────

  const categories = getCategories()
  const uncategorized = getUncategorizedPresets()

  return (
    <div
      style={{
        width: '240px',
        minWidth: '200px',
        maxWidth: '300px',
        backgroundColor: '#0d0d1a',
        borderRight: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#ddd' }}
                title={TOOLTIPS.characterPreset.short}>
            Presets
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#666' }}>
              {presets.length}
            </span>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0 2px',
                lineHeight: 1,
              }}
              title="Hide Presets"
            >
              &#x2715;
            </button>
          </div>
        </div>

        {/* Save New button */}
        {!showSaveForm && (
          <button
            onClick={() => setShowSaveForm(true)}
            style={{
              background: '#2a4a6b',
              border: '1px solid #4a8abf',
              color: '#ccc',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              width: '100%',
            }}
            title={TOOLTIPS.characterPreset.detail}
          >
            + Save Current as Preset
          </button>
        )}

        {/* Save New form */}
        {showSaveForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Character name"
              style={inputStyle}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNew()
                if (e.key === 'Escape') setShowSaveForm(false)
              }}
            />
            <input
              type="text"
              value={saveCategory}
              onChange={(e) => setSaveCategory(e.target.value)}
              placeholder="Category (optional)"
              style={inputStyle}
            />
            <textarea
              value={saveNotes}
              onChange={(e) => setSaveNotes(e.target.value)}
              placeholder="Performance notes (optional)"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            {saveError && (
              <div style={{ color: '#f55', fontSize: '11px' }}>{saveError}</div>
            )}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={handleSaveNew} style={{ ...smallButtonStyle, flex: 1 }}>Save</button>
              <button onClick={() => { setShowSaveForm(false); setSaveError(null) }} style={{ ...smallButtonStyle, flex: 1 }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── A/B Toggle ────────────────────────────────────────── */}
        {!abEnabled ? (
          /* Collapsed state: simple enable button */
          <button
            onClick={enableAB}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#888',
              padding: '3px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              width: '100%',
            }}
            title={TOOLTIPS.abToggle.detail}
          >
            A/B Toggle
          </button>
        ) : (
          /* Expanded state: two clear slots with toggle */
          <div style={{
            border: '1px solid #4a8abf',
            borderRadius: '6px',
            padding: '6px',
            backgroundColor: '#111122',
          }}>
            <div style={{
              fontSize: '11px',
              color: '#8ab',
              marginBottom: '6px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span title={TOOLTIPS.abToggle.detail}>A/B Toggle</span>
              <button
                onClick={disableAB}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '0 2px',
                }}
                title="Exit A/B mode (keeps the active slot)"
              >
                Exit
              </button>
            </div>

            {/* Slot A */}
            <div
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                marginBottom: '4px',
                backgroundColor: abActiveSlot === 'A' ? '#1a3a1a' : '#1a1a2e',
                border: abActiveSlot === 'A' ? '1px solid #4a8a4a' : '1px solid #333',
                cursor: 'pointer',
              }}
              onClick={() => {
                // Clicking slot A makes it active and applies its snapshot
                if (abSlotA && abActiveSlot !== 'A') {
                  handleABToggle()
                }
              }}
            >
              <div style={{ fontSize: '10px', color: abActiveSlot === 'A' ? '#8c8' : '#666', fontWeight: 600 }}>
                A {abActiveSlot === 'A' ? '(active)' : ''}
              </div>
              <div style={{
                fontSize: '12px',
                color: abSlotA ? '#ccc' : '#555',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {presets.find((p) => p.id === abSlotA)?.name ?? 'Click a preset to load'}
              </div>
            </div>

            {/* Slot B */}
            <div
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                marginBottom: '6px',
                backgroundColor: abActiveSlot === 'B' ? '#3a1a1a' : '#1a1a2e',
                border: abActiveSlot === 'B' ? '1px solid #8a4a4a' : '1px solid #333',
                cursor: 'pointer',
              }}
              onClick={() => {
                // Clicking slot B makes it active and applies its snapshot
                if (abSlotB && abActiveSlot !== 'B') {
                  handleABToggle()
                }
              }}
            >
              <div style={{ fontSize: '10px', color: abActiveSlot === 'B' ? '#c88' : '#666', fontWeight: 600 }}>
                B {abActiveSlot === 'B' ? '(active)' : ''}
              </div>
              <div style={{
                fontSize: '12px',
                color: abSlotB ? '#ccc' : '#555',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {presets.find((p) => p.id === abSlotB)?.name ?? 'Click a preset to load'}
              </div>
            </div>

            {/* Toggle button - only active when both slots are filled */}
            <button
              onClick={handleABToggle}
              disabled={!abSlotA || !abSlotB}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '4px',
                border: '1px solid #555',
                backgroundColor: (!abSlotA || !abSlotB) ? '#1a1a2e' : '#2a3a5a',
                color: (!abSlotA || !abSlotB) ? '#444' : '#ddd',
                cursor: (!abSlotA || !abSlotB) ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
              title={!abSlotA || !abSlotB
                ? 'Load a preset into both slots first'
                : 'Toggle between A and B'}
            >
              Toggle A/B
            </button>

            {/* Instruction text when slots are empty */}
            {(!abSlotA || !abSlotB) && (
              <div style={{ fontSize: '10px', color: '#555', marginTop: '4px', textAlign: 'center' }}>
                {!abSlotA
                  ? 'Click a preset below to load into A'
                  : 'Click another preset to load into B'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable Preset List ────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '4px',
      }}>
        {presets.length === 0 && (
          <div style={{
            color: '#555',
            fontSize: '12px',
            textAlign: 'center',
            padding: '20px 10px',
          }}>
            No presets yet. Dial in a character voice and click "Save Current as Preset" above.
          </div>
        )}

        {/* Categorized presets */}
        {categories.map((category) => {
          const categoryPresets = getPresetsByCategory(category)
          const isCollapsed = collapsedCategories.has(category)

          return (
            <div key={category} style={{ marginBottom: '4px' }}>
              {/* Category header - click to collapse/expand */}
              <div
                onClick={() => toggleCategory(category)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 6px',
                  cursor: 'pointer',
                  color: '#aaa',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: '8px' }}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                {category}
                <span style={{ color: '#555', fontWeight: 400 }}>({categoryPresets.length})</span>
              </div>

              {/* Category presets (hidden when collapsed) */}
              {!isCollapsed && categoryPresets.map(renderPresetItem)}
            </div>
          )
        })}

        {/* Uncategorized presets */}
        {uncategorized.length > 0 && (
          <div style={{ marginBottom: '4px' }}>
            {categories.length > 0 && (
              <div style={{
                padding: '4px 6px',
                color: '#777',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Uncategorized ({uncategorized.length})
              </div>
            )}
            {uncategorized.map(renderPresetItem)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Shared Inline Styles ─────────────────────────────────────────────────

const smallButtonStyle: React.CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid #444',
  color: '#aaa',
  padding: '2px 6px',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '11px',
}

const inputStyle: React.CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid #444',
  color: '#e0e0e0',
  padding: '4px 6px',
  borderRadius: '3px',
  fontSize: '12px',
  width: '100%',
  boxSizing: 'border-box',
}
