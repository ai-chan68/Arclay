/**
 * Image Preview Component
 *
 * Image preview with zoom, rotation and fullscreen support
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { RotateCw, ZoomIn, ZoomOut, Maximize2, RotateCcw, Loader2 } from 'lucide-react';
import type { PreviewComponentProps } from '../../shared/types/artifacts';
import { getImageMimeType } from '../../shared/lib/file-utils';
import { getFileSrc } from '../../shared/lib/utils';

export function ImagePreview({ artifact }: PreviewComponentProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSrc, setImageSrc] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev * 1.2, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev / 1.2, 0.1));
  }, []);

  const handleRotateRight = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  const handleRotateLeft = useCallback(() => {
    setRotation(prev => (prev - 90 + 360) % 360);
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  }, [zoom, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, dragStart, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Load image source
  useEffect(() => {
    let mounted = true;

    async function loadImage() {
      setIsLoading(true);
      setLoadError(null);

      try {
        // Check for data URL content first
        if (artifact.content && artifact.content.startsWith('data:')) {
          if (mounted) {
            setImageSrc(artifact.content);
            setIsLoading(false);
          }
          return;
        }

        // Load from path
        if (artifact.path) {
          const src = await getFileSrc(artifact.path);
          if (mounted) {
            setImageSrc(src);
            setIsLoading(false);
          }
          return;
        }

        // No valid source
        if (mounted) {
          setImageSrc('');
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[ImagePreview] Failed to load image:', error);
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load image');
          setIsLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      mounted = false;
    };
  }, [artifact.content, artifact.path]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" />
          <p className="mt-2 text-sm">Loading image...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm text-red-500">Failed to load image</p>
          <p className="mt-1 text-xs opacity-70">{loadError}</p>
        </div>
      </div>
    );
  }

  // No source state
  if (!imageSrc) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">No image data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full bg-muted/20">
      {/* Controls */}
      <div className="absolute top-4 left-4 z-10 flex gap-2 rounded-lg bg-background/80 p-2 shadow-lg backdrop-blur-sm">
        <button
          onClick={handleZoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-background hover:bg-accent"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={handleZoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-background hover:bg-accent"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={handleRotateLeft}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-background hover:bg-accent"
          title="Rotate Left"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={handleRotateRight}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-background hover:bg-accent"
          title="Rotate Right"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          onClick={handleReset}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-background hover:bg-accent"
          title="Reset"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Zoom indicator */}
      <div className="absolute top-4 right-4 z-10 rounded-lg bg-background/80 px-3 py-1 text-sm backdrop-blur-sm">
        {Math.round(zoom * 100)}%
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="flex h-full cursor-grab items-center justify-center overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}
      >
        <img
          src={imageSrc}
          alt={artifact.name}
          className="max-h-none max-w-none select-none transition-transform duration-200"
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
            transformOrigin: 'center center'
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}