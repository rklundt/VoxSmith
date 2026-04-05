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
 * Session Store - Zustand (PLACEHOLDER — Sprint 8+)
 *
 * NOT currently used. Kept as a documented placeholder for future sprint work:
 *  - Sprint 8: Take list management, recording session state, export queue
 *  - Sprint 9: Script import, session management, line-by-line workflow
 *
 * Recording state currently lives in engineStore (recordingState, activeTake).
 * This store will own session-level state once Sprint 8 adds multi-take workflows.
 *
 * If this file is still unused after Sprint 9, delete it.
 */

import { create } from 'zustand'

interface SessionState {
  // TODO Sprint 8: Add takes[], activeTakeId, exportQueue
  /** Placeholder — not currently wired to any component */
  placeholder: boolean
}

export const useSessionStore = create<SessionState>(() => ({
  placeholder: false,
}))
