import React from 'react';
import { useEnvironment, useWindowControls } from '../../shared/hooks';
import { isTauri } from 'shared-types';

interface TitleBarProps {
  title?: string;
}

export function TitleBar({ title = 'EasyWork' }: TitleBarProps) {
  const { environment, platform } = useEnvironment();
  const { minimize, toggleMaximize, close, startDragging, onDoubleClick } = useWindowControls();

  // Don't render in web environment
  if (environment !== 'tauri') {
    return null;
  }

  // macOS uses native traffic lights
  const isMacOS = platform?.os === 'macos';

  return (
    <div
      className="titlebar flex h-8 select-none flex-row items-center bg-zinc-900 text-zinc-300"
      onMouseDown={(e) => {
        if (e.buttons === 1) {
          startDragging();
        }
      }}
      onDoubleClick={onDoubleClick}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left side - macOS traffic lights spacing or menu area */}
      <div className="flex w-20 flex-shrink-0 items-center px-3">
        {isMacOS && (
          <div className="traffic-lights">
            {/* Native macOS traffic lights will be shown by the system */}
          </div>
        )}
      </div>

      {/* Center - Title */}
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm font-medium">{title}</span>
      </div>

      {/* Right side - Windows/Linux window controls */}
      {!isMacOS && (
        <div className="flex flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={minimize}
            className="flex h-8 w-12 items-center justify-center hover:bg-zinc-700"
            title="Minimize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect fill="currentColor" width="10" height="1" x="1" y="6" />
            </svg>
          </button>
          <button
            onClick={toggleMaximize}
            className="flex h-8 w-12 items-center justify-center hover:bg-zinc-700"
            title="Maximize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect
                fill="none"
                stroke="currentColor"
                width="9"
                height="9"
                x="1.5"
                y="1.5"
              />
            </svg>
          </button>
          <button
            onClick={close}
            className="flex h-8 w-12 items-center justify-center hover:bg-red-600"
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path
                fill="currentColor"
                d="M6.707 6l3.147-3.146a.5.5 0 0 0-.708-.708L6 5.293 2.854 2.146a.5.5 0 1 0-.708.708L5.293 6l-3.147 3.146a.5.5 0 0 0 .708.708L6 6.707l3.146 3.147a.5.5 0 0 0 .708-.708L6.707 6z"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Spacing for macOS right side */}
      {isMacOS && <div className="w-20 flex-shrink-0" />}
    </div>
  );
}
