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
 * HelpTooltip — Shared (?) icon with hover tooltip
 *
 * A small "?" circle that shows a positioned tooltip on hover.
 * Uses React state instead of native title for faster delay (~200ms vs ~400ms)
 * and controlled width to prevent overflow in narrow panels like ExportPanel.
 *
 * IMPORTANT: The tooltip popup renders via a React Portal at the <body> level.
 * This is necessary because parent containers (like ExportPanel) use
 * `overflow: hidden` or `overflow: auto`, which clip absolutely-positioned
 * children no matter how high their z-index is. Portals escape all clipping.
 *
 * The `anchor` prop controls which direction the tooltip opens:
 *  - 'left' (default): tooltip opens to the right of the icon
 *  - 'right': tooltip opens to the left of the icon (for right-side panels)
 */

import React, { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface HelpTooltipProps {
  /** The full detail text to show */
  detail: string
  /** "Works well with" pairings */
  pairsWith: string[]
  /**
   * Which side the tooltip anchors from.
   * 'left' = tooltip opens rightward (default, for main panel controls)
   * 'right' = tooltip opens leftward (for right-side panels like Export)
   */
  anchor?: 'left' | 'right'
}

/** Fixed width for the tooltip popup */
const TOOLTIP_WIDTH = 240

export function HelpTooltip({ detail, pairsWith, anchor = 'left' }: HelpTooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false)
  // Store the computed screen position of the tooltip popup
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref to the "?" icon so we can measure its screen position
  const iconRef = useRef<HTMLSpanElement>(null)

  const handleMouseEnter = useCallback(() => {
    // ~200ms delay — half the default browser title delay (~400ms)
    timerRef.current = setTimeout(() => {
      // Measure the icon's position on screen so the portal-rendered tooltip
      // appears right below it, regardless of overflow clipping on ancestors.
      if (iconRef.current) {
        const rect = iconRef.current.getBoundingClientRect()
        if (anchor === 'right') {
          // Tooltip opens leftward: right edge aligns with the icon's right edge
          setPosition({
            top: rect.bottom + 4,
            left: rect.right - TOOLTIP_WIDTH,
          })
        } else {
          // Tooltip opens rightward: left edge aligns with the icon's left edge
          setPosition({
            top: rect.bottom + 4,
            left: rect.left,
          })
        }
      }
      setVisible(true)
    }, 200)
  }, [anchor])

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  return (
    <span
      ref={iconRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
    >
      {/* The "?" circle */}
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        border: '1px solid #555',
        fontSize: '9px',
        color: '#777',
        cursor: 'help',
      }}>
        ?
      </span>

      {/* Tooltip popup — rendered via Portal at <body> to escape overflow clipping */}
      {visible && createPortal(
        <div style={{
          position: 'fixed',
          top: `${position.top}px`,
          left: `${position.left}px`,
          backgroundColor: '#1e2a3a',
          border: '1px solid #3a4a5a',
          borderRadius: '6px',
          padding: '10px 12px',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#d0d0d0',
          width: `${TOOLTIP_WIDTH}px`,
          whiteSpace: 'normal',
          wordWrap: 'break-word',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }}>
          <div style={{ marginBottom: '6px' }}>{detail}</div>
          <div style={{ fontSize: '11px', color: '#8a9aaa' }}>
            Works well with: {pairsWith.join(', ')}
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}
