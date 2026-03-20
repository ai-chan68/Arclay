/**
 * Base Agent Implementation
 * Agent 基类，提供会话管理和通用功能
 */

import type { AgentMessage, AgentSessionInfo } from '@shared-types';
import type {
  IAgent,
  AgentProviderType,
  AgentRunOptions,
  ConversationMessage,
} from './types';

/**
 * Agent 抽象基类
 */
export abstract class BaseAgent implements IAgent {
  /** Agent 类型 */
  abstract readonly type: AgentProviderType;

  /** 当前会话 */
  protected session: AgentSessionInfo | null = null;

  /** 对话历史 */
  protected conversationHistory: ConversationMessage[] = [];

  /** 中止控制器 */
  protected abortController: AbortController | null = null;

  /**
   * 执行 Agent 并收集所有消息
   */
  async run(prompt: string, options?: AgentRunOptions): Promise<AgentMessage[]> {
    const messages: AgentMessage[] = [];
    for await (const message of this.stream(prompt, options)) {
      messages.push(message);
    }
    return messages;
  }

  /**
   * 流式执行 Agent - 子类必须实现
   */
  abstract stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage>;

  /**
   * 中止当前执行
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 获取当前会话
   */
  getSession(): AgentSessionInfo | null {
    return this.session;
  }

  /**
   * 初始化或恢复会话
   */
  protected initSession(sessionId?: string): AgentSessionInfo {
    const now = Date.now();
    if (sessionId && this.session?.id === sessionId) {
      this.session.updatedAt = now;
      return this.session;
    }

    this.session = {
      id: sessionId || this.generateSessionId(),
      createdAt: now,
      updatedAt: now,
      status: 'running',
      messageCount: 0,
    };
    this.conversationHistory = [];
    return this.session;
  }

  /**
   * 生成唯一会话 ID
   */
  protected generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 生成唯一消息 ID
   */
  protected generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 添加消息到对话历史
   */
  protected addToHistory(message: ConversationMessage): void {
    this.conversationHistory.push(message);
    if (this.session) {
      this.session.messageCount++;
      this.session.updatedAt = Date.now();
    }
  }

  /**
   * 获取对话历史
   */
  protected getHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * 清空对话历史
   */
  protected clearHistory(): void {
    this.conversationHistory = [];
    if (this.session) {
      this.session.messageCount = 0;
      this.session.updatedAt = Date.now();
    }
  }

  /**
   * 更新会话状态
   */
  protected updateSessionStatus(status: AgentSessionInfo['status']): void {
    if (this.session) {
      this.session.status = status;
      this.session.updatedAt = Date.now();
    }
  }
}
