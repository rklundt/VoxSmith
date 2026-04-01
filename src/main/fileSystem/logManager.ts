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
 * Log Manager — Main Process
 *
 * Handles session log file creation and purge-on-startup.
 *
 * Strategy:
 * - A new log file is created on every app launch: logs/session-YYYY-MM-DD_HH-MM-SS.log
 * - After creating the new file, oldest logs are purged if count exceeds maxSessionFiles
 * - maxSessionFiles is read from merged settings — configurable without a code change
 */

import fs from 'fs'
import path from 'path'
import winston from 'winston'
import { app } from 'electron'
import { APP_NAME } from '../../shared/constants'

/**
 * Creates the logs directory if it doesn't exist and returns its path.
 */
function getLogDir(): string {
  const logDir = path.join(app.getAppPath(), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

/**
 * Generates a session log filename with the current timestamp.
 * Format: session-YYYY-MM-DD_HH-MM-SS.log
 */
function generateLogFilename(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + '_' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('-')
  return `session-${timestamp}.log`
}

/**
 * Purges oldest session log files if the count exceeds maxSessionFiles.
 *
 * Sorts log files by name (which sorts chronologically due to the timestamp format),
 * then deletes the oldest files until count is within the limit.
 */
export function purgeOldLogs(logDir: string, maxSessionFiles: number): void {
  try {
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith('session-') && f.endsWith('.log'))
      .sort() // Chronological sort — earliest first due to YYYY-MM-DD_HH-MM-SS format

    // Delete oldest files until we're at or below the limit
    const toDelete = files.length - maxSessionFiles
    if (toDelete > 0) {
      for (let i = 0; i < toDelete; i++) {
        const filePath = path.join(logDir, files[i])
        fs.unlinkSync(filePath)
      }
    }
  } catch {
    // If purge fails, continue — this is a housekeeping operation, not critical
    console.error('Failed to purge old log files')
  }
}

/**
 * Creates and configures the Winston logger for this session.
 *
 * Transports:
 * - File: session log file in logs/ directory
 * - Console: dev only (when app is not packaged)
 *
 * Log format includes timestamp, level, and message for easy parsing.
 */
export function createSessionLogger(logLevel: string): winston.Logger {
  const logDir = getLogDir()
  const logFilename = generateLogFilename()
  const logPath = path.join(logDir, logFilename)

  const transports: winston.transport[] = [
    // Session log file — always active
    new winston.transports.File({
      filename: logPath,
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}`
        })
      ),
    }),
  ]

  // Console transport — dev mode only, for developer convenience
  if (!app.isPackaged) {
    transports.push(
      new winston.transports.Console({
        level: 'debug',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
          winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} ${level} ${message}`
          })
        ),
      })
    )
  }

  const logger = winston.createLogger({
    level: logLevel,
    defaultMeta: { service: APP_NAME },
    transports,
  })

  return logger
}

/**
 * Initializes logging for the current session.
 *
 * 1. Creates a new session log file
 * 2. Purges oldest logs if count exceeds maxSessionFiles
 * 3. Logs app launch info (version, platform, paths)
 *
 * Returns the configured Winston logger instance.
 */
export function initializeLogging(maxSessionFiles: number, logLevel: string): winston.Logger {
  const logDir = getLogDir()
  const logger = createSessionLogger(logLevel)

  // Purge old logs after creating the new one
  // (the new file already exists at this point via the File transport)
  purgeOldLogs(logDir, maxSessionFiles)

  // Log app launch info — required by CLAUDE.md logging spec
  logger.info(`${APP_NAME} starting`)
  logger.info(`Version: ${app.getVersion()}`)
  logger.info(`Platform: ${process.platform} ${process.arch}`)
  logger.info(`Electron: ${process.versions.electron}`)
  logger.info(`Chrome: ${process.versions.chrome}`)
  logger.info(`Node: ${process.versions.node}`)
  logger.info(`App path: ${app.getAppPath()}`)
  logger.info(`User data: ${app.getPath('userData')}`)
  logger.info(`Packaged: ${app.isPackaged}`)

  return logger
}
