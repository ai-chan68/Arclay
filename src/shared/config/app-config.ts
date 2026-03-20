/**
 * Application configuration
 * Provides centralized configuration with environment variable overrides
 */

export interface AppConfig {
  /** API service configuration */
  api: {
    /** Startup timeout in milliseconds */
    startupTimeout: number;
    /** Retry interval in milliseconds */
    retryInterval: number;
    /** Maximum retry attempts */
    maxRetries: number;
    /** Default port */
    defaultPort: number;
  };

  /** Database configuration */
  database: {
    /** IndexedDB version */
    indexedDBVersion: number;
    /** IndexedDB name */
    indexedDBName: string;
  };

  /** UI configuration */
  ui: {
    /** Default sidebar width */
    sidebarWidth: number;
    /** Animation duration in ms */
    animationDuration: number;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  api: {
    startupTimeout: 30000,    // 30 seconds
    retryInterval: 200,       // 200ms
    maxRetries: 150,          // 30s / 200ms
    defaultPort: 2026,
  },
  database: {
    indexedDBVersion: 3,
    indexedDBName: 'easywork-db',
  },
  ui: {
    sidebarWidth: 280,
    animationDuration: 300,
  },
};

/**
 * Get application configuration
 * Merges default config with environment variables
 */
export function getAppConfig(): AppConfig {
  return {
    api: {
      startupTimeout: parseInt(
        import.meta.env.VITE_API_TIMEOUT || String(DEFAULT_CONFIG.api.startupTimeout),
        10
      ),
      retryInterval: DEFAULT_CONFIG.api.retryInterval,
      maxRetries: Math.ceil(
        parseInt(
          import.meta.env.VITE_API_TIMEOUT || String(DEFAULT_CONFIG.api.startupTimeout),
          10
        ) / DEFAULT_CONFIG.api.retryInterval
      ),
      defaultPort: DEFAULT_CONFIG.api.defaultPort,
    },
    database: {
      indexedDBVersion: DEFAULT_CONFIG.database.indexedDBVersion,
      indexedDBName: DEFAULT_CONFIG.database.indexedDBName,
    },
    ui: DEFAULT_CONFIG.ui,
  };
}

/**
 * Get API configuration only
 */
export function getApiConfig(): AppConfig['api'] {
  return getAppConfig().api;
}

/**
 * Get database configuration only
 */
export function getDatabaseConfig(): AppConfig['database'] {
  return getAppConfig().database;
}
