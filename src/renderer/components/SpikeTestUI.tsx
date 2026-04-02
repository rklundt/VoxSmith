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
 * SpikeTestUI - Sprint 1 Rubber Band WASM Spike (COMPLETED)
 *
 * STATUS: Spike complete. This component will be removed in Sprint 2.
 *
 * FINDINGS SUMMARY:
 * 1. rubberband-web WASM loads in Electron AudioWorklet - PASS (with unsafe-eval CSP)
 * 2. setPitch() produces audible pitch changes - PASS
 * 3. setTempo() does NOT function in real-time AudioWorklet mode - FAIL (buffer overrun)
 * 4. No setFormant() API exists - CONFIRMED ABSENT
 *
 * DECISION: Switch to native Rubber Band CLI binary via child_process in main process.
 * This solves all three limitations: formant control, proper tempo, no buffer overruns.
 * Architecture updated to three-stage pipeline. See docs/architecture.md.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { RubberBandProcessor } from '../engine/RubberBandProcessor'

// Converts a linear gain multiplier to decibels for display purposes.
// e.g. 1.0 → "0.0 dB", 2.0 → "+6.0 dB", 0.5 → "-6.0 dB"
function gainToDb(gain: number): string {
  const db = 20 * Math.log10(gain)
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ProcessorStatus =
  | 'idle'           // No file loaded, nothing initialized
  | 'loading'        // AudioWorklet loading (createRubberBandNode is async)
  | 'ready'          // WASM loaded, file decoded, ready to play
  | 'playing'        // Currently playing audio
  | 'error'          // Something went wrong - see statusMessage

// ─── Component ───────────────────────────────────────────────────────────────

export function SpikeTestUI(): React.ReactElement {
  // Audio processing state
  const [status, setStatus] = useState<ProcessorStatus>('idle')
  const [statusMessage, setStatusMessage] = useState<string>('Load an audio file to test pitch shifting.')
  const [fileName, setFileName] = useState<string | null>(null)

  // Slider display values - pitch commits on pointer release to avoid zipper noise.
  // Gain updates live (native AudioParam, no artifacts).
  const [pitch, setPitch] = useState<number>(1.0)
  const [gain, setGain] = useState<number>(1.0)

  // Refs hold audio objects that persist across renders without triggering re-renders.
  // We use refs (not state) because audio nodes are not serializable.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<RubberBandProcessor | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)

  // ─── Cleanup on unmount ──────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopAudio()
      processorRef.current?.close()
      audioCtxRef.current?.close()
    }
  }, [])

  // ─── Helper: stop active playback ────────────────────────────────────────

  const stopAudio = useCallback((): void => {
    if (sourceNodeRef.current) {
      // Null out onended BEFORE calling stop() - otherwise stop() fires the
      // onended callback asynchronously, which overwrites the 'playing' status
      // back to 'ready' when Restart is used (race condition).
      sourceNodeRef.current.onended = null
      try {
        sourceNodeRef.current.stop()
        sourceNodeRef.current.disconnect()
      } catch {
        // stop() throws if the source was never started or already ended - safe to ignore
      }
      sourceNodeRef.current = null
    }
  }, [])

  // ─── File Load Handler ───────────────────────────────────────────────────

  const handleFileLoad = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return

    stopAudio()
    setStatus('loading')
    setFileName(file.name)
    setStatusMessage('Initializing AudioContext and loading Rubber Band WASM...')

    try {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        await audioCtxRef.current.close()
      }
      audioCtxRef.current = new AudioContext()

      if (processorRef.current) {
        processorRef.current.close()
      }
      processorRef.current = new RubberBandProcessor()
      await processorRef.current.initialize(audioCtxRef.current)

      // GainNode for volume control - native AudioParam, smooth and artifact-free
      gainNodeRef.current = audioCtxRef.current.createGain()
      gainNodeRef.current.gain.value = gain

      setStatusMessage('WASM loaded. Decoding audio file...')

      const arrayBuffer = await file.arrayBuffer()
      audioBufferRef.current = await audioCtxRef.current.decodeAudioData(arrayBuffer)

      setStatus('ready')
      setStatusMessage(
        `Ready. ${file.name} | ` +
        `${audioBufferRef.current.numberOfChannels}ch | ` +
        `${audioBufferRef.current.sampleRate}Hz | ` +
        `${audioBufferRef.current.duration.toFixed(2)}s`
      )
    } catch (err) {
      setStatus('error')
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`)
      console.error('[SpikeTestUI] Initialization error:', err)
    }
  }, [stopAudio, gain])

  // ─── Play Handler ────────────────────────────────────────────────────────

  const handlePlay = useCallback(async (): Promise<void> => {
    if (!audioCtxRef.current || !processorRef.current || !audioBufferRef.current) return

    stopAudio()

    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume()
    }

    const source = audioCtxRef.current.createBufferSource()
    source.buffer = audioBufferRef.current
    sourceNodeRef.current = source

    // Signal chain: source → RubberBandNode → GainNode → destination
    const rbNode = processorRef.current.getNode()
    const gNode = gainNodeRef.current ?? audioCtxRef.current.createGain()
    source.connect(rbNode)
    rbNode.connect(gNode)
    gNode.connect(audioCtxRef.current.destination)

    // Apply current pitch (tempo locked at 1.0 - it's broken in WASM mode)
    processorRef.current.setPitch(pitch)
    processorRef.current.setTempo(1.0)

    source.onended = () => {
      setStatus('ready')
      setStatusMessage('Playback complete. Press Play again to replay.')
      sourceNodeRef.current = null
    }

    source.start()
    setStatus('playing')
    setStatusMessage(`Playing with pitch=${pitch.toFixed(2)}x, gain=${gain.toFixed(2)}x`)
  }, [pitch, gain, stopAudio])

  // ─── Stop Handler ────────────────────────────────────────────────────────

  const handleStop = useCallback((): void => {
    stopAudio()
    if (status === 'playing') {
      setStatus('ready')
      setStatusMessage('Stopped.')
    }
  }, [stopAudio, status])

  // ─── Pitch - display updates live, processor commits on pointer release ──

  const handlePitchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setPitch(parseFloat(e.target.value))
  }, [])

  const handlePitchCommit = useCallback((e: React.PointerEvent<HTMLInputElement>): void => {
    const value = parseFloat((e.target as HTMLInputElement).value)
    processorRef.current?.setPitch(value)
  }, [])

  // ─── Gain - updates live (native AudioParam, no artifacts) ───────────────

  const handleGainChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = parseFloat(e.target.value)
    setGain(value)
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = value
    }
  }, [])

  // ─── Render ──────────────────────────────────────────────────────────────

  const isReady = status === 'ready' || status === 'playing'
  const isPlaying = status === 'playing'
  const isLoading = status === 'loading'

  const statusColor: Record<ProcessorStatus, string> = {
    idle: '#888',
    loading: '#f0c040',
    ready: '#40c080',
    playing: '#40a0ff',
    error: '#ff4060',
  }

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, monospace',
      backgroundColor: '#0d1117',
      color: '#e0e0e0',
      minHeight: '100vh',
      padding: '2rem',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem', borderBottom: '1px solid #30363d', paddingBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#58a6ff' }}>
          Sprint 1 - Rubber Band WASM Spike
        </h1>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#40c080' }}>
          SPIKE COMPLETE - findings documented, architecture updated to three-stage pipeline
        </p>
      </div>

      {/* Spike results banner */}
      <div style={{
        padding: '1rem',
        borderRadius: '6px',
        backgroundColor: '#0d2818',
        border: '1px solid #238636',
        marginBottom: '1.5rem',
        fontSize: '0.8rem',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: '#40c080' }}>DECISION: Native Rubber Band CLI binary via main process</strong>
        <div style={{ marginTop: '0.5rem', color: '#8b949e' }}>
          rubberband-web rejected: no formant API, broken real-time tempo, buffer overruns.
          Sprint 2 will implement the three-stage pipeline (offline Rubber Band CLI, real-time Web Audio, FFmpeg export).
          This spike UI will be removed.
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        padding: '0.75rem 1rem',
        borderRadius: '6px',
        backgroundColor: '#161b22',
        border: `1px solid ${statusColor[status]}40`,
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <div style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: statusColor[status],
          flexShrink: 0,
          animation: isLoading ? 'pulse 1s ease-in-out infinite' : 'none',
        }} />
        <span style={{ fontSize: '0.85rem', color: statusColor[status] }}>
          {statusMessage}
        </span>
      </div>

      {/* File loader */}
      <section style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', marginBottom: '0.4rem' }}>
          AUDIO FILE
        </label>
        <input
          type="file"
          accept="audio/*"
          onChange={handleFileLoad}
          disabled={isLoading}
          style={{
            display: 'block',
            width: '100%',
            padding: '0.5rem',
            backgroundColor: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '6px',
            color: '#e0e0e0',
            fontSize: '0.85rem',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            boxSizing: 'border-box',
          }}
        />
        {fileName && (
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: '#8b949e' }}>
            Loaded: {fileName}
          </p>
        )}
      </section>

      {/* Playback controls */}
      <section style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem' }}>
        <button
          onClick={handlePlay}
          disabled={!isReady || isLoading}
          style={{
            padding: '0.6rem 1.5rem',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: isPlaying ? '#1f6feb' : '#238636',
            color: '#fff',
            fontSize: '0.9rem',
            cursor: isReady ? 'pointer' : 'not-allowed',
            opacity: isReady ? 1 : 0.4,
          }}
        >
          {isPlaying ? '↺ Restart' : '▶ Play'}
        </button>
        <button
          onClick={handleStop}
          disabled={!isPlaying}
          style={{
            padding: '0.6rem 1.5rem',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: '#b62324',
            color: '#fff',
            fontSize: '0.9rem',
            cursor: isPlaying ? 'pointer' : 'not-allowed',
            opacity: isPlaying ? 1 : 0.4,
          }}
        >
          ■ Stop
        </button>
      </section>

      {/* Pitch slider - the one thing that works in WASM mode */}
      <section style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
          <span style={{ color: '#8b949e' }}>PITCH (works - but with chipmunk effect, no formant control)</span>
          <span style={{ color: pitch === 1.0 ? '#8b949e' : '#f0c040', fontFamily: 'monospace' }}>
            {pitch.toFixed(2)}x
          </span>
        </label>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.01"
          value={pitch}
          onChange={handlePitchChange}
          onPointerUp={handlePitchCommit}
          disabled={!isReady && !isLoading}
          style={{ width: '100%', cursor: 'pointer', accentColor: '#f0c040' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#484f58', marginTop: '0.2rem' }}>
          <span>0.5x (octave down)</span>
          <span>1.0x (no change)</span>
          <span>2.0x (octave up)</span>
        </div>
      </section>

      {/* Gain slider */}
      <section style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
          <span style={{ color: '#8b949e' }}>GAIN (VOLUME)</span>
          <span style={{ color: gain === 1.0 ? '#8b949e' : '#40c080', fontFamily: 'monospace' }}>
            {gain.toFixed(2)}x &nbsp;{gainToDb(gain)}
          </span>
        </label>
        <input
          type="range"
          min="0.1"
          max="4.0"
          step="0.05"
          value={gain}
          onChange={handleGainChange}
          disabled={!isReady && !isLoading}
          style={{ width: '100%', cursor: 'pointer', accentColor: '#40c080' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#484f58', marginTop: '0.2rem' }}>
          <span>0.1x (-20 dB)</span>
          <span>1.0x (0 dB)</span>
          <span>4.0x (+12 dB)</span>
        </div>
      </section>

      {/* Spike findings - completed results */}
      <section style={{
        padding: '1rem',
        borderRadius: '6px',
        backgroundColor: '#161b22',
        border: '1px solid #30363d',
        fontSize: '0.8rem',
      }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#58a6ff' }}>
          Sprint 1 Spike Results
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #30363d' }}>
              <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: '#8b949e' }}>Feature</th>
              <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: '#8b949e' }}>Result</th>
              <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: '#8b949e' }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #21262d' }}>
              <td style={{ padding: '0.4rem 0.5rem', color: '#e0e0e0' }}>WASM Load</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#40c080' }}>PASS</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#8b949e' }}>Loads with unsafe-eval CSP</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #21262d' }}>
              <td style={{ padding: '0.4rem 0.5rem', color: '#e0e0e0' }}>Pitch Shift</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#40c080' }}>PASS</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#8b949e' }}>Audible pitch change via setPitch()</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #21262d' }}>
              <td style={{ padding: '0.4rem 0.5rem', color: '#e0e0e0' }}>Formant Control</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#ff4060' }}>ABSENT</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#8b949e' }}>No setFormant() in API or WASM internals</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #21262d' }}>
              <td style={{ padding: '0.4rem 0.5rem', color: '#e0e0e0' }}>Tempo / Time-stretch</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#ff4060' }}>BROKEN</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#8b949e' }}>Does not function in 128-sample AudioWorklet blocks</td>
            </tr>
            <tr>
              <td style={{ padding: '0.4rem 0.5rem', color: '#e0e0e0' }}>Buffer Management</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#ff4060' }}>OVERRUNS</td>
              <td style={{ padding: '0.4rem 0.5rem', color: '#8b949e' }}>WASM floods console with BUFFER OVERRUN at non-default tempo</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Pulse keyframe for loading indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
