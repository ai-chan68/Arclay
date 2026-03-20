/**
 * MarkdownRenderer - 通用 Markdown 渲染组件
 * 支持 GFM（表格、任务列表等）和代码高亮
 */

import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { cn, getFileSrcSync } from '@/shared/lib/utils'

interface MarkdownRendererProps {
  content: string
  className?: string
  fileBaseDir?: string
}

function resolveRelativePath(baseDir: string, relativePath: string): string {
  const normalizeSlashes = (value: string) => value.replace(/\\/g, '/')
  const baseParts = normalizeSlashes(baseDir).split('/').filter(Boolean)
  const relativeParts = normalizeSlashes(relativePath).split('/').filter(Boolean)

  for (const part of relativeParts) {
    if (part === '.') continue
    if (part === '..') {
      baseParts.pop()
      continue
    }
    baseParts.push(part)
  }

  const prefix = normalizeSlashes(baseDir).startsWith('/') ? '/' : ''
  return `${prefix}${baseParts.join('/')}`
}

function resolveMarkdownAssetSource(src: string | undefined, fileBaseDir?: string): string | undefined {
  if (!src) return src

  const trimmed = src.trim()
  if (!trimmed) return trimmed

  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/api/')
  ) {
    return trimmed
  }

  const isAbsoluteLocalPath =
    trimmed.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('~/')

  if (isAbsoluteLocalPath) {
    return getFileSrcSync(trimmed)
  }

  if (!fileBaseDir) {
    return trimmed
  }

  return getFileSrcSync(resolveRelativePath(fileBaseDir, trimmed))
}

// 代码块组件
function CodeBlock({
  language,
  children,
}: {
  language?: string
  children: string
}) {
  const isDark = typeof window !== 'undefined' &&
    document.documentElement.classList.contains('dark')

  // 如果没有指定语言，尝试从内容推断
  const detectedLang = language || 'text'

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border/50">
      {/* 语言标签 */}
      {detectedLang && detectedLang !== 'text' && (
        <div className="absolute right-2 top-2 z-10 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {detectedLang}
        </div>
      )}
      <SyntaxHighlighter
        language={detectedLang}
        style={isDark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.8125rem',
          lineHeight: '1.5',
          background: isDark ? '#1e1e1e' : '#fafafa',
        }}
        codeTagProps={{
          style: {
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          }
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

// 内联代码组件
function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-primary before:content-none after:content-none">
      {children}
    </code>
  )
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  fileBaseDir,
}: MarkdownRendererProps) {
  // Memoize components to prevent unnecessary re-renders
  const components = useMemo(() => ({
    // 代码块处理
    code: ({ inline, className: codeClassName, children, ...props }: {
      inline?: boolean
      className?: string
      children?: React.ReactNode
    }) => {
      const match = /language-(\w+)/.exec(codeClassName || '')
      const language = match ? match[1] : undefined
      const codeString = String(children).replace(/\n$/, '')

      if (!inline && (language || codeString.includes('\n'))) {
        return <CodeBlock language={language}>{codeString}</CodeBlock>
      }

      return <InlineCode>{codeString}</InlineCode>
    },

    // 链接处理 - 新窗口打开
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a
        href={resolveMarkdownAssetSource(href, fileBaseDir)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    ),

    // 标题处理
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="mb-4 mt-6 text-2xl font-bold first:mt-0">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="mb-3 mt-5 text-xl font-semibold first:mt-0">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h3>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h4>
    ),

    // 段落
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="my-2 leading-relaxed break-words [overflow-wrap:anywhere] first:mt-0 last:mb-0">{children}</p>
    ),

    // 列表
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="leading-relaxed break-words [overflow-wrap:anywhere]">{children}</li>
    ),

    // 引用
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="my-3 border-l-4 border-primary/50 pl-4 italic text-muted-foreground">
        {children}
      </blockquote>
    ),

    // 分割线
    hr: () => <hr className="my-4 border-border" />,

    // 表格
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="my-3 max-w-full overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-muted/50">{children}</thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <tbody className="divide-y divide-border">{children}</tbody>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <tr className="border-b border-border">{children}</tr>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="border border-border px-3 py-2 text-left align-top font-medium break-words [overflow-wrap:anywhere]">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="border border-border px-3 py-2 align-top break-words [overflow-wrap:anywhere]">{children}</td>
    ),

    // 图片
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <img
        src={resolveMarkdownAssetSource(src, fileBaseDir)}
        alt={alt}
        className="my-3 max-w-full rounded-lg"
        loading="lazy"
      />
    ),

    // 删除线
    del: ({ children }: { children?: React.ReactNode }) => (
      <del className="line-through text-muted-foreground">{children}</del>
    ),

    // 强调
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic">{children}</em>
    ),
  }), [fileBaseDir])

  return (
    <div className={cn('min-w-0 max-w-full text-sm text-foreground break-words [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
