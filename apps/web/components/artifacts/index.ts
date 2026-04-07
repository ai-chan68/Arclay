/**
 * Artifacts Components Index
 * 
 * Export all artifact preview components
 */

export { ArtifactPreview } from './ArtifactPreview';
export { CodePreview } from './CodePreview';
export { ImagePreview } from './ImagePreview';
export { PdfPreview } from './PdfPreview';
export { ExcelPreview } from './ExcelPreview';
export { DocxPreview } from './DocxPreview';
export { PptxPreview } from './PptxPreview';
export { AudioPreview } from './AudioPreview';
export { VideoPreview } from './VideoPreview';
export { FontPreview } from './FontPreview';
export { WebSearchPreview } from './WebSearchPreview';

// Re-export types
export type {
  Artifact,
  ArtifactType,
  ArtifactPreviewProps,
  PreviewComponentProps,
  PreviewMode,
  ViewMode,
  PreviewStatus
} from '../../shared/types/artifacts';