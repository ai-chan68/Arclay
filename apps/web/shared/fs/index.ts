import { isTauri, FileInfo, PickFileOptions, FileFilter } from 'shared-types';

// File system API that abstracts Tauri and web implementations

export interface FileSystemAPI {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
  pickFile(options?: PickFileOptions): Promise<string | string[] | null>;
  pickDirectory(): Promise<string | null>;
  fileExists(path: string): Promise<boolean>;
  getFileSize(path: string): Promise<number>;
  getFileMTime(path: string): Promise<string>;
  listDir(path: string): Promise<string[]>;
  createDir(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  getFileInfo(path: string): Promise<FileInfo>;
}

// Tauri implementation
class TauriFileSystem implements FileSystemAPI {
  private async getFS() {
    const fs = await import('@tauri-apps/plugin-fs');
    return fs;
  }

  private async getDialog() {
    const dialog = await import('@tauri-apps/plugin-dialog');
    return dialog;
  }

  async readTextFile(path: string): Promise<string> {
    const fs = await this.getFS();
    return fs.readTextFile(path);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const fs = await this.getFS();
    await fs.writeTextFile(path, content);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const fs = await this.getFS();
    return fs.readFile(path);
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    const fs = await this.getFS();
    await fs.writeFile(path, data);
  }

  async pickFile(options?: PickFileOptions): Promise<string | string[] | null> {
    const dialog = await this.getDialog();
    const filters = options?.filter
      ? [{ name: options.filter.name, extensions: options.filter.extensions }]
      : undefined;

    if (options?.multiple) {
      const result = await dialog.open({
        multiple: true,
        filters,
        defaultPath: options?.defaultPath,
      });
      return result as string[] | null;
    } else {
      const result = await dialog.open({
        multiple: false,
        filters,
        defaultPath: options?.defaultPath,
      });
      return result as string | null;
    }
  }

  async pickDirectory(): Promise<string | null> {
    const dialog = await this.getDialog();
    const result = await dialog.open({ directory: true });
    return result as string | null;
  }

  async fileExists(path: string): Promise<boolean> {
    const fs = await this.getFS();
    return fs.exists(path);
  }

  async getFileSize(path: string): Promise<number> {
    const fs = await this.getFS();
    const stat = await fs.stat(path);
    return stat.size;
  }

  async getFileMTime(path: string): Promise<string> {
    const fs = await this.getFS();
    const stat = await fs.stat(path);
    return stat.mtime?.toISOString() ?? new Date().toISOString();
  }

  async listDir(path: string): Promise<string[]> {
    const fs = await this.getFS();
    const entries = await fs.readDir(path);
    return entries.map((e) => e.name);
  }

  async createDir(path: string): Promise<void> {
    const fs = await this.getFS();
    await fs.mkdir(path, { recursive: true });
  }

  async removeDir(path: string): Promise<void> {
    const fs = await this.getFS();
    // Use remove with recursive option for directories
    await fs.remove(path, { recursive: true });
  }

  async deleteFile(path: string): Promise<void> {
    const fs = await this.getFS();
    await fs.remove(path);
  }

  async getFileInfo(path: string): Promise<FileInfo> {
    const fs = await this.getFS();
    const stat = await fs.stat(path);
    const parts = path.split('/');
    const name = parts[parts.length - 1];

    return {
      name,
      path,
      isDirectory: stat.isDirectory ?? false,
      size: stat.size,
      modifiedAt: stat.mtime?.toISOString() ?? new Date().toISOString(),
    };
  }
}

// Web implementation (limited - uses File System Access API or download fallback)
class WebFileSystem implements FileSystemAPI {
  async readTextFile(path: string): Promise<string> {
    throw new Error('File system access not available in web browser');
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    // Fallback: trigger download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() || 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    throw new Error('File system access not available in web browser');
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    // Fallback: trigger download
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() || 'file.bin';
    a.click();
    URL.revokeObjectURL(url);
  }

  async pickFile(options?: PickFileOptions): Promise<string | string[] | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (options?.multiple) input.multiple = true;
      if (options?.filter?.extensions) {
        input.accept = options.filter.extensions.map((e) => `.${e}`).join(',');
      }

      input.onchange = () => {
        const files = input.files;
        if (!files || files.length === 0) {
          resolve(null);
          return;
        }

        // For web, we can't get the file path, so we return the file names
        if (options?.multiple) {
          resolve(Array.from(files).map((f) => f.name));
        } else {
          resolve(files[0].name);
        }
      };

      input.click();
    });
  }

  async pickDirectory(): Promise<string | null> {
    // Web doesn't support directory picking in most browsers
    throw new Error('Directory picker not available in web browser');
  }

  async fileExists(path: string): Promise<boolean> {
    throw new Error('File system access not available in web browser');
  }

  async getFileSize(path: string): Promise<number> {
    throw new Error('File system access not available in web browser');
  }

  async getFileMTime(path: string): Promise<string> {
    throw new Error('File system access not available in web browser');
  }

  async listDir(path: string): Promise<string[]> {
    throw new Error('File system access not available in web browser');
  }

  async createDir(path: string): Promise<void> {
    throw new Error('File system access not available in web browser');
  }

  async removeDir(path: string): Promise<void> {
    throw new Error('File system access not available in web browser');
  }

  async deleteFile(path: string): Promise<void> {
    throw new Error('File system access not available in web browser');
  }

  async getFileInfo(path: string): Promise<FileInfo> {
    throw new Error('File system access not available in web browser');
  }
}

// Singleton instance
let fsInstance: FileSystemAPI | null = null;

export function getFileSystem(): FileSystemAPI {
  if (fsInstance) {
    return fsInstance;
  }

  if (isTauri()) {
    fsInstance = new TauriFileSystem();
  } else {
    fsInstance = new WebFileSystem();
  }

  return fsInstance;
}
