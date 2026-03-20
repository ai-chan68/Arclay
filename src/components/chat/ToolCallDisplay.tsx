/**
 * Tool call display component
 */

interface ToolCallDisplayProps {
  name: string
  input?: Record<string, unknown>
  id?: string
  compact?: boolean
}

export function ToolCallDisplay({ name, input, id, compact = false }: ToolCallDisplayProps) {
  // In compact mode, show a more condensed view
  if (compact) {
    // Format input as a single line for compact view
    const inputStr = input && Object.keys(input).length > 0
      ? Object.entries(input)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 50)}${v.length > 50 ? '...' : ''}"` : JSON.stringify(v)}`)
          .join(', ')
          .slice(0, 100)
      : ''

    return (
      <div className="text-xs">
        <span className="text-muted-foreground">{inputStr}</span>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-100">
          {name}
        </span>
        {id && (
          <span className="text-xs text-gray-400">
            {id.slice(0, 8)}...
          </span>
        )}
      </div>
      {input && Object.keys(input).length > 0 && (
        <pre className="text-xs whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto bg-black/5 dark:bg-white/5 p-2 rounded">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}
