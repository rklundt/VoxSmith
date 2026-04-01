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
 * ControlPanel — Main Audio Controls UI (Sprint 2)
 *
 * This is the primary interface for VoxSmith. It provides:
 * - File loading (drag-and-drop or button)
 * - Stage 1 controls (pitch, formant, tempo) with Apply button + stale indicator
 * - Stage 2 controls (EQ, compressor, high-pass) that update in real time
 * - Playback controls (play, pause, stop)
 * - Volume control
 *
 * ARCHITECTURE NOTES:
 * - This component reads state from the Zustand engineStore
 * - All actions flow through hooks (useAudioEngine, useStage1Processing)
 * - No direct AudioEngine or Web Audio API calls happen here
 * - Tooltip text comes from src/shared/tooltips.ts (not hardcoded)
 */

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useEngineStore, computeIsStale } from '../../stores/engineStore'
import { DEFAULT_ENGINE_SNAPSHOT } from '../../../shared/constants'
import { TOOLTIPS } from '../../../shared/tooltips'
import { useAudioEngine } from '../../hooks/useAudioEngine'
import { useStage1Processing } from '../../hooks/useStage1Processing'

export function ControlPanel(): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // File loading error — shown as a friendly popup in the UI
  const [fileError, setFileError] = useState<string | null>(null)

  // ─── Store State ────────────────────────────────────────────────────
  const snapshot = useEngineStore((s) => s.snapshot)
  const isPlaying = useEngineStore((s) => s.isPlaying)
  const hasFile = useEngineStore((s) => s.hasFile)
  const hasProcessed = useEngineStore((s) => s.hasProcessed)
  const volume = useEngineStore((s) => s.volume)
  const stage1Status = useEngineStore((s) => s.stage1Status)
  const stage1Error = useEngineStore((s) => s.stage1Error)
  const appliedStage1Params = useEngineStore((s) => s.appliedStage1Params)
  const updateParam = useEngineStore((s) => s.updateParam)

  // Derive isStale directly from primitive values rather than reading the store's
  // precomputed field. This guarantees reactivity: when the snapshot object changes
  // (which it does on every slider move), this recomputes isStale in the same render.
  // The store's isStale field is still maintained for other consumers.
  const isStale = useMemo(
    () => computeIsStale(snapshot, appliedStage1Params, hasProcessed),
    [snapshot, appliedStage1Params, hasProcessed]
  )

  // ─── Hooks ──────────────────────────────────────────────────────────
  const {
    getEngine,
    loadFile,
    loadProcessedBuffer,
    play,
    pause,
    stop,
    setVolume,
    setHighPassFrequency,
    setCompressorThreshold,
    setCompressorRatio,
  } = useAudioEngine()

  const { applyStage1, cancelStage1 } = useStage1Processing({
    loadProcessedBuffer,
    getEngine,
  })

  // ─── File Loading ───────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileError(null)
    try {
      const arrayBuffer = await file.arrayBuffer()
      await loadFile(arrayBuffer)
      console.debug(`[ControlPanel] Loaded file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)
    } catch (err) {
      const msg = `Could not load "${file.name}". The file may be invalid, corrupt, or in an unsupported format.`
      setFileError(msg)
      console.error('[ControlPanel] Failed to load file:', err)
    }

    // Reset the input so the same file can be re-loaded
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [loadFile])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return

    // Only accept audio files
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(wav|mp3|ogg|flac)$/i)) {
      setFileError(`"${file.name}" is not a supported audio file. Try WAV, MP3, OGG, or FLAC.`)
      return
    }

    setFileError(null)
    try {
      const arrayBuffer = await file.arrayBuffer()
      await loadFile(arrayBuffer)
      console.debug(`[ControlPanel] Loaded dropped file: ${file.name}`)
    } catch (err) {
      const msg = `Could not load "${file.name}". The file may be invalid, corrupt, or in an unsupported format.`
      setFileError(msg)
      console.error('[ControlPanel] Failed to load dropped file:', err)
    }
  }, [loadFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // ─── Stage 1 Parameter Handlers ─────────────────────────────────────
  // These update the store (for UI display) but do NOT process audio yet.
  // The user must click "Apply" to send params to Rubber Band CLI.

  const handlePitchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateParam('pitch', Number(e.target.value))
  }, [updateParam])

  const handleFormantChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateParam('formant', Number(e.target.value))
  }, [updateParam])

  const handleSpeedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateParam('speed', Number(e.target.value))
  }, [updateParam])

  // ─── Stage 2 Parameter Handlers ─────────────────────────────────────
  // These update BOTH the store AND the engine in real time (no Apply needed).

  const handleHighPassChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('highPassFrequency', value)
    setHighPassFrequency(value)
  }, [updateParam, setHighPassFrequency])

  const handleCompThresholdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('compressorThreshold', value)
    setCompressorThreshold(value)
  }, [updateParam, setCompressorThreshold])

  const handleCompRatioChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('compressorRatio', value)
    setCompressorRatio(value)
  }, [updateParam, setCompressorRatio])

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value))
  }, [setVolume])

  // ─── Reset Handlers ─────────────────────────────────────────────────
  // Stage 1 reset: sets pitch/formant/speed back to defaults in the store.
  // The user still needs to click Apply to re-process with the default values
  // (or if all are at default, Apply will clear the processed buffer entirely).

  const resetStage1 = useCallback(() => {
    updateParam('pitch', DEFAULT_ENGINE_SNAPSHOT.pitch)
    updateParam('formant', DEFAULT_ENGINE_SNAPSHOT.formant)
    updateParam('speed', DEFAULT_ENGINE_SNAPSHOT.speed)
  }, [updateParam])

  // Stage 2 reset: sets high-pass/compressor back to defaults and immediately
  // updates the engine nodes (no Apply needed — these are real-time effects).

  const resetStage2 = useCallback(() => {
    updateParam('highPassFrequency', DEFAULT_ENGINE_SNAPSHOT.highPassFrequency)
    updateParam('compressorThreshold', DEFAULT_ENGINE_SNAPSHOT.compressorThreshold)
    updateParam('compressorRatio', DEFAULT_ENGINE_SNAPSHOT.compressorRatio)
    setHighPassFrequency(DEFAULT_ENGINE_SNAPSHOT.highPassFrequency)
    setCompressorThreshold(DEFAULT_ENGINE_SNAPSHOT.compressorThreshold)
    setCompressorRatio(DEFAULT_ENGINE_SNAPSHOT.compressorRatio)
  }, [updateParam, setHighPassFrequency, setCompressorThreshold, setCompressorRatio])

  // ─── Render ─────────────────────────────────────────────────────────

  const isProcessing = stage1Status === 'processing'

  return (
    <div
      style={{
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#e0e0e0',
        backgroundColor: '#1a1a2e',
        minHeight: '100vh',
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', color: '#64b5f6' }}>
        VoxSmith
      </h1>
      <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: '#888' }}>
        Sprint 2 — Core Audio Engine + Stage 1 Pipeline
      </p>

      {/* ─── File Loading ────────────────────────────────────────────── */}
      <section style={{ marginBottom: '24px' }}>
        <div
          style={{
            border: '2px dashed #444',
            borderRadius: '8px',
            padding: '24px',
            textAlign: 'center',
            backgroundColor: '#16213e',
            cursor: 'pointer',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.flac"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {hasFile ? (
            <span style={{ color: '#4caf50' }}>
              File loaded. Drop another file or click to replace.
            </span>
          ) : (
            <span>
              Drop an audio file here, or click to browse.
            </span>
          )}
        </div>

        {/* File loading error — shown as a friendly popup in the UI */}
        {fileError && (
          <div style={{
            background: '#3e0d0d',
            border: '1px solid #c62828',
            borderRadius: '6px',
            padding: '10px 14px',
            marginTop: '12px',
            fontSize: '13px',
            color: '#ef9a9a',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
          }}>
            <span>{fileError}</span>
            <span
              onClick={() => setFileError(null)}
              style={{ cursor: 'pointer', color: '#ef9a9a', fontWeight: 'bold', flexShrink: 0 }}
            >
              ✕
            </span>
          </div>
        )}
      </section>

      {/* ─── Playback Controls ───────────────────────────────────────── */}
      <section style={{ marginBottom: '24px' }}>
        <h2 style={sectionHeaderStyle}>Playback</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={isPlaying ? pause : play}
            disabled={!hasFile}
            style={buttonStyle(hasFile)}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={stop}
            disabled={!hasFile || !isPlaying}
            style={buttonStyle(hasFile && isPlaying)}
          >
            Stop
          </button>

          {/* Volume slider */}
          <label style={{ marginLeft: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px' }}>Volume</span>
            <HelpTooltip detail={TOOLTIPS.volume.detail} pairsWith={TOOLTIPS.volume.pairsWith} />
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={volume}
              onChange={handleVolumeChange}
              style={{ width: '120px' }}
            />
            <span style={{ fontSize: '12px', color: '#888', minWidth: '36px' }}>
              {Math.round(volume * 100)}%
            </span>
          </label>
        </div>
      </section>

      {/* ─── Stage 1: Offline Processing (Pitch / Formant / Tempo) ──── */}
      <section style={{ marginBottom: '24px' }}>
        <h2 style={sectionHeaderStyle}>
          Stage 1 — Pitch / Formant / Speed
          <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#888', marginLeft: '8px' }}>
            (offline — click Apply to process)
          </span>
          <span
            onClick={resetStage1}
            style={resetLinkStyle}
          >
            reset
          </span>
        </h2>

        {/* Stale indicator — visible when dialed params don't match processed audio */}
        {hasFile && isStale && stage1Status !== 'processing' && (
          <div style={{
            background: '#332800',
            border: '1px solid #665200',
            borderRadius: '6px',
            padding: '8px 12px',
            marginBottom: '12px',
            fontSize: '13px',
            color: '#ffd54f',
          }}>
            Preview is outdated — click <strong>Apply</strong> to hear these changes.
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && (
          <div style={{
            background: '#0d293e',
            border: '1px solid #1565c0',
            borderRadius: '6px',
            padding: '8px 12px',
            marginBottom: '12px',
            fontSize: '13px',
            color: '#64b5f6',
          }}>
            Processing audio with Rubber Band CLI...
          </div>
        )}

        {/* Error indicator */}
        {stage1Error && (
          <div style={{
            background: '#3e0d0d',
            border: '1px solid #c62828',
            borderRadius: '6px',
            padding: '8px 12px',
            marginBottom: '12px',
            fontSize: '13px',
            color: '#ef9a9a',
          }}>
            Error: {stage1Error}
          </div>
        )}

        {/* Pitch slider: -24 to +24 semitones.
            Disabled during processing — Stage 1 params require offline processing,
            so changing them mid-flight would be confusing. Re-enabled after completion. */}
        <SliderControl
          label="Pitch"
          value={snapshot.pitch}
          min={-24}
          max={24}
          step={1}
          unit="st"
          tooltipKey="pitch"
          disabled={isProcessing}
          onChange={handlePitchChange}
        />

        {/* Formant slider: DISABLED for Sprint 2.
            The two-pass Rubber Band CLI approach (shift everything → shift pitch back
            with --formant preservation) introduces unacceptable artifacts.
            Re-enabled in a future sprint when we integrate the Rubber Band C++ library
            API directly via Node.js native addon — the API's setFormantScale() method
            provides independent formant shifting in a single pass with no quality loss.
            See docs/phasesAndSprints.md for the re-enablement user story. */}
        <SliderControl
          label="Formant"
          value={snapshot.formant}
          min={-1}
          max={1}
          step={0.01}
          unit="oct"
          tooltipKey="formant"
          disabled={true}
          onChange={handleFormantChange}
        />
        <div style={{ fontSize: '11px', color: '#666', marginTop: '-4px', marginBottom: '8px', marginLeft: '122px' }}>
          Disabled — requires native Rubber Band library integration (future sprint)
        </div>

        {/* Speed/tempo slider: 0.5x to 2.0x */}
        <SliderControl
          label="Speed"
          value={snapshot.speed}
          min={0.5}
          max={2.0}
          step={0.05}
          unit="x"
          tooltipKey="speed"
          disabled={isProcessing}
          onChange={handleSpeedChange}
        />

        {/* Apply / Cancel buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={applyStage1}
            disabled={!hasFile || isProcessing || !isStale}
            style={{
              ...buttonStyle(hasFile && !isProcessing && isStale),
              backgroundColor: hasFile && !isProcessing && isStale ? '#1565c0' : undefined,
              minWidth: '100px',
            }}
          >
            {isProcessing ? 'Processing...' : 'Apply'}
          </button>
          {isProcessing && (
            <button onClick={cancelStage1} style={buttonStyle(true)}>
              Cancel
            </button>
          )}
          {hasProcessed && !isStale && (
            <span style={{ alignSelf: 'center', fontSize: '12px', color: '#4caf50' }}>
              Applied
            </span>
          )}
        </div>
      </section>

      {/* ─── Stage 2: Real-Time Effects ──────────────────────────────── */}
      <section style={{ marginBottom: '24px' }}>
        <h2 style={sectionHeaderStyle}>
          Stage 2 — Real-Time Effects
          <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#888', marginLeft: '8px' }}>
            (updates live)
          </span>
          <span
            onClick={resetStage2}
            style={resetLinkStyle}
          >
            reset
          </span>
        </h2>

        {/* High-Pass Filter */}
        <SliderControl
          label="High-Pass"
          value={snapshot.highPassFrequency}
          min={20}
          max={500}
          step={1}
          unit="Hz"
          tooltipKey="highPass"
          onChange={handleHighPassChange}
        />

        {/* Compressor Threshold */}
        <SliderControl
          label="Comp Threshold"
          value={snapshot.compressorThreshold}
          min={-60}
          max={0}
          step={1}
          unit="dB"
          tooltipKey="compressorThreshold"
          onChange={handleCompThresholdChange}
        />

        {/* Compressor Ratio */}
        <SliderControl
          label="Comp Ratio"
          value={snapshot.compressorRatio}
          min={1}
          max={20}
          step={0.5}
          unit=":1"
          tooltipKey="compressorRatio"
          onChange={handleCompRatioChange}
        />
      </section>

      {/* ─── Debug Info ──────────────────────────────────────────────── */}
      <section style={{ marginTop: '32px', fontSize: '11px', color: '#aaa' }}>
        <details>
          <summary style={{ cursor: 'pointer', color: '#aaa' }}>Debug Info</summary>
          <pre style={{ marginTop: '8px', whiteSpace: 'pre-wrap', fontSize: '10px', color: '#ccc' }}>
{JSON.stringify({
  hasFile,
  hasProcessed,
  isPlaying,
  isStale,
  stage1Status,
  stage1Params: {
    pitch: snapshot.pitch,
    formant: snapshot.formant,
    speed: snapshot.speed,
  },
  stage2Params: {
    highPass: snapshot.highPassFrequency,
    compThreshold: snapshot.compressorThreshold,
    compRatio: snapshot.compressorRatio,
  },
  volume,
}, null, 2)}
          </pre>
        </details>
      </section>
    </div>
  )
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

// ─── Tooltip Component ──────────────────────────────────────────────────────
// Custom tooltip with ~200ms show delay (half of browser default ~400ms),
// max-width constraint to prevent bleeding into other panels, and word wrap.

interface HelpTooltipProps {
  /** The full detail text to show */
  detail: string
  /** "Works well with" pairings */
  pairsWith: string[]
}

/**
 * A small "?" circle that shows a positioned tooltip on hover.
 * Uses React state instead of native title for faster delay and controlled width.
 */
function HelpTooltip({ detail, pairsWith }: HelpTooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    // ~200ms delay — half the default browser title delay (~400ms)
    timerRef.current = setTimeout(() => setVisible(true), 200)
  }

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }

  return (
    <span
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
    >
      {/* The "?" circle */}
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        border: '1px solid #555',
        fontSize: '9px',
        color: '#777',
        cursor: 'help',
      }}>
        ?
      </span>

      {/* Tooltip popup — positioned below the "?" icon, anchored left
          so it flows into the slider area and never overlaps the panel border */}
      {visible && (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '0px',
          backgroundColor: '#1e2a3a',
          border: '1px solid #3a4a5a',
          borderRadius: '6px',
          padding: '10px 12px',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#d0d0d0',
          // Constrain width so it stays within the panel area
          width: '280px',
          maxWidth: 'calc(100vw - 80px)',
          whiteSpace: 'normal',
          wordWrap: 'break-word',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }}>
          <div style={{ marginBottom: '6px' }}>{detail}</div>
          <div style={{ fontSize: '11px', color: '#8a9aaa' }}>
            Works well with: {pairsWith.join(', ')}
          </div>
        </div>
      )}
    </span>
  )
}

// ─── Slider Component ───────────────────────────────────────────────────────

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  /** Key into TOOLTIPS object — if provided, shows tooltip on hover */
  tooltipKey?: string
  /** Whether the slider is disabled (e.g., during Stage 1 processing) */
  disabled?: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * A labeled slider with current value display and optional tooltip.
 *
 * Tooltip behavior:
 * - Hovering over the "?" icon shows detail text + pairings in a custom popup (~200ms delay)
 * - Tooltip content is pulled from src/shared/tooltips.ts (single source of truth)
 *
 * Simple inline component — will be replaced by a proper Knob/Slider control
 * component in Sprint 3 when the design system is built.
 */
function SliderControl({ label, value, min, max, step, unit, tooltipKey, disabled, onChange }: SliderControlProps): React.ReactElement {
  // Format the display value based on the unit type
  const displayValue = unit === 'x' ? value.toFixed(2) :
    unit === 'oct' ? value.toFixed(2) :
    String(Math.round(value))

  // Look up tooltip content if a key was provided
  const tooltip = tooltipKey ? TOOLTIPS[tooltipKey] : undefined

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
      <label style={{ fontSize: '13px', minWidth: '110px', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
        {label}
        {tooltip && (
          <HelpTooltip detail={tooltip.detail} pairsWith={tooltip.pairsWith} />
        )}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={onChange}
        style={{ flex: 1, maxWidth: '300px', opacity: disabled ? 0.4 : 1 }}
      />
      <span style={{ fontSize: '12px', color: '#aaa', minWidth: '60px' }}>
        {displayValue} {unit}
      </span>
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  margin: '0 0 12px 0',
  color: '#b0bec5',
  borderBottom: '1px solid #333',
  paddingBottom: '6px',
}

const resetLinkStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 'normal',
  color: '#607d8b',
  marginLeft: '12px',
  cursor: 'pointer',
  textDecoration: 'underline',
  userSelect: 'none',
}

function buttonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '6px 16px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: enabled ? '#2a3a5e' : '#1a1a2e',
    color: enabled ? '#e0e0e0' : '#555',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: '13px',
    fontWeight: 500,
  }
}
