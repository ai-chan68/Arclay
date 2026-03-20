/**
 * Audio Preview Component
 *
 * Audio player with controls
 */

import React, { useState, useEffect } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
import type { PreviewComponentProps } from '../../shared/types/artifacts';
import { getAudioMimeType } from '../../shared/lib/file-utils';
import { getFileSrc } from '../../shared/lib/utils';

export function AudioPreview({ artifact }: PreviewComponentProps) {
  const [audioSrc, setAudioSrc] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mimeType = getAudioMimeType(artifact.name);

  // Load audio source
  useEffect(() => {
    let mounted = true;

    async function loadAudio() {
      setIsLoading(true);
      setLoadError(null);

      try {
        // Check for data URL content first
        if (artifact.content && artifact.content.startsWith('data:')) {
          if (mounted) {
            setAudioSrc(artifact.content);
            setIsLoading(false);
          }
          return;
        }

        // Load from path
        if (artifact.path) {
          const src = await getFileSrc(artifact.path);
          if (mounted) {
            setAudioSrc(src);
            setIsLoading(false);
          }
          return;
        }

        // No valid source
        if (mounted) {
          setAudioSrc('');
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[AudioPreview] Failed to load audio:', error);
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load audio');
          setIsLoading(false);
        }
      }
    }

    loadAudio();

    return () => {
      mounted = false;
    };
  }, [artifact.content, artifact.path]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin" />
          <p className="mt-4 text-sm">Loading audio...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Volume2 className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm text-red-500">Failed to load audio</p>
          <p className="mt-2 text-xs opacity-70">{loadError}</p>
        </div>
      </div>
    );
  }

  // No source state
  if (!audioSrc) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Volume2 className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm">No audio data available</p>
          {artifact.path && (
            <p className="mt-2 text-xs opacity-70">Path: {artifact.path}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-muted/20">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Volume2 className="mx-auto h-16 w-16 text-primary" />
          <h3 className="mt-4 text-lg font-medium text-foreground">{artifact.name}</h3>
        </div>

        <audio
          controls
          className="w-full"
          preload="metadata"
        >
          <source src={audioSrc} type={mimeType} />
          Your browser does not support the audio element.
        </audio>
      </div>
    </div>
  );
}