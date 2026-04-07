import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names with Tailwind CSS conflict resolution
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert a local file path into a preview-safe URL.
 *
 * The backend file-serving route is used for local files in both web and
 * Tauri. This keeps preview behavior consistent and avoids WebView asset
 * loading issues for files generated outside the app bundle.
 */
export async function getFileSrc(filePath: string): Promise<string> {
  // If already a data URL or http URL, return as-is
  if (filePath.startsWith('data:') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  return `/api/files/serve?path=${encodeURIComponent(filePath)}`;
}

/**
 * Synchronous version for cases where async is not possible.
 */
export function getFileSrcSync(filePath: string): string {
  // If already a data URL or http URL, return as-is
  if (filePath.startsWith('data:') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  return `/api/files/serve?path=${encodeURIComponent(filePath)}`;
}
