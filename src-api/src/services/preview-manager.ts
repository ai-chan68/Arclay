/**
 * Preview Manager Service
 * 
 * Manages Vite development server instances for live preview
 * Migrated and enhanced from easywork architecture
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface PreviewInstance {
  id: string;
  taskId: string;
  port: number;
  process: ChildProcess | null;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  url: string | null;
  workDir: string;
  startedAt: Date;
  lastAccessed: Date;
  error?: string;
}

export interface PreviewConfig {
  maxInstances: number;
  portRange: [number, number];
  idleTimeout: number; // minutes
  startupTimeout: number; // seconds
  autoInstallDeps: boolean;
}

export class PreviewManager {
  private instances = new Map<string, PreviewInstance>();
  private config: PreviewConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<PreviewConfig> = {}) {
    this.config = {
      maxInstances: 5,
      portRange: [5173, 5273],
      idleTimeout: 30, // 30 minutes
      startupTimeout: 120, // 2 minutes
      autoInstallDeps: true,
      ...config
    };

    // Start health check interval
    this.startHealthCheck();
  }

  /**
   * Check if Node.js is available
   */
  async isNodeAvailable(): Promise<boolean> {
    try {
      await execAsync('node --version');
      return true;
    } catch (error) {
      console.error('[PreviewManager] Node.js not available:', error);
      return false;
    }
  }

  /**
   * Start a preview server for a task
   */
  async startPreview(taskId: string, workDir: string): Promise<PreviewInstance> {
    // Check if already running
    const existing = Array.from(this.instances.values()).find(
      instance => instance.taskId === taskId
    );
    if (existing && existing.status === 'running') {
      existing.lastAccessed = new Date();
      return existing;
    }

    // Check instance limit
    const runningCount = Array.from(this.instances.values()).filter(
      instance => instance.status === 'running' || instance.status === 'starting'
    ).length;

    if (runningCount >= this.config.maxInstances) {
      throw new Error(`Maximum preview instances (${this.config.maxInstances}) reached`);
    }

    // Check if Node.js is available
    if (!(await this.isNodeAvailable())) {
      throw new Error('Node.js is not available. Please install Node.js to use live preview.');
    }

    // Find available port
    const port = await this.findAvailablePort();
    const instanceId = `preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const instance: PreviewInstance = {
      id: instanceId,
      taskId,
      port,
      process: null,
      status: 'starting',
      url: null,
      workDir,
      startedAt: new Date(),
      lastAccessed: new Date()
    };

    this.instances.set(instanceId, instance);

    try {
      // Ensure project files exist
      await this.ensureProjectFiles(workDir, port);

      // Install dependencies if needed
      if (this.config.autoInstallDeps) {
        await this.installDependencies(workDir);
      }

      // Start Vite server
      await this.startViteServer(instance);

      // Wait for server to be ready
      await this.waitForServerReady(instance);

      instance.status = 'running';
      instance.url = `http://localhost:${port}`;
      
      console.log(`[PreviewManager] Started preview for task ${taskId} on port ${port}`);
      return instance;

    } catch (error) {
      instance.status = 'error';
      instance.error = error instanceof Error ? error.message : String(error);
      console.error(`[PreviewManager] Failed to start preview for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Stop a preview server
   */
  async stopPreview(taskId: string): Promise<void> {
    const instance = Array.from(this.instances.values()).find(
      inst => inst.taskId === taskId
    );

    if (!instance) {
      throw new Error(`No preview instance found for task ${taskId}`);
    }

    await this.stopInstance(instance);
  }

  /**
   * Stop all preview servers
   */
  async stopAllPreviews(): Promise<void> {
    const stopPromises = Array.from(this.instances.values()).map(instance =>
      this.stopInstance(instance).catch(err => 
        console.error(`Failed to stop instance ${instance.id}:`, err)
      )
    );

    await Promise.all(stopPromises);
    this.instances.clear();
  }

  /**
   * Get preview status for a task
   */
  getPreviewStatus(taskId: string): PreviewInstance | null {
    return Array.from(this.instances.values()).find(
      instance => instance.taskId === taskId
    ) || null;
  }

  /**
   * Get all preview instances
   */
  getAllPreviews(): PreviewInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Find an available port in the configured range
   */
  private async findAvailablePort(): Promise<number> {
    const [start, end] = this.config.portRange;
    
    for (let port = start; port <= end; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    
    throw new Error(`No available ports in range ${start}-${end}`);
  }

  /**
   * Check if a port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`lsof -ti:${port}`);
      return !stdout.trim(); // Port is available if no process is using it
    } catch (error) {
      return true; // Port is available if lsof command fails
    }
  }

  /**
   * Ensure project files exist (package.json, vite.config.js, index.html)
   */
  private async ensureProjectFiles(workDir: string, port: number): Promise<void> {
    // Create package.json if it doesn't exist
    const packageJsonPath = path.join(workDir, 'package.json');
    try {
      await fs.access(packageJsonPath);
    } catch {
      const packageJson = {
        name: 'preview-project',
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        },
        devDependencies: {
          vite: '^5.0.0'
        }
      };
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }

    // Create vite.config.js
    const viteConfigPath = path.join(workDir, 'vite.config.js');
    const viteConfig = `import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: ${port},
    host: 'localhost',
    strictPort: true,
    open: false
  },
  build: {
    outDir: 'dist'
  }
});`;
    await fs.writeFile(viteConfigPath, viteConfig);

    // Create index.html if it doesn't exist
    const indexHtmlPath = path.join(workDir, 'index.html');
    try {
      await fs.access(indexHtmlPath);
    } catch {
      // Look for other HTML files
      const files = await fs.readdir(workDir);
      const htmlFiles = files.filter(file => file.endsWith('.html'));
      
      if (htmlFiles.length > 0) {
        // Create a redirect to the first HTML file
        const redirectHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=./${htmlFiles[0]}">
  <title>Redirecting...</title>
</head>
<body>
  <p>Redirecting to <a href="./${htmlFiles[0]}">${htmlFiles[0]}</a>...</p>
</body>
</html>`;
        await fs.writeFile(indexHtmlPath, redirectHtml);
      } else {
        // Create a basic index.html
        const basicHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
</head>
<body>
  <h1>Live Preview</h1>
  <p>No HTML files found in this directory.</p>
</body>
</html>`;
        await fs.writeFile(indexHtmlPath, basicHtml);
      }
    }
  }

  /**
   * Install dependencies using npm
   */
  private async installDependencies(workDir: string): Promise<void> {
    try {
      const viteBinaryPath = path.join(workDir, 'node_modules', '.bin', 'vite');
      try {
        await fs.access(viteBinaryPath);
        console.log(`[PreviewManager] Vite already installed in ${workDir}, skipping npm install`);
        return;
      } catch {
        // Vite not installed, continue with npm install.
      }

      console.log(`[PreviewManager] Installing dependencies in ${workDir}`);
      await execAsync('npm install', { 
        cwd: workDir,
        timeout: 60000 // 1 minute timeout
      });
      console.log(`[PreviewManager] Dependencies installed successfully`);
    } catch (error) {
      console.error(`[PreviewManager] Failed to install dependencies:`, error);
      throw new Error('Failed to install dependencies. Please run npm install manually.');
    }
  }

  /**
   * Start Vite server process
   */
  private async startViteServer(instance: PreviewInstance): Promise<void> {
    return new Promise((resolve, reject) => {
      const viteProcess = spawn('npx', ['--yes', 'vite', '--host', 'localhost', '--strictPort', '--port', instance.port.toString()], {
        cwd: instance.workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'development',
          BROWSER: 'none'
        }
      });

      instance.process = viteProcess;

      let serverReady = false;
      let startupTimeout: NodeJS.Timeout;

      const cleanup = () => {
        if (startupTimeout) clearTimeout(startupTimeout);
      };

      // Set startup timeout
      startupTimeout = setTimeout(() => {
        cleanup();
        if (!serverReady) {
          viteProcess.kill();
          reject(new Error(`Vite server startup timeout (${this.config.startupTimeout}s)`));
        }
      }, this.config.startupTimeout * 1000);

      // Handle stdout
      viteProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log(`[Vite:${instance.port}]`, output);

        // Check if server is ready
        if (output.includes('Local:') || output.includes(`localhost:${instance.port}`)) {
          serverReady = true;
          cleanup();
          resolve();
        }
      });

      // Handle stderr
      viteProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        console.error(`[Vite:${instance.port}]`, output);

        if (output.includes('Need to install the following packages')) {
          cleanup();
          viteProcess.kill();
          reject(new Error('Vite is not installed in preview workspace. Please retry after dependencies are installed.'));
        }
      });

      // Handle process exit
      viteProcess.on('exit', (code, signal) => {
        cleanup();
        if (!serverReady) {
          reject(new Error(`Vite server exited with code ${code}, signal ${signal}`));
        }
      });

      // Handle process error
      viteProcess.on('error', (error) => {
        cleanup();
        reject(error);
      });
    });
  }

  /**
   * Wait for server to be ready by checking HTTP endpoint
   */
  private async waitForServerReady(instance: PreviewInstance): Promise<void> {
    const maxAttempts = 30; // 30 attempts with 1s interval = 30s timeout
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`http://localhost:${instance.port}`);
        if (response.ok) {
          return; // Server is ready
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error(`Server did not become ready within ${maxAttempts} seconds`);
  }

  /**
   * Stop a preview instance
   */
  private async stopInstance(instance: PreviewInstance): Promise<void> {
    if (instance.status === 'stopped') {
      return;
    }

    instance.status = 'stopping';

    if (instance.process) {
      try {
        // Try graceful shutdown first
        instance.process.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Force kill if still running
        if (!instance.process.killed) {
          instance.process.kill('SIGKILL');
        }
      } catch (error) {
        console.error(`[PreviewManager] Error stopping process for instance ${instance.id}:`, error);
      }
    }

    instance.status = 'stopped';
    instance.process = null;
    instance.url = null;
    
    this.instances.delete(instance.id);
    console.log(`[PreviewManager] Stopped preview instance ${instance.id}`);
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Perform health check on all instances
   */
  private async performHealthCheck(): Promise<void> {
    const now = new Date();
    const idleTimeoutMs = this.config.idleTimeout * 60 * 1000;

    for (const instance of this.instances.values()) {
      // Check for idle timeout
      const idleTime = now.getTime() - instance.lastAccessed.getTime();
      if (idleTime > idleTimeoutMs && instance.status === 'running') {
        console.log(`[PreviewManager] Stopping idle instance ${instance.id} (idle for ${Math.round(idleTime / 60000)}m)`);
        await this.stopInstance(instance);
        continue;
      }

      // Check if process is still alive
      if (instance.process && instance.status === 'running') {
        try {
          // Try to fetch the server to check if it's responsive
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(`http://localhost:${instance.port}`, {
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
          }
        } catch (error) {
          console.log(`[PreviewManager] Instance ${instance.id} is not responsive, stopping`);
          await this.stopInstance(instance);
        }
      }
    }
  }

  /**
   * Cleanup and stop all instances
   */
  async destroy(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    await this.stopAllPreviews();
  }
}
