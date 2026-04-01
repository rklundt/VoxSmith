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
 * VoxSmith — App Shell
 *
 * Sprint 2: Mounts the ControlPanel with Stage 1 pipeline and Stage 2 effects.
 * The SpikeTestUI from Sprint 1 has been replaced.
 *
 * Future sprints will add:
 * - Sprint 4: WaveformPanel
 * - Sprint 5: PresetPanel
 * - Sprint 7: Recording controls
 * - Sprint 8: Settings panel
 */

import React, { useEffect } from 'react'
import { ControlPanel } from './components/panels/ControlPanel'

function App(): React.ReactElement {
  // Verify IPC bridge is still working (runs silently in the background)
  useEffect(() => {
    window.voxsmith.getSettings()
      .then(() => console.debug('[App] IPC bridge active'))
      .catch((err: unknown) => console.error('[App] IPC bridge error:', err))
  }, [])

  return <ControlPanel />
}

export default App
