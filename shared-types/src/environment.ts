// Environment and platform types for Tauri integration

export type RuntimeEnvironment = 'tauri' | 'web';

export interface PlatformInfo {
  os: 'macos' | 'windows' | 'linux' | 'unknown';
  arch: 'x64' | 'arm64' | 'unknown';
  version: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowBounds;
  isMaximized: boolean;
}

// File system types
export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface PickFileOptions {
  multiple?: boolean;
  filter?: FileFilter;
  defaultPath?: string;
}

// Environment detection helper
export function detectEnvironment(): RuntimeEnvironment {
  // Check if running in browser-like environment with Tauri
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as {
      __TAURI__?: unknown;
      __TAURI_INTERNALS__?: unknown;
    };
    if ('__TAURI__' in g || '__TAURI_INTERNALS__' in g) {
      return 'tauri';
    }
  }
  return 'web';
}

// Check if running in Tauri
export function isTauri(): boolean {
  return detectEnvironment() === 'tauri';
}
