import { useState, useEffect, useCallback } from 'react';
import { RuntimeEnvironment, PlatformInfo, isTauri, WindowBounds, WindowState } from 'shared-types';

interface EnvironmentState {
  environment: RuntimeEnvironment;
  platform: PlatformInfo | null;
  isLoading: boolean;
}

export function useEnvironment(): EnvironmentState {
  const [state, setState] = useState<EnvironmentState>({
    environment: 'web',
    platform: null,
    isLoading: true,
  });

  useEffect(() => {
    async function detectEnvironment() {
      const environment = isTauri() ? 'tauri' : 'web';
      let platform: PlatformInfo | null = null;

      if (environment === 'tauri') {
        try {
          // Import Tauri API dynamically
          const { platform: getPlatform, arch, version } = await import('@tauri-apps/plugin-os');
          const osMap: Record<string, PlatformInfo['os']> = {
            macos: 'macos',
            windows: 'windows',
            linux: 'linux',
          };
          const archMap: Record<string, PlatformInfo['arch']> = {
            x86_64: 'x64',
            aarch64: 'arm64',
            arm64: 'arm64',
          };
          platform = {
            os: osMap[await getPlatform()] || 'unknown',
            arch: archMap[await arch()] || 'unknown',
            version: await version(),
          };
        } catch {
          platform = { os: 'unknown', arch: 'unknown', version: '' };
        }
      }

      setState({
        environment,
        platform,
        isLoading: false,
      });
    }

    detectEnvironment();
  }, []);

  return state;
}

// Window control functions
export function useWindowControls() {
  const minimize = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }, []);

  const close = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }, []);

  const startDragging = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  }, []);

  const onDoubleClick = useCallback(async () => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  }, []);

  return {
    minimize,
    toggleMaximize,
    close,
    startDragging,
    onDoubleClick,
  };
}

// Window state persistence
const WINDOW_STATE_KEY = 'window_state';

export function useWindowState() {
  const saveWindowState = useCallback(async () => {
    if (!isTauri()) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();

      const [position, size, isMaximized] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.isMaximized(),
      ]);

      const state: WindowState = {
        bounds: {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
        },
        isMaximized,
      };

      localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save window state:', error);
    }
  }, []);

  const restoreWindowState = useCallback(async () => {
    if (!isTauri()) return;

    try {
      const savedState = localStorage.getItem(WINDOW_STATE_KEY);
      if (!savedState) return;

      const state: WindowState = JSON.parse(savedState);
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
      const win = getCurrentWindow();

      // Restore position and size
      await win.setPosition(new PhysicalPosition(state.bounds.x, state.bounds.y));
      await win.setSize(new PhysicalSize(state.bounds.width, state.bounds.height));

      // Restore maximized state
      if (state.isMaximized) {
        await win.maximize();
      }
    } catch (error) {
      console.error('Failed to restore window state:', error);
    }
  }, []);

  return {
    saveWindowState,
    restoreWindowState,
  };
}
