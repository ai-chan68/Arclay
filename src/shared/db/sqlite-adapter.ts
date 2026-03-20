import type {
  Session,
  Task,
  Message,
  LibraryFile,
  CreateSessionInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateMessageInput,
  CreateFileInput,
} from 'shared-types';
import {
  BooleanTransformer,
  TaskTransformer,
  MessageTransformer,
  FileTransformer,
} from 'shared-types';
import type { IStorageAdapter } from './storage-adapter';

// SQLite database connection
let sqliteDb: Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-sql').default.load>
> | null = null;

const SQLITE_DB_NAME = 'sqlite:easywork.db';

/**
 * Get or create SQLite database connection
 */
async function getSQLiteDB() {
  if (sqliteDb) return sqliteDb;

  try {
    const Database = (await import('@tauri-apps/plugin-sql')).default;
    sqliteDb = await Database.load(SQLITE_DB_NAME);
    console.log('[SQLite] Database connected');
    return sqliteDb;
  } catch (error) {
    console.error('[SQLite] Failed to connect:', error);
    throw error;
  }
}

/**
 * SQLite Storage Adapter
 * Implements IStorageAdapter for Tauri desktop environment
 */
export class SQLiteAdapter implements IStorageAdapter {
  async init(): Promise<void> {
    // Database is initialized by Tauri backend
    // Just verify connection works
    await getSQLiteDB();
    console.log('[SQLite] Adapter initialized');
  }

  async getVersion(): Promise<number> {
    // SQLite version is managed by Tauri backend
    // Return a fixed version for compatibility
    return 3;
  }

  async close(): Promise<void> {
    if (sqliteDb) {
      await sqliteDb.close();
      sqliteDb = null;
    }
  }

  // ============ Session Operations ============

  async createSession(input: CreateSessionInput): Promise<Session> {
    const db = await getSQLiteDB();

    // Ensure sessions table exists
    await this.ensureSessionsTable(db);

    await db.execute(
      'INSERT INTO sessions (id, prompt, task_count) VALUES ($1, $2, $3)',
      [input.id, input.prompt, 0]
    );

    const session = await this.getSession(input.id);
    if (!session) throw new Error('Failed to create session');

    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const db = await getSQLiteDB();

    try {
      const result = await db.select<Session[]>(
        'SELECT * FROM sessions WHERE id = $1',
        [id]
      );
      return result[0] || null;
    } catch {
      return null;
    }
  }

  async listSessions(): Promise<Session[]> {
    const db = await getSQLiteDB();

    try {
      return await db.select<Session[]>(
        'SELECT * FROM sessions ORDER BY created_at DESC'
      );
    } catch {
      return [];
    }
  }

  async updateSessionTaskCount(
    sessionId: string,
    taskCount: number
  ): Promise<void> {
    const db = await getSQLiteDB();

    try {
      await db.execute(
        "UPDATE sessions SET task_count = $1, updated_at = datetime('now') WHERE id = $2",
        [taskCount, sessionId]
      );
    } catch {
      // Session table may not exist
    }
  }

  async deleteSession(id: string): Promise<void> {
    const db = await getSQLiteDB();
    await db.execute('DELETE FROM sessions WHERE id = $1', [id]);
  }

  // ============ Task Operations ============

  async createTask(input: CreateTaskInput): Promise<Task> {
    const db = await getSQLiteDB();

    // Try with new schema, fallback to old
    try {
      await db.execute(
        `INSERT INTO tasks (id, session_id, task_index, prompt, status, preview_mode, is_right_sidebar_visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          input.session_id,
          input.task_index,
          input.prompt,
          'running',
          'static',
          1,
        ]
      );
    } catch {
      // Fallback for older schema
      await db.execute(
        'INSERT INTO tasks (id, session_id, task_index, prompt) VALUES ($1, $2, $3, $4)',
        [input.id, input.session_id, input.task_index, input.prompt]
      );
    }

    const task = await this.getTask(input.id);
    if (!task) throw new Error('Failed to create task');

    // Update session task count
    await this.updateSessionTaskCount(input.session_id, input.task_index);

    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    const db = await getSQLiteDB();

    const result = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );

    if (!result[0]) return null;

    // Apply transformations
    return TaskTransformer.fromStorage(result[0]) as unknown as Task;
  }

  async listTasks(sessionId: string): Promise<Task[]> {
    const db = await getSQLiteDB();

    try {
      const tasks = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM tasks WHERE session_id = $1 ORDER BY task_index ASC',
        [sessionId]
      );

      return tasks.map((t) => TaskTransformer.fromStorage(t) as unknown as Task);
    } catch {
      // session_id column may not exist in older DBs
      return [];
    }
  }

  async listAllTasks(): Promise<Task[]> {
    const db = await getSQLiteDB();

    const tasks = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM tasks ORDER BY created_at DESC'
    );

    return tasks.map((t) => TaskTransformer.fromStorage(t) as unknown as Task);
  }

  async updateTask(id: string, data: UpdateTaskInput): Promise<Task | null> {
    const db = await getSQLiteDB();

    const updates: string[] = [];
    const values: (string | number | null | boolean)[] = [];
    let paramIndex = 1;

    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.cost !== undefined) {
      updates.push(`cost = $${paramIndex++}`);
      values.push(data.cost);
    }
    if (data.duration !== undefined) {
      updates.push(`duration = $${paramIndex++}`);
      values.push(data.duration);
    }
    if (data.prompt !== undefined) {
      updates.push(`prompt = $${paramIndex++}`);
      values.push(data.prompt);
    }
    if (data.favorite !== undefined) {
      updates.push(`favorite = $${paramIndex++}`);
      values.push(data.favorite ? 1 : 0);
    }
    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.selected_artifact_id !== undefined) {
      updates.push(`selected_artifact_id = $${paramIndex++}`);
      values.push(data.selected_artifact_id);
    }
    if (data.preview_mode !== undefined) {
      updates.push(`preview_mode = $${paramIndex++}`);
      values.push(data.preview_mode);
    }
    if (data.is_right_sidebar_visible !== undefined) {
      updates.push(`is_right_sidebar_visible = $${paramIndex++}`);
      values.push(data.is_right_sidebar_visible ? 1 : 0);
    }

    if (updates.length === 0) return this.getTask(id);

    updates.push(`updated_at = datetime('now')`);
    values.push(id);

    try {
      await db.execute(
        `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    } catch (error) {
      // Handle missing columns gracefully
      await this.handleMissingColumns(db, error, id, data);
    }

    return this.getTask(id);
  }

  async deleteTask(id: string): Promise<boolean> {
    const db = await getSQLiteDB();
    const result = await db.execute('DELETE FROM tasks WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  }

  // ============ Message Operations ============

  async createMessage(input: CreateMessageInput): Promise<Message> {
    const db = await getSQLiteDB();

    // Transform attachments for storage
    const storageInput = MessageTransformer.toStorage(
      input as unknown as Record<string, unknown>
    ) as unknown as CreateMessageInput;

    try {
      const result = await db.execute(
        `INSERT INTO messages (task_id, type, content, tool_name, tool_input, tool_output, tool_use_id, role, error_message, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.task_id,
          input.type,
          input.content || null,
          input.tool_name || null,
          input.tool_input || null,
          input.tool_output || null,
          input.tool_use_id || null,
          input.subtype || null,
          input.error_message || null,
          storageInput.attachments || null,
        ]
      );

      const messages = await db.select<Record<string, unknown>[]>(
        'SELECT *, role AS subtype FROM messages WHERE id = $1',
        [result.lastInsertId]
      );

      return MessageTransformer.fromStorage(messages[0]) as unknown as Message;
    } catch {
      // Fallback: try without attachments column
      await this.ensureAttachmentsColumn(db);

      const result = await db.execute(
        `INSERT INTO messages (task_id, type, content, tool_name, tool_input, tool_output, tool_use_id, role, error_message, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.task_id,
          input.type,
          input.content || null,
          input.tool_name || null,
          input.tool_input || null,
          input.tool_output || null,
          input.tool_use_id || null,
          input.subtype || null,
          input.error_message || null,
          storageInput.attachments || null,
        ]
      );

      const messages = await db.select<Record<string, unknown>[]>(
        'SELECT *, role AS subtype FROM messages WHERE id = $1',
        [result.lastInsertId]
      );

      return MessageTransformer.fromStorage(messages[0]) as unknown as Message;
    }
  }

  async listMessages(taskId: string): Promise<Message[]> {
    const db = await getSQLiteDB();

    const messages = await db.select<Record<string, unknown>[]>(
      // created_at has second-level precision in SQLite; id preserves true insertion order
      'SELECT *, role AS subtype FROM messages WHERE task_id = $1 ORDER BY id ASC',
      [taskId]
    );

    return messages.map((m) => MessageTransformer.fromStorage(m) as unknown as Message);
  }

  async deleteMessagesByTaskId(taskId: string): Promise<number> {
    const db = await getSQLiteDB();
    const result = await db.execute(
      'DELETE FROM messages WHERE task_id = $1',
      [taskId]
    );
    return result.rowsAffected;
  }

  // ============ File Operations ============

  async createFile(input: CreateFileInput): Promise<LibraryFile> {
    const db = await getSQLiteDB();

    const result = await db.execute(
      `INSERT INTO files (task_id, name, type, path, preview, thumbnail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.task_id,
        input.name,
        input.type,
        input.path,
        input.preview || null,
        input.thumbnail || null,
      ]
    );

    const files = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM files WHERE id = $1',
      [result.lastInsertId]
    );

    return FileTransformer.fromStorage(files[0]) as unknown as LibraryFile;
  }

  async listFiles(taskId: string): Promise<LibraryFile[]> {
    const db = await getSQLiteDB();

    const files = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM files WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId]
    );

    return files.map((f) => FileTransformer.fromStorage(f) as unknown as LibraryFile);
  }

  async listAllFiles(): Promise<LibraryFile[]> {
    const db = await getSQLiteDB();

    const files = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM files ORDER BY created_at DESC'
    );

    return files.map((f) => FileTransformer.fromStorage(f) as unknown as LibraryFile);
  }

  async toggleFileFavorite(fileId: number): Promise<LibraryFile | null> {
    const db = await getSQLiteDB();

    await db.execute(
      'UPDATE files SET is_favorite = NOT is_favorite WHERE id = $1',
      [fileId]
    );

    const files = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM files WHERE id = $1',
      [fileId]
    );

    if (!files[0]) return null;
    return FileTransformer.fromStorage(files[0]) as unknown as LibraryFile;
  }

  async deleteFile(fileId: number): Promise<boolean> {
    const db = await getSQLiteDB();
    const result = await db.execute('DELETE FROM files WHERE id = $1', [
      fileId,
    ]);
    return result.rowsAffected > 0;
  }

  async getFilesGroupedByTask(): Promise<
    { task: Task; files: LibraryFile[] }[]
  > {
    const allFiles = await this.listAllFiles();
    const allTasks = await this.listAllTasks();

    // Create a map of task_id to files
    const filesByTask = new Map<string, LibraryFile[]>();
    for (const file of allFiles) {
      const existing = filesByTask.get(file.task_id) || [];
      existing.push(file);
      filesByTask.set(file.task_id, existing);
    }

    // Build result with task info
    const result: { task: Task; files: LibraryFile[] }[] = [];
    for (const task of allTasks) {
      const files = filesByTask.get(task.id);
      if (files && files.length > 0) {
        result.push({ task, files });
      }
    }

    return result;
  }

  // ============ Private Helpers ============

  private async ensureSessionsTable(
    db: Awaited<ReturnType<typeof getSQLiteDB>>
  ): Promise<void> {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY NOT NULL,
          prompt TEXT NOT NULL,
          task_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    } catch {
      // Table may already exist
    }
  }

  private async ensureAttachmentsColumn(
    db: Awaited<ReturnType<typeof getSQLiteDB>>
  ): Promise<void> {
    try {
      await db.execute('ALTER TABLE messages ADD COLUMN attachments TEXT');
    } catch {
      // Column may already exist
    }
  }

  private async handleMissingColumns(
    db: Awaited<ReturnType<typeof getSQLiteDB>>,
    error: unknown,
    taskId: string,
    data: UpdateTaskInput
  ): Promise<void> {
    const errorStr = String(error);

    // Add missing columns and retry
    if (errorStr.includes('favorite')) {
      await db.execute(
        'ALTER TABLE tasks ADD COLUMN favorite INTEGER DEFAULT 0'
      );
    }
    if (errorStr.includes('title')) {
      await db.execute('ALTER TABLE tasks ADD COLUMN title TEXT');
    }
    if (errorStr.includes('selected_artifact_id')) {
      await db.execute('ALTER TABLE tasks ADD COLUMN selected_artifact_id TEXT');
    }
    if (errorStr.includes('preview_mode')) {
      await db.execute(
        "ALTER TABLE tasks ADD COLUMN preview_mode TEXT DEFAULT 'static'"
      );
    }
    if (errorStr.includes('is_right_sidebar_visible')) {
      await db.execute(
        'ALTER TABLE tasks ADD COLUMN is_right_sidebar_visible INTEGER DEFAULT 1'
      );
    }

    // Retry the update
    await this.updateTask(taskId, data);
  }
}
