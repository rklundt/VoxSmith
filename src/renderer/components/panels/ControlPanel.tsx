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
 * ControlPanel - Main Audio Controls UI (Sprint 3)
 *
 * This is the primary interface for VoxSmith. It provides:
 * - File loading (drag-and-drop or button)
 * - Stage 1 controls (pitch, formant, tempo) with Apply button + stale indicator
 * - Stage 2 controls split into Basic and Advanced modes:
 *     Basic:  reverb (amount + room size), vibrato, tremolo, vocal fry, breathiness
 *     Advanced: EQ bands, compressor, high-pass, wet/dry per effect
 * - Playback controls (play, pause, stop) with volume
 * - Bypass toggle for instant A/B comparison
 *
 * ARCHITECTURE NOTES:
 * - This component reads state from the Zustand engineStore
 * - All actions flow through hooks (useAudioEngine, useStage1Processing)
 * - No direct AudioEngine or Web Audio API calls happen here
 * - Tooltip text comes from src/shared/tooltips.ts (not hardcoded)
 */

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useEngineStore, computeIsStale } from '../../stores/engineStore'
import { DEFAULT_ENGINE_SNAPSHOT, EFFECT_NAMES, EQ_BAND_LABELS } from '../../../shared/constants'
import { TOOLTIPS } from '../../../shared/tooltips'
import { HelpTooltip } from '../controls/HelpTooltip'
import { useAudioEngine } from '../../hooks/useAudioEngine'
import { useStage1Processing } from '../../hooks/useStage1Processing'
import type { EffectName, EQBand } from '../../../shared/types'

export function ControlPanel(): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // File loading error - shown as a friendly popup in the UI
  const [fileError, setFileError] = useState<string | null>(null)

  // Basic/Advanced mode toggle - Advanced reveals EQ, compressor, high-pass, wet/dry
  const [advancedMode, setAdvancedMode] = useState(false)

  // Loop mode - when checked, audio loops seamlessly until stop or unchecked
  const [loopEnabled, setLoopEnabled] = useState(false)

  // ─── Store State ────────────────────────────────────────────────────
  const snapshot = useEngineStore((s) => s.snapshot)
  const isPlaying = useEngineStore((s) => s.isPlaying)
  const hasFile = useEngineStore((s) => s.hasFile)
  const hasProcessed = useEngineStore((s) => s.hasProcessed)
  const volume = useEngineStore((s) => s.volume)
  const stage1Status = useEngineStore((s) => s.stage1Status)
  const stage1Error = useEngineStore((s) => s.stage1Error)
  const appliedStage1Params = useEngineStore((s) => s.appliedStage1Params)

  // Mic mode: Stage 1 controls are disabled during live mic monitoring
  // because pitch/formant/tempo require offline processing (Rubber Band CLI).
  // The user records first, then applies Stage 1 to the recorded take.
  const micActive = useEngineStore((s) => s.micActive)
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
    setVibrato,
    setTremolo,
    setReverb,
    setVocalFry,
    setBreathiness,
    setBreathiness2,
    setWetDry,
    setBypass,
    setLoop,
    setEQBand,
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

  // ── Basic Effects ──────────────────────────────────────────────────

  const handleReverbAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('reverbAmount', value)
    // Keep wetDryMix.reverb in sync so preset save/load works correctly.
    // The "Reverb Amount" slider IS the reverb wet level in Basic mode.
    updateParam('wetDryMix', { ...snapshot.wetDryMix, reverb: value })
    setReverb(snapshot.reverbRoomSize, value)
    setWetDry('reverb', value)
  }, [updateParam, setReverb, setWetDry, snapshot.reverbRoomSize, snapshot.wetDryMix])

  const handleReverbRoomSizeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('reverbRoomSize', value)
    setReverb(value, snapshot.reverbAmount)
  }, [updateParam, setReverb, snapshot.reverbAmount])

  const handleVibratoRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('vibratoRate', value)
    setVibrato(value, snapshot.vibratoDepth)
  }, [updateParam, setVibrato, snapshot.vibratoDepth])

  const handleVibratoDepthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('vibratoDepth', value)
    setVibrato(snapshot.vibratoRate, value)
  }, [updateParam, setVibrato, snapshot.vibratoRate])

  const handleTremoloRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('tremoloRate', value)
    setTremolo(value, snapshot.tremoloDepth)
  }, [updateParam, setTremolo, snapshot.tremoloDepth])

  const handleTremoloDepthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('tremoloDepth', value)
    setTremolo(snapshot.tremoloRate, value)
  }, [updateParam, setTremolo, snapshot.tremoloRate])

  const handleVocalFryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('vocalFryIntensity', value)
    setVocalFry(value)
  }, [updateParam, setVocalFry])

  const handleBreathinessChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('breathiness', value)
    setBreathiness(value)
  }, [updateParam, setBreathiness])

  const handleBreathiness2Change = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    updateParam('breathiness2', value)
    setBreathiness2(value)
  }, [updateParam, setBreathiness2])

  // ── Advanced Effects (EQ, Compressor, High-Pass, Wet/Dry) ──────────

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

  // EQ band handlers - update the specific band in the snapshot's eq array.
  const handleEQGainChange = useCallback((index: number, gain: number) => {
    const newEQ = snapshot.eq.map((band: EQBand, i: number) =>
      i === index ? { ...band, gain } : band
    )
    updateParam('eq', newEQ)
    setEQBand(index, gain, snapshot.eq[index].frequency)
  }, [updateParam, setEQBand, snapshot.eq])

  // Wet/dry mix handlers - update the nested wetDryMix record in the snapshot.
  const handleWetDryChange = useCallback((effect: EffectName, mix: number) => {
    const newMix = { ...snapshot.wetDryMix, [effect]: mix }
    updateParam('wetDryMix', newMix)
    setWetDry(effect, mix)
  }, [updateParam, setWetDry, snapshot.wetDryMix])

  // Bypass toggle
  const handleBypassToggle = useCallback(() => {
    const newBypassed = !snapshot.bypassed
    updateParam('bypassed', newBypassed)
    setBypass(newBypassed)
  }, [updateParam, setBypass, snapshot.bypassed])

  // ─── Reset Handlers ─────────────────────────────────────────────────

  const resetStage1 = useCallback(() => {
    updateParam('pitch', DEFAULT_ENGINE_SNAPSHOT.pitch)
    updateParam('formant', DEFAULT_ENGINE_SNAPSHOT.formant)
    updateParam('speed', DEFAULT_ENGINE_SNAPSHOT.speed)
  }, [updateParam])

  // Reset all Stage 2 effects to defaults and sync to engine
  const resetStage2 = useCallback(() => {
    const d = DEFAULT_ENGINE_SNAPSHOT

    // Inline effects
    updateParam('highPassFrequency', d.highPassFrequency)
    updateParam('compressorThreshold', d.compressorThreshold)
    updateParam('compressorRatio', d.compressorRatio)
    setHighPassFrequency(d.highPassFrequency)
    setCompressorThreshold(d.compressorThreshold)
    setCompressorRatio(d.compressorRatio)

    // Tone.js effects
    updateParam('reverbAmount', d.reverbAmount)
    updateParam('reverbRoomSize', d.reverbRoomSize)
    updateParam('vibratoRate', d.vibratoRate)
    updateParam('vibratoDepth', d.vibratoDepth)
    updateParam('tremoloRate', d.tremoloRate)
    updateParam('tremoloDepth', d.tremoloDepth)
    setReverb(d.reverbRoomSize, d.reverbAmount)
    setVibrato(d.vibratoRate, d.vibratoDepth)
    setTremolo(d.tremoloRate, d.tremoloDepth)

    // Custom effects
    updateParam('vocalFryIntensity', d.vocalFryIntensity)
    updateParam('breathiness', d.breathiness)
    updateParam('breathiness2', d.breathiness2)
    setVocalFry(d.vocalFryIntensity)
    setBreathiness(d.breathiness)
    setBreathiness2(d.breathiness2)

    // Wet/dry
    updateParam('wetDryMix', d.wetDryMix)
    setWetDry('vibrato', d.wetDryMix.vibrato)
    setWetDry('tremolo', d.wetDryMix.tremolo)
    setWetDry('reverb', d.wetDryMix.reverb)
    setWetDry('vocalFry', d.wetDryMix.vocalFry)
    setWetDry('breathiness', d.wetDryMix.breathiness)
    setWetDry('breathiness2', d.wetDryMix.breathiness2)

    // EQ bands
    updateParam('eq', d.eq)
    d.eq.forEach((band: EQBand, i: number) => setEQBand(i, band.gain, band.frequency))

    // Bypass off
    updateParam('bypassed', false)
    setBypass(false)
  }, [updateParam, setHighPassFrequency, setCompressorThreshold, setCompressorRatio,
      setReverb, setVibrato, setTremolo, setVocalFry, setBreathiness, setBreathiness2,
      setWetDry, setEQBand, setBypass])

  // ─── Render ─────────────────────────────────────────────────────────

  const isProcessing = stage1Status === 'processing'

  // Stage 1 controls disabled during processing OR mic monitoring
  const stage1Disabled = isProcessing || micActive

  // A6: EQ band labels from shared constants
  const eqLabels = EQ_BAND_LABELS

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#64b5f6' }}>
          VoxSmith
        </h1>
        {/* Bypass toggle - always visible for quick A/B comparison */}
        {/* X1: aria-pressed for toggle state, aria-label for screen readers */}
        <button
          onClick={handleBypassToggle}
          aria-pressed={snapshot.bypassed}
          aria-label={snapshot.bypassed ? 'Effects bypassed, click to enable' : 'Bypass all effects'}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: snapshot.bypassed ? '1px solid #ff9800' : '1px solid #444',
            backgroundColor: snapshot.bypassed ? '#332200' : '#1a1a2e',
            color: snapshot.bypassed ? '#ff9800' : '#888',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
          title={TOOLTIPS.bypass.detail}
        >
          {snapshot.bypassed ? 'BYPASSED' : 'Bypass'}
        </button>
      </div>
      <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: '#888' }}>
        Sprint 3 - Advanced Effects Chain
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

        {/* File loading error */}
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
              X
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
            aria-label={isPlaying ? 'Pause playback' : 'Play audio'}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={stop}
            disabled={!hasFile || !isPlaying}
            style={buttonStyle(hasFile && isPlaying)}
            aria-label="Stop playback"
          >
            Stop
          </button>

          {/* Loop checkbox - audio repeats seamlessly until stop or unchecked */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={loopEnabled}
              onChange={(e) => {
                const checked = e.target.checked
                setLoopEnabled(checked)
                setLoop(checked)
              }}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontSize: '13px', color: '#aaa' }}>Loop</span>
          </label>

          {/* Volume slider */}
          <label style={{ marginLeft: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px' }}>Volume</span>
            <HelpTooltip detail={TOOLTIPS.volume.detail} pairsWith={TOOLTIPS.volume.pairsWith} />
            <input
              type="range"
              min="0"
              max="4"
              step="0.01"
              value={volume}
              onChange={handleVolumeChange}
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={volume}
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
          Stage 1 - Pitch / Formant / Speed
          <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#888', marginLeft: '8px' }}>
            (offline - click Apply to process)
          </span>
          <button onClick={resetStage1} style={resetLinkStyle} aria-label="Reset Stage 1 settings">reset</button>
        </h2>

        {/* Stale indicator */}
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
            Preview is outdated - click <strong>Apply</strong> to hear these changes.
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

        {/* Mic mode indicator: Stage 1 controls are disabled during live monitoring */}
        {micActive && (
          <div style={{
            marginBottom: '8px',
            padding: '6px 8px',
            backgroundColor: '#1a2a1a',
            border: '1px solid #3a5a3a',
            borderRadius: '4px',
            fontSize: '11px',
            color: '#8c8',
            lineHeight: 1.4,
          }}>
            🎙 Mic active — Stage 1 controls disabled during monitoring.
            Record a take first, then apply pitch/formant/speed.
          </div>
        )}

        <SliderControl
          label="Pitch"
          value={snapshot.pitch}
          min={-24} max={24} step={1}
          unit="st" tooltipKey="pitch"
          disabled={stage1Disabled}
          onChange={handlePitchChange}
        />

        {/* Formant slider: Uses Rubber Band library API (Koffi FFI) for true
            single-pass formant shifting via setFormantScale(). Re-enabled in Sprint 6. */}
        <SliderControl
          label="Formant"
          value={snapshot.formant}
          min={-1} max={1} step={0.01}
          unit="oct" tooltipKey="formant"
          disabled={stage1Disabled}
          onChange={handleFormantChange}
        />
        <SliderControl
          label="Speed"
          value={snapshot.speed}
          min={0.5} max={2.0} step={0.05}
          unit="x" tooltipKey="speed"
          disabled={stage1Disabled}
          onChange={handleSpeedChange}
        />

        {/* Apply / Cancel buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={applyStage1}
            disabled={!hasFile || stage1Disabled || !isStale}
            style={{
              ...buttonStyle(hasFile && !stage1Disabled && isStale),
              backgroundColor: hasFile && !stage1Disabled && isStale ? '#1565c0' : undefined,
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
          Stage 2 - Real-Time Effects
          <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#888', marginLeft: '8px' }}>
            (updates live)
          </span>
          <button onClick={resetStage2} style={resetLinkStyle} aria-label="Reset Stage 2 effects">reset</button>
        </h2>

        {/* Basic/Advanced mode toggle */}
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setAdvancedMode(!advancedMode)}
            aria-pressed={advancedMode}
            aria-label={advancedMode ? 'Switch to basic mode' : 'Switch to advanced mode'}
            style={{
              padding: '3px 10px',
              borderRadius: '4px',
              border: '1px solid #444',
              backgroundColor: advancedMode ? '#2a3a5e' : '#1a1a2e',
              color: advancedMode ? '#64b5f6' : '#888',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500,
            }}
          >
            {advancedMode ? 'Advanced Mode' : 'Basic Mode'}
          </button>
          <span style={{ fontSize: '11px', color: '#666' }}>
            {advancedMode ? 'Showing EQ, compressor, high-pass, wet/dry controls' : 'Click to reveal advanced controls'}
          </span>
        </div>

        {/* ── Reverb ──────────────────────────────────────────────────── */}
        <SliderControl
          label="Reverb"
          value={snapshot.reverbAmount}
          min={0} max={1} step={0.01}
          unit="" tooltipKey="reverb"
          onChange={handleReverbAmountChange}
        />
        <SliderControl
          label="Room Size"
          value={snapshot.reverbRoomSize}
          min={0} max={1} step={0.01}
          unit="" tooltipKey="roomSize"
          onChange={handleReverbRoomSizeChange}
        />

        {/* ── Vibrato ─────────────────────────────────────────────────── */}
        <SliderControl
          label="Vibrato Depth"
          value={snapshot.vibratoDepth}
          min={0} max={1} step={0.01}
          unit="" tooltipKey="vibratoDepth"
          onChange={handleVibratoDepthChange}
        />
        <SliderControl
          label="Vibrato Rate"
          value={snapshot.vibratoRate}
          min={1} max={15} step={0.5}
          unit="Hz" tooltipKey="vibratoRate"
          onChange={handleVibratoRateChange}
        />

        {/* ── Tremolo ─────────────────────────────────────────────────── */}
        <SliderControl
          label="Tremolo Depth"
          value={snapshot.tremoloDepth}
          min={0} max={1} step={0.01}
          unit="" tooltipKey="tremoloDepth"
          onChange={handleTremoloDepthChange}
        />
        <SliderControl
          label="Tremolo Rate"
          value={snapshot.tremoloRate}
          min={1} max={15} step={0.5}
          unit="Hz" tooltipKey="tremoloRate"
          onChange={handleTremoloRateChange}
        />

        {/* ── Vocal Fry ───────────────────────────────────────────────── */}
        <SliderControl
          label="Vocal Fry"
          value={snapshot.vocalFryIntensity}
          min={0} max={1} step={0.01}
          unit="" tooltipKey="vocalFry"
          onChange={handleVocalFryChange}
        />

        {/* ── Breathiness ─────────────────────────────────────────────── */}
        <SliderControl
          label="Breathiness"
          value={snapshot.breathiness}
          min={0} max={1} step={0.01}
          unit="" tooltipKey="breathiness"
          onChange={handleBreathinessChange}
        />

        {/* ── Breathiness 2 ──────────────────────────────────────────── */}
        <SliderControl
          label="Breathiness 2"
          value={snapshot.breathiness2}
          min={0} max={1} step={0.01}
          unit="" tooltipKey="breathiness2"
          onChange={handleBreathiness2Change}
        />

        {/* ── Advanced Controls (EQ, Compressor, High-Pass, Wet/Dry) ── */}
        {advancedMode && (
          <>
            {/* ── 4-Band EQ ─────────────────────────────────────────── */}
            <h3 style={subHeaderStyle}>
              4-Band EQ
              <HelpTooltip detail={TOOLTIPS.eq.detail} pairsWith={TOOLTIPS.eq.pairsWith} />
            </h3>
            {snapshot.eq.map((band: EQBand, i: number) => (
              <SliderControl
                key={i}
                label={eqLabels[i]}
                value={band.gain}
                min={-12} max={12} step={0.5}
                unit="dB"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleEQGainChange(i, Number(e.target.value))
                }
              />
            ))}

            {/* ── High-Pass Filter ──────────────────────────────────── */}
            <h3 style={subHeaderStyle}>Filters & Dynamics</h3>
            <SliderControl
              label="High-Pass"
              value={snapshot.highPassFrequency}
              min={20} max={500} step={1}
              unit="Hz" tooltipKey="highPass"
              onChange={handleHighPassChange}
            />

            {/* ── Compressor ────────────────────────────────────────── */}
            <SliderControl
              label="Comp Threshold"
              value={snapshot.compressorThreshold}
              min={-60} max={0} step={1}
              unit="dB" tooltipKey="compressorThreshold"
              onChange={handleCompThresholdChange}
            />
            <SliderControl
              label="Comp Ratio"
              value={snapshot.compressorRatio}
              min={1} max={20} step={0.5}
              unit=":1" tooltipKey="compressorRatio"
              onChange={handleCompRatioChange}
            />

            {/* ── Per-Effect Wet/Dry ────────────────────────────────── */}
            <h3 style={subHeaderStyle}>
              Wet/Dry Mix
              <HelpTooltip detail={TOOLTIPS.wetDry.detail} pairsWith={TOOLTIPS.wetDry.pairsWith} />
            </h3>
            {EFFECT_NAMES.map(
              (effect) => (
                <SliderControl
                  key={effect}
                  label={effect.charAt(0).toUpperCase() + effect.slice(1).replace(/([A-Z])/g, ' $1')}
                  value={snapshot.wetDryMix[effect]}
                  min={0} max={1} step={0.01}
                  unit=""
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleWetDryChange(effect, Number(e.target.value))
                  }
                />
              )
            )}
          </>
        )}
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
  bypassed: snapshot.bypassed,
  advancedMode,
  stage1Status,
  stage1Params: {
    pitch: snapshot.pitch,
    formant: snapshot.formant,
    speed: snapshot.speed,
  },
  stage2Params: {
    reverb: snapshot.reverbAmount,
    roomSize: snapshot.reverbRoomSize,
    vibratoRate: snapshot.vibratoRate,
    vibratoDepth: snapshot.vibratoDepth,
    tremoloRate: snapshot.tremoloRate,
    tremoloDepth: snapshot.tremoloDepth,
    vocalFry: snapshot.vocalFryIntensity,
    breathiness: snapshot.breathiness,
    breathiness2: snapshot.breathiness2,
    highPass: snapshot.highPassFrequency,
    compThreshold: snapshot.compressorThreshold,
    compRatio: snapshot.compressorRatio,
  },
  wetDryMix: snapshot.wetDryMix,
  volume,
}, null, 2)}
          </pre>
        </details>
      </section>
    </div>
  )
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

// HelpTooltip is now imported from ../controls/HelpTooltip.tsx (shared component)

// ─── Slider Component ───────────────────────────────────────────────────────

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  /** Key into TOOLTIPS object - if provided, shows tooltip on hover */
  tooltipKey?: string
  /** Whether the slider is disabled (e.g., during Stage 1 processing) */
  disabled?: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * A labeled slider with current value display and optional tooltip.
 * Tooltip content is pulled from src/shared/tooltips.ts (single source of truth).
 */
function SliderControl({ label, value, min, max, step, unit, tooltipKey, disabled, onChange }: SliderControlProps): React.ReactElement {
  // Format the display value based on the unit type
  const displayValue = unit === 'x' ? value.toFixed(2) :
    unit === 'oct' ? value.toFixed(2) :
    unit === '' ? value.toFixed(2) :
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
      {/* X1: ARIA attributes for screen readers — label text, value range, and current value */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
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

const subHeaderStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  margin: '16px 0 8px 0',
  color: '#90a4ae',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
}

// X2: Changed from <span> to <button> — added background/border/padding resets
const resetLinkStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 'normal',
  color: '#607d8b',
  marginLeft: '12px',
  cursor: 'pointer',
  textDecoration: 'underline',
  userSelect: 'none',
  background: 'none',
  border: 'none',
  padding: 0,
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
