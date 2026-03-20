// Agent types
export type {
  AgentMessageType,
  AgentMessage,
  MessageRole,
  SessionStatus,
  AgentSessionInfo,
  AgentPlanStep,
  Plan,
  AgentStatus,
  AgentPhase,
  PermissionRequest,
  PendingQuestion,
  MessageAttachment,
  TaskPlan,
  PlanStep,
  AgentTurnState,
  AgentTurnSnapshot,
} from './agent';

// Message types
export type { ChatMessage, Attachment } from './message';

// Config types
export type {
  LLMProvider,
  ProviderConfig,
  SandboxProviderType as ConfigSandboxProviderType,
  SandboxConfig,
  MCPConfig,
  MCPServerConfig,
  SkillsConfig,
  AppConfig,
} from './config';

// Tool types
export type { ToolDefinition, ToolResult, ToolCall } from './tool';

// Sandbox types - use export type for interfaces
export type {
  SandboxResult,
  ExecuteOptions,
  ReadFileOptions,
  WriteFileOptions,
  EditFileOptions,
} from './sandbox';

// Rename FileInfo from sandbox to avoid conflict
export type { FileInfo as SandboxFileInfo } from './sandbox';

// Error types
export type { AgentErrorCode, AgentError } from './error';
export { createAgentError, isAgentError } from './error';

// Database types (Phase 3)
export type {
  TaskStatus,
  Session,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Message,
  CreateSessionInput,
  CreateMessageInput,
  MessageType,
  LibraryFile,
  CreateFileInput,
  FileType,
  DatabaseAdapter,
  QueryOptions,
} from './database';

// Storage transformers
export {
  BooleanTransformer,
  JsonTransformer,
  DateTransformer,
  NumberTransformer,
  StringTransformer,
  TaskTransformer,
  MessageTransformer,
  FileTransformer,
} from './transformers';

// Environment types (Phase 3)
export type {
  RuntimeEnvironment,
  PlatformInfo,
  WindowBounds,
  WindowState,
  FileInfo,
  FileFilter,
  PickFileOptions,
} from './environment';

export { isTauri, detectEnvironment } from './environment';

// Multi-agent types (Phase 4)
export type {
  TaskComplexity,
  DecompositionStrategy,
  SubTaskPriority,
  MultiAgentPhase,
  SubTaskStatus,
  TaskAnalysis,
  SubTaskScope,
  SubTask,
  SubTaskResult,
  SubAgentInfo,
  MultiAgentProgress,
  MultiAgentStatus,
  MultiAgentConfig,
  MultiAgentCost,
  MultiAgentMessage,
  AgentRole,
  MultiAgentSession,
} from './multi-agent';
