/**
 * PDF Preview Component
 *
 * PDF document preview using iframe (more reliable than embed)
 */

import React, { useState, useEffect } from 'react';
import { FileText, ExternalLink, Loader2 } from 'lucide-react';
import type { PreviewComponentProps } from '../../shared/types/artifacts';
import { getFileSrc } from '../../shared/lib/utils';
import { apiFetchRaw } from '../../shared/api';

export function PdfPreview({ artifact }: PreviewComponentProps) {
  const [pdfSrc, setPdfSrc] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load PDF source
  useEffect(() => {
    let mounted = true;

    async function loadPdf() {
      setIsLoading(true);
      setLoadError(null);

      try {
        // Check for data URL content first
        if (artifact.content && artifact.content.startsWith('data:')) {
          if (mounted) {
            setPdfSrc(artifact.content);
            setIsLoading(false);
          }
          return;
        }

        // Load from path
        if (artifact.path) {
          const src = await getFileSrc(artifact.path);
          if (mounted) {
            setPdfSrc(src);
            setIsLoading(false);
          }
          return;
        }

        // No valid source
        if (mounted) {
          setPdfSrc('');
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[PdfPreview] Failed to load PDF:', error);
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load PDF');
          setIsLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      mounted = false;
    };
  }, [artifact.content, artifact.path]);

  const handleOpenExternal = async () => {
    if (artifact.path) {
      try {
        await apiFetchRaw('/api/files/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: artifact.path }),
        });
      } catch (error) {
        console.error('[PdfPreview] Failed to open file:', error);
      }
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin" />
          <p className="mt-4 text-sm">Loading PDF...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileText className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm text-red-500">Failed to load PDF</p>
          <p className="mt-2 text-xs opacity-70">{loadError}</p>
        </div>
      </div>
    );
  }

  // No source state
  if (!pdfSrc) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileText className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm">No PDF data available</p>
          {artifact.path && (
            <p className="mt-2 text-xs opacity-70">Path: {artifact.path}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Controls */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleOpenExternal}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-background/80 shadow-lg backdrop-blur-sm hover:bg-accent"
          title="Open in external app"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      {/* PDF iframe - more reliable than embed */}
      <iframe
        src={pdfSrc}
        className="h-full w-full border-0"
        title={artifact.name}
      />
    </div>
  );
}