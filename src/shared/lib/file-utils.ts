/**
 * File Utilities
 * 
 * File type detection and processing utilities
 * Migrated and enhanced from easywork
 */

import type { AgentMessage } from '../../../shared-types/src/agent';
import type { 
  Artifact, 
  ArtifactType
} from '../types/artifacts';

import {
  SKIP_CONTENT_TYPES,
  CODE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  SPREADSHEET_EXTENSIONS,
  PRESENTATION_EXTENSIONS,
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  FONT_EXTENSIONS
} from '../types/artifacts';

/**
 * Internal planning/scaffolding files written by the Agent execution framework.
 * These should not appear as user-facing artifacts in the UI.
 */
const INTERNAL_PLANNING_FILENAMES = new Set([
  'task_plan.md',
  'progress.md',
  'findings.md',
]);

function isInternalPlanningFile(filePath: string): boolean {
  const filename = filePath.split(/[\/]/).pop() || '';
  return INTERNAL_PLANNING_FILENAMES.has(filename);
}

/**
 * Extract file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Map file extension to ArtifactType
 */
export function getArtifactTypeByExt(filename: string): ArtifactType {
  const ext = getFileExtension(filename);
  
  // Special cases first
  if (ext === 'md') return 'markdown';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'jsx') return 'jsx';
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
  if (ext === 'json') return 'json';
  
  // Check extension arrays
  if (CODE_EXTENSIONS.includes(ext)) return 'code';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (DOCUMENT_EXTENSIONS.includes(ext)) return 'document';
  if (SPREADSHEET_EXTENSIONS.includes(ext)) return 'spreadsheet';
  if (PRESENTATION_EXTENSIONS.includes(ext)) return 'presentation';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (FONT_EXTENSIONS.includes(ext)) return 'font';
  
  // Default to text
  return 'text';
}

/**
 * Check if content should be skipped for this file type
 */
export function shouldSkipContent(type: ArtifactType): boolean {
  return SKIP_CONTENT_TYPES.includes(type);
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Extract files from agent message
 */
export function extractFilesFromMessage(message: AgentMessage): Artifact[] {
  return extractFilesFromMessages([message]);
}

/**
 * Extract files from a message stream.
 * File content is injected only after Write tool_result succeeds.
 */
export function extractFilesFromMessages(messages: AgentMessage[]): Artifact[] {
  const artifacts: Artifact[] = [];
  const pendingWritePayload = new Map<string, { filePath: string; content?: string }>();

  const addArtifactFromPath = createArtifactAdder(artifacts);

  for (const message of messages) {
    // Extract from Write tool_use (path only, no content yet)
    if (message.type === 'tool_use' && (message.toolName === 'Write' || message.toolName === 'write')) {
      try {
        const input = typeof message.toolInput === 'string'
          ? JSON.parse(message.toolInput)
          : message.toolInput;

        if (input?.file_path || input?.path) {
          const filePath = String(input.file_path || input.path);
          const content = input.content || input.contents;

          // Do NOT register artifact yet — wait for tool_result to confirm success
          if (message.toolUseId) {
            pendingWritePayload.set(message.toolUseId, {
              filePath,
              content: typeof content === 'string' ? content : undefined,
            });
          }
        }
      } catch (error) {
        console.warn('Failed to parse tool_input:', error);
      }
      continue;
    }

    // Extract from tool_result messages (file paths + successful write content)
    if (message.type === 'tool_result' && message.toolOutput) {
      const output = message.toolOutput;
      const isError = isToolResultError(output);

      if (!isError && message.toolUseId) {
        const pendingWrite = pendingWritePayload.get(message.toolUseId);
        if (pendingWrite) {
          // Register artifact only after Write succeeds
          addArtifactFromPath(pendingWrite.filePath, pendingWrite.content);
        }
      }

      if (!isError) {
        extractPathsFromToolOutput(output, addArtifactFromPath);
      }
      continue;
    }

    // Extract from text messages (file path patterns)
    if (message.type === 'text' && message.content) {
      extractPathsFromTextContent(message.content, addArtifactFromPath);
    }
  }

  return artifacts;
}

function createArtifactAdder(artifacts: Artifact[]) {
  return (rawPath: string, content?: string): void => {
    const filePath = normalizePathCandidate(rawPath);
    if (!isLikelyLocalFilePath(filePath)) return;
    if (isInternalPlanningFile(filePath)) return;
    const existing = artifacts.find(a => a.path === filePath);
    if (existing) {
      if (content && !existing.content && !shouldSkipContent(existing.type)) {
        existing.content = content;
      }
      return;
    }

    const filename = filePath.split(/[\\/]/).pop() || filePath;
    const type = getArtifactTypeByExt(filename);
    const stableId = filePath.replace(/[^a-zA-Z0-9]/g, '-');

    artifacts.push({
      id: stableId,
      name: filename,
      type,
      path: filePath,
      content: shouldSkipContent(type) ? undefined : content
    });
  };
}

function isToolResultError(output: string): boolean {
  const lowerOutput = output.toLowerCase();
  return (
    lowerOutput.includes('enoent') ||
    lowerOutput.includes('no such file or directory') ||
    lowerOutput.includes('file not found') ||
    lowerOutput.includes('permission denied') ||
    lowerOutput.startsWith('failed') ||
    lowerOutput.includes('error:') ||
    lowerOutput.includes('execution failed')
  );
}

function extractPathsFromToolOutput(
  output: string,
  addArtifactFromPath: (rawPath: string, content?: string) => void
): void {
  // Markdown links like [Report PDF](./out/report.pdf)
  const markdownLinkRegex = /\[[^\]]+\]\(([^)\s]+)\)/g;
  let linkMatch;
  while ((linkMatch = markdownLinkRegex.exec(output)) !== null) {
    addArtifactFromPath(linkMatch[1]);
  }

  // Plain local path tokens
  const filePathRegex = /(?:^|[\s"'`])((?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:[\\/])[^\s"'`<>]+?\.[a-zA-Z0-9]{1,12})(?=$|[\s"'`<>])/g;
  let pathMatch;
  while ((pathMatch = filePathRegex.exec(output)) !== null) {
    addArtifactFromPath(pathMatch[1]);
  }
}

function extractPathsFromTextContent(
  content: string,
  addArtifactFromPath: (rawPath: string, content?: string) => void
): void {
  // Support sandbox:// protocol links: [text](sandbox:/path/to/file.ext)
  const sandboxLinkRegex = /\[([^\]]+)\]\(sandbox:([^\)]+)\)/g;
  let sandboxMatch;
  while ((sandboxMatch = sandboxLinkRegex.exec(content)) !== null) {
    addArtifactFromPath(sandboxMatch[2]);
  }

  // Explicit "path" labels in English/Chinese, e.g.:
  // "路径: /abs/path/file.txt" or "Path: /abs/path/file.txt"
  const labeledPathRegex = /(?:路径|path)\s*[:：]\s*((?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:[\\/])[^\s"'`<>]+?\.[A-Za-z0-9]{1,12})(?=$|[\s"'`<>])/gi;
  let labeledMatch;
  while ((labeledMatch = labeledPathRegex.exec(content)) !== null) {
    addArtifactFromPath(labeledMatch[1]);
  }

  // Support both English and Chinese messages
  // English: "created/wrote/saved/generated /path/to/file.py"
  // Chinese: "创建在：/path/to/file.py" or "已成功创建在：/path/to/file.py"
  const filePathRegex = /(?:created?|wrote|saved|generated|创建[在於]?|已.*?创建[在於]?|保存[在於]?|生成[在於]?)[:：]?\s*([\/][^\s，。！？]+\.[a-zA-Z0-9]+)/gi;
  let match;

  while ((match = filePathRegex.exec(content)) !== null) {
    addArtifactFromPath(match[1]);
  }

  // Generic local file path tokens in text outputs.
  const genericPathRegex = /(?:^|[\s"'`])((?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:[\\/])[^\s"'`<>]+?\.[a-zA-Z0-9]{1,12})(?=$|[\s"'`<>])/g;
  let genericMatch;
  while ((genericMatch = genericPathRegex.exec(content)) !== null) {
    addArtifactFromPath(genericMatch[1]);
  }
}

/**
 * Check if artifact is a README-style guide file
 */
export function isReadmeArtifact(artifact: Artifact): boolean {
  const source = (artifact.name || artifact.path || '').split(/[\\/]/).pop() || '';
  return /^readme(\.[a-z0-9]+)?$/i.test(source);
}

/**
 * Priority score for deciding default preview artifact.
 * Higher score means more likely to be "final output" for users.
 */
export function getArtifactPreviewPriority(artifact: Artifact): number {
  if (isReadmeArtifact(artifact)) return 5;

  switch (artifact.type) {
    case 'pdf':
      return 120;
    case 'presentation':
      return 115;
    case 'html':
      return 110;
    case 'image':
      return 100;
    case 'document':
      return 95;
    case 'spreadsheet':
      return 90;
    case 'csv':
      return 88;
    case 'audio':
    case 'video':
      return 80;
    case 'code':
    case 'jsx':
    case 'css':
    case 'json':
      return 70;
    case 'text':
      return 50;
    case 'markdown':
      return 20;
    default:
      return 40;
  }
}

/**
 * Sort artifacts for preview by priority, keeping original order for ties.
 */
export function sortArtifactsForPreview(artifacts: Artifact[]): Artifact[] {
  return artifacts
    .map((artifact, index) => ({
      artifact,
      index,
      priority: getArtifactPreviewPriority(artifact),
    }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .map((item) => item.artifact);
}

/**
 * Pick the best default artifact for preview.
 */
export function pickPrimaryArtifactForPreview(artifacts: Artifact[]): Artifact | undefined {
  return sortArtifactsForPreview(artifacts)[0];
}

/**
 * Decide whether we should auto-switch preview selection to candidate.
 */
export function shouldPromotePreviewSelection(current: Artifact, candidate: Artifact): boolean {
  const currentPriority = getArtifactPreviewPriority(current);
  const candidatePriority = getArtifactPreviewPriority(candidate);
  if (candidatePriority <= currentPriority) return false;

  if (isReadmeArtifact(current) && !isReadmeArtifact(candidate)) {
    return true;
  }

  return candidatePriority - currentPriority >= 20;
}

function normalizePathCandidate(raw: string): string {
  let candidate = raw.trim();

  // remove common wrappers/quotes around path tokens
  candidate = candidate.replace(/^['"`]+|['"`]+$/g, '');
  candidate = candidate.replace(/^[([<{]+/, '');
  candidate = candidate.replace(/[)\]>},;:!?]+$/, '');

  // convert sandbox: links to local path
  if (candidate.startsWith('sandbox:')) {
    candidate = candidate.slice('sandbox:'.length);
  }

  return candidate.trim();
}

function isLikelyLocalFilePath(path: string): boolean {
  if (!path) return false;
  if (/^https?:\/\//i.test(path)) return false;
  if (/^[a-z]+:/i.test(path) && !/^file:/i.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) return false;

  // must end with extension
  const filename = path.split(/[\\/]/).pop() || '';
  const extMatch = filename.match(/\.([A-Za-z0-9]{1,12})$/);
  if (!extMatch) return false;

  // stem should contain at least one alnum, reject cases like ".pdf" or "(.pdf"
  const stem = filename.slice(0, filename.length - extMatch[0].length);
  if (!/[A-Za-z0-9]/.test(stem)) return false;

  // accept absolute/relative/local filenames
  if (
    path.startsWith('/') ||
    path.startsWith('./') ||
    path.startsWith('../') ||
    path.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(path)
  ) {
    return true;
  }

  // bare filenames are allowed only for simple local names like report.pdf
  return /^[^\\/\s]+$/.test(path);
}

/**
 * Check if a URL is remote
 */
export function isRemoteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Maximum file size for preview (10MB)
 */
export const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

/**
 * Open file with external application
 */
export async function openFileExternal(path: string): Promise<void> {
  const { isTauri } = await import('shared-types');

  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(path);
  } else {
    // Web fallback - can't open local files
    console.warn('Cannot open external file in web mode:', path);
  }
}

/**
 * Get MIME type for image files
 */
export function getImageMimeType(filename: string): string {
  const ext = getFileExtension(filename);
  const mimeMap: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon'
  };
  return mimeMap[ext] || 'image/jpeg';
}

/**
 * Get MIME type for audio files
 */
export function getAudioMimeType(filename: string): string {
  const ext = getFileExtension(filename);
  const mimeMap: Record<string, string> = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'aac': 'audio/aac',
    'm4a': 'audio/mp4'
  };
  return mimeMap[ext] || 'audio/mpeg';
}

/**
 * Get MIME type for video files
 */
export function getVideoMimeType(filename: string): string {
  const ext = getFileExtension(filename);
  const mimeMap: Record<string, string> = {
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'mkv': 'video/x-matroska'
  };
  return mimeMap[ext] || 'video/mp4';
}

/**
 * Parse CSV content into 2D array
 */
export function parseCSV(content: string): string[][] {
  const lines = content.split('\n').filter(line => line.trim());
  const result: string[][] = [];
  
  for (const line of lines) {
    // Simple CSV parsing - handles basic cases
    const cells = line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
    result.push(cells);
  }
  
  return result;
}

/**
 * Parse YAML frontmatter from markdown
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, string> | null; content: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    return { frontmatter: null, content };
  }
  
  const [, yamlContent, markdownContent] = match;
  const frontmatter: Record<string, string> = {};
  
  // Simple YAML parsing for key-value pairs
  const lines = yamlContent.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      frontmatter[key] = value;
    }
  }
  
  return { frontmatter, content: markdownContent };
}

/**
 * Inline CSS and JS assets into HTML content
 */
export function inlineAssets(htmlContent: string, allArtifacts: Artifact[]): string {
  let enhancedHtml = htmlContent;
  
  // Inline CSS files
  const cssLinkRegex = /<link[^>]+href=["']([^"']+\.css)["'][^>]*>/g;
  enhancedHtml = enhancedHtml.replace(cssLinkRegex, (match, href) => {
    const cssFile = allArtifacts.find(artifact => 
      artifact.name === href || artifact.path?.endsWith(href)
    );
    
    if (cssFile && cssFile.content) {
      return `<style>\n${cssFile.content}\n</style>`;
    }
    return match;
  });
  
  // Inline JS files
  const scriptSrcRegex = /<script[^>]+src=["']([^"']+\.js)["'][^>]*><\/script>/g;
  enhancedHtml = enhancedHtml.replace(scriptSrcRegex, (match, src) => {
    const jsFile = allArtifacts.find(artifact => 
      artifact.name === src || artifact.path?.endsWith(src)
    );
    
    if (jsFile && jsFile.content) {
      return `<script>\n${jsFile.content}\n</script>`;
    }
    return match;
  });
  
  return enhancedHtml;
}

/**
 * Get language hint for syntax highlighting
 */
export function getLanguageHint(filename: string): string {
  const ext = getFileExtension(filename);
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'html': 'html',
    'htm': 'html',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sql': 'sql',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'toml': 'toml',
    'ini': 'ini',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'vue': 'vue',
    'svelte': 'svelte'
  };
  
  return langMap[ext] || 'text';
}
