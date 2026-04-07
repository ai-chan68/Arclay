/**
 * Web Search Preview Component
 * 
 * Preview for web search results
 */

import React from 'react';
import { Search, ExternalLink } from 'lucide-react';
import type { PreviewComponentProps } from '../../shared/types/artifacts';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function WebSearchPreview({ artifact }: PreviewComponentProps) {
  let searchResults: SearchResult[] = [];
  
  try {
    if (artifact.content) {
      const parsed = JSON.parse(artifact.content);
      if (Array.isArray(parsed)) {
        searchResults = parsed;
      } else if (parsed.results && Array.isArray(parsed.results)) {
        searchResults = parsed.results;
      }
    }
  } catch (error) {
    console.error('Failed to parse search results:', error);
  }

  if (searchResults.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Search className="mx-auto h-16 w-16 opacity-50" />
          <p className="mt-4 text-sm">No search results available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <Search className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">Search Results</h2>
          <span className="text-sm text-muted-foreground">
            ({searchResults.length} results)
          </span>
        </div>

        <div className="space-y-6">
          {searchResults.map((result, index) => (
            <div
              key={index}
              className="rounded-lg border border-border bg-card p-4 hover:bg-accent/50 transition-colors"
            >
              <div className="mb-2 flex items-start justify-between gap-4">
                <h3 className="text-lg font-medium text-foreground hover:text-primary">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {result.title}
                  </a>
                </h3>
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              
              <div className="mb-3 text-sm text-muted-foreground">
                {result.url}
              </div>
              
              <p className="text-sm text-muted-foreground leading-relaxed">
                {result.snippet}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}