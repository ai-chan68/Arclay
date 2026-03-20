/**
 * Data transformers for cross-platform storage compatibility
 * Handles conversion between JavaScript types and storage formats
 */

import { isTauri } from './environment';

/**
 * Boolean transformer
 * - SQLite stores as INTEGER (0/1)
 * - IndexedDB stores as native boolean
 */
export const BooleanTransformer = {
  toStorage(value: boolean | undefined): number | boolean {
    if (value === undefined) return isTauri() ? 0 : false;
    return isTauri() ? (value ? 1 : 0) : value;
  },

  fromStorage(value: number | boolean | undefined | null): boolean {
    if (value === undefined || value === null) return false;
    return Boolean(value);
  }
};

/**
 * JSON transformer
 * - Converts objects to JSON strings for storage
 * - Parses JSON strings back to objects
 */
export const JsonTransformer = {
  toStorage<T>(value: T | undefined | null): string | null {
    if (value === undefined || value === null) return null;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  },

  fromStorage<T>(value: string | null | undefined): T | undefined {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
};

/**
 * Date transformer
 * - Converts Date objects to ISO strings for storage
 * - Parses ISO strings back to Date objects
 */
export const DateTransformer = {
  toStorage(value: Date | string | undefined): string {
    if (value === undefined) return new Date().toISOString();
    return typeof value === 'string' ? value : value.toISOString();
  },

  fromStorage(value: string | undefined): Date {
    return value ? new Date(value) : new Date();
  }
};

/**
 * Number transformer
 * - Handles null/undefined conversion
 * - Ensures consistent number format
 */
export const NumberTransformer = {
  toStorage(value: number | undefined | null): number | null {
    if (value === undefined || value === null) return null;
    return Number(value);
  },

  fromStorage(value: number | null | undefined): number | null {
    if (value === undefined || value === null) return null;
    return Number(value);
  }
};

/**
 * String transformer
 * - Handles null/undefined conversion
 * - Trims whitespace
 */
export const StringTransformer = {
  toStorage(value: string | undefined | null): string | null {
    if (value === undefined || value === null) return null;
    return value.trim();
  },

  fromStorage(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    return value;
  }
};

/**
 * Task-specific transformers
 * Handles complex Task object serialization/deserialization
 */
export const TaskTransformer = {
  /**
   * Transform Task for storage (converts booleans, etc.)
   */
  toStorage<T extends Record<string, unknown>>(task: T): T {
    const result = { ...task };

    // Transform boolean fields
    if ('favorite' in result) {
      (result as Record<string, unknown>).favorite = BooleanTransformer.toStorage(result.favorite as boolean);
    }
    if ('is_right_sidebar_visible' in result) {
      (result as Record<string, unknown>).is_right_sidebar_visible = BooleanTransformer.toStorage(
        result.is_right_sidebar_visible as boolean
      );
    }

    // Transform JSON fields
    if ('attachments' in result && result.attachments !== undefined) {
      (result as Record<string, unknown>).attachments = JsonTransformer.toStorage(result.attachments);
    }

    return result as T;
  },

  /**
   * Transform Task from storage (converts 0/1 to booleans, etc.)
   */
  fromStorage<T extends Record<string, unknown>>(task: Record<string, unknown>): T {
    const result = { ...task };

    // Transform boolean fields
    if ('favorite' in result) {
      result.favorite = BooleanTransformer.fromStorage(result.favorite as number | boolean);
    }
    if ('is_right_sidebar_visible' in result) {
      result.is_right_sidebar_visible = BooleanTransformer.fromStorage(
        result.is_right_sidebar_visible as number | boolean
      );
    }

    // Transform JSON fields
    if ('attachments' in result && typeof result.attachments === 'string') {
      result.attachments = JsonTransformer.fromStorage(result.attachments);
    }

    return result as T;
  }
};

/**
 * Message-specific transformers
 */
export const MessageTransformer = {
  toStorage<T extends Record<string, unknown>>(message: T): T {
    const result = { ...message };

    if ('attachments' in result && result.attachments !== undefined) {
      (result as Record<string, unknown>).attachments = JsonTransformer.toStorage(result.attachments);
    }

    return result as T;
  },

  fromStorage<T extends Record<string, unknown>>(message: Record<string, unknown>): T {
    const result = { ...message };

    if ('attachments' in result && typeof result.attachments === 'string') {
      result.attachments = JsonTransformer.fromStorage(result.attachments);
    }

    return result as T;
  }
};

/**
 * LibraryFile-specific transformers
 */
export const FileTransformer = {
  toStorage<T extends Record<string, unknown>>(file: T): T {
    const result = { ...file };

    if ('is_favorite' in result) {
      (result as Record<string, unknown>).is_favorite = BooleanTransformer.toStorage(result.is_favorite as boolean);
    }

    return result as T;
  },

  fromStorage<T extends Record<string, unknown>>(file: Record<string, unknown>): T {
    const result = { ...file };

    if ('is_favorite' in result) {
      result.is_favorite = BooleanTransformer.fromStorage(result.is_favorite as number | boolean);
    }

    return result as T;
  }
};
