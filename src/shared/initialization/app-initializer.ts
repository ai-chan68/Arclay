import { isTauri } from 'shared-types';
import { getApiConfig } from '../config/app-config';
import { setCachedPort, resetCachedPort } from '../api';

/**
 * Initialization phase
 */
export type InitPhase =
  | 'idle'
  | 'detecting_environment'
  | 'waiting_for_api'
  | 'initializing_database'
  | 'loading_settings'
  | 'ready'
  | 'error';

/**
 * Initialization state
 */
export interface InitState {
  phase: InitPhase;
  progress: number;
  message: string;
  error?: Error;
}

/**
 * Initialization state listener
 */
type InitStateListener = (state: InitState) => void;

/**
 * App Initializer
 * Manages application initialization with state machine pattern
 */
export class AppInitializer {
  private state: InitState = {
    phase: 'idle',
    progress: 0,
    message: '',
  };
  private listeners: Set<InitStateListener> = new Set();
  private abortController: AbortController | null = null;
  private isInitializing = false;

  /**
   * Subscribe to state changes
   */
  onStateChange(listener: InitStateListener): () => void {
    this.listeners.add(listener);
    // Immediately notify current state
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current state
   */
  getState(): InitState {
    return { ...this.state };
  }

  /**
   * Check if initialization is in progress
   */
  getIsInitializing(): boolean {
    return this.isInitializing;
  }

  /**
   * Update state and notify listeners
   */
  private setState(updates: Partial<InitState>): void {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((listener) => listener(this.state));
  }

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    if (this.isInitializing) {
      console.warn('[AppInitializer] Already initializing');
      return;
    }

    this.isInitializing = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // Reset any previous state
      resetCachedPort();

      // 1. Detect environment (0-10%)
      this.setState({
        phase: 'detecting_environment',
        progress: 5,
        message: '检测运行环境...',
        error: undefined,
      });

      const desktop = isTauri();
      console.log(`[AppInitializer] Environment: ${desktop ? 'desktop' : 'web'}`);

      // 2. Wait for API service (desktop only) (10-50%)
      if (desktop) {
        this.setState({
          phase: 'waiting_for_api',
          progress: 10,
          message: '启动 API 服务...',
        });
        await this.waitForApi(signal);
      }

      // 3. Initialize database (50-80%)
      this.setState({
        phase: 'initializing_database',
        progress: 50,
        message: '初始化数据库...',
      });
      await this.initializeDatabase();

      // 4. Load settings (80-100%)
      this.setState({
        phase: 'loading_settings',
        progress: 80,
        message: '加载配置...',
      });
      await this.loadSettings();

      // 5. Ready
      this.setState({
        phase: 'ready',
        progress: 100,
        message: '就绪',
      });

      console.log('[AppInitializer] Initialization complete');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[AppInitializer] Initialization failed:', err);

      this.setState({
        phase: 'error',
        progress: 0,
        message: '初始化失败',
        error: err,
      });

      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Abort initialization
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isInitializing = false;
  }

  /**
   * Retry initialization after error
   */
  async retry(): Promise<void> {
    if (this.state.phase !== 'error') {
      console.warn('[AppInitializer] Can only retry from error state');
      return;
    }

    this.setState({
      phase: 'idle',
      progress: 0,
      message: '',
      error: undefined,
    });

    return this.initialize();
  }

  // ============ Private Methods ============

  /**
   * Wait for API service to be ready
   */
  private async waitForApi(signal: AbortSignal): Promise<void> {
    const config = getApiConfig();
    const startTime = Date.now();
    let lastLoggedProgress = 10;

    console.log(
      `[AppInitializer] Waiting for API (timeout: ${config.startupTimeout}ms)`
    );

    while (Date.now() - startTime < config.startupTimeout) {
      if (signal.aborted) {
        throw new Error('初始化已取消');
      }

      let preferredPort = config.defaultPort;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const port = await invoke<number>('get_api_port');
        if (port > 0) {
          preferredPort = port;
        }
      } catch {
        // API not ready yet, keep default port
      }

      const foundPort = await this.findHealthyApiPort(preferredPort, signal);
      if (foundPort > 0) {
        setCachedPort(foundPort);
        console.log(`[AppInitializer] API ready on port ${foundPort}`);
        return;
      }

      // Update progress (10-50% range)
      const elapsed = Date.now() - startTime;
      const progress = Math.min(
        50,
        10 + Math.floor((elapsed / config.startupTimeout) * 40)
      );

      if (progress > lastLoggedProgress + 5) {
        lastLoggedProgress = progress;
        this.setState({
          phase: 'waiting_for_api',
          progress,
          message: `启动 API 服务... (${Math.floor(
            (elapsed / config.startupTimeout) * 100
          )}%)`,
        });
      }

      await new Promise((resolve) =>
        setTimeout(resolve, config.retryInterval)
      );
    }

    throw new Error(
      `API 服务启动超时（${Math.round(config.startupTimeout / 1000)}秒）`
    );
  }

  /**
   * Find API port by probing health endpoints on nearby ports
   */
  private async findHealthyApiPort(
    startPort: number,
    signal: AbortSignal
  ): Promise<number> {
    const fallbackPort = getApiConfig().defaultPort;
    const ports = [
      startPort,
      fallbackPort,
      ...Array.from({ length: 19 }, (_, i) => startPort + i + 1),
    ].filter((port, index, all) => port > 0 && all.indexOf(port) === index);

    for (const port of ports) {
      if (signal.aborted) {
        throw new Error('初始化已取消');
      }
      if (await this.isApiHealthy(port)) {
        return port;
      }
    }

    return 0;
  }

  /**
   * Check API health on a specific port
   */
  private async isApiHealthy(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Initialize database
   */
  private async initializeDatabase(): Promise<void> {
    // Database is initialized lazily by storage hooks/adapters.
    // Keep this phase for UX consistency and future warmup work.
    console.log('[AppInitializer] Database warmup skipped (lazy init)');
  }

  /**
   * Load application settings
   */
  private async loadSettings(): Promise<void> {
    // Settings are loaded on-demand by hooks
    // This is a placeholder for future settings initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Singleton instance
 */
export const appInitializer = new AppInitializer();

/**
 * Hook-compatible function to initialize app
 */
export async function initializeApp(): Promise<void> {
  return appInitializer.initialize();
}

/**
 * Get initializer singleton
 */
export function getAppInitializer(): AppInitializer {
  return appInitializer;
}
