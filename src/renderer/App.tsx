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
 * VoxSmith - App Shell
 *
 * Sprint 6: Adds ExportPanel sidebar for audio export controls.
 * Layout: TopBar + (optional PresetPanel) + main area + (optional ExportPanel).
 *
 * All panels share the same AudioEngine instance via useAudioEngine().
 * The hook is called here in App so that both children access the same
 * engine. Props are passed down rather than calling the hook in each child.
 *
 * Future sprints will add:
 * - Sprint 7: Recording controls
 * - Sprint 8: Settings panel (toggle in hamburger menu)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ControlPanel } from './components/panels/ControlPanel'
import { WaveformPanel } from './components/panels/WaveformPanel'
import { PresetPanel } from './components/panels/PresetPanel'
import { ExportPanel } from './components/panels/ExportPanel'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePresets } from './hooks/usePresets'
import { useExport } from './hooks/useExport'
import { useEngineStore } from './stores/engineStore'

function App(): React.ReactElement {
  // Single AudioEngine instance shared by all panels.
  // useAudioEngine returns the module-level singleton and provides
  // stable callbacks for interacting with it.
  const audioEngine = useAudioEngine()

  // Preset management hook - bridges UI actions to IPC and stores.
  // Receives applySnapshot so presets can update the audio engine.
  const presetsHook = usePresets(audioEngine.applySnapshot)

  // Export hook - handles WAV encoding and FFmpeg IPC pipeline.
  const exportHook = useExport(audioEngine.getEngine)

  // Track whether audio is loaded so we can disable export when empty
  const hasFile = useEngineStore((s) => s.hasFile)

  // ─── Panel Visibility ──────────────────────────────────────────────────
  // Both sidebars start hidden so the main controls have full width on launch.
  // The hamburger menu toggles them.
  const [showPresets, setShowPresets] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close hamburger menu when clicking outside of it
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const togglePresets = useCallback(() => {
    setShowPresets((prev) => !prev)
    setMenuOpen(false)
  }, [])

  const toggleExport = useCallback(() => {
    setShowExport((prev) => !prev)
    setMenuOpen(false)
  }, [])

  // Verify IPC bridge is still working (runs silently in the background)
  useEffect(() => {
    window.voxsmith.getSettings()
      .then(() => console.debug('[App] IPC bridge active'))
      .catch((err: unknown) => console.error('[App] IPC bridge error:', err))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* ── Top Bar ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 10px',
        backgroundColor: '#0a0a18',
        borderBottom: '1px solid #333',
        height: '32px',
        flexShrink: 0,
      }}>
        {/* App title */}
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#8ab', letterSpacing: '0.5px' }}>
          VoxSmith
        </span>

        {/* Hamburger menu */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: '#999',
              cursor: 'pointer',
              fontSize: '18px',
              padding: '2px 6px',
              lineHeight: 1,
            }}
            title="Menu"
          >
            {/* Three-line hamburger icon using unicode box-drawing chars */}
            &#9776;
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              backgroundColor: '#1a1a2e',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '4px 0',
              minWidth: '160px',
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}>
              <button
                onClick={togglePresets}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: '#ccc',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a2a4e')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {showPresets ? 'Hide Presets' : 'Show Presets'}
              </button>
              <button
                onClick={toggleExport}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: '#ccc',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a2a4e')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {showExport ? 'Hide Export' : 'Show Export'}
              </button>
              {/* Future menu items (Sprint 8: Settings, etc.) go here */}
            </div>
          )}
        </div>
      </div>

      {/* ── Main Layout ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left sidebar: preset library (hidden by default) */}
        {showPresets && (
          <PresetPanel
            onSaveNew={presetsHook.saveNewPreset}
            onLoad={presetsHook.loadPreset}
            onUpdate={presetsHook.updatePreset}
            onOverwrite={presetsHook.overwriteActivePreset}
            onDelete={presetsHook.deletePresetById}
            onSetPortrait={presetsHook.setPortrait}
            onAddEmotion={presetsHook.addEmotionVariant}
            onDeleteEmotion={presetsHook.deleteEmotionVariant}
            onLoadEmotion={presetsHook.loadEmotionVariant}
            applySnapshot={audioEngine.applySnapshot}
            onClose={togglePresets}
          />
        )}

        {/* Main content area: waveform + controls */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          {/* Waveform display and level meter - fixed at top */}
          <WaveformPanel
            getCurrentTime={audioEngine.getCurrentTime}
            getDuration={audioEngine.getDuration}
            getOutputLevel={audioEngine.getOutputLevel}
            seek={audioEngine.seek}
            getEngine={audioEngine.getEngine}
          />
          {/* All parameter controls and playback buttons */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ControlPanel />
          </div>
        </div>

        {/* Right sidebar: export controls (hidden by default) */}
        {showExport && (
          <ExportPanel
            settings={exportHook.settings}
            updateSetting={exportHook.updateSetting}
            status={exportHook.status}
            error={exportHook.error}
            lastExportPath={exportHook.lastExportPath}
            onExport={exportHook.exportAudio}
            onResetStatus={exportHook.resetStatus}
            hasAudio={hasFile}
            onClose={toggleExport}
          />
        )}
      </div>
    </div>
  )
}

export default App
