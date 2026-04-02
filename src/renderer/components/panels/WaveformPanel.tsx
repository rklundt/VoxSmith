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
 * WaveformPanel - Audio Waveform Display and Level Meter (Sprint 4)
 *
 * Provides visual feedback during playback:
 * - Waveform rendering via WaveSurfer.js
 * - Moving playhead that tracks playback position
 * - Click-to-seek on the waveform
 * - Real-time level meter with clip detection
 *
 * ARCHITECTURE NOTES:
 * - WaveSurfer.js handles waveform rendering and interaction (seek, playhead)
 * - The level meter reads from AudioEngine's AnalyserNode via getOutputLevel()
 * - Playhead position is synced via requestAnimationFrame polling of getCurrentTime()
 * - WaveSurfer uses its own internal audio for rendering, but we DON'T let it play audio -
 *   all audio playback goes through our AudioEngine. WaveSurfer is display-only here.
 *
 * WHY NOT LET WAVESURFER PLAY AUDIO:
 * WaveSurfer.js has its own playback engine, but we can't use it because our audio
 * goes through the AudioEngine's effects chain (EQ, reverb, etc.). If WaveSurfer
 * played audio, it would bypass all effects. Instead, we use WaveSurfer purely for
 * waveform visualization and playhead display, while AudioEngine handles all audio.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { useEngineStore } from '../../stores/engineStore'
import { TOOLTIPS } from '../../../shared/tooltips'

// ─── Props ────────────────────────────────────────────────────────────────

interface WaveformPanelProps {
  /**
   * Returns the current playback position in seconds.
   * Called on every animation frame while playing.
   */
  getCurrentTime: () => number

  /**
   * Returns the duration of the active buffer in seconds.
   */
  getDuration: () => number

  /**
   * Returns the current output peak level (0.0 to 1.0+).
   * Values above 1.0 mean clipping.
   */
  getOutputLevel: () => number

  /**
   * Seeks the AudioEngine to a specific time in seconds.
   * Called when the user clicks on the waveform.
   */
  seek: (seconds: number) => void

  /**
   * The AudioEngine instance's AudioContext - needed to create an
   * AudioBuffer that WaveSurfer can render from. We pass the engine
   * reference to access the active buffer for waveform rendering.
   */
  getEngine: () => { activeBuffer: AudioBuffer | null; audioContext: AudioContext }
}

export function WaveformPanel({
  getCurrentTime,
  getDuration,
  getOutputLevel,
  seek,
  getEngine,
}: WaveformPanelProps): React.ReactElement {
  // DOM ref for the WaveSurfer container div
  const waveformRef = useRef<HTMLDivElement>(null)

  // WaveSurfer instance ref - created once, updated when buffer changes
  const wsRef = useRef<WaveSurfer | null>(null)

  // Animation frame ID for cleanup
  const animFrameRef = useRef<number>(0)

  // Level meter state - updated every animation frame
  const [level, setLevel] = useState(0)
  const [isClipping, setIsClipping] = useState(false)

  // Peak hold for the level meter - shows the highest recent peak
  // with a slow decay so the user can see transient peaks
  const peakHoldRef = useRef(0)
  const peakDecayTimerRef = useRef(0)

  // Store state
  const isPlaying = useEngineStore((s) => s.isPlaying)
  const hasFile = useEngineStore((s) => s.hasFile)
  const hasProcessed = useEngineStore((s) => s.hasProcessed)

  // ─── WaveSurfer Initialization ──────────────────────────────────────

  useEffect(() => {
    if (!waveformRef.current) return

    // Create WaveSurfer instance - display-only mode (no audio playback).
    // We set interact=true so the user can click to seek, but WaveSurfer
    // won't play audio itself - we intercept the seek event and route
    // it through our AudioEngine instead.
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4a6fa5',
      progressColor: '#64b5f6',
      cursorColor: '#ff9800',
      cursorWidth: 2,
      height: 100,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
      // WaveSurfer is display-only in VoxSmith. We feed it pre-computed
      // peaks from AudioEngine's buffer via load('', peaks, duration),
      // so it never decodes audio or creates a playback media element.
      // All audio playback goes through AudioEngine's effects chain.
    })

    wsRef.current = ws

    // Intercept WaveSurfer's seeking event - when the user clicks on the waveform,
    // WaveSurfer emits a 'seeking' event with the currentTime in seconds.
    // We route this directly through our AudioEngine's seek method.
    ws.on('seeking', (currentTime: number) => {
      seek(currentTime)
    })

    // Also handle the 'interaction' event for drag-seeking (user drags across waveform).
    // This emits the newTime in seconds as the user drags.
    ws.on('interaction', (newTime: number) => {
      seek(newTime)
    })

    return () => {
      ws.destroy()
      wsRef.current = null
    }
    // getDuration and seek are stable callbacks (useCallback with [getEngine])
    // so this effect only runs once on mount
  }, [getDuration, seek])

  // ─── Load Waveform When Buffer Changes ──────────────────────────────

  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    const engine = getEngine()
    const buffer = engine.activeBuffer

    if (buffer) {
      // Pass raw peak data directly to WaveSurfer - no audio decoding, no
      // media element, no playback engine. WaveSurfer renders the waveform
      // from the Float32Array channel data we already have in the AudioBuffer.
      // This is the most performant approach: zero CPU spent on redundant
      // audio decoding, and WaveSurfer has nothing to "play" through speakers.
      const peaks = [buffer.getChannelData(0)]
      ws.load('', peaks, buffer.duration).catch((err) => {
        console.error('[WaveformPanel] Failed to render waveform:', err)
      })
    } else {
      // No buffer loaded - show empty waveform
      ws.empty()
    }
  }, [hasFile, hasProcessed, getEngine])

  // ─── Playhead Sync + Level Meter Animation Loop ─────────────────────

  useEffect(() => {
    // Only run the animation loop when audio is playing.
    // This saves CPU when idle - no unnecessary frame updates.
    if (!isPlaying) {
      // Reset level meter when not playing
      setLevel(0)
      setIsClipping(false)
      return
    }

    const animate = () => {
      const ws = wsRef.current
      if (ws) {
        // Sync WaveSurfer's visual playhead with AudioEngine's current position.
        // getCurrentTime() reads from the AudioContext clock, so it's sample-accurate.
        const currentTime = getCurrentTime()
        const duration = getDuration()
        if (duration > 0) {
          // setTime() moves WaveSurfer's cursor/progress without triggering playback
          const progress = currentTime / duration
          ws.seekTo(Math.min(progress, 1))
        }
      }

      // Update level meter from AnalyserNode
      const currentLevel = getOutputLevel()
      setLevel(currentLevel)
      setIsClipping(currentLevel >= 1.0)

      // Peak hold with decay - holds the peak for ~1 second, then decays
      if (currentLevel > peakHoldRef.current) {
        peakHoldRef.current = currentLevel
        peakDecayTimerRef.current = 60 // ~1 second at 60fps
      } else if (peakDecayTimerRef.current > 0) {
        peakDecayTimerRef.current--
      } else {
        // Decay the peak hold gradually
        peakHoldRef.current *= 0.95
      }

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying, getCurrentTime, getDuration, getOutputLevel])

  // ─── Render ─────────────────────────────────────────────────────────

  // Convert level (0-1+) to a display percentage (capped at 100%)
  const levelPercent = Math.min(level * 100, 100)

  // Color the meter based on level: green (safe) -> yellow (hot) -> red (clipping)
  const meterColor = isClipping ? '#f44336' : level > 0.7 ? '#ff9800' : '#4caf50'

  // Peak hold indicator position
  const peakPercent = Math.min(peakHoldRef.current * 100, 100)

  return (
    <div style={{
      padding: '16px 24px',
      backgroundColor: '#1a1a2e',
      borderBottom: '1px solid #2a2a4e',
    }}>
      {/* ─── Waveform Display ────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      }}>
        <span style={{ fontSize: '12px', color: '#888' }} title={TOOLTIPS.waveform.detail}>
          Waveform
        </span>
      </div>

      <div
        ref={waveformRef}
        style={{
          width: '100%',
          backgroundColor: '#16213e',
          borderRadius: '6px',
          overflow: 'hidden',
          minHeight: '100px',
          // Show a subtle message when no file is loaded
          ...(hasFile ? {} : {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }),
        }}
      >
        {!hasFile && (
          <span style={{ color: '#555', fontSize: '13px', pointerEvents: 'none' }}>
            Load an audio file to see the waveform
          </span>
        )}
      </div>

      {/* ─── Level Meter ─────────────────────────────────────────────── */}
      <div style={{
        marginTop: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span
          style={{ fontSize: '12px', color: '#888', minWidth: '32px' }}
          title={TOOLTIPS.levelMeter.detail}
        >
          Level
        </span>

        {/* Meter bar container */}
        <div style={{
          flex: 1,
          height: '12px',
          backgroundColor: '#16213e',
          borderRadius: '3px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {/* Filled portion - represents current level */}
          <div style={{
            height: '100%',
            width: `${levelPercent}%`,
            backgroundColor: meterColor,
            borderRadius: '3px',
            transition: 'width 0.05s ease-out',
          }} />

          {/* Peak hold indicator - a thin line showing recent peak */}
          {peakPercent > 1 && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: `${peakPercent}%`,
              width: '2px',
              height: '100%',
              backgroundColor: peakPercent >= 100 ? '#f44336' : '#ffffff55',
              transition: 'left 0.05s ease-out',
            }} />
          )}
        </div>

        {/* Numeric dB readout */}
        <span style={{
          fontSize: '11px',
          color: isClipping ? '#f44336' : '#888',
          minWidth: '48px',
          textAlign: 'right',
          fontFamily: 'monospace',
          fontWeight: isClipping ? 'bold' : 'normal',
        }}>
          {level > 0.001
            ? `${(20 * Math.log10(level)).toFixed(1)} dB`
            : '-inf dB'
          }
        </span>

        {/* Clip indicator */}
        {isClipping && (
          <span style={{
            fontSize: '10px',
            color: '#f44336',
            fontWeight: 'bold',
            animation: 'none',
          }}>
            CLIP
          </span>
        )}
      </div>

      {/* ─── Time Display ────────────────────────────────────────────── */}
      {hasFile && (
        <div style={{
          marginTop: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#666',
          fontFamily: 'monospace',
        }}>
          <span>{formatTime(isPlaying ? getCurrentTime() : 0)}</span>
          <span>{formatTime(getDuration())}</span>
        </div>
      )}
    </div>
  )
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Formats seconds into MM:SS.ms display format.
 * Used for the time display below the waveform.
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
}

