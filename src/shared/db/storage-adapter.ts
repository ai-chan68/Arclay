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

/**
 * Storage adapter interface
 * Provides unified CRUD operations for both IndexedDB and SQLite backends
 */
export interface IStorageAdapter {
  // === Initialization ===
  /**
   * Initialize the storage (create tables, migrate, etc.)
   */
  init(): Promise<void>;

  /**
   * Get current storage version
   */
  getVersion(): Promise<number>;

  /**
   * Close the storage connection
   */
  close(): Promise<void>;

  // === Session Operations ===
  /**
   * Create a new session
   */
  createSession(input: CreateSessionInput): Promise<Session>;

  /**
   * Get a session by ID
   */
  getSession(id: string): Promise<Session | null>;

  /**
   * List all sessions
   */
  listSessions(): Promise<Session[]>;

  /**
   * Update session task count
   */
  updateSessionTaskCount(sessionId: string, taskCount: number): Promise<void>;

  /**
   * Delete a session
   */
  deleteSession(id: string): Promise<void>;

  // === Task Operations ===
  /**
   * Create a new task
   */
  createTask(input: CreateTaskInput): Promise<Task>;

  /**
   * Get a task by ID
   */
  getTask(id: string): Promise<Task | null>;

  /**
   * List tasks for a session
   */
  listTasks(sessionId: string): Promise<Task[]>;

  /**
   * List all tasks
   */
  listAllTasks(): Promise<Task[]>;

  /**
   * Update a task
   */
  updateTask(id: string, data: UpdateTaskInput): Promise<Task | null>;

  /**
   * Delete a task
   */
  deleteTask(id: string): Promise<boolean>;

  // === Message Operations ===
  /**
   * Create a new message
   */
  createMessage(input: CreateMessageInput): Promise<Message>;

  /**
   * List messages for a task
   */
  listMessages(taskId: string): Promise<Message[]>;

  /**
   * Delete messages by task ID
   */
  deleteMessagesByTaskId(taskId: string): Promise<number>;

  // === File Operations ===
  /**
   * Create a new file record
   */
  createFile(input: CreateFileInput): Promise<LibraryFile>;

  /**
   * List files for a task
   */
  listFiles(taskId: string): Promise<LibraryFile[]>;

  /**
   * List all files
   */
  listAllFiles(): Promise<LibraryFile[]>;

  /**
   * Toggle file favorite status
   */
  toggleFileFavorite(fileId: number): Promise<LibraryFile | null>;

  /**
   * Delete a file record
   */
  deleteFile(fileId: number): Promise<boolean>;

  /**
   * Get files grouped by task
   */
  getFilesGroupedByTask(): Promise<{ task: Task; files: LibraryFile[] }[]>;
}

/**
 * Storage adapter factory
 * Creates appropriate adapter based on environment
 */
export async function createStorageAdapter(): Promise<IStorageAdapter> {
  const { isTauri } = await import('shared-types');

  if (isTauri()) {
    const { SQLiteAdapter } = await import('./sqlite-adapter');
    return new SQLiteAdapter();
  } else {
    const { IndexedDBAdapter } = await import('./indexeddb-adapter');
    return new IndexedDBAdapter();
  }
}

/**
 * Singleton storage adapter instance
 */
let storageAdapter: IStorageAdapter | null = null;

/**
 * Get or create storage adapter instance
 */
export async function getStorageAdapter(): Promise<IStorageAdapter> {
  if (!storageAdapter) {
    storageAdapter = await createStorageAdapter();
    await storageAdapter.init();
  }
  return storageAdapter;
}

/**
 * Reset storage adapter (for testing)
 */
export function resetStorageAdapter(): void {
  storageAdapter = null;
}
