/**
 * Task status - unified status enum
 * - running: task is currently executing
 * - completed: task finished successfully
 * - error: task encountered an error
 * - stopped: task was manually stopped
 */
export type TaskStatus = 'running' | 'completed' | 'error' | 'stopped';

/**
 * Session represents a conversation context that can contain multiple tasks
 * Session ID format: YYYYMMDDHHmmss_slug
 */
export interface Session {
  id: string;
  prompt: string;
  task_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Task input for creating a new task
 */
export interface CreateTaskInput {
  id: string;
  session_id: string;
  task_index: number;
  prompt: string;
}

/**
 * Task input for updating an existing task
 */
export interface UpdateTaskInput {
  status?: TaskStatus;
  cost?: number;
  duration?: number;
  prompt?: string;
  favorite?: boolean;
  title?: string;
  selected_artifact_id?: string | null;
  preview_mode?: 'static' | 'live';
  is_right_sidebar_visible?: boolean;
}

/**
 * Task - represents a single task within a session
 */
export interface Task {
  id: string;
  session_id: string;
  task_index: number;
  prompt: string;
  title?: string | null;
  status: TaskStatus;
  cost: number | null;
  duration: number | null;
  favorite?: boolean;
  selected_artifact_id?: string | null;
  preview_mode?: 'static' | 'live';
  is_right_sidebar_visible?: boolean;
  created_at: string;
  updated_at: string;
}

export type MessageType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'user'
  | 'plan'
  | 'done'
  | 'permission_request'
  | 'clarification_request';

export interface Message {
  id: number;
  task_id: string;
  type: MessageType;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_use_id: string | null;
  subtype: string | null;
  error_message: string | null;
  attachments: string | null; // JSON string of MessageAttachment[]
  created_at: string;
}

export interface CreateSessionInput {
  id: string;
  prompt: string;
}

export interface CreateMessageInput {
  task_id: string;
  type: MessageType;
  content?: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  tool_use_id?: string;
  subtype?: string;
  error_message?: string;
  attachments?: string; // JSON string of MessageAttachment[]
}

// Library file types
export type FileType =
  | 'image'
  | 'text'
  | 'code'
  | 'document'
  | 'website'
  | 'presentation'
  | 'spreadsheet';

export interface LibraryFile {
  id: number;
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview: string | null;
  thumbnail: string | null;
  is_favorite: boolean;
  created_at: string;
}

export interface CreateFileInput {
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview?: string;
  thumbnail?: string;
}

// Database adapter interface for abstraction
export interface DatabaseAdapter {
  // Initialization
  init(): Promise<void>;

  // Session operations
  createSession(input: CreateSessionInput): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  updateSessionTaskCount(sessionId: string, taskCount: number): Promise<void>;

  // Task operations
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  listTasks(sessionId: string): Promise<Task[]>;
  listAllTasks(): Promise<Task[]>;
  updateTask(id: string, data: UpdateTaskInput): Promise<Task | null>;
  deleteTask(id: string): Promise<boolean>;

  // Message operations
  createMessage(input: CreateMessageInput): Promise<Message>;
  listMessages(taskId: string): Promise<Message[]>;
  deleteMessagesByTaskId(taskId: string): Promise<number>;

  // File operations
  createFile(input: CreateFileInput): Promise<LibraryFile>;
  listFiles(taskId: string): Promise<LibraryFile[]>;
  listAllFiles(): Promise<LibraryFile[]>;
  toggleFileFavorite(fileId: number): Promise<LibraryFile | null>;
  deleteFile(fileId: number): Promise<boolean>;
  getFilesGroupedByTask(): Promise<{ task: Task; files: LibraryFile[] }[]>;
}

// Query options for list operations
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}
