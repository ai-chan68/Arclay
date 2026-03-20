/**
 * Preview API Routes
 * 
 * HTTP endpoints for preview service management
 */

import { Hono } from 'hono';
import { PreviewManager } from '../services/preview-manager.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SandboxService } from '../core/sandbox/sandbox-service';

const preview = new Hono();

// Global preview manager instance
const previewManager = new PreviewManager();
const SANDBOX_STATIC_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface SandboxStaticInstance {
  id: string;
  taskId: string;
  workDir: string;
  distDir: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  url: string | null;
  startedAt: Date;
  lastAccessed: Date;
  error?: string;
}

const sandboxStaticInstances = new Map<string, SandboxStaticInstance>();
let sandboxService: SandboxService | null = null;

export function setPreviewSandboxService(service: SandboxService): void {
  sandboxService = service;
}

function shouldPreferSandboxStatic(runtime: string | undefined): boolean {
  if (!sandboxService) return false;
  if (runtime === 'local') return false;
  if (runtime === 'sandbox_static') return true;
  return sandboxService.getProviderName() !== 'native';
}

function getSandboxStaticInstance(taskId: string): SandboxStaticInstance | null {
  const instance = sandboxStaticInstances.get(taskId) || null;
  if (!instance) return null;

  const now = Date.now();
  if (instance.status === 'running' && now - instance.lastAccessed.getTime() > SANDBOX_STATIC_IDLE_TIMEOUT_MS) {
    sandboxStaticInstances.delete(taskId);
    return null;
  }

  instance.lastAccessed = new Date();
  return instance;
}

function safeResolveUnderRoot(root: string, relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\/+/, '');
  const resolved = path.resolve(root, cleaned || 'index.html');
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }
  return resolved;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.map') return 'application/json; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function ensureSandboxStaticBuild(workDir: string): Promise<string> {
  if (!sandboxService) {
    throw new Error('Sandbox service not initialized');
  }

  const installResult = await sandboxService.execute(
    'if [ ! -x node_modules/.bin/vite ]; then npm install --no-audit --no-fund; fi',
    { cwd: workDir, timeout: 5 * 60 * 1000 }
  );
  if (installResult.exitCode !== 0) {
    throw new Error(`Sandbox install failed: ${installResult.stderr || installResult.stdout}`);
  }

  const buildResult = await sandboxService.execute('npm run build', {
    cwd: workDir,
    timeout: 5 * 60 * 1000,
  });
  if (buildResult.exitCode !== 0) {
    throw new Error(`Sandbox build failed: ${buildResult.stderr || buildResult.stdout}`);
  }

  const distDir = path.join(path.resolve(workDir), 'dist');
  try {
    const stat = await fs.stat(distDir);
    if (!stat.isDirectory()) {
      throw new Error('dist exists but is not a directory');
    }
  } catch {
    throw new Error('Sandbox build succeeded but dist directory is missing');
  }

  return distDir;
}

async function startSandboxStaticPreview(taskId: string, workDir: string, originUrl: string): Promise<SandboxStaticInstance> {
  const existing = sandboxStaticInstances.get(taskId);
  if (existing && existing.status === 'running') {
    existing.lastAccessed = new Date();
    return existing;
  }

  const instance: SandboxStaticInstance = {
    id: `sandbox-preview-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    taskId,
    workDir: path.resolve(workDir),
    distDir: '',
    status: 'starting',
    url: null,
    startedAt: new Date(),
    lastAccessed: new Date(),
  };
  sandboxStaticInstances.set(taskId, instance);

  try {
    const distDir = await ensureSandboxStaticBuild(instance.workDir);
    instance.distDir = distDir;
    instance.status = 'running';
    instance.url = new URL(`/api/preview/sandbox/${encodeURIComponent(taskId)}/`, originUrl).toString();
    return instance;
  } catch (error) {
    instance.status = 'error';
    instance.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

// Cleanup on process exit
process.on('SIGINT', async () => {
  console.log('[Preview] Shutting down preview manager...');
  await previewManager.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Preview] Shutting down preview manager...');
  await previewManager.destroy();
  process.exit(0);
});

/**
 * Check if Node.js is available
 */
preview.get('/node-available', async (c) => {
  try {
    const available = await previewManager.isNodeAvailable();
    return c.json({ available });
  } catch (error) {
    return c.json({ 
      available: false, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

/**
 * Start a preview server
 */
preview.post('/start', async (c) => {
  try {
    const body = await c.req.json();
    const { taskId, workDir, runtime } = body;

    if (!taskId || !workDir) {
      return c.json({ 
        success: false, 
        error: 'taskId and workDir are required' 
      }, 400);
    }

    const preferSandboxStatic = shouldPreferSandboxStatic(runtime);
    const requestOrigin = new URL(c.req.url).origin;

    if (preferSandboxStatic) {
      try {
        console.log(`[Preview API] Starting sandbox static preview for task ${taskId} in ${workDir}`);
        const sandboxInstance = await startSandboxStaticPreview(taskId, workDir, requestOrigin);
        return c.json({
          success: true,
          instance: {
            id: sandboxInstance.id,
            taskId: sandboxInstance.taskId,
            port: null,
            status: sandboxInstance.status,
            url: sandboxInstance.url,
            startedAt: sandboxInstance.startedAt.toISOString(),
            mode: 'sandbox_static',
          },
        });
      } catch (sandboxError) {
        if (runtime === 'sandbox_static') {
          throw sandboxError;
        }
        sandboxStaticInstances.delete(taskId);
        console.warn('[Preview API] Sandbox static preview failed, fallback to local preview:', sandboxError);
      }
    }

    console.log(`[Preview API] Starting local preview for task ${taskId} in ${workDir}`);
    const instance = await previewManager.startPreview(taskId, workDir);

    return c.json({
      success: true,
      instance: {
        id: instance.id,
        taskId: instance.taskId,
        port: instance.port,
        status: instance.status,
        url: instance.url,
        startedAt: instance.startedAt.toISOString(),
        mode: 'local',
      }
    });
  } catch (error) {
    console.error('[Preview API] Failed to start preview:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

/**
 * Stop a preview server
 */
preview.post('/stop', async (c) => {
  try {
    const body = await c.req.json();
    const { taskId } = body;

    if (!taskId) {
      return c.json({ 
        success: false, 
        error: 'taskId is required' 
      }, 400);
    }

    console.log(`[Preview API] Stopping preview for task ${taskId}`);

    if (sandboxStaticInstances.has(taskId)) {
      sandboxStaticInstances.delete(taskId);
    }

    const localInstance = previewManager.getPreviewStatus(taskId);
    if (localInstance) {
      await previewManager.stopPreview(taskId);
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('[Preview API] Failed to stop preview:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

/**
 * Get preview status for a task
 */
preview.get('/status/:taskId', async (c) => {
  try {
    const taskId = c.req.param('taskId');
    
    if (!taskId) {
      return c.json({ 
        success: false, 
        error: 'taskId is required' 
      }, 400);
    }

    const sandboxInstance = getSandboxStaticInstance(taskId);
    if (sandboxInstance) {
      return c.json({
        success: true,
        status: sandboxInstance.status,
        instance: {
          id: sandboxInstance.id,
          taskId: sandboxInstance.taskId,
          port: null,
          status: sandboxInstance.status,
          url: sandboxInstance.url,
          startedAt: sandboxInstance.startedAt.toISOString(),
          lastAccessed: sandboxInstance.lastAccessed.toISOString(),
          error: sandboxInstance.error,
          mode: 'sandbox_static',
        }
      });
    }

    const instance = previewManager.getPreviewStatus(taskId);
    
    if (!instance) {
      return c.json({
        success: true,
        status: 'idle',
        instance: null
      });
    }

    // Update last accessed time
    instance.lastAccessed = new Date();
    
    return c.json({
      success: true,
      status: instance.status,
      instance: {
        id: instance.id,
        taskId: instance.taskId,
        port: instance.port,
        status: instance.status,
        url: instance.url,
        startedAt: instance.startedAt.toISOString(),
        lastAccessed: instance.lastAccessed.toISOString(),
        error: instance.error,
        mode: 'local',
      }
    });
  } catch (error) {
    console.error('[Preview API] Failed to get preview status:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

/**
 * Stop all preview servers
 */
preview.post('/stop-all', async (c) => {
  try {
    console.log('[Preview API] Stopping all previews');
    
    sandboxStaticInstances.clear();
    await previewManager.stopAllPreviews();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('[Preview API] Failed to stop all previews:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

/**
 * Get all preview instances
 */
preview.get('/list', async (c) => {
  try {
    const localInstances = previewManager.getAllPreviews();
    const sandboxInstances = Array.from(sandboxStaticInstances.values());
    
    return c.json({
      success: true,
      instances: [
        ...localInstances.map(instance => ({
          id: instance.id,
          taskId: instance.taskId,
          port: instance.port,
          status: instance.status,
          url: instance.url,
          startedAt: instance.startedAt.toISOString(),
          lastAccessed: instance.lastAccessed.toISOString(),
          error: instance.error,
          mode: 'local',
        })),
        ...sandboxInstances.map(instance => ({
          id: instance.id,
          taskId: instance.taskId,
          port: null,
          status: instance.status,
          url: instance.url,
          startedAt: instance.startedAt.toISOString(),
          lastAccessed: instance.lastAccessed.toISOString(),
          error: instance.error,
          mode: 'sandbox_static',
        })),
      ]
    });
  } catch (error) {
    console.error('[Preview API] Failed to list previews:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

/**
 * Serve sandbox static preview files
 */
preview.get('/sandbox/:taskId/*', async (c) => {
  try {
    const taskId = c.req.param('taskId');
    const wildcard = c.req.param('*') || '';
    const instance = getSandboxStaticInstance(taskId);

    if (!instance || instance.status !== 'running' || !instance.distDir) {
      return c.text('Sandbox preview is not running for this task', 404);
    }

    let requestPath = wildcard || 'index.html';
    if (!requestPath || requestPath.endsWith('/')) {
      requestPath = `${requestPath}index.html`;
    }

    let filePath = safeResolveUnderRoot(instance.distDir, requestPath);
    if (!filePath) {
      return c.text('Invalid path', 400);
    }

    let exists = await fileExists(filePath);
    if (!exists) {
      const ext = path.extname(filePath);
      if (!ext) {
        const spaFallback = safeResolveUnderRoot(instance.distDir, 'index.html');
        if (!spaFallback) {
          return c.text('Invalid fallback path', 500);
        }
        filePath = spaFallback;
        exists = await fileExists(filePath);
      }
    }

    if (!exists) {
      return c.text('File not found', 404);
    }

    const content = await fs.readFile(filePath);
    const mimeType = getMimeType(filePath);
    c.header('Content-Type', mimeType);
    c.header('Cache-Control', 'no-store');
    return c.body(content);
  } catch (error) {
    console.error('[Preview API] Failed to serve sandbox preview file:', error);
    return c.text('Internal error while serving preview file', 500);
  }
});

export default preview;
