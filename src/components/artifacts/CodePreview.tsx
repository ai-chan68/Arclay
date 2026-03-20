/**
 * Code Preview Component
 *
 * Syntax highlighted code preview with language detection
 */

import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Loader2, FileText } from 'lucide-react';
import type { PreviewComponentProps } from '../../shared/types/artifacts';
import { getLanguageHint } from '../../shared/lib/file-utils';

interface CodePreviewProps extends PreviewComponentProps {
  isLoading?: boolean;
}

export function CodePreview({ artifact, isLoading }: CodePreviewProps) {
  // Show loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading file content...</span>
        </div>
      </div>
    );
  }

  if (!artifact.content) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-16 items-center justify-center rounded-xl border">
            <FileText className="text-muted-foreground/50 size-8" />
          </div>
          <h3 className="text-muted-foreground text-sm font-medium">
            No content available
          </h3>
          <p className="text-muted-foreground/70 mt-1 text-xs">
            {artifact.path ? `File: ${artifact.path}` : 'Content could not be loaded'}
          </p>
        </div>
      </div>
    );
  }

  const language = getLanguageHint(artifact.name);
  const isDark = document.documentElement.classList.contains('dark');
  
  return (
    <div className="h-full overflow-auto">
      <SyntaxHighlighter
        language={language}
        style={isDark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '1rem',
          background: 'transparent',
          fontSize: '0.875rem',
          lineHeight: '1.5'
        }}
        showLineNumbers
        wrapLines
        wrapLongLines
      >
        {artifact.content}
      </SyntaxHighlighter>
    </div>
  );
}