import { isTauri } from 'shared-types';

/**
 * Clipboard service interface
 * Abstracts platform-specific clipboard implementations
 */
export interface IClipboardService {
  /** Check if clipboard operations are supported */
  isSupported(): boolean;

  /** Write text to clipboard */
  writeText(text: string): Promise<void>;

  /** Read text from clipboard */
  readText(): Promise<string>;

  /** Write file path to clipboard (desktop only) */
  writeFilePath?(path: string): Promise<void>;
}

/**
 * Web Clipboard Service
 * Uses the Clipboard API
 */
class WebClipboardService implements IClipboardService {
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'clipboard' in navigator;
  }

  async writeText(text: string): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('剪贴板功能不可用');
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('[Clipboard] Failed to write text:', error);
      throw new Error('复制到剪贴板失败');
    }
  }

  async readText(): Promise<string> {
    if (!this.isSupported()) {
      throw new Error('剪贴板功能不可用');
    }

    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error('[Clipboard] Failed to read text:', error);
      throw new Error('从剪贴板读取失败');
    }
  }
}

/**
 * Tauri Clipboard Service
 * Uses tauri-plugin-clipboard-manager
 */
class TauriClipboardService implements IClipboardService {
  private module: typeof import('@tauri-apps/plugin-clipboard-manager') | null = null;

  private async loadModule(): Promise<typeof import('@tauri-apps/plugin-clipboard-manager')> {
    if (!this.module) {
      try {
        this.module = await import('@tauri-apps/plugin-clipboard-manager');
      } catch (error) {
        console.error('[Clipboard] Failed to load Tauri clipboard module:', error);
        throw new Error('剪贴板模块加载失败');
      }
    }
    return this.module;
  }

  isSupported(): boolean {
    return true; // Tauri always supports clipboard
  }

  async writeText(text: string): Promise<void> {
    try {
      const module = await this.loadModule();
      await module.writeText(text);
    } catch (error) {
      console.error('[Clipboard] Failed to write text:', error);
      throw new Error('复制到剪贴板失败');
    }
  }

  async readText(): Promise<string> {
    try {
      const module = await this.loadModule();
      return await module.readText();
    } catch (error) {
      console.error('[Clipboard] Failed to read text:', error);
      throw new Error('从剪贴板读取失败');
    }
  }

  async writeFilePath(path: string): Promise<void> {
    // On desktop, we can write the file path as text
    // Future: could use specialized clipboard formats
    await this.writeText(path);
  }
}

/**
 * Legacy Clipboard Service (fallback)
 * Uses document.execCommand for older browsers
 */
class LegacyClipboardService implements IClipboardService {
  isSupported(): boolean {
    return typeof document !== 'undefined' && 'execCommand' in document;
  }

  async writeText(text: string): Promise<void> {
    // Create temporary textarea
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);

    try {
      textarea.focus();
      textarea.select();

      const success = document.execCommand('copy');
      if (!success) {
        throw new Error('execCommand failed');
      }
    } catch (error) {
      console.error('[Clipboard] Legacy copy failed:', error);
      throw new Error('复制到剪贴板失败');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async readText(): Promise<string> {
    throw new Error('剪贴板读取在此环境下不可用');
  }
}

/**
 * Create appropriate clipboard service for the environment
 */
export function createClipboardService(): IClipboardService {
  if (isTauri()) {
    return new TauriClipboardService();
  }

  // Check for modern Clipboard API
  if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
    return new WebClipboardService();
  }

  // Fall back to legacy method
  return new LegacyClipboardService();
}

/**
 * Singleton instance
 */
let clipboardService: IClipboardService | null = null;

/**
 * Get or create clipboard service instance
 */
export function getClipboardService(): IClipboardService {
  if (!clipboardService) {
    clipboardService = createClipboardService();
  }
  return clipboardService;
}

/**
 * Reset clipboard service (for testing)
 */
export function resetClipboardService(): void {
  clipboardService = null;
}

/**
 * Convenience function to copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<void> {
  const service = getClipboardService();
  return service.writeText(text);
}

/**
 * Convenience function to read text from clipboard
 */
export async function readFromClipboard(): Promise<string> {
  const service = getClipboardService();
  return service.readText();
}

/**
 * Copy code snippet with optional formatting
 */
export async function copyCodeSnippet(code: string, language?: string): Promise<void> {
  const service = getClipboardService();

  // Add language comment if specified
  const textToCopy = language
    ? `// ${language}\n${code}`
    : code;

  await service.writeText(textToCopy);
}

/**
 * Copy file path to clipboard (useful for desktop)
 */
export async function copyFilePath(path: string): Promise<void> {
  const service = getClipboardService();

  if (service.writeFilePath) {
    await service.writeFilePath(path);
  } else {
    await service.writeText(path);
  }
}

/**
 * Copy rich content (HTML) - Web only
 */
export async function copyRichContent(text: string, html?: string): Promise<void> {
  if (isTauri() || !html) {
    // Desktop or no HTML: just copy text
    await copyToClipboard(text);
    return;
  }

  // Web with HTML: use ClipboardItem API
  if (typeof ClipboardItem !== 'undefined') {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([text], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blob,
        'text/plain': textBlob,
      });
      await navigator.clipboard.write([item]);
    } catch (error) {
      console.warn('[Clipboard] Rich copy failed, falling back to text:', error);
      await copyToClipboard(text);
    }
  } else {
    await copyToClipboard(text);
  }
}
