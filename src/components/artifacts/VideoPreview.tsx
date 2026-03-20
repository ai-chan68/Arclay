/**
 * Video Preview Component
 *
 * Video player with controls
 */

import React, { useState, useEffect } from 'react';
import { Play, Loader2 } from 'lucide-react';
import type { PreviewComponentProps } from '../../shared/types/artifacts';
import { getVideoMimeType } from '../../shared/lib/file-utils';
import { getFileSrc } from '../../shared/lib/utils';

export function VideoPreview({ artifact }: PreviewComponentProps) {
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mimeType = getVideoMimeType(artifact.name);

  // Load video source
  useEffect(() => {
    let mounted = true;

    async function loadVideo() {
      setIsLoading(true);
      setLoadError(null);

      try {
        // Check for data URL content first
        if (artifact.content && artifact.content.startsWith('data:')) {
          if (mounted) {
            setVideoSrc(artifact.content);
            setIsLoading(false);
          }
          return;
        }

        // Load from path
        if (artifact.path) {
          const src = await getFileSrc(artifact.path);
          if (mounted) {
            setVideoSrc(src);
            setIsLoading(false);
          }
          return;
        }

        // No valid source
        if (mounted) {
          setVideoSrc('');
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[VideoPreview] Failed to load video:', error);
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load video');
          setIsLoading(false);
        }
      }
    }

    loadVideo();

    return () => {
      mounted = false;
    };
  }, [artifact.content, artifact.path]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-muted-foreground">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin" />
          <p className="mt-4 text-sm">Loading video...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-muted-foreground">
        <div className="text-center">
          <Play className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm text-red-500">Failed to load video</p>
          <p className="mt-2 text-xs opacity-70">{loadError}</p>
        </div>
      </div>
    );
  }

  // No source state
  if (!videoSrc) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-muted-foreground">
        <div className="text-center">
          <Play className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm">No video data available</p>
          {artifact.path && (
            <p className="mt-2 text-xs opacity-70">Path: {artifact.path}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-black">
      <video
        controls
        className="max-h-full max-w-full"
        preload="metadata"
      >
        <source src={videoSrc} type={mimeType} />
        Your browser does not support the video element.
      </video>
    </div>
  );
}