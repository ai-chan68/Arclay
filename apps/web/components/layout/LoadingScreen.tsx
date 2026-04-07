import React from 'react';
import { isTauri } from 'shared-types';
import {
  appInitializer,
  type InitState,
} from '../../shared/initialization/app-initializer';

interface LoadingScreenProps {
  message?: string;
  progress?: number;
}

export function LoadingScreen({
  message = 'Loading...',
  progress,
}: LoadingScreenProps) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-900 text-zinc-300">
      <div className="flex min-w-60 flex-col items-center gap-4 px-6">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-600 border-t-blue-500" />
        <p className="text-sm">{message}</p>
        {typeof progress === 'number' && (
          <div className="w-full">
            <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-700">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const INITIAL_STATE: InitState = appInitializer.getState();

export function AppInitializer({ children }: { children: React.ReactNode }) {
  const [initState, setInitState] = React.useState<InitState>(INITIAL_STATE);
  const hasStartedRef = React.useRef(false);

  React.useEffect(() => {
    const unsubscribe = appInitializer.onStateChange((state) => {
      setInitState({ ...state });
    });

    if (!hasStartedRef.current && appInitializer.getState().phase !== 'ready') {
      hasStartedRef.current = true;
      appInitializer.initialize().catch(() => {
        // Error state is handled via subscription
      });
    }

    return unsubscribe;
  }, []);

  // Save window state on unmount
  React.useEffect(() => {
    const saveState = async () => {
      try {
        if (!isTauri()) return;

        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const [position, size, isMaximized] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          win.isMaximized(),
        ]);

        localStorage.setItem(
          'window_state',
          JSON.stringify({
            bounds: {
              x: position.x,
              y: position.y,
              width: size.width,
              height: size.height,
            },
            isMaximized,
          })
        );
      } catch {
        // Ignore errors during cleanup
      }
    };

    return () => {
      saveState();
    };
  }, []);

  if (initState.phase === 'error') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-900 text-red-400">
        <div className="text-center">
          <p className="text-lg font-medium">Failed to start application</p>
          <p className="mt-2 text-sm text-zinc-400">
            {initState.error?.message || 'Initialization failed'}
          </p>
          <button
            className="mt-4 rounded bg-zinc-700 px-3 py-1 text-sm text-zinc-100 hover:bg-zinc-600"
            onClick={() => {
              appInitializer.retry().catch(() => {
                // Error state is handled via subscription
              });
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (initState.phase !== 'ready') {
    return (
      <LoadingScreen
        message={initState.message || 'Initializing...'}
        progress={initState.progress}
      />
    );
  }

  return <>{children}</>;
}
