/**
 * Font Preview Component
 *
 * Font file preview with sample text
 */

import React, { useState, useEffect } from 'react';
import { Type } from 'lucide-react';
import type { PreviewComponentProps } from '../../shared/types/artifacts';
import { getFileSrc } from '../../shared/lib/utils';

export function FontPreview({ artifact }: PreviewComponentProps) {
  const [fontLoaded, setFontLoaded] = useState(false);
  const [fontFamily, setFontFamily] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog');

  useEffect(() => {
    if (!artifact.path) return;

    let mounted = true;

    const loadFont = async () => {
      try {
        setLoadError(null);
        const fontName = artifact.name.replace(/\.[^/.]+$/, ''); // Remove extension
        if (!artifact.path) {
          throw new Error('No font file path');
        }
        const fontSrc = await getFileSrc(artifact.path);
        const fontFace = new FontFace(fontName, `url(${fontSrc})`);

        await fontFace.load();

        if (mounted) {
          document.fonts.add(fontFace);
          setFontFamily(fontName);
          setFontLoaded(true);
        }
      } catch (error) {
        console.error('[FontPreview] Failed to load font:', error);
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load font');
        }
      }
    };

    loadFont();

    return () => {
      mounted = false;
    };
  }, [artifact.path, artifact.name]);

  if (!artifact.path) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Type className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm">No font file available</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Type className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm text-red-500">Failed to load font</p>
          <p className="mt-2 text-xs opacity-70">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background p-8">
      <div className="mx-auto max-w-4xl">
        {/* Font Info */}
        <div className="mb-8 text-center">
          <Type className="mx-auto h-12 w-12 text-primary" />
          <h2 className="mt-4 text-2xl font-bold">{artifact.name}</h2>
          {fontLoaded && (
            <p className="mt-2 text-muted-foreground">Font loaded successfully</p>
          )}
        </div>

        {/* Sample Text Input */}
        <div className="mb-8">
          <label className="mb-2 block text-sm font-medium">Sample Text:</label>
          <input
            type="text"
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Enter text to preview..."
          />
        </div>

        {/* Font Previews */}
        {fontLoaded ? (
          <div className="space-y-8">
            {/* Different sizes */}
            {[48, 36, 24, 18, 14].map((size) => (
              <div key={size} className="border-b border-border pb-6">
                <div className="mb-2 text-xs text-muted-foreground">
                  {size}px
                </div>
                <div
                  style={{
                    fontFamily: fontFamily,
                    fontSize: `${size}px`,
                    lineHeight: 1.2
                  }}
                  className="text-foreground"
                >
                  {sampleText}
                </div>
              </div>
            ))}

            {/* Character set preview */}
            <div className="border-b border-border pb-6">
              <div className="mb-2 text-xs text-muted-foreground">
                Character Set
              </div>
              <div
                style={{
                  fontFamily: fontFamily,
                  fontSize: '18px',
                  lineHeight: 1.5
                }}
                className="text-foreground"
              >
                <div className="mb-2">ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>
                <div className="mb-2">abcdefghijklmnopqrstuvwxyz</div>
                <div className="mb-2">0123456789</div>
                <div>!@#$%^&*()_+-=[]{}|;':",./{`<>`}?</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto"></div>
            <p className="mt-4 text-sm">Loading font...</p>
          </div>
        )}
      </div>
    </div>
  );
}