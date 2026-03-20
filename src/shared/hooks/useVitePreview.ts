/**
 * Vite Preview Hook
 * 
 * React hook for managing Vite preview server state
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PreviewStatus } from '../types/artifacts';
import { apiFetchRaw } from '../api';

const START_REQUEST_TIMEOUT_MS = 15000;

export interface VitePreviewState {
  status: PreviewStatus;
  url: string | null;
  error: string | null;
  port: number | null;
  startedAt: string | null;
}

export interface UseVitePreviewOptions {
  taskId: string;
  workDir: string;
  pollInterval?: number; // milliseconds
  // Note: autoStart is intentionally removed - preview must be triggered by user action only
}

export interface UseVitePreviewReturn {
  state: VitePreviewState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
  isLoading: boolean;
}

export function useVitePreview({
  taskId,
  workDir,
  pollInterval = 2000
}: UseVitePreviewOptions): UseVitePreviewReturn {
  const [state, setState] = useState<VitePreviewState>({
    status: 'idle',
    url: null,
    error: null,
    port: null,
    startedAt: null
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<PreviewStatus>('idle');

  const apiFetchRawWithTimeout = useCallback(
    async (path: string, options: RequestInit = {}, timeoutMs = START_REQUEST_TIMEOUT_MS) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        return await apiFetchRaw(path, {
          ...options,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
    },
    []
  );

  // Keep statusRef in sync with state.status
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  // Poll for status updates
  const pollStatus = useCallback(async (forcePolling = false) => {
    if (!mountedRef.current || !taskId) return;

    let shouldContinuePolling =
      forcePolling ||
      statusRef.current === 'starting' || statusRef.current === 'running';

    try {
      const response = await apiFetchRaw(`/api/preview/status/${taskId}`);
      const data = await response.json();

      if (!mountedRef.current) return;

      if (data.success && data.instance) {
        shouldContinuePolling =
          data.instance.status === 'starting' || data.instance.status === 'running';

        setState(prev => ({
          ...prev,
          status: data.instance.status,
          url: data.instance.url,
          port: data.instance.port,
          startedAt: data.instance.startedAt,
          error: data.instance.error || null
        }));
      } else {
        // /start can still be processing; keep polling briefly while starting.
        if (forcePolling && statusRef.current === 'starting') {
          shouldContinuePolling = true;
        } else {
          shouldContinuePolling = false;
          setState(prev => ({
            ...prev,
            status: 'idle',
            url: null,
            port: null,
            startedAt: null,
            error: null
          }));
        }
      }
    } catch (error) {
      if (!mountedRef.current) return;

      console.error('[useVitePreview] Failed to poll status:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error)
      }));
    }

    // Continue polling while preview service is active
    if (mountedRef.current && shouldContinuePolling) {
      pollTimeoutRef.current = setTimeout(pollStatus, pollInterval);
    }
  }, [taskId, pollInterval]);

  // Start preview server
  const start = useCallback(async () => {
    if (isLoading || state.status === 'starting' || state.status === 'running') {
      return;
    }

    setIsLoading(true);
    statusRef.current = 'starting';
    setState(prev => ({ ...prev, status: 'starting', error: null }));

    // Start status polling immediately so UI doesn't get stuck waiting for /start response.
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    pollStatus(true);

    try {
      const response = await apiFetchRawWithTimeout('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, workDir })
      });

      const data = await response.json();

      if (!mountedRef.current) return;

      if (data.success && data.instance) {
        setState(prev => ({
          ...prev,
          status: data.instance.status,
          url: data.instance.url,
          port: data.instance.port,
          startedAt: data.instance.startedAt,
          error: null
        }));
      } else {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: data.error || 'Failed to start preview server'
        }));
      }
    } catch (error) {
      if (!mountedRef.current) return;

      if (error instanceof DOMException && error.name === 'AbortError') {
        console.warn('[useVitePreview] Start request timed out, continue polling status.');
        setState(prev => ({
          ...prev,
          error: '启动请求较慢，正在持续检测预览服务状态...'
        }));
        return;
      }

      console.error('[useVitePreview] Failed to start preview:', error);
      setState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [taskId, workDir, isLoading, state.status, pollStatus, apiFetchRawWithTimeout]);

  // Stop preview server
  const stop = useCallback(async () => {
    if (isLoading || state.status === 'stopping' || state.status === 'idle') {
      return;
    }

    setIsLoading(true);
    setState(prev => ({ ...prev, status: 'stopping' }));

    // Clear polling
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    try {
      const response = await apiFetchRaw('/api/preview/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });

      const data = await response.json();

      if (!mountedRef.current) return;

      if (data.success) {
        setState(prev => ({
          ...prev,
          status: 'idle',
          url: null,
          port: null,
          startedAt: null,
          error: null
        }));
      } else {
        setState(prev => ({
          ...prev,
          error: data.error || 'Failed to stop preview server'
        }));
      }
    } catch (error) {
      if (!mountedRef.current) return;
      
      console.error('[useVitePreview] Failed to stop preview:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [taskId, isLoading, state.status]);

  // Refresh status
  const refresh = useCallback(async () => {
    await pollStatus();
  }, [pollStatus]);

  // Reset state and check status when taskId changes
  useEffect(() => {
    // Clear any pending poll
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    // Reset state to initial values for new task
    setState({
      status: 'idle',
      url: null,
      error: null,
      port: null,
      startedAt: null
    });
    setIsLoading(false);

    // Then poll for the new task's status
    if (taskId) {
      pollStatus();
    }
  }, [taskId]);

  return {
    state,
    start,
    stop,
    refresh,
    isLoading
  };
}
