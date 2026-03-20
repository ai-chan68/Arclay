import { isTauri } from 'shared-types';

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

async function getApiPort(): Promise<number> {
  if (cachedPort !== null) {
    return cachedPort;
  }

  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      cachedPort = await invoke<number>('get_api_port');
      if (cachedPort === 0) {
        cachedPort = null; // Reset if not ready
        return 2026; // Fallback
      }
      return cachedPort;
    } catch {
      // Fallback to default port
      return 2026;
    }
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

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('[API] Error response:', error);
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (err) {
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
    return await fetch(url, {
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

  const response = await fetch(url, {
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
  get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  stream: (path: string, body?: unknown) =>
    apiStream(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json' },
    }),
};
