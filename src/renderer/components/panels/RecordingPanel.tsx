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
 * RecordingPanel — Mic input, recording controls, and take management (Sprint 7)
 *
 * Left sidebar panel for the recording workflow:
 *  - Mic device dropdown
 *  - Start/stop mic monitoring
 *  - Count-in configuration
 *  - Record/stop button
 *  - Take list with audition and delete
 *  - Punch-in recording controls
 *
 * ARCHITECTURE:
 * This component handles display and user interaction ONLY.
 * All recording logic lives in the useRecording hook.
 * Tooltip text comes from src/shared/tooltips.ts.
 *
 * KEYBOARD SHORTCUTS:
 *  R — Toggle recording (start/stop)
 *  Space — Play/stop take (when not recording)
 *  P — Punch-in (future: when region selected)
 */

import React, { useCallback, useEffect } from 'react'
import { useEngineStore } from '../../stores/engineStore'
import { useRecording } from '../../hooks/useRecording'
import { HelpTooltip } from '../controls/HelpTooltip'
import { TOOLTIPS } from '../../../shared/tooltips'
import type { MicDevice } from '../../../shared/types'

interface RecordingPanelProps {
  onClose: () => void
}

export function RecordingPanel({ onClose }: RecordingPanelProps): React.ReactElement {
  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    startMic,
    stopMic,
    toggleMonitorMute,
    startRecording,
    stopRecording,
    toggleRecording,
    auditionTake,
    deleteTake,
    punchIn,
    getCursorTime,
  } = useRecording()

  // Read recording state from the store
  const micActive = useEngineStore((s) => s.micActive)
  const recordingState = useEngineStore((s) => s.recordingState)
  const countInBeats = useEngineStore((s) => s.countInBeats)
  const countInTotal = useEngineStore((s) => s.countInTotal)
  const takes = useEngineStore((s) => s.takes)
  const selectedTakeId = useEngineStore((s) => s.selectedTakeId)
  const recordingDurationMs = useEngineStore((s) => s.recordingDurationMs)
  const micError = useEngineStore((s) => s.micError)
  const monitorMuted = useEngineStore((s) => s.monitorMuted)
  // noiseSuppression store state preserved for Sprint 7.2 (RNNoise WASM)
  // UI toggle will be re-added when real noise suppression is implemented
  const punchInRegion = useEngineStore((s) => s.punchInRegion)
  const setPunchInRegion = useEngineStore((s) => s.setPunchInRegion)
  const setCountInTotal = useEngineStore((s) => s.setCountInTotal)

  const isRecording = recordingState === 'recording'
  const isCountingIn = recordingState === 'count-in'

  // ─── Keyboard Shortcuts ─────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return

      switch (e.key.toLowerCase()) {
        case 'r':
          // R = toggle recording
          e.preventDefault()
          toggleRecording()
          break
        case 'p':
          // P = punch-in on selected region (requires mic active, take selected, region marked)
          if (punchInRegion && selectedTakeId && micActive && recordingState !== 'recording') {
            e.preventDefault()
            void punchIn(punchInRegion)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleRecording, punchIn, punchInRegion, selectedTakeId, micActive, recordingState])

  // ─── Helpers ────────────────────────────────────────────────────────

  /** Format milliseconds to MM:SS.ss display */
  const formatDuration = useCallback((ms: number): string => {
    const totalSeconds = ms / 1000
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
  }, [])

  const handleDeviceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setSelectedDeviceId(value === '' ? null : value)
  }, [setSelectedDeviceId])

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div style={{
      width: '260px',
      minWidth: '220px',
      maxWidth: '320px',
      backgroundColor: '#0d0d1a',
      borderRight: '1px solid #333',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#ddd' }}>
          Recording
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
          title="Hide Recording Panel"
          aria-label="Close recording panel"
        >
          &#x2715;
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>

        {/* ── Mic Device Selection ──────────────────────────────── */}
        <div>
          <label style={labelWithHelpStyle}>
            <span>Microphone</span>
            <HelpTooltip
              detail={TOOLTIPS.micInput.detail}
              pairsWith={TOOLTIPS.micInput.pairsWith}
            />
          </label>
          <select
            value={selectedDeviceId ?? ''}
            onChange={handleDeviceChange}
            style={selectStyle}
            disabled={isRecording || isCountingIn}
            aria-label="Select microphone"
          >
            <option value="">System Default</option>
            {devices.map((d: MicDevice) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {/* ── Mic Monitor Toggle ─────────────────────────────────── */}
        <button
          onClick={micActive ? stopMic : startMic}
          disabled={isRecording || isCountingIn}
          aria-label={micActive ? 'Stop microphone monitoring' : 'Start microphone monitoring'}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: micActive ? '1px solid #e05050' : '1px solid #4a8abf',
            backgroundColor: micActive ? '#4a1a1a' : '#1a3a5a',
            color: micActive ? '#f88' : '#8cf',
            cursor: (isRecording || isCountingIn) ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          {micActive ? '⏹ Stop Monitoring' : '🎙 Start Mic'}
        </button>

        {/* Monitor mute toggle — prevents feedback when not using headphones */}
        {micActive && (
          <div>
            <button
              onClick={toggleMonitorMute}
              aria-pressed={!monitorMuted}
              aria-label={monitorMuted ? 'Enable monitor audio' : 'Mute monitor audio'}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: '4px',
                border: monitorMuted ? '1px solid #555' : '1px solid #e0a050',
                backgroundColor: monitorMuted ? '#1a1a2e' : '#3a2a1a',
                color: monitorMuted ? '#888' : '#fc8',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
                textAlign: 'left',
              }}
            >
              {monitorMuted ? '🔇 Monitor Off (no feedback)' : '🔊 Monitor On (use headphones!)'}
            </button>
            {!monitorMuted && (
              <div style={{
                marginTop: '4px',
                padding: '4px 8px',
                backgroundColor: '#3a2a1a',
                border: '1px solid #e0a050',
                borderRadius: '3px',
                fontSize: '10px',
                color: '#fc8',
                lineHeight: 1.4,
              }}>
                ⚠ Use headphones to avoid feedback! Speaker output will feed back into the mic, especially with reverb.
              </div>
            )}
          </div>
        )}

        {/* Mic error display */}
        {micError && (
          <div style={{ fontSize: '11px', color: '#f55', lineHeight: 1.4 }}>
            {micError}
          </div>
        )}

        {/* ── Count-In ────────────────────────────────────────────── */}
        {micActive && (
          <div>
            <label style={labelWithHelpStyle}>
              <span>Count-In Beats</span>
              <HelpTooltip
                detail={TOOLTIPS.countIn.detail}
                pairsWith={TOOLTIPS.countIn.pairsWith}
              />
            </label>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[0, 1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setCountInTotal(n)}
                  disabled={isRecording || isCountingIn}
                  aria-label={n === 0 ? 'No count-in' : `${n} beat count-in`}
                  aria-pressed={countInTotal === n}
                  style={{
                    flex: 1,
                    padding: '4px',
                    borderRadius: '3px',
                    border: countInTotal === n ? '1px solid #4a8abf' : '1px solid #444',
                    backgroundColor: countInTotal === n ? '#2a4a6b' : '#1a1a2e',
                    color: countInTotal === n ? '#fff' : '#888',
                    cursor: (isRecording || isCountingIn) ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  {n === 0 ? 'Off' : n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Record Button ──────────────────────────────────────── */}
        {micActive && (
          <button
            onClick={isRecording || isCountingIn ? stopRecording : startRecording}
            aria-label={isRecording ? 'Stop recording' : isCountingIn ? 'Cancel count-in' : 'Start recording'}
            style={{
              padding: '10px 12px',
              borderRadius: '4px',
              border: isRecording
                ? '1px solid #e05050'
                : isCountingIn
                  ? '1px solid #e0a050'
                  : '1px solid #50e050',
              backgroundColor: isRecording
                ? '#5a1a1a'
                : isCountingIn
                  ? '#5a4a1a'
                  : '#1a4a1a',
              color: isRecording
                ? '#f88'
                : isCountingIn
                  ? '#fc8'
                  : '#8f8',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 700,
            }}
          >
            {isRecording
              ? `⏹ Stop Recording (${formatDuration(recordingDurationMs)})`
              : isCountingIn
                ? `⏳ Count-in: ${countInBeats}...`
                : '⏺ Record'}
          </button>
        )}

        {/* ── Keyboard Shortcut Hint ─────────────────────────────── */}
        {micActive && (
          <div style={{ fontSize: '10px', color: '#555', textAlign: 'center' }}>
            Press <kbd style={kbdStyle}>R</kbd> to toggle recording
          </div>
        )}

        {/* ── Divider ────────────────────────────────────────────── */}
        {takes.length > 0 && (
          <div style={{ borderTop: '1px solid #333', margin: '4px 0' }} />
        )}

        {/* ── Take List ──────────────────────────────────────────── */}
        {takes.length > 0 && (
          <div>
            <label style={labelWithHelpStyle}>
              <span>Takes ({takes.length})</span>
              <HelpTooltip
                detail={TOOLTIPS.takeManagement.detail}
                pairsWith={TOOLTIPS.takeManagement.pairsWith}
              />
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {takes.map((take) => (
                <div
                  key={take.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 8px',
                    borderRadius: '3px',
                    backgroundColor: selectedTakeId === take.id ? '#1a2a3a' : '#111',
                    border: selectedTakeId === take.id
                      ? '1px solid #4a8abf'
                      : '1px solid #222',
                  }}
                >
                  {/* Take name and duration */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: '#ccc', fontWeight: 500 }}>
                      {take.name}
                    </div>
                    <div style={{ fontSize: '10px', color: '#777' }}>
                      {formatDuration(take.durationMs)}
                    </div>
                  </div>

                  {/* Audition button */}
                  <button
                    onClick={() => auditionTake(take.id)}
                    disabled={isRecording}
                    style={{
                      background: 'none',
                      border: '1px solid #444',
                      borderRadius: '3px',
                      color: '#8cf',
                      cursor: isRecording ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      padding: '3px 6px',
                    }}
                    title="Play this take"
                    aria-label={`Play take ${take.name}`}
                  >
                    ▶
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => deleteTake(take.id)}
                    disabled={isRecording}
                    style={{
                      background: 'none',
                      border: '1px solid #444',
                      borderRadius: '3px',
                      color: '#f66',
                      cursor: isRecording ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      padding: '3px 6px',
                    }}
                    title="Delete this take"
                    aria-label={`Delete take ${take.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Punch-In Controls ────────────────────────────────────── */}
        {/* Show whenever takes exist — mic only needed for actual punch-in recording */}
        {takes.length > 0 && (
          <div>
            <label style={labelWithHelpStyle}>
              <span>Punch-In</span>
              <HelpTooltip
                detail={TOOLTIPS.punchIn.detail}
                pairsWith={TOOLTIPS.punchIn.pairsWith}
              />
            </label>

            {!selectedTakeId ? (
              <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.4 }}>
                Audition a take first, then mark a region to punch in.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {/* Mark Start / Mark End buttons — click waveform to seek, then mark */}
                <div style={{ fontSize: '10px', color: '#666', lineHeight: 1.3, marginBottom: '2px' }}>
                  Click the waveform to position the cursor, then mark start and end.
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => {
                      const time = getCursorTime()
                      const current = punchInRegion
                      // Set start, keep existing end (or default to duration end)
                      const endTime = current?.endTime ?? time + 1
                      setPunchInRegion({
                        startTime: Math.min(time, endTime),
                        endTime: Math.max(time, endTime),
                      })
                    }}
                    disabled={isRecording}
                    style={{
                      flex: 1,
                      padding: '5px 4px',
                      borderRadius: '3px',
                      border: punchInRegion ? '1px solid #4a8abf' : '1px solid #555',
                      backgroundColor: '#1a2a3a',
                      color: '#8cf',
                      cursor: isRecording ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      fontWeight: 500,
                    }}
                  >
                    ◂ Mark Start
                  </button>
                  <button
                    onClick={() => {
                      const time = getCursorTime()
                      const current = punchInRegion
                      // Set end, keep existing start (or default to 0)
                      const startTime = current?.startTime ?? 0
                      setPunchInRegion({
                        startTime: Math.min(startTime, time),
                        endTime: Math.max(startTime, time),
                      })
                    }}
                    disabled={isRecording}
                    style={{
                      flex: 1,
                      padding: '5px 4px',
                      borderRadius: '3px',
                      border: punchInRegion ? '1px solid #4a8abf' : '1px solid #555',
                      backgroundColor: '#1a2a3a',
                      color: '#8cf',
                      cursor: isRecording ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      fontWeight: 500,
                    }}
                  >
                    Mark End ▸
                  </button>
                </div>

                {/* Show selected region info and punch-in button when region is marked */}
                {punchInRegion && (
                  <>
                    <div style={{ fontSize: '11px', color: '#aaa', fontFamily: 'monospace', textAlign: 'center' }}>
                      {formatDuration(punchInRegion.startTime * 1000)} → {formatDuration(punchInRegion.endTime * 1000)}
                      <span style={{ color: '#666', marginLeft: '6px' }}>
                        ({((punchInRegion.endTime - punchInRegion.startTime) * 1000).toFixed(0)}ms)
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => void punchIn(punchInRegion)}
                        disabled={isRecording || !micActive}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          borderRadius: '3px',
                          border: '1px solid #e0a050',
                          backgroundColor: (!micActive || isRecording) ? '#1a1a2e' : '#3a2a1a',
                          color: (!micActive || isRecording) ? '#666' : '#fc8',
                          cursor: (isRecording || !micActive) ? 'not-allowed' : 'pointer',
                          fontSize: '12px',
                          fontWeight: 600,
                        }}
                      >
                        🎙 Punch In (<kbd style={kbdStyle}>P</kbd>)
                      </button>

                      <button
                        onClick={() => setPunchInRegion(null)}
                        style={{
                          padding: '6px 8px',
                          borderRadius: '3px',
                          border: '1px solid #444',
                          backgroundColor: '#1a1a2e',
                          color: '#888',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                        title="Clear selected region"
                      >
                        ✕
                      </button>
                    </div>
                    {!micActive && (
                      <div style={{ fontSize: '10px', color: '#e0a050', lineHeight: 1.3, marginTop: '2px' }}>
                        Start mic to punch in.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────

const labelWithHelpStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '11px',
  color: '#999',
  marginBottom: '3px',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#1a1a2e',
  border: '1px solid #444',
  color: '#e0e0e0',
  padding: '4px 6px',
  borderRadius: '3px',
  fontSize: '12px',
}

/** Keyboard shortcut badge styling */
const kbdStyle: React.CSSProperties = {
  backgroundColor: '#222',
  border: '1px solid #444',
  borderRadius: '3px',
  padding: '1px 4px',
  fontSize: '10px',
  fontFamily: 'monospace',
  color: '#aaa',
}
