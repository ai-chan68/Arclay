/**
 * Artifact Types and Interfaces
 * 
 * Unified file type system supporting multiple application scenarios
 * Migrated from easywork architecture
 */

export type ArtifactType =
  | 'html'
  | 'jsx' 
  | 'css'
  | 'json'
  | 'text'
  | 'image'
  | 'code'
  | 'markdown'
  | 'csv'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'font'
  | 'websearch';

export interface Artifact {
  id: string;
  name: string;
  type: ArtifactType;
  content?: string;
  path?: string;
  // For presentations: array of slide contents (HTML or image URLs)
  slides?: string[];
  // For spreadsheets: parsed data
  data?: string[][];
  // File size in bytes (used when file is too large)
  fileSize?: number;
  // Flag indicating the file is too large to preview
  fileTooLarge?: boolean;
}

export interface ArtifactPreviewProps {
  artifact: Artifact | null;
  onClose?: () => void;
  hideHeader?: boolean;
  // All artifacts for resolving relative imports
  allArtifacts?: Artifact[];
  // Live preview props
  livePreviewUrl?: string | null;
  livePreviewStatus?: PreviewStatus;
  livePreviewError?: string | null;
  onStartLivePreview?: () => void;
  onStopLivePreview?: () => void;
}

export type PreviewMode = 'static' | 'live';
export type ViewMode = 'preview' | 'code';
export type PreviewStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

// Props for individual preview components
export interface PreviewComponentProps {
  artifact: Artifact;
}

// Excel sheet interface
export interface ExcelSheet {
  name: string;
  data: string[][];
}

// PPTX slide interface
export interface PptxSlide {
  index: number;
  title: string;
  content: string[];
  imageUrl?: string;
}

// DOCX paragraph interface
export interface DocxParagraph {
  text: string;
  style?: string;
  isBold?: boolean;
  isItalic?: boolean;
  isHeading?: boolean;
  headingLevel?: number;
}

// File too large component props
export interface FileTooLargeProps {
  artifact: Artifact;
  fileSize: number;
  icon: React.ComponentType<{ className?: string }>;
  onOpenExternal: () => void;
}

// File type detection constants
export const SKIP_CONTENT_TYPES: ArtifactType[] = [
  'audio',
  'video', 
  'font',
  'image',
  'pdf',
  'spreadsheet',
  'presentation',
  'document'
];

export const CODE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'css', 'scss', 'less', 'html', 'htm', 'json', 'xml', 'yaml', 'yml', 'md',
  'sql', 'sh', 'bash', 'zsh', 'toml', 'ini', 'conf', 'env', 'gitignore',
  'dockerfile', 'makefile', 'gradle', 'swift', 'kt', 'scala', 'php', 'vue', 'svelte'
];

export const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'
];

export const DOCUMENT_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'rtf', 'odt'
];

export const SPREADSHEET_EXTENSIONS = [
  'xls', 'xlsx', 'numbers', 'ods', 'csv', 'tsv'
];

export const PRESENTATION_EXTENSIONS = [
  'ppt', 'pptx', 'key', 'odp'
];

export const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'
];

export const VIDEO_EXTENSIONS = [
  'mp4', 'webm', 'avi', 'mov', 'wmv', 'flv', 'mkv'
];

export const FONT_EXTENSIONS = [
  'ttf', 'otf', 'woff', 'woff2'
];
