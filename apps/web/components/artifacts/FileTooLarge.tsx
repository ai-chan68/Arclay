/**
 * File Too Large Component
 *
 * Displayed when a file is too large to preview
 */

import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { FileTooLargeProps } from '../../shared/types/artifacts';
import { formatFileSize } from '../../shared/lib/file-utils';

export function FileTooLarge({ artifact, fileSize, icon: Icon, onOpenExternal }: FileTooLargeProps) {
  return (
    <div className="flex h-full items-center justify-center bg-muted/20">
      <div className="max-w-md text-center">
        <div className="border-border bg-background mb-4 flex h-20 w-20 items-center justify-center rounded-xl border mx-auto">
          <Icon className="h-10 w-10 text-muted-foreground" />
        </div>

        <h3 className="text-foreground mb-2 text-lg font-medium">
          {artifact.name}
        </h3>

        <p className="text-muted-foreground mb-2 text-sm">
          File is too large to preview
        </p>

        <p className="text-muted-foreground mb-6 text-xs">
          Size: {formatFileSize(fileSize)} (max 10MB for preview)
        </p>

        {artifact.path && (
          <button
            onClick={onOpenExternal}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="h-4 w-4" />
            Open in External App
          </button>
        )}
      </div>
    </div>
  );
}
