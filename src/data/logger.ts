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
 * Logger — Renderer Side
 *
 * Lightweight logging utility for the renderer process.
 * Uses console methods since Winston runs in main process only.
 *
 * The main process handles structured logging to session files.
 * This module provides a consistent interface for renderer-side logging
 * that mirrors the log level conventions from CLAUDE.md.
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug'

/**
 * Renderer-side logger.
 * Outputs to browser console in dev mode.
 * In production, critical errors should be surfaced to the user via UI.
 */
export const rendererLogger = {
  error: (message: string, ...args: unknown[]): void => {
    console.error(`[VoxSmith] ${message}`, ...args)
  },
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(`[VoxSmith] ${message}`, ...args)
  },
  info: (message: string, ...args: unknown[]): void => {
    console.info(`[VoxSmith] ${message}`, ...args)
  },
  debug: (message: string, ...args: unknown[]): void => {
    console.debug(`[VoxSmith] ${message}`, ...args)
  },
}
