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
 * Session Store — Zustand
 *
 * Owns: script lines (Phase 3), take list, recording state, punch-in markers, export queue.
 *
 * Sprint 0: Stub with empty state only.
 * Sprint 7: Will be populated with recording and take management.
 * Sprint 9: Will add script import and session management.
 */

import { create } from 'zustand'

interface SessionState {
  /** Whether the app is currently recording from mic */
  isRecording: boolean
}

export const useSessionStore = create<SessionState>(() => ({
  isRecording: false,
}))
