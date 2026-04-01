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

import React, { useCallback, useRef } from 'react'
import { useEngineStore } from '../../stores/engineStore'
import { useAudioEngine } from '../../hooks/useAudioEngine'
import { useStage1Processing } from '../../hooks/useStage1Processing'

export function ControlPanel(): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Store State ────────────────────────────────────────────────────
  const snapshot = useEngineStore((s) => s.snapshot)
  const isPlaying = useEngineStore((s) => s.isPlaying)
  const hasFile = useEngineStore((s) => s.hasFile)
  const hasProcessed = useEngineStore((s) => s.hasProcessed)
  const volume = useEngineStore((s) => s.volume)
  const stage1Status = useEngineStore((s) => s.stage1Status)
  const stage1Error = useEngineStore((s) => s.stage1Error)
  const isStale = useEngineStore((s) => s.isStale)
  const updateParam = useEngineStore((s) => s.updateParam)

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

    try {
      const arrayBuffer = await file.arrayBuffer()
      await loadFile(arrayBuffer)
      console.debug(`[ControlPanel] Loaded file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)
    } catch (err) {
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
      console.warn('[ControlPanel] Dropped file is not an audio file:', file.type)
      return
    }

    try {
      const arrayBuffer = await file.arrayBuffer()
      await loadFile(arrayBuffer)
      console.debug(`[ControlPanel] Loaded dropped file: ${file.name}`)
    } catch (err) {
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

        {/* Pitch slider: -24 to +24 semitones */}
        <SliderControl
          label="Pitch"
          value={snapshot.pitch}
          min={-24}
          max={24}
          step={1}
          unit="st"
          onChange={handlePitchChange}
        />

        {/* Formant slider: -2.0 to +2.0 octaves */}
        <SliderControl
          label="Formant"
          value={snapshot.formant}
          min={-2}
          max={2}
          step={0.1}
          unit="oct"
          onChange={handleFormantChange}
        />

        {/* Speed/tempo slider: 0.5x to 2.0x */}
        <SliderControl
          label="Speed"
          value={snapshot.speed}
          min={0.5}
          max={2.0}
          step={0.05}
          unit="x"
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
        </h2>

        {/* High-Pass Filter */}
        <SliderControl
          label="High-Pass"
          value={snapshot.highPassFrequency}
          min={20}
          max={500}
          step={1}
          unit="Hz"
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
          onChange={handleCompRatioChange}
        />
      </section>

      {/* ─── Debug Info ──────────────────────────────────────────────── */}
      <section style={{ marginTop: '32px', fontSize: '11px', color: '#555' }}>
        <details>
          <summary style={{ cursor: 'pointer' }}>Debug Info</summary>
          <pre style={{ marginTop: '8px', whiteSpace: 'pre-wrap', fontSize: '10px' }}>
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

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * A labeled slider with current value display.
 * Simple inline component — will be replaced by a proper Knob/Slider control
 * component in Sprint 3 when the design system is built.
 */
function SliderControl({ label, value, min, max, step, unit, onChange }: SliderControlProps): React.ReactElement {
  // Format the display value based on the unit type
  const displayValue = unit === 'x' ? value.toFixed(2) :
    unit === 'oct' ? value.toFixed(1) :
    String(Math.round(value))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
      <label style={{ fontSize: '13px', minWidth: '110px', textAlign: 'right' }}>
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        style={{ flex: 1, maxWidth: '300px' }}
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
