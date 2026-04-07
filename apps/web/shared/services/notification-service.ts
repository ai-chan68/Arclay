import { isTauri } from 'shared-types';

/**
 * Notification options
 */
export interface NotificationOptions {
  /** Notification title */
  title: string;
  /** Notification body text */
  body: string;
  /** Optional icon path/URL */
  icon?: string;
  /** Optional notification ID for updates */
  id?: string;
}

/**
 * Notification service interface
 * Abstracts platform-specific notification implementations
 */
export interface INotificationService {
  /** Check if notifications are supported */
  isSupported(): boolean;

  /** Check if permission is granted */
  hasPermission(): boolean;

  /** Request permission to show notifications */
  requestPermission(): Promise<boolean>;

  /** Show a notification */
  notify(options: NotificationOptions): Promise<void>;

  /** Show a task completion notification */
  notifyTaskCompleted(taskTitle: string): Promise<void>;

  /** Show a task error notification */
  notifyTaskError(taskTitle: string, errorMessage?: string): Promise<void>;
}

/**
 * Web Notification Service
 * Uses the Web Notifications API
 */
class WebNotificationService implements INotificationService {
  isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  hasPermission(): boolean {
    if (!this.isSupported()) return false;
    return Notification.permission === 'granted';
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) {
      console.warn('[Notification] Web notifications not supported');
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      return result === 'granted';
    } catch (error) {
      console.error('[Notification] Failed to request permission:', error);
      return false;
    }
  }

  async notify(options: NotificationOptions): Promise<void> {
    if (!this.hasPermission()) {
      console.warn('[Notification] Permission not granted');
      return;
    }

    try {
      new Notification(options.title, {
        body: options.body,
        icon: options.icon || '/icon.png',
        tag: options.id,
      });
    } catch (error) {
      console.error('[Notification] Failed to show notification:', error);
    }
  }

  async notifyTaskCompleted(taskTitle: string): Promise<void> {
    await this.notify({
      title: '任务完成',
      body: `「${taskTitle || '未命名任务'}」已完成`,
      id: 'task-completed',
    });
  }

  async notifyTaskError(taskTitle: string, errorMessage?: string): Promise<void> {
    await this.notify({
      title: '任务失败',
      body: `「${taskTitle || '未命名任务'}」执行失败${
        errorMessage ? `: ${errorMessage}` : ''
      }`,
      id: 'task-error',
    });
  }
}

/**
 * Tauri Notification Service
 * Uses tauri-plugin-notification
 */
class TauriNotificationService implements INotificationService {
  private module: typeof import('@tauri-apps/plugin-notification') | null = null;
  private permissionGranted = false;

  private async loadModule(): Promise<typeof import('@tauri-apps/plugin-notification')> {
    if (!this.module) {
      try {
        this.module = await import('@tauri-apps/plugin-notification');
      } catch (error) {
        console.error('[Notification] Failed to load Tauri notification module:', error);
        throw new Error('通知模块加载失败');
      }
    }
    return this.module;
  }

  isSupported(): boolean {
    return true; // Tauri always supports notifications
  }

  hasPermission(): boolean {
    return this.permissionGranted;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const module = await this.loadModule();
      const result = await module.requestPermission();
      this.permissionGranted = result === 'granted';
      return this.permissionGranted;
    } catch (error) {
      console.error('[Notification] Failed to request permission:', error);
      return false;
    }
  }

  async notify(options: NotificationOptions): Promise<void> {
    try {
      const module = await this.loadModule();

      // Request permission if not already granted
      if (!this.permissionGranted) {
        const granted = await this.requestPermission();
        if (!granted) return;
      }

      module.sendNotification({
        title: options.title,
        body: options.body,
        icon: options.icon,
      });
    } catch (error) {
      console.error('[Notification] Failed to show notification:', error);
    }
  }

  async notifyTaskCompleted(taskTitle: string): Promise<void> {
    await this.notify({
      title: 'EasyWork',
      body: `任务「${taskTitle || '未命名任务'}」已完成`,
    });
  }

  async notifyTaskError(taskTitle: string, errorMessage?: string): Promise<void> {
    await this.notify({
      title: 'EasyWork',
      body: `任务「${taskTitle || '未命名任务'}」执行失败${
        errorMessage ? `: ${errorMessage}` : ''
      }`,
    });
  }
}

/**
 * No-op notification service
 * Used when notifications are not available
 */
class NoopNotificationService implements INotificationService {
  isSupported(): boolean {
    return false;
  }

  hasPermission(): boolean {
    return false;
  }

  async requestPermission(): Promise<boolean> {
    return false;
  }

  async notify(): Promise<void> {
    // No-op
  }

  async notifyTaskCompleted(): Promise<void> {
    // No-op
  }

  async notifyTaskError(): Promise<void> {
    // No-op
  }
}

/**
 * Create appropriate notification service for the environment
 */
export function createNotificationService(): INotificationService {
  if (isTauri()) {
    return new TauriNotificationService();
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    return new WebNotificationService();
  }

  return new NoopNotificationService();
}

/**
 * Singleton instance
 */
let notificationService: INotificationService | null = null;

/**
 * Get or create notification service instance
 */
export function getNotificationService(): INotificationService {
  if (!notificationService) {
    notificationService = createNotificationService();
  }
  return notificationService;
}

/**
 * Reset notification service (for testing)
 */
export function resetNotificationService(): void {
  notificationService = null;
}

/**
 * Convenience function to show a notification
 */
export async function showNotification(options: NotificationOptions): Promise<void> {
  const service = getNotificationService();
  return service.notify(options);
}

/**
 * Convenience function to notify task completion
 */
export async function notifyTaskCompleted(taskTitle: string): Promise<void> {
  const service = getNotificationService();
  return service.notifyTaskCompleted(taskTitle);
}

/**
 * Convenience function to notify task error
 */
export async function notifyTaskError(taskTitle: string, errorMessage?: string): Promise<void> {
  const service = getNotificationService();
  return service.notifyTaskError(taskTitle, errorMessage);
}

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const service = getNotificationService();
  return service.requestPermission();
}
