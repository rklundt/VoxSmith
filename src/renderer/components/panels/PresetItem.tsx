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
 * PresetItem — Single preset list entry (A1: extracted from PresetPanel)
 *
 * Renders one preset row with its portrait, name, A/B badges, and expand arrow.
 * When expanded, shows action buttons, edit form, emotion variants, and timestamps.
 *
 * Wrapped in React.memo for performance — only re-renders when this specific
 * preset's data or relevant UI state (expanded/editing/confirming) changes.
 * The parent PresetPanel passes derived booleans (isExpanded, isEditing, etc.)
 * so memo's shallow comparison works correctly.
 */

import React from 'react'
import { TOOLTIPS } from '../../../shared/tooltips'
import type { Preset } from '../../../shared/types'

// ─── Props ────────────────────────────────────────────────────────────────

export interface PresetItemProps {
  preset: Preset
  /** Whether this preset is currently loaded in the engine */
  isActive: boolean
  /** Whether this preset's detail area is expanded */
  isExpanded: boolean
  /** Whether this preset is in inline-edit mode */
  isEditing: boolean
  /** Whether this preset is showing the delete confirmation */
  isConfirmingDelete: boolean
  /** Whether A/B mode is enabled and this preset is in slot A */
  isInSlotA: boolean
  /** Whether A/B mode is enabled and this preset is in slot B */
  isInSlotB: boolean
  /** Whether A/B comparison mode is active (changes click behavior) */
  abEnabled: boolean
  /** Whether the "Saved!" flash is showing for this preset */
  isFlashing: boolean
  /** Whether this preset's emotion-add form is open */
  isAddingEmotion: boolean

  // Edit form state — only relevant when isEditing is true
  editName: string
  editCategory: string
  editNotes: string
  editError: string | null

  // Emotion form state — only relevant when isAddingEmotion is true
  emotionName: string

  // Callbacks — all should be stable (useCallback in parent)
  onLoad: (presetId: string) => void
  onABClick: (presetId: string) => void
  onToggleExpand: (presetId: string) => void
  onStartEdit: (preset: Preset) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onSetPortrait: (presetId: string) => Promise<string | null>
  onOverwrite: () => Promise<Preset | null>
  onDelete: (presetId: string) => Promise<void>
  onConfirmDelete: (presetId: string) => void
  onCancelDelete: () => void
  onShowFlash: (presetId: string) => void
  onSetEditName: (value: string) => void
  onSetEditCategory: (value: string) => void
  onSetEditNotes: (value: string) => void
  onLoadEmotion: (presetId: string, variantId: string) => void
  onDeleteEmotion: (presetId: string, variantId: string) => Promise<void>
  onStartAddEmotion: (presetId: string) => void
  onCancelAddEmotion: () => void
  onSetEmotionName: (value: string) => void
  onAddEmotion: () => void
}

// ─── Component ────────────────────────────────────────────────────────────

function PresetItemInner({
  preset,
  isActive,
  isExpanded,
  isEditing,
  isConfirmingDelete,
  isInSlotA,
  isInSlotB,
  abEnabled,
  isFlashing,
  isAddingEmotion,
  editName,
  editCategory,
  editNotes,
  editError,
  emotionName,
  onLoad,
  onABClick,
  onToggleExpand,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onSetPortrait,
  onOverwrite,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onShowFlash,
  onSetEditName,
  onSetEditCategory,
  onSetEditNotes,
  onLoadEmotion,
  onDeleteEmotion,
  onStartAddEmotion,
  onCancelAddEmotion,
  onSetEmotionName,
  onAddEmotion,
}: PresetItemProps): React.ReactElement {
  // Portrait URI is attached as a transient field by the IPC handler
  const portraitUri = (preset as Preset & { portraitUri?: string }).portraitUri

  return (
    <div
      style={{
        padding: '6px 8px',
        marginBottom: '2px',
        borderRadius: '4px',
        backgroundColor: isActive ? '#2a4a6b' : 'transparent',
        border: isActive ? '1px solid #4a8abf' : '1px solid transparent',
        cursor: 'pointer',
      }}
    >
      {/* ── Preset Header Row ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Portrait thumbnail */}
        {portraitUri ? (
          <img
            src={portraitUri}
            alt={preset.name}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '4px',
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '4px',
              backgroundColor: '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              color: '#666',
              flexShrink: 0,
            }}
          >
            ?
          </div>
        )}

        {/* Preset name - click to load (X2: button for keyboard accessibility) */}
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => onSetEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            style={{
              flex: 1,
              background: '#1a1a2e',
              border: '1px solid #4a8abf',
              color: '#e0e0e0',
              padding: '2px 4px',
              borderRadius: '2px',
              fontSize: '13px',
            }}
            autoFocus
          />
        ) : (
          <button
            onClick={() => abEnabled ? onABClick(preset.id) : onLoad(preset.id)}
            title={TOOLTIPS.characterPreset.short}
            style={{
              flex: 1,
              fontSize: '13px',
              color: isActive ? '#fff' : '#ccc',
              fontWeight: isActive ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              padding: 0,
            }}
          >
            {preset.name}
          </button>
        )}

        {/* A/B slot badge - shows which slot this preset is loaded into */}
        {isInSlotA && (
          <span style={{
            fontSize: '9px',
            fontWeight: 700,
            color: '#8c8',
            backgroundColor: '#1a3a1a',
            border: '1px solid #4a8a4a',
            borderRadius: '3px',
            padding: '0 3px',
            flexShrink: 0,
          }} aria-label="A/B slot A">A</span>
        )}
        {isInSlotB && (
          <span style={{
            fontSize: '9px',
            fontWeight: 700,
            color: '#c88',
            backgroundColor: '#3a1a1a',
            border: '1px solid #8a4a4a',
            borderRadius: '3px',
            padding: '0 3px',
            flexShrink: 0,
          }} aria-label="A/B slot B">B</span>
        )}

        {/* Expand/collapse button */}
        <button
          onClick={() => onToggleExpand(preset.id)}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '10px',
            padding: '2px',
          }}
          title={isExpanded ? 'Hide details' : 'Show details'}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${preset.name}`}
        >
          {isExpanded ? '\u25B2' : '\u25BC'}
        </button>
      </div>

      {/* ── Expanded Detail Area ──────────────────────────────── */}
      {isExpanded && (
        <div style={{ marginTop: '8px', paddingLeft: '34px', fontSize: '12px' }}>
          {/* Action buttons row */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
            {!isEditing && (
              <>
                <button
                  onClick={() => onStartEdit(preset)}
                  style={smallButtonStyle}
                >
                  Rename
                </button>
                <button
                  onClick={() => onSetPortrait(preset.id)}
                  style={smallButtonStyle}
                  title="Set character portrait image"
                >
                  Portrait
                </button>
                {isActive && (
                  <button
                    onClick={async () => {
                      const result = await onOverwrite()
                      if (result) onShowFlash(preset.id)
                    }}
                    style={smallButtonStyle}
                    title="Overwrite this preset with current settings"
                  >
                    Update
                  </button>
                )}
                {!isConfirmingDelete ? (
                  <button
                    onClick={() => onConfirmDelete(preset.id)}
                    style={{ ...smallButtonStyle, color: '#f55' }}
                  >
                    Delete
                  </button>
                ) : (
                  <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }} role="group" aria-label="Confirm delete">
                    <span style={{ color: '#f55' }}>Sure?</span>
                    <button
                      onClick={() => onDelete(preset.id)}
                      style={{ ...smallButtonStyle, color: '#f55', fontWeight: 600 }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={onCancelDelete}
                      style={smallButtonStyle}
                    >
                      No
                    </button>
                  </span>
                )}
              </>
            )}
            {isEditing && (
              <>
                <button onClick={onSaveEdit} style={smallButtonStyle}>Save</button>
                <button onClick={onCancelEdit} style={smallButtonStyle}>Cancel</button>
              </>
            )}
          </div>

          {/* Flash confirmation after successful update */}
          {isFlashing && (
            <div style={{ color: '#5c5', fontSize: '11px', marginBottom: '4px' }} role="status">Saved!</div>
          )}

          {/* Edit error message */}
          {isEditing && editError && (
            <div style={{ color: '#f55', fontSize: '11px', marginBottom: '4px' }} role="alert">{editError}</div>
          )}

          {/* Edit form for category and notes */}
          {isEditing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              <label style={{ color: '#888', fontSize: '11px' }}>Category</label>
              <input
                type="text"
                value={editCategory}
                onChange={(e) => onSetEditCategory(e.target.value)}
                placeholder="e.g. Heroes, Villains"
                style={inputStyle}
              />
              <label style={{ color: '#888', fontSize: '11px' }}>Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => onSetEditNotes(e.target.value)}
                placeholder="Performance notes..."
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          )}

          {/* Notes display (when not editing) */}
          {!isEditing && preset.notes && (
            <div style={{ color: '#999', marginBottom: '6px', fontStyle: 'italic' }}>
              {preset.notes}
            </div>
          )}

          {/* Emotion sub-presets */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}
                 title={TOOLTIPS.emotionSubPreset.short}>
              Emotions
            </div>
            {preset.emotionVariants.length === 0 && (
              <div style={{ color: '#555', fontSize: '11px' }}>No emotion variants yet</div>
            )}
            {preset.emotionVariants.map((variant) => (
              <div
                key={variant.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginBottom: '2px',
                }}
              >
                {/* X2: Button for keyboard accessibility (was <span>) */}
                <button
                  onClick={() => onLoadEmotion(preset.id, variant.id)}
                  style={{
                    color: '#aad',
                    cursor: 'pointer',
                    fontSize: '12px',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    textAlign: 'left',
                  }}
                  title={`Load "${variant.emotion}" variant`}
                >
                  {variant.emotion}
                </button>
                <button
                  onClick={() => onDeleteEmotion(preset.id, variant.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#666',
                    cursor: 'pointer',
                    fontSize: '10px',
                    padding: '0 2px',
                  }}
                  title="Delete emotion variant"
                  aria-label={`Delete ${variant.emotion} emotion`}
                >
                  x
                </button>
              </div>
            ))}

            {/* Add emotion form */}
            {isAddingEmotion ? (
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <input
                  type="text"
                  value={emotionName}
                  onChange={(e) => onSetEmotionName(e.target.value)}
                  placeholder="e.g. angry, whisper"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onAddEmotion()
                    if (e.key === 'Escape') onCancelAddEmotion()
                  }}
                  style={{ ...inputStyle, flex: 1, fontSize: '11px', padding: '2px 4px' }}
                  autoFocus
                />
                <button onClick={onAddEmotion} style={smallButtonStyle}>Add</button>
                <button onClick={onCancelAddEmotion} style={smallButtonStyle}>Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => onStartAddEmotion(preset.id)}
                style={{ ...smallButtonStyle, marginTop: '4px', fontSize: '11px' }}
                title={TOOLTIPS.emotionSubPreset.detail}
              >
                + Emotion
              </button>
            )}
          </div>

          {/* Timestamps */}
          <div style={{ color: '#555', fontSize: '10px' }}>
            Created: {new Date(preset.createdAt).toLocaleDateString()}
            {' | '}
            Updated: {new Date(preset.updatedAt).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Memoized Export ──────────────────────────────────────────────────────

/**
 * Memoized PresetItem — only re-renders when props change.
 *
 * Key optimization: the parent passes derived booleans (isExpanded, isEditing, etc.)
 * instead of raw IDs. This means a preset that isn't expanded/editing/etc. won't
 * re-render when another preset becomes expanded/edited, because its boolean props
 * stay false → false (no change).
 */
export const PresetItem = React.memo(PresetItemInner)

// ─── Shared Styles ────────────────────────────────────────────────────────

/** Compact button style for preset action buttons (Rename, Portrait, Delete, etc.) */
const smallButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #444',
  color: '#bbb',
  padding: '2px 8px',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '11px',
}

/** Input field style for edit forms */
const inputStyle: React.CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid #444',
  color: '#e0e0e0',
  padding: '4px 6px',
  borderRadius: '3px',
  fontSize: '12px',
}
