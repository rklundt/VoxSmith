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
 * ExportPanel - Audio Export Controls UI (Sprint 6)
 *
 * Right sidebar panel for configuring and triggering audio exports.
 * All export settings are controlled here:
 *   - Bit depth (16, 24, 32)
 *   - Sample rate (44100, 48000)
 *   - Normalize on/off
 *   - Noise gate on/off
 *   - Silence padding (start/end in ms)
 *   - Export button with status feedback
 *
 * ARCHITECTURE:
 * This component handles display and user interaction ONLY.
 * The useExport hook handles WAV encoding and IPC calls.
 */

import React, { useCallback } from 'react'
import { TOOLTIPS } from '../../../shared/tooltips'
import { HelpTooltip } from '../controls/HelpTooltip'
import type { ExportSettings, ExportStatus } from '../../hooks/useExport'

// ─── Props ────────────────────────────────────────────────────────────────

interface ExportPanelProps {
  settings: ExportSettings
  updateSetting: <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => void
  status: ExportStatus
  error: string | null
  lastExportPath: string | null
  onExport: (suggestedName?: string) => Promise<unknown>
  onResetStatus: () => void
  hasAudio: boolean
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────

export function ExportPanel(props: ExportPanelProps): React.ReactElement {
  const {
    settings,
    updateSetting,
    status,
    error,
    lastExportPath,
    onExport,
    onResetStatus,
    hasAudio,
    onClose,
  } = props

  const handleExport = useCallback(() => {
    onResetStatus()
    onExport()
  }, [onExport, onResetStatus])

  // Determine if the export button should be disabled
  const isExporting = status === 'encoding' || status === 'exporting'
  const canExport = hasAudio && !isExporting

  return (
    <div
      style={{
        width: '240px',
        minWidth: '200px',
        maxWidth: '300px',
        backgroundColor: '#0d0d1a',
        borderLeft: '1px solid #333',
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
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#ddd' }}>
          Export
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
          title="Hide Export"
        >
          &#x2715;
        </button>
      </div>

      {/* ── Settings ─────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>

        {/* Bit Depth */}
        <div>
          <label style={labelWithHelpStyle}>
            <span>{TOOLTIPS.bitDepth.label}</span>
            <HelpTooltip detail={TOOLTIPS.bitDepth.detail} pairsWith={TOOLTIPS.bitDepth.pairsWith} anchor="right" />
          </label>
          <select
            value={settings.bitDepth}
            onChange={(e) => updateSetting('bitDepth', Number(e.target.value) as 16 | 24 | 32)}
            style={selectStyle}
          >
            <option value={16}>16-bit (standard)</option>
            <option value={24}>24-bit (recommended)</option>
            <option value={32}>32-bit (maximum)</option>
          </select>
        </div>

        {/* Sample Rate */}
        <div>
          <label style={labelWithHelpStyle}>
            <span>{TOOLTIPS.sampleRate.label}</span>
            <HelpTooltip detail={TOOLTIPS.sampleRate.detail} pairsWith={TOOLTIPS.sampleRate.pairsWith} anchor="right" />
          </label>
          <select
            value={settings.sampleRate}
            onChange={(e) => updateSetting('sampleRate', Number(e.target.value))}
            style={selectStyle}
          >
            <option value={44100}>44100 Hz (standard)</option>
            <option value={48000}>48000 Hz (video/some games)</option>
          </select>
        </div>

        {/* Normalize */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.normalize}
            onChange={(e) => updateSetting('normalize', e.target.checked)}
          />
          <span style={{ fontSize: '12px', color: '#ccc' }}>
            {TOOLTIPS.normalize.label}
          </span>
          <HelpTooltip detail={TOOLTIPS.normalize.detail} pairsWith={TOOLTIPS.normalize.pairsWith} anchor="right" />
        </label>

        {/* Noise Gate */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.noiseGate}
            onChange={(e) => updateSetting('noiseGate', e.target.checked)}
          />
          <span style={{ fontSize: '12px', color: '#ccc' }}>
            {TOOLTIPS.noiseGate.label}
          </span>
          <HelpTooltip detail={TOOLTIPS.noiseGate.detail} pairsWith={TOOLTIPS.noiseGate.pairsWith} anchor="right" />
        </label>

        {/* Silence Padding - Start */}
        <div>
          <label style={labelWithHelpStyle}>
            <span>Pad Start (ms)</span>
            <HelpTooltip detail={TOOLTIPS.silencePadding.detail} pairsWith={TOOLTIPS.silencePadding.pairsWith} anchor="right" />
          </label>
          <input
            type="number"
            min={0}
            max={5000}
            step={10}
            value={settings.padStartMs}
            onChange={(e) => updateSetting('padStartMs', Math.max(0, Number(e.target.value)))}
            style={inputStyle}
          />
        </div>

        {/* Silence Padding - End */}
        <div>
          <label style={labelWithHelpStyle}>
            <span>Pad End (ms)</span>
            <HelpTooltip detail={TOOLTIPS.silencePadding.detail} pairsWith={TOOLTIPS.silencePadding.pairsWith} anchor="right" />
          </label>
          <input
            type="number"
            min={0}
            max={5000}
            step={10}
            value={settings.padEndMs}
            onChange={(e) => updateSetting('padEndMs', Math.max(0, Number(e.target.value)))}
            style={inputStyle}
          />
        </div>

        {/* ── Divider ────────────────────────────────────────────── */}
        <div style={{ borderTop: '1px solid #333', margin: '4px 0' }} />

        {/* ── Export Button ───────────────────────────────────────── */}
        <button
          onClick={handleExport}
          disabled={!canExport}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: canExport ? '1px solid #4a8abf' : '1px solid #333',
            backgroundColor: canExport ? '#2a4a6b' : '#1a1a2e',
            color: canExport ? '#ddd' : '#555',
            cursor: canExport ? 'pointer' : 'not-allowed',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          {isExporting
            ? (status === 'encoding' ? 'Encoding...' : 'Exporting...')
            : 'Export WAV'}
        </button>

        {/* No audio loaded warning */}
        {!hasAudio && (
          <div style={{ fontSize: '11px', color: '#888' }}>
            Load an audio file first to export.
          </div>
        )}

        {/* ── Status Feedback ─────────────────────────────────────── */}
        {status === 'success' && lastExportPath && (
          <div style={{ fontSize: '11px', color: '#5c5' }}>
            Exported to: {lastExportPath}
          </div>
        )}

        {status === 'error' && error && (
          <div style={{ fontSize: '11px', color: '#f55' }}>
            Export failed: {error}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Shared Inline Styles ─────────────────────────────────────────────────

/** Label row with (?) icon — flexbox so the icon sits inline with the text */
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#1a1a2e',
  border: '1px solid #444',
  color: '#e0e0e0',
  padding: '4px 6px',
  borderRadius: '3px',
  fontSize: '12px',
  boxSizing: 'border-box',
}
