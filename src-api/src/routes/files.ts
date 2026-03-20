/**
 * File serving API routes
 */

import { Hono } from 'hono'
import { getSandboxService } from './sandbox'
import fs from 'fs/promises'
import path from 'path'
import { createReadStream } from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',

  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.mkv': 'video/x-matroska',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Fonts
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',

  // Text
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'text/xml',
}

const execFileAsync = promisify(execFile)
const MAX_EXPORT_FILES = 500
const MAX_EXPORT_BYTES = 300 * 1024 * 1024

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

function normalizeExportName(nameRaw?: string): string {
  const fallback = 'artifacts'
  if (!nameRaw || typeof nameRaw !== 'string') return fallback
  const withoutExt = nameRaw.replace(/\.zip$/i, '')
  const safe = withoutExt
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return safe || fallback
}

function commonRootPath(paths: string[]): string {
  if (paths.length === 0) return process.cwd()
  if (paths.length === 1) return path.dirname(paths[0]!)

  const resolved = paths.map((p) => path.resolve(p))
  const first = resolved[0]!
  const root = path.parse(first).root
  const firstParts = first.slice(root.length).split(path.sep).filter(Boolean)
  let commonLength = firstParts.length

  for (let i = 1; i < resolved.length; i += 1) {
    const current = resolved[i]!
    const currentRoot = path.parse(current).root
    if (currentRoot !== root) {
      return root
    }
    const currentParts = current.slice(root.length).split(path.sep).filter(Boolean)
    let j = 0
    while (j < commonLength && j < currentParts.length && firstParts[j] === currentParts[j]) {
      j += 1
    }
    commonLength = j
    if (commonLength === 0) {
      return root
    }
  }

  return path.join(root, ...firstParts.slice(0, commonLength))
}

export const filesRoutes = new Hono()

/**
 * GET /api/files/serve - Serve a file for preview
 * Used in web mode to serve files that would otherwise use file:// protocol
 */
filesRoutes.get('/serve', async (c) => {
  const filePath = c.req.query('path')

  if (!filePath) {
    return c.json({ error: 'path is required' }, 400)
  }

  try {
    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath)
    if (normalizedPath.includes('..')) {
      return c.json({ error: 'Invalid path' }, 400)
    }

    // Check if file exists
    const sandboxService = getSandboxService()
    if (sandboxService) {
      const exists = await sandboxService.exists(normalizedPath)
      if (!exists) {
        return c.json({ error: 'File not found' }, 404)
      }
    }

    // Get MIME type
    const mimeType = getMimeType(normalizedPath)

    // Read file content
    const content = await fs.readFile(normalizedPath)

    // Set content type and return
    return new Response(content, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': content.length.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[files/serve] Error serving file:', message)
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/files/open - Open a file with system default application
 */
filesRoutes.post('/open', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { path: filePath } = body

  if (!filePath) {
    return c.json({ error: 'path is required' }, 400)
  }

  try {
    // Use sandbox service to execute the open command
    const sandboxService = getSandboxService()
    if (!sandboxService) {
      return c.json({ error: 'Sandbox service not initialized' }, 500)
    }

    // Detect platform and use appropriate command
    const platform = process.platform
    let command: string

    if (platform === 'darwin') {
      command = `open "${filePath}"`
    } else if (platform === 'win32') {
      command = `start "" "${filePath}"`
    } else {
      // Linux
      command = `xdg-open "${filePath}"`
    }

    const result = await sandboxService.execute(command)

    if (result.exitCode === 0) {
      return c.json({ success: true })
    } else {
      return c.json({
        success: false,
        error: result.stderr || 'Failed to open file',
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[files/open] Error opening file:', message)
    return c.json({ success: false, error: message }, 500)
  }
})

/**
 * POST /api/files/open-in-editor - Open a file in the default code editor
 */
filesRoutes.post('/open-in-editor', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { path: filePath, editor } = body

  if (!filePath) {
    return c.json({ error: 'path is required' }, 400)
  }

  try {
    // Common editors and their commands
    const editors: Record<string, string> = {
      vscode: 'code',
      cursor: 'cursor',
      sublime: 'subl',
      atom: 'atom',
      vim: 'vim',
      nano: 'nano',
    }

    const editorCmd = editor ? editors[editor] || editor : 'code'

    // Use sandbox service to execute the editor command
    const sandboxService = getSandboxService()
    if (!sandboxService) {
      return c.json({ error: 'Sandbox service not initialized' }, 500)
    }

    const result = await sandboxService.execute(`${editorCmd} "${filePath}"`)

    if (result.exitCode === 0) {
      return c.json({ success: true, editor: editorCmd })
    } else {
      return c.json({
        success: false,
        error: result.stderr || `Failed to open in ${editorCmd}`,
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[files/open-in-editor] Error opening file in editor:', message)
    return c.json({ success: false, error: message }, 500)
  }
})

/**
 * POST /api/files/export-zip - Export multiple files as a zip archive
 */
filesRoutes.post('/export-zip', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const pathsRaw = body?.paths
  const nameRaw = body?.name

  if (!Array.isArray(pathsRaw) || pathsRaw.length === 0) {
    return c.json({ error: 'paths must be a non-empty array' }, 400)
  }

  const uniquePaths = Array.from(
    new Set(
      pathsRaw
        .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => path.resolve(path.normalize(item)))
    )
  )

  if (uniquePaths.length === 0) {
    return c.json({ error: 'No valid file paths provided' }, 400)
  }

  if (uniquePaths.length > MAX_EXPORT_FILES) {
    return c.json({ error: `Too many files. Maximum is ${MAX_EXPORT_FILES}.` }, 400)
  }

  let totalBytes = 0
  for (const filePath of uniquePaths) {
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) {
        return c.json({ error: `Not a file: ${filePath}` }, 400)
      }
      totalBytes += stat.size
      if (totalBytes > MAX_EXPORT_BYTES) {
        return c.json({ error: `Total export size exceeds ${MAX_EXPORT_BYTES} bytes` }, 400)
      }
    } catch {
      return c.json({ error: `File not found: ${filePath}` }, 404)
    }
  }

  const zipBaseName = normalizeExportName(nameRaw)
  const commonRoot = commonRootPath(uniquePaths)
  const relativePaths = uniquePaths.map((absolutePath) => path.relative(commonRoot, absolutePath))

  if (relativePaths.some((relativePath) => relativePath === '' || relativePath.startsWith('..'))) {
    return c.json({ error: 'Invalid file selection for zip export' }, 400)
  }

  let tmpDir: string | null = null

  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easywork-export-'))
    const zipFilePath = path.join(tmpDir, `${zipBaseName}.zip`)

    await execFileAsync('zip', ['-q', '-r', zipFilePath, ...relativePaths], {
      cwd: commonRoot,
      maxBuffer: 20 * 1024 * 1024,
    })

    const zipBuffer = await fs.readFile(zipFilePath)

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipBaseName}.zip"`,
        'Content-Length': String(zipBuffer.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export zip'
    console.error('[files/export-zip] Error exporting zip:', message)
    return c.json({ error: message }, 500)
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
})
