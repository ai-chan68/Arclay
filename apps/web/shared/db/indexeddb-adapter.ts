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
  TaskTransformer,
  MessageTransformer,
  FileTransformer,
} from 'shared-types';
import { getDatabaseConfig } from '../config/app-config';
import type { IStorageAdapter } from './storage-adapter';

/**
 * Migration definition for IndexedDB
 */
interface Migration {
  version: number;
  description: string;
  apply: (db: IDBDatabase) => void;
}

/**
 * IndexedDB migrations history
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    apply: (db) => {
      // Sessions store
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionsStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionsStore.createIndex('created_at', 'created_at', { unique: false });
      }

      // Tasks store
      if (!db.objectStoreNames.contains('tasks')) {
        const tasksStore = db.createObjectStore('tasks', { keyPath: 'id' });
        tasksStore.createIndex('created_at', 'created_at', { unique: false });
        tasksStore.createIndex('session_id', 'session_id', { unique: false });
      }

      // Messages store
      if (!db.objectStoreNames.contains('messages')) {
        const messagesStore = db.createObjectStore('messages', {
          keyPath: 'id',
          autoIncrement: true,
        });
        messagesStore.createIndex('task_id', 'task_id', { unique: false });
      }
    },
  },
  {
    version: 2,
    description: 'Add files store',
    apply: (db) => {
      if (!db.objectStoreNames.contains('files')) {
        const filesStore = db.createObjectStore('files', {
          keyPath: 'id',
          autoIncrement: true,
        });
        filesStore.createIndex('task_id', 'task_id', { unique: false });
      }
    },
  },
  {
    version: 3,
    description: 'Add UI state fields support',
    apply: (db) => {
      // v3: Add support for UI state fields in tasks
      // No schema changes needed for IndexedDB (flexible schema)
      // But we ensure indexes exist
      if (db.objectStoreNames.contains('tasks')) {
        const tx = db.transaction('tasks', 'readonly');
        const store = tx.objectStore('tasks');
        // Verify indexes exist
        if (!store.indexNames.contains('session_id')) {
          // Need to recreate store to add index - handled by version upgrade
        }
      }
    },
  },
];

/**
 * IndexedDB Storage Adapter
 * Implements IStorageAdapter for browser environment
 */
export class IndexedDBAdapter implements IStorageAdapter {
  private db: IDBDatabase | null = null;
  private config = getDatabaseConfig();

  async init(): Promise<void> {
    await this.getDB();
    console.log('[IndexedDB] Adapter initialized');
  }

  async getVersion(): Promise<number> {
    const db = await this.getDB();
    return db.version;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ============ Private Helpers ============

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        this.config.indexedDBName,
        this.config.indexedDBVersion
      );

      request.onerror = () => {
        console.error('[IndexedDB] Failed to open:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        console.log(`[IndexedDB] Upgrading from v${oldVersion} to v${this.config.indexedDBVersion}`);

        // Apply migrations
        for (const migration of MIGRATIONS) {
          if (migration.version > oldVersion) {
            console.log(`[IndexedDB] Applying migration v${migration.version}: ${migration.description}`);
            migration.apply(db);
          }
        }
      };
    });
  }

  private async idbRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ============ Session Operations ============

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id: input.id,
      prompt: input.prompt,
      task_count: 0,
      created_at: now,
      updated_at: now,
    };

    const db = await this.getDB();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    await this.idbRequest(store.put(session));

    console.log('[IndexedDB] Created session:', input.id);
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const db = await this.getDB();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const result = await this.idbRequest(store.get(id));
    return result || null;
  }

  async listSessions(): Promise<Session[]> {
    const db = await this.getDB();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const sessions = await this.idbRequest(store.getAll());

    return sessions.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async updateSessionTaskCount(
    sessionId: string,
    taskCount: number
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const updatedSession = {
      ...session,
      task_count: taskCount,
      updated_at: new Date().toISOString(),
    };

    const db = await this.getDB();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    await this.idbRequest(store.put(updatedSession));
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    await this.idbRequest(store.delete(id));
  }

  // ============ Task Operations ============

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: input.id,
      session_id: input.session_id,
      task_index: input.task_index,
      prompt: input.prompt,
      status: 'running',
      cost: null,
      duration: null,
      favorite: false,
      created_at: now,
      updated_at: now,
      // UI state defaults
      preview_mode: 'static',
      is_right_sidebar_visible: true,
    };

    const db = await this.getDB();
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    await this.idbRequest(store.put(task));

    // Update session task count
    await this.updateSessionTaskCount(input.session_id, input.task_index);

    console.log('[IndexedDB] Created task:', input.id);
    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    const db = await this.getDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const result = await this.idbRequest(store.get(id));

    if (!result) return null;

    // Apply transformations
    return TaskTransformer.fromStorage(result as Record<string, unknown>) as unknown as Task;
  }

  async listTasks(sessionId: string): Promise<Task[]> {
    const db = await this.getDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');

    try {
      const index = store.index('session_id');
      const tasks = await this.idbRequest(index.getAll(sessionId));

      return tasks
        .map((t) => TaskTransformer.fromStorage(t as Record<string, unknown>) as unknown as Task)
        .sort((a, b) => (a.task_index || 0) - (b.task_index || 0));
    } catch {
      // Index may not exist, fall back to filtering all tasks
      const allTasks = await this.idbRequest(store.getAll());
      return allTasks
        .filter((t) => t.session_id === sessionId)
        .map((t) => TaskTransformer.fromStorage(t as Record<string, unknown>) as unknown as Task)
        .sort((a, b) => (a.task_index || 0) - (b.task_index || 0));
    }
  }

  async listAllTasks(): Promise<Task[]> {
    const db = await this.getDB();
    const tx = db.transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const tasks = await this.idbRequest(store.getAll());

    return tasks
      .map((t) => TaskTransformer.fromStorage(t as Record<string, unknown>) as unknown as Task)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }

  async updateTask(id: string, data: UpdateTaskInput): Promise<Task | null> {
    const task = await this.getTask(id);
    if (!task) return null;

    const updatedTask = {
      ...task,
      ...data,
      updated_at: new Date().toISOString(),
    };

    // Transform for storage
    const storageTask = TaskTransformer.toStorage(updatedTask as Record<string, unknown>);

    const db = await this.getDB();
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    await this.idbRequest(store.put(storageTask));

    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const db = await this.getDB();

    // Delete task
    const tx = db.transaction(['tasks', 'messages'], 'readwrite');
    const taskStore = tx.objectStore('tasks');
    const messageStore = tx.objectStore('messages');

    await this.idbRequest(taskStore.delete(id));

    // Delete related messages
    try {
      const index = messageStore.index('task_id');
      const messages = await this.idbRequest(index.getAll(id));
      for (const message of messages) {
        await this.idbRequest(messageStore.delete(message.id));
      }
    } catch {
      // Index may not exist
    }

    return true;
  }

  // ============ Message Operations ============

  async createMessage(input: CreateMessageInput): Promise<Message> {
    const now = new Date().toISOString();
    const message: Omit<Message, 'id'> & { id?: number } = {
      task_id: input.task_id,
      type: input.type,
      content: input.content || null,
      tool_name: input.tool_name || null,
      tool_input: input.tool_input || null,
      tool_output: input.tool_output || null,
      tool_use_id: input.tool_use_id || null,
      subtype: input.subtype || null,
      error_message: input.error_message || null,
      attachments: input.attachments || null,
      created_at: now,
    };

    // Transform for storage
    const storageMessage = MessageTransformer.toStorage(message);

    const db = await this.getDB();
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const id = await this.idbRequest(store.add(storageMessage));

    return { ...message, id: id as number } as Message;
  }

  async listMessages(taskId: string): Promise<Message[]> {
    const db = await this.getDB();
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');

    try {
      const index = store.index('task_id');
      const messages = await this.idbRequest(index.getAll(taskId));

      return messages
        .map((m) => MessageTransformer.fromStorage(m as Record<string, unknown>) as unknown as Message)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
    } catch {
      // Index may not exist
      const allMessages = await this.idbRequest(store.getAll());
      return allMessages
        .filter((m) => m.task_id === taskId)
        .map((m) => MessageTransformer.fromStorage(m as Record<string, unknown>) as unknown as Message)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
    }
  }

  async deleteMessagesByTaskId(taskId: string): Promise<number> {
    const db = await this.getDB();
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');

    try {
      const index = store.index('task_id');
      const messages = await this.idbRequest(index.getAll(taskId));

      for (const message of messages) {
        await this.idbRequest(store.delete(message.id));
      }

      return messages.length;
    } catch {
      return 0;
    }
  }

  // ============ File Operations ============

  async createFile(input: CreateFileInput): Promise<LibraryFile> {
    const now = new Date().toISOString();
    const file: Omit<LibraryFile, 'id'> & { id?: number } = {
      task_id: input.task_id,
      name: input.name,
      type: input.type,
      path: input.path,
      preview: input.preview || null,
      thumbnail: input.thumbnail || null,
      is_favorite: false,
      created_at: now,
    };

    // Transform for storage
    const storageFile = FileTransformer.toStorage(file);

    const db = await this.getDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const id = await this.idbRequest(store.add(storageFile));

    return { ...file, id: id as number } as LibraryFile;
  }

  async listFiles(taskId: string): Promise<LibraryFile[]> {
    const db = await this.getDB();
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');

    try {
      const index = store.index('task_id');
      const files = await this.idbRequest(index.getAll(taskId));

      return files
        .map((f) => FileTransformer.fromStorage(f as Record<string, unknown>) as unknown as LibraryFile)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
    } catch {
      // Index may not exist
      const allFiles = await this.idbRequest(store.getAll());
      return allFiles
        .filter((f) => f.task_id === taskId)
        .map((f) => FileTransformer.fromStorage(f as Record<string, unknown>) as unknown as LibraryFile)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
    }
  }

  async listAllFiles(): Promise<LibraryFile[]> {
    const db = await this.getDB();
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const files = await this.idbRequest(store.getAll());

    return files
      .map((f) => FileTransformer.fromStorage(f as Record<string, unknown>) as unknown as LibraryFile)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }

  async toggleFileFavorite(fileId: number): Promise<LibraryFile | null> {
    const db = await this.getDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');

    const file = await this.idbRequest(store.get(fileId));
    if (!file) return null;

    file.is_favorite = !file.is_favorite;
    await this.idbRequest(store.put(file));

    return FileTransformer.fromStorage(file as Record<string, unknown>) as unknown as LibraryFile;
  }

  async deleteFile(fileId: number): Promise<boolean> {
    const db = await this.getDB();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    await this.idbRequest(store.delete(fileId));
    return true;
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
}
