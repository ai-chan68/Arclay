/**
 * Artifact Preview Component
 * 
 * Main preview component that routes to specific preview components based on artifact type
 * Migrated and enhanced from easywork architecture
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Eye,
  Code,
  Copy,
  Check,
  ExternalLink,
  FileCode2,
  Maximize2,
  X,
  FileText,
  Radio,
  Loader2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  ArtifactPreviewProps,
  ViewMode,
  PreviewMode,
  Artifact
} from '../../shared/types/artifacts';
import {
  getFileExtension,
  parseCSV,
  parseFrontmatter,
  inlineAssets,
  shouldSkipContent
} from '../../shared/lib/file-utils';
import { apiFetchRaw } from '../../shared/api';
import { copyToClipboard } from '../../shared/services/clipboard-service';

// Import preview components
import { CodePreview } from './CodePreview';
import { ImagePreview } from './ImagePreview';
import { PdfPreview } from './PdfPreview';
import { ExcelPreview } from './ExcelPreview';
import { DocxPreview } from './DocxPreview';
import { PptxPreview } from './PptxPreview';
import { AudioPreview } from './AudioPreview';
import { VideoPreview } from './VideoPreview';
import { FontPreview } from './FontPreview';
import { WebSearchPreview } from './WebSearchPreview';

function isHttpUrl(value?: string): boolean {
  return !!value && /^https?:\/\//i.test(value);
}

// Expandable text component for long content
function ExpandableText({
  text,
  maxLength = 100,
}: {
  text: string;
  maxLength?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsTruncation = text.length > maxLength;

  if (!needsTruncation) {
    return <span>{text}</span>;
  }

  return (
    <span>
      {isExpanded ? text : `${text.slice(0, maxLength)}...`}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-primary ml-1 text-xs hover:underline"
      >
        {isExpanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  );
}

export function ArtifactPreview({
  artifact,
  onClose,
  hideHeader = false,
  allArtifacts = [],
  livePreviewUrl,
  livePreviewStatus = 'idle',
  livePreviewError,
  onStartLivePreview,
  onStopLivePreview,
}: ArtifactPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('static');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isNodeAvailable, setIsNodeAvailable] = useState<boolean | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load file content from path if not already available
  const loadFileContent = useCallback(async (artifact: Artifact, retryCount = 0): Promise<void> => {
    // Skip if content already exists or no path
    if (artifact.content || !artifact.path) return;
    if (isHttpUrl(artifact.path)) return;

    // Skip for binary types
    if (shouldSkipContent(artifact.type)) return;

    // Set loading state only on first attempt
    if (retryCount === 0) {
      setIsLoadingContent(true);
      setContentError(null);
    }

    try {
      // Use API to read file content (works in both Tauri and web mode)
      console.log(`[ArtifactPreview] Loading file from: ${artifact.path} (attempt ${retryCount + 1})`);
      const response = await apiFetchRaw('/api/sandbox/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        // If file not found and we haven't retried too many times, wait and retry
        // This handles the case where the file is still being written
        const isFileNotFound = result.error?.includes('ENOENT') || result.error?.includes('no such file');
        if (isFileNotFound && retryCount < 5) {
          console.log(`[ArtifactPreview] File not found, retrying in 1s... (attempt ${retryCount + 1}/5)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Recursively retry - loading state remains true
          return loadFileContent(artifact, retryCount + 1);
        }
        throw new Error(result.error || 'Failed to read file');
      }

      setLoadedContent(result.content);
      console.log('[ArtifactPreview] Successfully loaded file content from:', artifact.path);
      setIsLoadingContent(false);
    } catch (error) {
      console.error('[ArtifactPreview] Failed to load file content:', error);
      setContentError(error instanceof Error ? error.message : 'Failed to load file');
      setIsLoadingContent(false);
    }
  }, []);

  // Get the effective content (either original or loaded)
  const effectiveContent = useMemo(() => {
    return artifact?.content || loadedContent;
  }, [artifact?.content, loadedContent]);

  // Load content when artifact changes - use stable key to avoid unnecessary reloads
  const artifactKey = artifact ? `${artifact.id}-${artifact.path}` : '';
  useEffect(() => {
    // Skip if no artifact or no path
    if (!artifact?.path) {
      setLoadedContent(null);
      return;
    }

    // Don't reload if artifact already has content (embedded content takes priority)
    if (artifact.content) {
      setLoadedContent(null);
      setContentError(null);
      return;
    }

    // Load file content from path
    setLoadedContent(null);
    setContentError(null);
    loadFileContent(artifact);
  }, [artifactKey, artifact?.content, loadFileContent]);

  // Check if Node.js is available (required for Live Preview)
  useEffect(() => {
    // Only check if artifact is HTML (only type that needs live preview)
    if (artifact?.type !== 'html') {
      setIsNodeAvailable(false);
      return;
    }

    async function checkNodeAvailable() {
      try {
        const response = await apiFetchRaw('/api/preview/node-available');
        const data = await response.json();
        setIsNodeAvailable(data.available);
        console.log('[ArtifactPreview] Node.js available:', data.available);
      } catch (error) {
        console.error('[ArtifactPreview] Failed to check Node.js availability:', error);
        setIsNodeAvailable(false);
      }
    }
    checkNodeAvailable();
  }, [artifact?.type]);

  // Check if live preview is available for this artifact
  const canUseLivePreview = useMemo(() => {
    if (!artifact) return false;
    if (!isNodeAvailable) return false;
    return artifact.type === 'html' && onStartLivePreview !== undefined;
  }, [artifact, onStartLivePreview, isNodeAvailable]);

  // Auto-switch to live mode if live preview is already running
  useEffect(() => {
    if (livePreviewStatus === 'running' && canUseLivePreview) {
      setPreviewMode('live');
    }
  }, [livePreviewStatus, canUseLivePreview]);

  // Reset view mode and slide when artifact changes
  useEffect(() => {
    if (!artifact) {
      setViewMode('preview');
      setCurrentSlide(0);
      return;
    }

    // For code-only types, default to code view
    const codeOnlyTypes = ['code', 'jsx', 'css', 'json', 'text'];
    if (codeOnlyTypes.includes(artifact.type)) {
      setViewMode('code');
    } else {
      setViewMode('preview');
    }
    setCurrentSlide(0);
  }, [artifact?.id, artifact?.type]);

  // Handle copy to clipboard
  const handleCopy = async () => {
    if (!effectiveContent) return;
    try {
      await copyToClipboard(effectiveContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle open in external app
  const handleOpenExternal = async () => {
    if (!artifact) return;

    if (artifact.path) {
      if (isHttpUrl(artifact.path)) {
        window.open(artifact.path, '_blank', 'noopener,noreferrer');
        return;
      }
      try {
        console.log('[ArtifactPreview] Opening file with system app:', artifact.path);
        const response = await apiFetchRaw('/api/files/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: artifact.path }),
        });
        const result = await response.json();
        if (!result.success) {
          console.error('[ArtifactPreview] Failed to open file:', result.error);
        }
        return;
      } catch (err) {
        console.error('[ArtifactPreview] Failed to open file:', err);
      }
    }

    // Fallback for HTML content without path
    if (artifact.type === 'html' && effectiveContent) {
      const blob = new Blob([effectiveContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
  };

  // Check if artifact is a code file
  const isCodeFile = useMemo(() => {
    if (!artifact) return false;
    const codeTypes = ['code', 'jsx', 'css', 'json', 'text', 'markdown'];
    if (codeTypes.includes(artifact.type)) return true;
    const ext = getFileExtension(artifact.name);
    const codeExtensions = [
      'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'hpp',
      'css', 'scss', 'less', 'html', 'htm', 'json', 'xml', 'yaml', 'yml', 'md',
      'sql', 'sh', 'bash', 'zsh', 'toml', 'ini', 'conf', 'env', 'gitignore',
      'dockerfile', 'makefile', 'gradle', 'swift', 'kt', 'scala', 'php', 'vue', 'svelte',
    ];
    return codeExtensions.includes(ext);
  }, [artifact]);

  // Handle open in code editor
  const handleOpenInEditor = async () => {
    if (!artifact?.path) return;

    try {
      console.log('[ArtifactPreview] Opening in editor:', artifact.path);
      const response = await apiFetchRaw('/api/files/open-in-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path }),
      });
      const result = await response.json();
      if (result.success) {
        console.log('[ArtifactPreview] Opened in', result.editor);
      } else {
        console.error('[ArtifactPreview] Failed to open in editor:', result.error);
      }
    } catch (err) {
      console.error('[ArtifactPreview] Failed to open in editor:', err);
    }
  };

  // Generate iframe content for HTML with inlined assets
  const shouldShowStaticPreview = viewMode === 'preview' && previewMode === 'static';

  // Use a ref to track the current iframe src to avoid unnecessary re-renders
  const iframeSrcRef = useRef<string | null>(null);
  const lastContentRef = useRef<string>('');

  const iframeSrc = useMemo(() => {
    if (!shouldShowStaticPreview) return null;
    if (artifact?.type !== 'html') return null;

    if (artifact.path && isHttpUrl(artifact.path)) {
      if (iframeSrcRef.current && iframeSrcRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(iframeSrcRef.current);
      }
      iframeSrcRef.current = artifact.path;
      return artifact.path;
    }

    if (!effectiveContent) return null;

    // Only regenerate if content actually changed
    if (effectiveContent === lastContentRef.current && iframeSrcRef.current) {
      console.log('[ArtifactPreview] Reusing existing iframe src (content unchanged)');
      return iframeSrcRef.current;
    }

    console.log('[ArtifactPreview] Generating new iframe src, content changed:', {
      lastContentLength: lastContentRef.current?.length,
      newContentLength: effectiveContent?.length,
      hasIframeSrc: !!iframeSrcRef.current
    });

    const enhancedHtml = allArtifacts.length > 0
      ? inlineAssets(effectiveContent, allArtifacts)
      : effectiveContent;

    // Cleanup old blob URL before creating new one
    if (iframeSrcRef.current && iframeSrcRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(iframeSrcRef.current);
    }

    lastContentRef.current = effectiveContent;
    const blob = new Blob([enhancedHtml], { type: 'text/html' });
    iframeSrcRef.current = URL.createObjectURL(blob);
    return iframeSrcRef.current;
  }, [effectiveContent, artifact?.type, artifact?.path, allArtifacts, shouldShowStaticPreview]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (iframeSrcRef.current) {
        if (iframeSrcRef.current.startsWith('blob:')) {
          URL.revokeObjectURL(iframeSrcRef.current);
        }
        iframeSrcRef.current = null;
      }
    };
  }, []);

  // Parse CSV data
  const csvData = useMemo(() => {
    if (artifact?.type === 'csv' && effectiveContent) {
      return parseCSV(effectiveContent);
    }
    if (artifact?.data) {
      return artifact.data;
    }
    return null;
  }, [artifact?.type, effectiveContent, artifact?.data]);

  // Get slides for presentation
  const slides = useMemo(() => {
    if (artifact?.type === 'presentation' && artifact.slides) {
      return artifact.slides;
    }
    return null;
  }, [artifact?.type, artifact?.slides]);

  // Check if preview is available
  const hasPreview = useMemo(() => {
    if (!artifact) return false;
    switch (artifact.type) {
      case 'html':
        return !!effectiveContent || isHttpUrl(artifact.path);
      case 'image':
        return !!effectiveContent || !!artifact.path;
      case 'markdown':
        return !!effectiveContent;
      case 'text':
        return !!effectiveContent;
      case 'csv':
        return !!csvData;
      case 'spreadsheet':
        return !!artifact.path;
      case 'presentation':
        return !!artifact.path || !!slides;
      case 'pdf':
        return !!effectiveContent || !!artifact.path;
      case 'audio':
        return !!effectiveContent || !!artifact.path;
      case 'video':
        return !!effectiveContent || !!artifact.path;
      case 'font':
        return !!artifact.path;
      case 'document':
        return !!artifact.path;
      case 'websearch':
        return !!effectiveContent;
      default:
        return false;
    }
  }, [artifact, effectiveContent, csvData, slides]);

  // Check if code view is available
  const hasCodeView = useMemo(() => {
    if (!artifact) return false;
    if (['image', 'pdf', 'document', 'spreadsheet', 'presentation'].includes(artifact.type)) {
      return false;
    }
    return !!effectiveContent;
  }, [artifact, effectiveContent]);

  // Empty state
  if (!artifact) {
    return (
      <div className="bg-background flex h-full flex-col">
        <div className="border-border/50 bg-muted/30 flex shrink-0 items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Eye className="text-muted-foreground size-4" />
            <span className="text-muted-foreground text-sm font-medium">
              Artifacts
            </span>
          </div>
        </div>
        <div className="bg-muted/20 flex flex-1 flex-col items-center justify-center p-8">
          <div className="flex flex-col items-center text-center">
            <div className="border-border bg-background mb-4 flex size-16 items-center justify-center rounded-xl border">
              <FileText className="text-muted-foreground/50 size-8" />
            </div>
            <h3 className="text-muted-foreground text-sm font-medium">
              No files available
            </h3>
            <p className="text-muted-foreground/70 mt-1 text-xs">
              Select an artifact from the right panel to preview
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-background flex h-full flex-col ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      {!hideHeader && (
        <div className="border-border/50 bg-muted/30 flex shrink-0 items-center justify-between border-b px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-foreground truncate text-sm font-medium">
              {artifact.name}
            </span>
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
              {getFileExtension(artifact.name) || artifact.type}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={handleOpenExternal}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
              title="Open in external app"
            >
              <ExternalLink className="size-4" />
            </button>

            {isCodeFile && artifact.path && (
              <button
                onClick={handleOpenInEditor}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                title="Open in editor"
              >
                <FileCode2 className="size-4" />
              </button>
            )}

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              <Maximize2 className="size-4" />
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                title="Close"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* View mode toggle */}
      {(hasCodeView || (canUseLivePreview && viewMode === 'preview')) && (
        <div className="bg-muted/20 border-border/30 flex shrink-0 items-center gap-2 border-b px-4 py-2">
          {hasPreview && hasCodeView && (
            <div className="bg-muted flex items-center gap-1 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('preview')}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Eye className="size-3.5" />
                Preview
              </button>
              <button
                onClick={() => setViewMode('code')}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'code'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Code className="size-3.5" />
                Code
              </button>
            </div>
          )}

          {canUseLivePreview && viewMode === 'preview' && (
            <div className="bg-muted flex items-center gap-1 rounded-lg p-0.5">
              <button
                onClick={() => setPreviewMode('static')}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  previewMode === 'static'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Eye className="size-3.5" />
                Static
              </button>
              <button
                onClick={() => {
                  setPreviewMode('live');
                  if (livePreviewStatus === 'idle' && onStartLivePreview) {
                    onStartLivePreview();
                  }
                }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  previewMode === 'live'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Radio className={`size-3.5 ${livePreviewStatus === 'running' ? 'text-green-500' : ''}`} />
                Live
                {livePreviewStatus === 'running' && (
                  <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
                )}
              </button>
            </div>
          )}

          {!hasPreview && hasCodeView && (
            <div className="bg-muted text-foreground flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium">
              <Code className="size-3.5" />
              Code
            </div>
          )}

          {hasCodeView && viewMode === 'code' && (
            <button
              onClick={handleCopy}
              className="text-muted-foreground hover:bg-accent hover:text-foreground ml-auto flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
              title="Copy"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-500" />
                  <span className="text-emerald-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isLoadingContent ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading file content...</span>
            </div>
          </div>
        ) : contentError ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="flex flex-col items-center text-center">
              <div className="border-border bg-background mb-4 flex size-16 items-center justify-center rounded-xl border">
                <FileText className="text-muted-foreground/50 size-8" />
              </div>
              <h3 className="text-muted-foreground text-sm font-medium">
                Failed to load file
              </h3>
              <p className="text-muted-foreground/70 mt-1 text-xs">
                {contentError}
              </p>
            </div>
          </div>
        ) : viewMode === 'preview' ? (
          <PreviewContent
            artifact={artifact}
            iframeSrc={iframeSrc}
            iframeRef={iframeRef}
            csvData={csvData}
            slides={slides}
            currentSlide={currentSlide}
            onSlideChange={setCurrentSlide}
            effectiveContent={effectiveContent}
          />
        ) : (
          <CodePreview
            artifact={{ ...artifact, content: effectiveContent || undefined }}
            isLoading={isLoadingContent}
          />
        )}
      </div>
    </div>
  );
}

// Preview content component
function PreviewContent({
  artifact,
  iframeSrc,
  iframeRef,
  csvData,
  slides,
  currentSlide,
  onSlideChange,
  effectiveContent,
}: {
  artifact: Artifact;
  iframeSrc: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  csvData: string[][] | null;
  slides: string[] | null;
  currentSlide: number;
  onSlideChange: (slide: number) => void;
  effectiveContent: string | null;
}) {
  // HTML Preview
  if (artifact.type === 'html' && iframeSrc) {
    return (
      <div className="h-full bg-white">
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          title={artifact.name}
        />
      </div>
    );
  }

  // Route to specific preview components
  // Pass effective content to components that need it
  const artifactWithContent = { ...artifact, content: effectiveContent || artifact.content };

  switch (artifact.type) {
    case 'image':
      return <ImagePreview artifact={artifactWithContent} />;
    case 'pdf':
      return <PdfPreview artifact={artifactWithContent} />;
    case 'spreadsheet':
      return <ExcelPreview artifact={artifactWithContent} />;
    case 'document':
      return <DocxPreview artifact={artifactWithContent} />;
    case 'presentation':
      return <PptxPreview artifact={artifactWithContent} />;
    case 'audio':
      return <AudioPreview artifact={artifactWithContent} />;
    case 'video':
      return <VideoPreview artifact={artifactWithContent} />;
    case 'font':
      return <FontPreview artifact={artifactWithContent} />;
    case 'websearch':
      return <WebSearchPreview artifact={artifactWithContent} />;
  }

  // Markdown Preview
  if (artifact.type === 'markdown' && effectiveContent) {
    const { frontmatter, content: markdownContent } = parseFrontmatter(effectiveContent);
    return (
      <div className="bg-background h-full overflow-auto">
        <div className="max-w-none p-6">
          {/* Frontmatter Table */}
          {frontmatter && Object.keys(frontmatter).length > 0 && (
            <div className="border-border/50 mb-6 overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(frontmatter).map(([key, value]) => (
                    <tr key={key} className="border-border/30 border-b last:border-b-0">
                      <td className="bg-muted/30 text-muted-foreground w-32 px-4 py-2 align-top font-medium">
                        {key}
                      </td>
                      <td className="text-foreground px-4 py-2">
                        <ExpandableText text={value} maxLength={100} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Markdown Content */}
          <div className="prose prose-sm dark:prose-invert prose-h1:text-xl prose-h1:font-semibold prose-h2:text-lg prose-h2:font-semibold max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {markdownContent}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // Plain text preview
  if (artifact.type === 'text' && effectiveContent) {
    return (
      <div className="bg-background h-full overflow-auto p-6">
        <pre className="text-foreground whitespace-pre-wrap break-words text-sm leading-6">
          {effectiveContent}
        </pre>
      </div>
    );
  }

  // CSV Preview
  if (artifact.type === 'csv' && csvData) {
    return <ExcelPreview artifact={{ ...artifact, data: csvData }} />;
  }

  // Default: show prompt to switch to code view
  return (
    <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center text-center">
        <div className="border-border bg-background mb-4 flex size-16 items-center justify-center rounded-xl border">
          <Code className="text-muted-foreground/50 size-8" />
        </div>
        <h3 className="text-muted-foreground text-sm font-medium">
          Preview not available
        </h3>
        <p className="text-muted-foreground/70 mt-1 text-xs">
          Switch to Code view to see the content
        </p>
      </div>
    </div>
  );
}
