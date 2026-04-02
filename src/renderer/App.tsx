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
 * Sprint 4: Adds WaveformPanel above ControlPanel for visual feedback.
 * WaveformPanel renders the audio waveform, level meter, and playhead.
 * ControlPanel handles all parameter controls and playback buttons.
 *
 * Both panels share the same AudioEngine instance via useAudioEngine().
 * The hook is called here in App so that both children access the same
 * engine. Props are passed down rather than calling the hook in each child.
 *
 * Future sprints will add:
 * - Sprint 5: PresetPanel
 * - Sprint 7: Recording controls
 * - Sprint 8: Settings panel
 */

import React, { useEffect } from 'react'
import { ControlPanel } from './components/panels/ControlPanel'
import { WaveformPanel } from './components/panels/WaveformPanel'
import { useAudioEngine } from './hooks/useAudioEngine'

function App(): React.ReactElement {
  // Single AudioEngine instance shared by all panels.
  // useAudioEngine returns the module-level singleton and provides
  // stable callbacks for interacting with it.
  const audioEngine = useAudioEngine()

  // Verify IPC bridge is still working (runs silently in the background)
  useEffect(() => {
    window.voxsmith.getSettings()
      .then(() => console.debug('[App] IPC bridge active'))
      .catch((err: unknown) => console.error('[App] IPC bridge error:', err))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
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
  )
}

export default App
