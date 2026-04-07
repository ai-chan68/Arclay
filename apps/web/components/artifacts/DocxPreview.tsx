/**
 * DOCX Preview Component
 *
 * Word document preview with JSZip XML parsing
 */

import React, { useEffect, useState } from 'react';
import { FileText, ExternalLink, Loader2 } from 'lucide-react';
import type { DocxParagraph, PreviewComponentProps } from '../../shared/types/artifacts';
import { isRemoteUrl, MAX_PREVIEW_SIZE, openFileExternal, formatFileSize } from '../../shared/lib/file-utils';
import { apiFetchRaw } from '../../shared/api';
import { FileTooLarge } from './FileTooLarge';
import { cn } from '../../shared/lib/utils';

/**
 * Read file content via API (works in both Tauri and web mode)
 */
async function readFileViaAPI(path: string): Promise<Uint8Array> {
  const response = await apiFetchRaw('/api/sandbox/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, encoding: 'base64' }),
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to read file');
  }

  // Decode base64 to binary
  const base64Data = result.content;
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function DocxPreview({ artifact }: PreviewComponentProps) {
  const [paragraphs, setParagraphs] = useState<DocxParagraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);

  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  useEffect(() => {
    async function loadDocx() {
      if (!artifact.path) {
        setError('No DOCX file path available');
        setLoading(false);
        return;
      }

      console.log('[DOCX Preview] Loading DOCX from path:', artifact.path);

      try {
        let arrayBuffer: ArrayBuffer;

        if (isRemoteUrl(artifact.path)) {
          const url = artifact.path.startsWith('//')
            ? `https:${artifact.path}`
            : artifact.path;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch DOCX: ${response.status} ${response.statusText}`
            );
          }
          arrayBuffer = await response.arrayBuffer();
        } else {
          // Use API to read file (works in both Tauri and web mode)
          const bytes = await readFileViaAPI(artifact.path);
          arrayBuffer = bytes.buffer;
        }

        // Check file size
        if (arrayBuffer.byteLength > MAX_PREVIEW_SIZE) {
          console.log('[DOCX Preview] File too large:', arrayBuffer.byteLength);
          setFileTooLarge(arrayBuffer.byteLength);
          setLoading(false);
          return;
        }

        console.log('[DOCX Preview] Loaded', arrayBuffer.byteLength, 'bytes');

        // Dynamically import JSZip
        const JSZip = (await import('jszip')).default;

        // Parse DOCX using JSZip
        const zip = await JSZip.loadAsync(arrayBuffer);

        // Get document.xml content
        const documentXml = await zip
          .file('word/document.xml')
          ?.async('string');
        if (!documentXml) {
          throw new Error('Invalid DOCX: missing word/document.xml');
        }

        // Parse XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(documentXml, 'text/xml');

        // Extract paragraphs
        const parsedParagraphs: DocxParagraph[] = [];
        const pElements = doc.querySelectorAll('w\\:p, p');

        pElements.forEach((pEl) => {
          // Get paragraph style
          const pStyle = pEl.querySelector('w\\:pStyle, pStyle');
          const styleName = pStyle?.getAttribute('w:val') || '';

          // Check if it's a heading
          const isHeading =
            styleName.toLowerCase().includes('heading') ||
            styleName.toLowerCase().includes('title') ||
            styleName.match(/^h\d$/i) !== null;
          const headingMatch = styleName.match(/(\d)/);
          const headingLevel = headingMatch
            ? parseInt(headingMatch[1])
            : undefined;

          // Get all text content from this paragraph
          const textElements = pEl.querySelectorAll('w\\:t, t');
          let paragraphText = '';

          textElements.forEach((tEl) => {
            paragraphText += tEl.textContent || '';
          });

          // Check for bold/italic
          const rPr = pEl.querySelector('w\\:rPr, rPr');
          const isBold = !!rPr?.querySelector('w\\:b, b');
          const isItalic = !!rPr?.querySelector('w\\:i, i');

          // Only add non-empty paragraphs
          if (paragraphText.trim()) {
            parsedParagraphs.push({
              text: paragraphText,
              style: styleName,
              isBold,
              isItalic,
              isHeading,
              headingLevel,
            });
          }
        });

        console.log(
          '[DOCX Preview] Parsed',
          parsedParagraphs.length,
          'paragraphs'
        );
        setParagraphs(parsedParagraphs);
        setError(null);
      } catch (err) {
        console.error('[DOCX Preview] Failed to load DOCX:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    }

    loadDocx();
  }, [artifact.path]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-muted/20 p-8">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        <p className="text-muted-foreground mt-4 text-sm">
          Loading document...
        </p>
      </div>
    );
  }

  if (fileTooLarge !== null) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={fileTooLarge}
        icon={FileText}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  if (error || paragraphs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 p-8">
        <div className="max-w-md text-center">
          <div className="border-border bg-background mb-4 flex h-20 w-20 items-center justify-center rounded-xl border mx-auto">
            <FileText className="h-10 w-10 text-blue-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground mb-4 text-sm break-all whitespace-pre-wrap">
            {error || 'No content available'}
          </p>
          {artifact.path && (
            <button
              onClick={handleOpenExternal}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Word
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Document content */}
      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-3xl">
          {paragraphs.map((para, idx) => {
            // Render based on style
            if (para.isHeading || para.style?.toLowerCase().includes('title')) {
              const level =
                para.headingLevel ||
                (para.style?.toLowerCase().includes('title') ? 1 : 2);
              const headingClasses = cn(
                'font-bold text-foreground mb-4',
                level === 1 && 'text-3xl mt-8',
                level === 2 && 'text-2xl mt-6',
                level === 3 && 'text-xl mt-4',
                level > 3 && 'text-lg mt-4'
              );

              if (level === 1) {
                return (
                  <h1 key={idx} className={headingClasses}>
                    {para.text}
                  </h1>
                );
              } else if (level === 2) {
                return (
                  <h2 key={idx} className={headingClasses}>
                    {para.text}
                  </h2>
                );
              } else if (level === 3) {
                return (
                  <h3 key={idx} className={headingClasses}>
                    {para.text}
                  </h3>
                );
              } else {
                return (
                  <h4 key={idx} className={headingClasses}>
                    {para.text}
                  </h4>
                );
              }
            }

            // Regular paragraph
            return (
              <p
                key={idx}
                className={cn(
                  'mb-4 text-base leading-relaxed text-foreground/90',
                  para.isBold && 'font-semibold',
                  para.isItalic && 'italic'
                )}
              >
                {para.text}
              </p>
            );
          })}
        </div>
      </div>

      {/* Status bar */}
      <div className="border-border bg-muted/30 shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
        {paragraphs.length} paragraphs
      </div>
    </div>
  );
}
