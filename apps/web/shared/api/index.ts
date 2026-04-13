import { isTauri } from '@arclay/shared-types';
import { getDesktopApiPort } from '../tauri/commands';

// API client that adapts to the running environment

let cachedPort: number | null = null;

// Allow external port update
export function setCachedPort(port: number) {
  cachedPort = port;
  console.log('[API] Cached port set to:', port);
}

export function resetCachedPort() {
  cachedPort = null;
}

/**
 * Retry fetch on network errors (TypeError = connection refused).
 * Only retries connection failures, NOT HTTP errors or timeouts.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelayMs = 500,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (err instanceof TypeError && attempt < maxRetries) {
        lastError = err;
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[API] Connection failed, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError!;
}

async function getApiPort(): Promise<number> {
  if (cachedPort !== null) {
    return cachedPort;
  }

  if (isTauri()) {
    const port = await getDesktopApiPort();
    if (port === 0) {
      cachedPort = null; // Reset if not ready
      return 2026; // Fallback
    }

    cachedPort = port;
    return cachedPort;
  }

  // Web environment - use same origin or configured port
  return parseInt(import.meta.env.VITE_API_PORT || '2026', 10);
}

export function getApiBaseUrl(): string {
  if (isTauri()) {
    // In Tauri, we need to wait for the port
    // This is a synchronous fallback that returns the default
    return `http://localhost:${cachedPort || 2026}`;
  }

  // In web development, API runs on different port
  if (import.meta.env.DEV) {
    return `http://localhost:${import.meta.env.VITE_API_PORT || '2026'}`;
  }

  // In production web, API is on same origin
  return '';
}

export async function getApiUrl(path: string): Promise<string> {
  const port = await getApiPort();
  if (isTauri()) {
    return `http://localhost:${port}${path}`;
  }

  // In web development, use relative path to leverage Vite proxy
  // This avoids CORS issues and ensures routing works correctly
  if (import.meta.env.DEV) {
    return path;
  }

  return path;
}

// Fetch wrapper that handles environment-specific API calls
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = await getApiUrl(path);
  console.log('[API] Fetching:', url);

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Set timeout for long-running operations (e.g., GitHub imports)
  const timeout = (options as any).timeout || 120000; // Default 2 minutes
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchWithRetry(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[API] Error response:', error);
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[API] Request timeout');
      throw new Error('请求超时，请检查网络连接或稍后重试');
    }
    if (err instanceof TypeError) {
      console.error('[API] Network error:', err);
      throw new Error('Failed to connect to API server. Please check if the app is running correctly.');
    }
    throw err;
  }
}

export async function apiFetchRaw(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = await getApiUrl(path);
  console.log('[API] Fetching raw:', url);

  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    return await fetchWithRetry(url, {
      ...options,
      headers,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      console.error('[API] Network error:', err);
      throw new Error(
        'Failed to connect to API server. Please check if the app is running correctly.'
      );
    }
    throw err;
  }
}

// Streaming fetch for SSE endpoints
export async function apiStream(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = await getApiUrl(path);
  console.log('[API] Streaming:', url);

  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response;
}

// Convenience methods
export const api = {
  get: <T>(path: string, options?: RequestInit) => apiFetch<T>(path, { method: 'GET', ...options }),
  post: <T>(path: string, body?: unknown, options?: RequestInit) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    }),
  put: <T>(path: string, body?: unknown, options?: RequestInit) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    }),
  delete: <T>(path: string, options?: RequestInit) => apiFetch<T>(path, { method: 'DELETE', ...options }),
  stream: (path: string, body?: unknown) =>
    apiStream(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json' },
    }),
};
