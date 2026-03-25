/**
 * Claude (Anthropic) Agent Provider
 * 使用 @anthropic-ai/claude-agent-sdk 实现
 * 支持 Skills、MCP Servers、Sandbox 等高级功能
 */

import { createRequire } from 'module';
import { cpSync, existsSync, readdirSync, rmSync } from 'fs';
import { appendFile, mkdir, writeFile } from 'fs/promises';
import { homedir, platform, arch } from 'os';
import { join, dirname, relative, resolve, sep } from 'path';
import {
  createSdkMcpServer,
  Options,
  query,
  tool,
  type CanUseTool,
  type PermissionResult,
  type McpServerConfig as SdkMcpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { AgentMessage, AgentMessageType, AgentError, TaskPlan, PermissionRequest, PendingQuestion } from '@shared-types';
import { createAgentError } from '@shared-types';
import { BaseAgent } from '../base-agent';
import type {
  IAgentProvider,
  AgentProviderConfig,
  AgentRunOptions,
  AgentCapabilities,
  SkillsConfig,
  McpConfig,
  SandboxConfig,
  ImageAttachment,
  ConversationMessage,
} from '../types';
import type { ProviderState } from '../../../shared/provider/types';
import { getAllSkills } from '@/skills/skill-scanner';
import { getProjectRoot } from '../../../config';
import { getPlanningInstructionWithSkills } from '../system-prompt';
import { nanoid } from 'nanoid';
import { getSettings } from '../../../settings-store';
import { filterEnabledSkills, routeSkillsForPrompt, type RouteSkillsResult } from '@/skills/router';
import { recordSkillRouteOutcomes } from '@/skills/index-store';
import { approvalCoordinator } from '../../../services/approval-coordinator';
import {
  getMcpExecutionDisciplineInstruction,
  getPlanningFilesProtocolInstruction,
} from '../../../services/plan-execution';
import { looksLikeBrowserAutomationIntentInText } from '../../../services/browser-intent';
import { taskPlanner } from '../../../services/task-planner';

/**
 * Task complexity levels for dynamic maxTurns configuration
 */
const TASK_COMPLEXITY = {
  /** Simple tasks: file read, single command, quick checks */
  SIMPLE: { maxTurns: 15, patterns: [/\bread\b/i, /\bclone\b/i, /\bls\b/i, /\bstatus\b/i] },
  /** Medium tasks: code edits, multi-file operations */
  MEDIUM: { maxTurns: 50, patterns: [/\bedit\b/i, /\bwrite\b/i, /\bcreate\b/i, /\bfix\b/i] },
  /** Complex tasks: project setup, refactoring, analysis */
  COMPLEX: { maxTurns: 100, patterns: [/\brefactor\b/i, /\bimplement\b/i, /\bsetup\b/i, /\bbuild\b/i] },
  /** Maximum for open-ended tasks */
  MAX: { maxTurns: 200, patterns: [] },
} as const;

const DEFAULT_AUTO_ALLOW_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'TodoWrite',
  'LS',
  'LSP',
];

const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_PLAN_STEPS = 2;

type WebTaskIntent = 'none' | 'information_retrieval' | 'interaction' | 'hybrid';

async function appendProviderDiagnostics(
  sessionCwd: string,
  lines: string[],
): Promise<void> {
  const progressPath = join(sessionCwd, 'progress.md');
  if (!existsSync(progressPath)) {
    return;
  }

  try {
    await appendFile(progressPath, `\n\n${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.warn('[ClaudeAgent] Failed to append provider diagnostics:', error);
  }
}

/**
 * Detect task complexity based on prompt content
 */
function detectTaskComplexity(prompt: string): number {
  const lowerPrompt = prompt.toLowerCase();

  // Check for simple task patterns
  for (const pattern of TASK_COMPLEXITY.SIMPLE.patterns) {
    if (pattern.test(lowerPrompt)) {
      return TASK_COMPLEXITY.SIMPLE.maxTurns;
    }
  }

  // Check for medium task patterns
  for (const pattern of TASK_COMPLEXITY.MEDIUM.patterns) {
    if (pattern.test(lowerPrompt)) {
      return TASK_COMPLEXITY.MEDIUM.maxTurns;
    }
  }

  // Check for complex task patterns
  for (const pattern of TASK_COMPLEXITY.COMPLEX.patterns) {
    if (pattern.test(lowerPrompt)) {
      return TASK_COMPLEXITY.COMPLEX.maxTurns;
    }
  }

  // Default to max for open-ended tasks
  return TASK_COMPLEXITY.MAX.maxTurns;
}

function classifyWebTaskIntent(
  prompt: string,
  plan?: Pick<TaskPlan, 'goal' | 'steps' | 'notes'>
): WebTaskIntent {
  const corpus = [
    prompt,
    plan?.goal,
    plan?.notes,
    ...(plan?.steps || []).map((step) => step.description),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .toLowerCase();

  if (!corpus) {
    return 'none';
  }

  const hasWebContext = /(https?:\/\/\S+|网页|页面|浏览器|chrome|playwright|devtools|站点|url|链接|官网|搜索结果|页面内容|网站)/i
    .test(corpus);
  if (!hasWebContext) {
    return 'none';
  }

  const informationPatterns = [
    /查找/, /搜索/, /提取/, /读取/, /查看/, /总结/, /汇总/, /整理/, /分析/, /对比/, /收集/, /信息/, /内容/, /字段/, /状态/, /价格/, /参数/, /链接/,
    /\bextract\b/i, /\bsummar/i, /\bcollect\b/i, /\bfind\b/i, /\bread\b/i, /\bretrieve\b/i, /\banaly[sz]e\b/i, /\bcompare\b/i,
  ];
  const interactionPatterns = [
    /点击/, /输入/, /填写/, /提交/, /上传/, /下载/, /勾选/, /切换/, /选择/, /打开/, /关闭/, /登录/, /拖拽/, /hover/, /悬停/, /复制/,
    /\bclick\b/i, /\bfill\b/i, /\btype\b/i, /\bsubmit\b/i, /\bupload\b/i, /\bdownload\b/i, /\bselect\b/i, /\bcheck\b/i, /\blogin\b/i, /\bopen\b/i,
  ];

  const hasInformationIntent = informationPatterns.some((pattern) => pattern.test(corpus));
  const hasInteractionIntent = interactionPatterns.some((pattern) => pattern.test(corpus));

  if (hasInformationIntent && hasInteractionIntent) {
    return 'hybrid';
  }
  if (hasInteractionIntent) {
    return 'interaction';
  }
  if (hasInformationIntent) {
    return 'information_retrieval';
  }

  return 'none';
}

function getWebExecutionPolicyInstruction(intent: WebTaskIntent): string {
  if (intent === 'none') {
    return '';
  }

  if (intent === 'information_retrieval') {
    return `
## Web Information Collection Policy

- When the goal is to gather or summarize information from the web, prefer the highest-information-density method first.
- Prefer direct text extraction, DOM inspection, structured fields, table parsing, or eval-style reads when they capture the needed facts clearly.
- Use screenshots when visual evidence is the clearest, most reliable, or most efficient way to capture the result.
- Capture screenshots for charts, canvases, hover states, visual diffs, maps, image-heavy pages, or when the screenshot is the best user-facing artifact.
- Avoid repetitive screenshots that do not add new information.
- If you are approaching the turn limit, return the facts already collected, explain what remains, and recommend the next step instead of ending silently.
`;
  }

  if (intent === 'interaction') {
    return `
## Web Interaction Policy

- Use browser automation tools to complete the required interactions.
- Prefer targeted page reads and snapshots for element discovery instead of documenting every step visually.
- Capture screenshots at key state transitions, on errors, or when the user needs visual confirmation.
- Avoid repetitive screenshots after every interaction unless each screenshot adds new evidence.
`;
  }

  return `
## Hybrid Web Task Policy

- Start with the highest-information-density method for information gathering.
- Switch to browser interaction only for the steps that require user-like actions.
- Use screenshots when visual evidence is the clearest artifact, and avoid repetitive screenshots that do not add new information.
- If execution stops early, return the facts gathered so far and identify the remaining interactive steps.
`;
}

const normalizedPlanSchema = z.object({
  goal: z.string().min(1).optional(),
  steps: z.array(z.string().min(1)).min(MIN_PLAN_STEPS),
  notes: z.string().min(1).optional(),
});

/**
 * Claude Agent SDK 实现
 */
export class ClaudeAgent extends BaseAgent {
  readonly type = 'claude' as const;

  private config: AgentProviderConfig;
  private claudeCodePath: string | undefined;
  private activeContextManager?: import('../../../services/context-manager').ContextManager;

  constructor(config: AgentProviderConfig) {
    super();
    this.config = config;
  }

  /**
   * 流式执行 Agent - 使用 Claude Agent SDK
   */
  async *stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage> {
    this.abortController = options?.abortController || new AbortController();
    const signal = options?.signal || this.abortController.signal;
    this.activeContextManager = options?.contextManager as import('../../../services/context-manager').ContextManager | undefined;

    // 1. 初始化会话
    const session = this.initSession(options?.sessionId);
    yield {
      id: this.generateMessageId(),
      type: 'session' as AgentMessageType,
      sessionId: session.id,
      timestamp: Date.now(),
    };

    // 2. 确保 Claude Code 已安装
    const claudeCodePath = await this.ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        id: this.generateMessageId(),
        type: 'error' as AgentMessageType,
        errorMessage: '__CLAUDE_CODE_NOT_FOUND__',
        timestamp: Date.now(),
      };
      yield {
        id: this.generateMessageId(),
        type: 'done' as AgentMessageType,
        timestamp: Date.now(),
      };
      return;
    }

    // 3. 获取会话工作目录
    const sessionCwd = this.getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId
    );
    await this.ensureDir(sessionCwd);
    console.log(`[Claude ${session.id}] Working directory: ${sessionCwd}`);

    // 4. Skill 自动路由（按设置决定是否真正应用）
    const routedSkills = this.resolveRoutedSkills(prompt, options?.skillsConfig);
    const routedSkillIds = routedSkills.shouldApply
      ? routedSkills.selected.map((skill) => skill.skillId)
      : undefined;
    const routedSkillsContext = this.buildRoutedSkillsContext(routedSkills);

    // 5. 处理图片附件
    let imageInstruction = '';
    if (options?.images && options.images.length > 0) {
      const imagePaths = await this.saveImagesToDisk(options.images, sessionCwd);
      if (imagePaths.length > 0) {
        imageInstruction = `
## 🖼️ MANDATORY IMAGE ANALYSIS - DO THIS FIRST

**STOP! Before doing anything else, you MUST read the attached image(s).**

The user has attached ${imagePaths.length} image file(s):
${imagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}

**YOUR FIRST ACTION MUST BE:**
Use the Read tool to view each image file listed above.

---
User's request (answer this AFTER reading the images):
`;
      }
    }

    // 6. 格式化对话历史
    const conversationContext = this.formatConversationHistory(options?.conversation);

    // 7. 增强 Prompt
    const enhancedPrompt = imageInstruction
      ? imageInstruction + prompt + '\n\n' + this.getWorkspaceInstruction(sessionCwd, options?.sandbox, options?.mcpConfig) + routedSkillsContext + conversationContext
      : this.getWorkspaceInstruction(sessionCwd, options?.sandbox, options?.mcpConfig) + routedSkillsContext + conversationContext + prompt;

    // 8. 构建 SDK 查询选项
    const queryOptions: Options = await this.buildQueryOptions(
      sessionCwd,
      options,
      signal,
      claudeCodePath,
      routedSkillIds,
      session.id,
      enhancedPrompt
    );

    const runtimeMcpServerNames = queryOptions.mcpServers
      ? Object.keys(queryOptions.mcpServers).filter((name) => name.trim().length > 0)
      : [];
    const runtimeToolNamespaces = runtimeMcpServerNames.map((name) => `mcp__${name}__*`);
    const browserAutomationIntent = looksLikeBrowserAutomationIntentInText(enhancedPrompt);

    await appendProviderDiagnostics(sessionCwd, [
      `### Provider Query Options (${new Date().toISOString()})`,
      `- Session ID: ${session.id}`,
      `- Task ID: ${options?.taskId || '(none)'}`,
      `- Browser Automation Intent: ${browserAutomationIntent ? 'yes' : 'no'}`,
      `- Tools Preset: ${JSON.stringify(queryOptions.tools)}`,
      `- Runtime MCP Servers: ${runtimeMcpServerNames.length > 0 ? runtimeMcpServerNames.join(', ') : '(none)'}`,
      `- Runtime Tool Namespaces: ${runtimeToolNamespaces.length > 0 ? runtimeToolNamespaces.join(', ') : '(none)'}`,
      `- Allowed Tools: ${(queryOptions.allowedTools || []).length > 0 ? (queryOptions.allowedTools || []).join(', ') : '(none)'}`,
      `- Setting Sources: ${(queryOptions.settingSources || []).length > 0 ? (queryOptions.settingSources || []).join(', ') : '(none)'}`,
    ]);

    // 9. 执行查询并处理消息
    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();
    const executionStartAt = Date.now();
    let executionSuccess = false;
    let executionError = '';
    let sdkMessageCount = 0;
    let providerCompletionMetadata: Record<string, unknown> | null = null;

    console.log(`[Claude ${session.id}] LLM execute request started`, {
      model: this.config.model,
      promptLength: enhancedPrompt.length,
      maxTurns: queryOptions.maxTurns ?? null,
      cwd: sessionCwd,
      taskId: options?.taskId || null,
      browserAutomationIntent,
      toolsPreset: queryOptions.tools,
      runtimeMcpServerNames,
      runtimeToolNamespaces,
      allowedTools: queryOptions.allowedTools || [],
      settingSources: queryOptions.settingSources || [],
    });

    try {
      const MAX_AUTO_RESUMES = 3;
      let autoResumeCount = 0;
      let currentPrompt = enhancedPrompt;

      while (true) {
        providerCompletionMetadata = null;

        for await (const message of query({
          prompt: currentPrompt,
          options: queryOptions,
        })) {
          sdkMessageCount += 1;
          if (signal.aborted) break;

          const completionMetadata = this.extractProviderCompletionMetadata(message);
          if (completionMetadata) {
            providerCompletionMetadata = completionMetadata;
          }

          yield* this.processSdkMessage(
            message,
            session.id,
            sentTextHashes,
            sentToolIds,
            this.activeContextManager
          );
        }

        // Check if we hit max_turns and should auto-resume
        const isMaxTurns = providerCompletionMetadata?.subtype === 'max_turns';
        if (!isMaxTurns || autoResumeCount >= MAX_AUTO_RESUMES || signal.aborted) {
          break;
        }

        // Auto-resume: notify frontend and continue
        autoResumeCount++;
        console.log(`[Claude ${session.id}] Auto-resume #${autoResumeCount}/${MAX_AUTO_RESUMES} after max_turns`);
        yield {
          id: this.generateMessageId(),
          type: 'turn_limit_warning' as AgentMessageType,
          content: `轮次上限已到达，自动续期中（第${autoResumeCount}次，最多${MAX_AUTO_RESUMES}次）...`,
          metadata: { currentResume: autoResumeCount, maxResumes: MAX_AUTO_RESUMES },
          timestamp: Date.now(),
        };
        currentPrompt = '继续执行未完成的步骤。';
      }

      executionSuccess = true;
      console.log(`[Claude ${session.id}] LLM execute request completed`, {
        model: this.config.model,
        durationMs: Date.now() - executionStartAt,
        sdkMessageCount,
        aborted: signal.aborted,
        autoResumeCount,
      });

      // 发送完成消息
      yield {
        id: this.generateMessageId(),
        type: 'done' as AgentMessageType,
        metadata: providerCompletionMetadata || undefined,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMessage = this.mapError(error);
      executionError = errorMessage;
      console.error(`[Claude ${session.id}] LLM execute request failed`, {
        model: this.config.model,
        durationMs: Date.now() - executionStartAt,
        sdkMessageCount,
        error: errorMessage,
      });
      yield {
        id: this.generateMessageId(),
        type: 'error' as AgentMessageType,
        errorMessage,
        timestamp: Date.now(),
      };
    } finally {
      this.recordRoutedSkillOutcomes(
        routedSkills,
        executionSuccess,
        Date.now() - executionStartAt,
        executionError
      );
    }
  }

  /**
   * Planning phase - Generate execution plan using LLM
   * easywork-style two-phase execution
   */
  async *plan(prompt: string, options?: AgentRunOptions): AsyncIterable<AgentMessage> {
    this.abortController = options?.abortController || new AbortController();
    const signal = options?.signal || this.abortController.signal;

    // Initialize session
    const session = this.initSession(options?.sessionId);
    yield {
      id: this.generateMessageId(),
      type: 'session' as AgentMessageType,
      sessionId: session.id,
      timestamp: Date.now(),
    };

    try {
      // Load routed skills for planning context
      const projectRoot = getProjectRoot();
      const routed = this.resolveRoutedSkills(prompt, options?.skillsConfig);
      const allSkills = getAllSkills(projectRoot);
      const enabledSkills = filterEnabledSkills(
        allSkills,
        this.config.provider || 'claude',
        getSettings()?.skills,
      );
      const selectedSkillIds = new Set(routed.selected.map((item) => item.skillId));
      const availableSkills = selectedSkillIds.size > 0
        ? allSkills.filter((skill) => selectedSkillIds.has(skill.id))
        : enabledSkills;
      const conversationContext = this.formatConversationHistory(options?.conversation);

      // Get planning response from LLM with skills context
      const planningPrompt =
        getPlanningInstructionWithSkills(availableSkills) +
        '\n\n' +
        this.buildRoutedSkillsContext(routed) +
        conversationContext +
        prompt;

      // Use a simple query to get the plan - NO TOOLS for planning phase
      const claudeCodePath = await this.ensureClaudeCode();
      if (!claudeCodePath) {
        yield {
          id: this.generateMessageId(),
          type: 'error' as AgentMessageType,
          errorMessage: '__CLAUDE_CODE_NOT_FOUND__',
          timestamp: Date.now(),
        };
        yield {
          id: this.generateMessageId(),
          type: 'done' as AgentMessageType,
          timestamp: Date.now(),
        };
        return;
      }
      const queryOptions: Options = {
        cwd: options?.cwd || process.cwd(),
        tools: { type: 'preset', preset: 'claude_code' },
        allowedTools: [], // No tools allowed during planning - text only
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: signal ? { signal } as AbortController : undefined,
        env: this.buildEnvConfig(),
        model: this.config.model,
        pathToClaudeCodeExecutable: claudeCodePath,
        maxTurns: 1, // Single turn for planning
      };

      const firstAttempt = await this.collectPlanningResponse(
        planningPrompt,
        queryOptions,
        signal,
        session.id,
        'first'
      );
      let fullResponse = firstAttempt.fullResponse;
      let hasToolUse = firstAttempt.hasToolUse;
      let planningResult = this.parsePlanningResponse(fullResponse);

      // Retry once with a stricter JSON-only suffix when parsing fails.
      // Skip retry if model already returned tool-use blocks — retrying won't help and just wastes time.
      if (planningResult.type === 'unknown' && !signal.aborted && !hasToolUse) {
        const strictJsonPrompt = `${planningPrompt}

IMPORTANT:
- Return ONLY one valid JSON object
- The JSON must include "type"
- If key constraints/context are missing, return {"type":"clarification_request", ...} instead of a plan
- Do NOT assume missing constraints (time, scope, output format, environment)
- Do NOT use markdown code fences
- Do NOT include extra explanation`;
        const secondAttempt = await this.collectPlanningResponse(
          strictJsonPrompt,
          queryOptions,
          signal,
          session.id,
          'retry'
        );
        hasToolUse = hasToolUse || secondAttempt.hasToolUse;
        if (secondAttempt.fullResponse.trim() !== '') {
          fullResponse = secondAttempt.fullResponse;
          planningResult = this.parsePlanningResponse(fullResponse);
        }
      }

      const forceExecutionPlan = this.shouldForceExecutionPlan(prompt);

      if (planningResult.type === 'clarification_request' && planningResult.clarification) {
        const clarification = planningResult.clarification;
        yield {
          id: this.generateMessageId(),
          type: 'clarification_request' as AgentMessageType,
          role: 'assistant',
          content: clarification.question,
          timestamp: Date.now(),
          clarification,
          // Backward compatibility for existing question handling branches.
          question: clarification,
        };
      } else if (planningResult.type === 'direct_answer' && !forceExecutionPlan) {
        // Simple question - yield direct answer
        yield {
          id: this.generateMessageId(),
          type: 'text' as AgentMessageType,
          role: 'assistant',
          content: planningResult.answer || 'I understand your request.',
          timestamp: Date.now(),
        };
      } else {
        const normalizedPlan = planningResult.type === 'plan'
          ? planningResult.plan
          : this.parsePlanFromResponse(fullResponse);

        if (normalizedPlan) {
          const taskPlan = this.toTaskPlan(normalizedPlan, prompt);

          yield {
            id: this.generateMessageId(),
            type: 'plan' as AgentMessageType,
            role: 'assistant',
            content: `已生成执行计划，共 ${taskPlan.steps.length} 个步骤`,
            timestamp: Date.now(),
            plan: taskPlan,
          };
        } else {
          // Final fallback: always keep execution flow alive by generating a generic plan.
          const taskPlan = this.createFallbackExecutionPlan(
            prompt,
            fullResponse,
            hasToolUse
          );
          yield {
            id: this.generateMessageId(),
            type: 'plan' as AgentMessageType,
            role: 'assistant',
            content: `已生成执行计划，共 ${taskPlan.steps.length} 个步骤`,
            timestamp: Date.now(),
            plan: taskPlan,
          };
        }
      }

      yield {
        id: this.generateMessageId(),
        type: 'done' as AgentMessageType,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Planning failed';
      yield {
        id: this.generateMessageId(),
        type: 'error' as AgentMessageType,
        errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  private async collectPlanningResponse(
    planningPrompt: string,
    queryOptions: Options,
    signal: AbortSignal,
    sessionId: string,
    attempt: 'first' | 'retry',
  ): Promise<{ fullResponse: string; hasToolUse: boolean }> {
    let fullResponse = '';
    let hasToolUse = false;
    let sdkMessageCount = 0;
    const requestStartAt = Date.now();

    console.log(`[Claude ${sessionId}] LLM planning request started`, {
      model: this.config.model,
      attempt,
      promptLength: planningPrompt.length,
      maxTurns: queryOptions.maxTurns ?? null,
    });

    try {
      for await (const message of query({
        prompt: planningPrompt,
        options: queryOptions,
      })) {
        sdkMessageCount += 1;
        if (signal.aborted) break;

        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content as Record<string, unknown>[]) {
            if ('text' in block) {
              fullResponse += block.text as string;
            }
            // Only treat explicit tool_use content blocks as tool usage.
            // Some non-tool blocks can carry name/id-like fields and caused false positives.
            if ('type' in block && block.type === 'tool_use') {
              hasToolUse = true;
            }
          }
        }
      }
    } catch (error) {
      const errorMessage = this.mapError(error);
      console.error(`[Claude ${sessionId}] LLM planning request failed`, {
        model: this.config.model,
        attempt,
        durationMs: Date.now() - requestStartAt,
        sdkMessageCount,
        error: errorMessage,
      });
      throw error;
    } finally {
      console.log(`[Claude ${sessionId}] LLM planning request completed`, {
        model: this.config.model,
        attempt,
        durationMs: Date.now() - requestStartAt,
        sdkMessageCount,
        responseLength: fullResponse.length,
        hasToolUse,
        aborted: signal.aborted,
      });
    }

    if (hasToolUse) {
      console.warn('[ClaudeAgent] Tool-use blocks detected during planning response');
    }

    return { fullResponse, hasToolUse };
  }

  private extractJsonObject(text: string, startIndex = 0): string | null {
    const firstBrace = text.indexOf('{', startIndex);
    if (firstBrace === -1) return null;

    let braceCount = 0;
    let inString = false;
    let escaped = false;

    for (let i = firstBrace; i < text.length; i += 1) {
      const char = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') braceCount += 1;
        if (char === '}') {
          braceCount -= 1;
          if (braceCount === 0) {
            return text.slice(firstBrace, i + 1);
          }
        }
      }
    }

    return null;
  }

  private normalizePlanPayload(parsed: unknown): { goal?: string; steps: string[]; notes?: string } | null {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.steps)) {
      return null;
    }

    const steps = record.steps
      .map((step) => {
        if (typeof step === 'string') return step.trim();
        if (step && typeof step === 'object' && typeof (step as { description?: unknown }).description === 'string') {
          return ((step as { description: string }).description).trim();
        }
        return '';
      })
      .filter((step) => step !== '');

    const goal = typeof record.goal === 'string' && record.goal.trim() !== ''
      ? record.goal.trim()
      : undefined;
    const notes = typeof record.notes === 'string' && record.notes.trim() !== ''
      ? record.notes.trim()
      : undefined;

    const validated = normalizedPlanSchema.safeParse({
      goal,
      steps,
      notes,
    });
    if (!validated.success) {
      return null;
    }

    return validated.data;
  }

  private parsePlanFromResponse(response: string): { goal?: string; steps: string[]; notes?: string } | null {
    const codeBlockMatches = [...response.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
    for (const match of codeBlockMatches) {
      const candidate = this.extractJsonObject(match[1]);
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        const normalized = this.normalizePlanPayload(parsed);
        if (normalized) return normalized;
      } catch {
        const recovered = this.recoverMalformedPlanPayload(match[1]);
        if (recovered) return recovered;
        // Continue trying other candidates.
      }
    }

    const typeIndex = response.indexOf('{"type"');
    if (typeIndex !== -1) {
      const candidate = this.extractJsonObject(response, typeIndex);
      if (candidate) {
        try {
          const parsed = JSON.parse(candidate);
          const normalized = this.normalizePlanPayload(parsed);
          if (normalized) return normalized;
        } catch {
          const recovered = this.recoverMalformedPlanPayload(candidate);
          if (recovered) return recovered;
          // Continue fallback extraction.
        }
      }
    }

    const fallbackCandidate = this.extractJsonObject(response);
    if (!fallbackCandidate) return null;

    try {
      const parsed = JSON.parse(fallbackCandidate);
      return this.normalizePlanPayload(parsed);
    } catch {
      return this.recoverMalformedPlanPayload(fallbackCandidate);
    }
  }

  private recoverMalformedPlanPayload(response: string): { goal?: string; steps: string[]; notes?: string } | null {
    if (!/"type"\s*:\s*"plan"/.test(response)) {
      return null;
    }

    const goal = this.extractLooseJsonStringField(response, 'goal');
    const notes = this.extractLooseJsonStringField(response, 'notes');
    const steps = this.extractLooseJsonStringArrayField(response, 'steps');

    const validated = normalizedPlanSchema.safeParse({
      goal: goal || undefined,
      steps,
      notes: notes || undefined,
    });

    if (!validated.success) {
      return null;
    }

    return validated.data;
  }

  private extractLooseJsonStringField(source: string, fieldName: string): string {
    const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'm');
    const match = pattern.exec(source);
    if (!match) return '';

    let cursor = match.index + match[0].length;
    let value = '';

    while (cursor < source.length) {
      const char = source[cursor];
      const nextSlice = source.slice(cursor);

      if (char === '"' && /"\s*(,|})/.test(nextSlice)) {
        break;
      }

      if (char === '\\' && cursor + 1 < source.length) {
        value += source[cursor + 1];
        cursor += 2;
        continue;
      }

      value += char;
      cursor += 1;
    }

    return value.trim();
  }

  private extractLooseJsonStringArrayField(source: string, fieldName: string): string[] {
    const pattern = new RegExp(`"${fieldName}"\\s*:\\s*\\[`, 'm');
    const match = pattern.exec(source);
    if (!match) return [];

    let cursor = match.index + match[0].length;
    let depth = 1;
    let arrayContent = '';

    while (cursor < source.length) {
      const char = source[cursor];
      if (char === '[') {
        depth += 1;
      } else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }

      arrayContent += char;
      cursor += 1;
    }

    return arrayContent
      .split(/",\s*"/)
      .map((item) => item.trim())
      .map((item) => item.replace(/^"/, '').replace(/"$/, '').trim())
      .filter(Boolean);
  }

  private toTaskPlan(plan: { goal?: string; steps: string[]; notes?: string }, prompt: string): TaskPlan {
    const normalizedPlan = this.normalizeInteractiveWebPlan(
      this.normalizePlanLanguage(plan, prompt),
      prompt
    );

    return {
      id: nanoid(),
      goal: normalizedPlan.goal || prompt,
      steps: normalizedPlan.steps.map((description, index) => ({
        id: `step_${index}`,
        description,
        status: 'pending' as const,
      })),
      notes: normalizedPlan.notes,
      createdAt: new Date(),
    };
  }

  private normalizePlanLanguage(
    plan: { goal?: string; steps: string[]; notes?: string },
    prompt: string
  ): { goal?: string; steps: string[]; notes?: string } {
    if (!this.containsChinese(prompt)) {
      return plan;
    }

    const goalNeedsNormalization = !plan.goal || this.isLikelyEnglishOnly(plan.goal);
    const notesNeedsNormalization = Boolean(plan.notes && this.isLikelyEnglishOnly(plan.notes));

    if (!goalNeedsNormalization && !notesNeedsNormalization) {
      return plan;
    }

    const normalizedNotes = notesNeedsNormalization
      ? '已按中文默认规范生成执行计划。'
      : plan.notes;

    return {
      goal: goalNeedsNormalization ? prompt.trim() : plan.goal,
      steps: plan.steps,
      notes: normalizedNotes,
    };
  }

  private normalizeInteractiveWebPlan(
    plan: { goal?: string; steps: string[]; notes?: string },
    prompt: string
  ): { goal?: string; steps: string[]; notes?: string } {
    if (!this.isInteractiveInternalWebTask(prompt)) {
      return plan;
    }

    const steps = plan.steps.map((step) => {
      if (!/web-search/i.test(step)) {
        return step;
      }
      return step.replace(/使用\s*web-search\s*技能/ig, '使用浏览器自动化工具')
        .replace(/web-search/ig, '浏览器自动化工具');
    });

    const notes = typeof plan.notes === 'string'
      ? plan.notes.replace(/web-search/ig, '浏览器自动化工具')
      : plan.notes;

    return {
      ...plan,
      steps,
      notes,
    };
  }

  private isInteractiveInternalWebTask(prompt: string): boolean {
    const normalized = prompt.toLowerCase().trim();
    const hasInternalUrl = /https?:\/\/[^\s]*workspace\.example\.test/.test(normalized);
    const hasInteractiveVerb = /(点击|输入|填写|查询|按钮|表单|click|fill|type|submit|form|search)/.test(normalized);
    return hasInternalUrl && hasInteractiveVerb;
  }

  private containsChinese(text: string | undefined): boolean {
    if (!text) return false;
    return /[\u4e00-\u9fff]/.test(text);
  }

  private isLikelyEnglishOnly(text: string | undefined): boolean {
    if (!text) return false;
    const normalized = text.trim();
    if (!normalized) return false;
    if (this.containsChinese(normalized)) return false;

    const latinMatches = normalized.match(/[A-Za-z]/g) || [];
    return latinMatches.length >= 8;
  }

  private createFallbackExecutionPlan(
    prompt: string,
    rawResponse: string,
    hasToolUse: boolean
  ): TaskPlan {
    const trimmed = rawResponse.trim();
    const summarized = trimmed.length > 120
      ? `${trimmed.slice(0, 120)}...`
      : trimmed;
    const notesParts = [
      '规划阶段未返回可解析 JSON，已自动切换为通用执行计划。',
      hasToolUse ? '检测到规划阶段出现工具调用迹象。' : '',
      summarized ? `原始回复摘要：${summarized}` : '',
    ].filter(Boolean);

    return {
      id: nanoid(),
      goal: prompt,
      steps: [
        { id: 'step_0', description: '分析任务需求并确认目标范围', status: 'pending' },
        { id: 'step_1', description: '执行具体操作并记录关键结果', status: 'pending' },
        { id: 'step_2', description: '验证结果并输出最终说明', status: 'pending' },
      ],
      notes: notesParts.join(' '),
      createdAt: new Date(),
    };
  }

  private shouldForceExecutionPlan(prompt: string): boolean {
    const normalized = prompt.toLowerCase();

    const zhActionHints = [
      '创建',
      '新建',
      '写入',
      '修改',
      '编辑',
      '删除',
      '重命名',
      '移动',
      '复制',
      '执行',
      '运行',
      '命令',
      '文件',
      '目录',
      '脚本',
      '安装',
      '配置',
    ];

    if (zhActionHints.some((hint) => prompt.includes(hint))) {
      return true;
    }

    // Real-time / trend-analysis queries should always execute via planning + tools.
    const zhRealtimeHints = [
      '最新',
      '实时',
      '近况',
      '近期',
      '今天',
      '昨日',
      '局势',
      '动态',
      '新闻',
      '趋势',
      '走向',
      '后续',
      '发展',
      '预测',
    ];
    if (zhRealtimeHints.some((hint) => prompt.includes(hint))) {
      return true;
    }

    if (/\b(latest|recent|current|today|yesterday|news|update|updates|trend|outlook|forecast|prediction|developments?)\b/i.test(normalized)) {
      return true;
    }

    return /\b(create|write|edit|modify|delete|remove|rename|move|copy|run|execute|command|file|folder|directory|script|install|touch|mkdir|cp|mv)\b/i.test(normalized);
  }

  private extractProviderCompletionMetadata(message: unknown): Record<string, unknown> | null {
    if (!message || typeof message !== 'object') {
      return null
    }

    const record = message as Record<string, unknown>
    if (record.type !== 'result') {
      return null
    }

    const subtype = typeof record.subtype === 'string' && record.subtype.trim()
      ? record.subtype.trim()
      : null
    const stopReason = typeof record.stop_reason === 'string' && record.stop_reason.trim()
      ? record.stop_reason.trim()
      : typeof record.stopReason === 'string' && record.stopReason.trim()
      ? record.stopReason.trim()
      : null
    const durationMs = typeof record.duration_ms === 'number' && Number.isFinite(record.duration_ms)
      ? record.duration_ms
      : typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
      ? record.durationMs
      : null
    const totalCostUsd = typeof record.total_cost_usd === 'number' && Number.isFinite(record.total_cost_usd)
      ? record.total_cost_usd
      : typeof record.totalCostUsd === 'number' && Number.isFinite(record.totalCostUsd)
      ? record.totalCostUsd
      : null

    const metadata: Record<string, unknown> = {}
    if (subtype) metadata.providerResultSubtype = subtype
    if (stopReason) metadata.providerStopReason = stopReason
    if (durationMs !== null) metadata.providerDurationMs = durationMs
    if (totalCostUsd !== null) metadata.providerTotalCostUsd = totalCostUsd

    return Object.keys(metadata).length > 0 ? metadata : null
  }

  /**
   * Parse planning response from LLM
   */
  private parsePlanningResponse(response: string): {
    type: 'direct_answer' | 'plan' | 'clarification_request' | 'unknown';
    answer?: string;
    plan?: { goal?: string; steps: string[]; notes?: string };
    clarification?: PendingQuestion;
  } {
    try {
      const plan = this.parsePlanFromResponse(response);
      if (plan) {
        return { type: 'plan', plan };
      }

      const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonContainer = codeBlockMatch ? codeBlockMatch[1].trim() : response.trim();
      const jsonString = this.extractJsonObject(jsonContainer) ?? this.extractJsonObject(response);

      if (!jsonString) {
        const inferredClarification = this.inferClarificationFromFreeform(response);
        if (inferredClarification) {
          return {
            type: 'clarification_request',
            clarification: inferredClarification,
          };
        }
        return { type: 'unknown' };
      }

      const parsed = JSON.parse(jsonString) as Record<string, unknown>;

      if (parsed.type === 'direct_answer' && typeof parsed.answer === 'string' && parsed.answer.trim() !== '') {
        return {
          type: 'direct_answer',
          answer: parsed.answer.trim(),
        };
      }

      if (
        parsed.type === 'clarification_request' ||
        parsed.type === 'clarification' ||
        parsed.type === 'question'
      ) {
        const clarification = this.normalizeClarificationPayload(parsed);
        if (clarification) {
          return {
            type: 'clarification_request',
            clarification,
          };
        }
      }

      if (parsed.type === 'plan') {
        const normalized = this.normalizePlanPayload(parsed);
        if (normalized) {
          return {
            type: 'plan',
            plan: normalized,
          };
        }
      }

      const inferredClarification = this.inferClarificationFromFreeform(response);
      if (inferredClarification) {
        return {
          type: 'clarification_request',
          clarification: inferredClarification,
        };
      }

      return { type: 'unknown' };
    } catch (error) {
      console.error('[ClaudeAgent] Failed to parse planning response:', error);
      const inferredClarification = this.inferClarificationFromFreeform(response);
      if (inferredClarification) {
        return {
          type: 'clarification_request',
          clarification: inferredClarification,
        };
      }
      return { type: 'unknown' };
    }
  }

  private inferClarificationFromFreeform(response: string): PendingQuestion | null {
    const text = response
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return null;
    }

    const lower = text.toLowerCase();
    const clarificationHints = [
      '请提供',
      '请补充',
      '请确认',
      '需要先确认',
      '需要你提供',
      '缺少',
      '信息不足',
      '无法确定',
      '不明确',
      '还需要',
      'need more information',
      'insufficient information',
      'missing information',
      'please provide',
      'please clarify',
      'could you clarify',
      'cannot determine',
      'unclear',
    ];
    const hasHint = clarificationHints.some((hint) => lower.includes(hint));
    const hasQuestionMark = text.includes('?') || text.includes('？');
    const questionIntent = /(请问|请提供|请补充|请确认|你希望|需要|what|which|when|where|who|how|could you|would you|do you want|please)/i;

    if (!hasHint && !(hasQuestionMark && questionIntent.test(text))) {
      return null;
    }

    const extractedQuestion = this.extractClarificationQuestion(text);
    if (!extractedQuestion) {
      return null;
    }

    return {
      id: nanoid(),
      question: extractedQuestion,
      allowFreeText: true,
    };
  }

  private extractClarificationQuestion(text: string): string | null {
    const normalized = text
      .replace(/^[\-\d.)\s]+/, '')
      .trim();
    if (!normalized) {
      return null;
    }

    const clauses = normalized
      .split(/[\n。!?！？]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const questionLike = clauses.filter((item) => {
      const hasQuestionMark = item.includes('?') || item.includes('？');
      const hasPromptVerb = /(请提供|请补充|请确认|你希望|需要|what|which|when|where|who|how|please provide|please clarify|could you)/i.test(item);
      return hasQuestionMark || hasPromptVerb;
    });

    const pick = questionLike.find((item) => item.length <= 140) || questionLike[0];
    if (pick) {
      const cleaned = pick.replace(/^[\-*]\s*/, '').trim().slice(0, 180);
      if (!cleaned) return null;
      if (cleaned.endsWith('?') || cleaned.endsWith('？')) return cleaned;
      return `${cleaned}？`;
    }

    const hasInfoGapHint = /(请提供|请补充|请确认|缺少|信息不足|无法确定|need more information|missing|insufficient|unclear|please provide|please clarify)/i.test(normalized);
    if (!hasInfoGapHint) {
      return null;
    }

    return '为生成可执行计划，请先补充关键约束（目标、范围、时间和输出格式）。';
  }

  private normalizeClarificationPayload(parsed: unknown): PendingQuestion | null {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const nested = typeof record.clarification === 'object' && record.clarification
      ? (record.clarification as Record<string, unknown>)
      : null;
    const payload = nested || record;

    const question = typeof payload.question === 'string'
      ? payload.question.trim()
      : '';

    if (!question) {
      return null;
    }

    const options = Array.isArray(payload.options)
      ? payload.options
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
      : [];

    const allowFreeText = typeof payload.allowFreeText === 'boolean'
      ? payload.allowFreeText
      : options.length === 0;

    return {
      id: nanoid(),
      question,
      options: options.length > 0 ? options : undefined,
      allowFreeText,
    };
  }

  /**
   * Format plan for execution phase
   */
  formatPlanForExecution(plan: TaskPlan, workDir: string): string {
    return taskPlanner.formatForExecution(plan, workDir);
  }

  /**
   * Map tool name to UI permission category.
   */
  private mapToolToPermissionType(toolName: string, input: Record<string, unknown>): PermissionRequest['type'] {
    if (toolName === 'WebSearch' || toolName === 'WebFetch') {
      return 'network_access';
    }
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
      return 'file_write';
    }

    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command.toLowerCase() : '';
      if (command.includes(' rm ') || command.startsWith('rm ') || command.includes(' del ')) {
        return 'file_delete';
      }
      return 'command_exec';
    }

    return 'other';
  }

  private getApprovalPolicy(): { enabled: boolean; autoAllowTools: Set<string>; timeoutMs: number } {
    const approval = getSettings()?.approval;
    const enabled = approval?.enabled ?? true;
    const configuredTools = Array.isArray(approval?.autoAllowTools)
      ? approval.autoAllowTools
      : DEFAULT_AUTO_ALLOW_TOOLS;
    const timeoutMs = Number(approval?.timeoutMs);

    return {
      enabled,
      autoAllowTools: new Set(configuredTools),
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_APPROVAL_TIMEOUT_MS,
    };
  }

  private shouldAutoAllowTool(toolName: string, autoAllowTools: Set<string>): boolean {
    const aliases = this.getToolNameAliases(toolName);
    return aliases.some((name) => autoAllowTools.has(name));
  }

  private shouldBypassApproval(toolName: string, mcpConfig?: McpConfig): boolean {
    if (toolName === 'Skill') {
      return true;
    }

    if (toolName.startsWith('mcp__') && !toolName.startsWith('mcp__sandbox__')) {
      return this.matchesConfiguredMcpTool(toolName, mcpConfig);
    }

    return false;
  }

  private matchesConfiguredMcpTool(toolName: string, mcpConfig?: McpConfig): boolean {
    if (!toolName.startsWith('mcp__') || !mcpConfig?.mcpServers) {
      return false;
    }

    return Object.keys(mcpConfig.mcpServers).some((serverName) => (
      typeof serverName === 'string' &&
      serverName.trim().length > 0 &&
      toolName.startsWith(`mcp__${serverName}__`)
    ));
  }

  private resolveWriteTargetPath(input: Record<string, unknown>): string | null {
    const candidates = [
      input.file_path,
      input.filePath,
      input.path,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private isPathInsideDirectory(targetPath: string, allowedDir: string): boolean {
    const resolvedTarget = resolve(targetPath);
    const resolvedAllowed = resolve(allowedDir);
    const rel = relative(resolvedAllowed, resolvedTarget);
    return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !rel.startsWith('/'));
  }

  private validateWriteScope(
    toolName: string,
    input: Record<string, unknown>,
    options?: AgentRunOptions
  ): { allowed: true } | { allowed: false; message: string; blockedPath?: string } {
    if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
      return { allowed: true };
    }

    const targetPath = this.resolveWriteTargetPath(input);
    if (!targetPath) {
      return { allowed: true };
    }

    const sessionDir = this.getSessionWorkDir(options?.cwd || this.config.workDir, undefined, options?.taskId);
    if (this.isPathInsideDirectory(targetPath, sessionDir)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      blockedPath: targetPath,
      message: `File writes must stay within the current session directory: ${sessionDir}`,
    };
  }

  private getToolNameAliases(toolName: string): string[] {
    const aliases = new Set<string>([toolName]);

    if (toolName === 'sandbox_run_command') {
      aliases.add('mcp__sandbox__sandbox_run_command');
    } else if (toolName === 'mcp__sandbox__sandbox_run_command') {
      aliases.add('sandbox_run_command');
    } else if (toolName === 'sandbox_run_script') {
      aliases.add('mcp__sandbox__sandbox_run_script');
    } else if (toolName === 'mcp__sandbox__sandbox_run_script') {
      aliases.add('sandbox_run_script');
    }

    return [...aliases];
  }

  private buildPermissionRequest(
    toolName: string,
    input: Record<string, unknown>,
    options: {
      blockedPath?: string;
      decisionReason?: string;
      toolUseID?: string;
      sessionId?: string;
      taskId?: string;
      providerSessionId?: string;
    }
  ): PermissionRequest {
    const permissionId = options.toolUseID || nanoid();
    const truncatedInput = JSON.stringify(input).slice(0, 800);
    const summary = options.decisionReason || `Tool ${toolName} requires approval.`;

    return {
      id: permissionId,
      type: this.mapToolToPermissionType(toolName, input),
      title: `请求执行工具: ${toolName}`,
      description: summary,
      metadata: {
        toolName,
        blockedPath: options.blockedPath || null,
        inputPreview: truncatedInput,
        sessionId: options.sessionId || null,
        taskId: options.taskId || null,
        providerSessionId: options.providerSessionId || null,
      },
    };
  }

  /**
   * Create runtime permission gate for each tool invocation.
   * The handler blocks tool execution until the user approves/rejects via API.
   */
  private createPermissionHandler(options?: AgentRunOptions, providerSessionId?: string): CanUseTool {
    return async (toolName, input, permissionOptions): Promise<PermissionResult> => {
      // Enforce sandbox execution path: when sandbox is enabled, host Bash is never allowed.
      if (options?.sandbox?.enabled && toolName === 'Bash') {
        return {
          behavior: 'deny',
          message: 'Sandbox mode requires sandbox_run_command or sandbox_run_script. Bash is disabled.',
          interrupt: false,
          toolUseID: permissionOptions.toolUseID,
        };
      }

      const writeScope = this.validateWriteScope(toolName, input, options);
      if (!writeScope.allowed) {
        return {
          behavior: 'deny',
          message: writeScope.message,
          interrupt: false,
          toolUseID: permissionOptions.toolUseID,
        };
      }

      const policy = this.getApprovalPolicy();

      if (!policy.enabled) {
        return {
          behavior: 'allow',
          updatedInput: input,
          toolUseID: permissionOptions.toolUseID,
        };
      }

      if (
        this.shouldBypassApproval(toolName, options?.mcpConfig) ||
        this.shouldAutoAllowTool(toolName, policy.autoAllowTools) ||
        this.matchesConfiguredMcpTool(toolName, options?.mcpConfig)
      ) {
        return {
          behavior: 'allow',
          updatedInput: input,
          toolUseID: permissionOptions.toolUseID,
        };
      }

      const timeoutMs = policy.timeoutMs;
      const permission = this.buildPermissionRequest(toolName, input, {
        blockedPath: permissionOptions.blockedPath,
        decisionReason: permissionOptions.decisionReason,
        toolUseID: permissionOptions.toolUseID,
        sessionId: this.session?.id,
        taskId: options?.taskId,
        providerSessionId,
      });

      approvalCoordinator.capturePermissionRequest(permission, {
        runId: this.session?.id,
        taskId: options?.taskId,
        providerSessionId,
        expiresAt: Date.now() + timeoutMs,
      });

      return await new Promise<PermissionResult>((resolve) => {
        let settled = false;
        const toolUseID = permissionOptions.toolUseID;

        const finalize = (result: PermissionResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          approvalCoordinator.detachPermissionResolver(permission.id);
          resolve(result);
        };

        const timeoutHandle = setTimeout(() => {
          approvalCoordinator.markPermissionExpired(permission.id, 'Permission request timed out.');
          finalize({
            behavior: 'deny',
            message: 'Permission request timed out.',
            interrupt: true,
            toolUseID,
          });
        }, timeoutMs);

        approvalCoordinator.attachPermissionResolver(permission.id, ({ approved, reason }) => {
          if (approved) {
            finalize({
              behavior: 'allow',
              updatedInput: input,
              toolUseID,
            });
            return;
          }
          finalize({
            behavior: 'deny',
            message: reason || 'Permission denied by user.',
            interrupt: true,
            toolUseID,
          });
        });

        if (permissionOptions.signal.aborted) {
          approvalCoordinator.markPermissionCanceled(permission.id, 'Permission request aborted.');
          finalize({
            behavior: 'deny',
            message: 'Permission request aborted.',
            interrupt: true,
            toolUseID,
          });
          return;
        }

        permissionOptions.signal.addEventListener(
          'abort',
          () => {
            approvalCoordinator.markPermissionCanceled(permission.id, 'Permission request aborted.');
            finalize({
              behavior: 'deny',
              message: 'Permission request aborted.',
              interrupt: true,
              toolUseID,
            });
          },
          { once: true }
        );
      });
    };
  }

  /**
   * 构建 SDK 查询选项
   */
  private async buildQueryOptions(
    cwd: string,
    options?: AgentRunOptions,
    signal?: AbortSignal,
    claudeCodePath?: string,
    selectedSkillIds?: string[],
    providerSessionId?: string,
    prompt?: string
  ): Promise<Options> {
    // 同步技能到会话目录，避免并发任务相互污染
    await this.syncSkillsToSession(cwd, options?.skillsConfig, selectedSkillIds);

    // 构建 settingSources - 只使用 project 来加载项目 .claude/skills/
    const settingSources = this.buildSettingSources(options?.skillsConfig);

    // 加载 MCP Servers
    const mcpServers = await this.loadMcpServers(options?.mcpConfig, options?.sandbox);

    // 动态计算 maxTurns：优先使用 IntentClassifier 的 complexityHint，否则 fallback 到正则匹配
    const COMPLEXITY_MAX_TURNS = { simple: 30, medium: 60, complex: 120 } as const;
    const TURNS_PER_STEP = 15;
    const MAX_TURNS_HARD_CAP = 300;
    let maxTurns = options?.complexityHint
      ? COMPLEXITY_MAX_TURNS[options.complexityHint]
      : (prompt ? detectTaskComplexity(prompt) : TASK_COMPLEXITY.MAX.maxTurns);
    // Plan-aware maxTurns: scale up based on number of steps or estimated iterations
    if (options?.plan) {
      const plan = options.plan;
      const iterationBased = plan.estimatedIterations
        ? Math.ceil(plan.estimatedIterations / 10) * TURNS_PER_STEP
        : plan.steps.length * TURNS_PER_STEP;
      const planBasedTurns = Math.min(iterationBased, MAX_TURNS_HARD_CAP);
      if (planBasedTurns > maxTurns) {
        maxTurns = planBasedTurns;
      }
    }
    console.log(`[Claude ${providerSessionId}] maxTurns=${maxTurns} (hint=${options?.complexityHint || 'none'}, planSteps=${options?.plan?.steps.length ?? 'n/a'}, estimatedIterations=${options?.plan?.estimatedIterations ?? 'n/a'})`);

    const queryOptions: Options = {
      cwd,
      tools: { type: 'preset', preset: 'claude_code' },
      // Keep auto-allow list empty, then decide allow/deny in canUseTool.
      allowedTools: [],
      settingSources,
      permissionMode: 'default',
      canUseTool: this.createPermissionHandler(options, providerSessionId),
      abortController: signal ? { signal } as AbortController : undefined,
      env: this.buildEnvConfig(),
      model: this.config.model,
      pathToClaudeCodeExecutable: claudeCodePath,
      maxTurns,
    };

    // 添加 MCP Servers
    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
    }

    // 添加 Sandbox MCP Server（如果启用）
    if (options?.sandbox?.enabled) {
      queryOptions.mcpServers = {
        ...queryOptions.mcpServers,
        sandbox: this.createSandboxMcpServer(options.sandbox),
      };
      // 添加 sandbox 工具到允许列表
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || []),
        'sandbox_run_script',
        'sandbox_run_command',
        'mcp__sandbox__sandbox_run_script',
        'mcp__sandbox__sandbox_run_command',
      ];
    }

    return queryOptions;
  }

  /**
   * 同步 skills 到会话级目录：
   * ${sessionCwd}/.claude/skills/
   * ${sessionCwd}/.claude/skills/active/
   */
  private async syncSkillsToSession(
    sessionCwd: string,
    skillsConfig?: SkillsConfig,
    selectedSkillIds?: string[]
  ): Promise<void> {
    // 如果 skills 被禁用，跳过
    if (skillsConfig && !skillsConfig.enabled) {
      return;
    }

    const projectDir = getProjectRoot();
    const sourceDir = join(projectDir, 'SKILLs');
    const targetDir = join(sessionCwd, '.claude', 'skills');
    const activeDir = join(targetDir, 'active');

    try {
      rmSync(targetDir, { recursive: true, force: true });
      await mkdir(activeDir, { recursive: true });

      if (!existsSync(sourceDir)) {
        return;
      }

      const selectedSkillNames = selectedSkillIds && selectedSkillIds.length > 0
        ? Array.from(
            new Set(
              selectedSkillIds.map((skillId) => this.getSkillDirectoryFromSkillId(skillId))
            )
          )
        : filterEnabledSkills(
            getAllSkills(projectDir),
            this.config.provider || 'claude',
            getSettings()?.skills,
          ).map((skill) => this.getSkillDirectoryFromSkillId(skill.id));

      let syncedCount = 0;
      for (const skillName of selectedSkillNames) {
        const sourceSkillPath = join(sourceDir, skillName);
        const sourceSkillMd = join(sourceSkillPath, 'SKILL.md');
        if (!existsSync(sourceSkillPath) || !existsSync(sourceSkillMd)) {
          continue;
        }

        cpSync(sourceSkillPath, join(targetDir, skillName), { recursive: true });
        cpSync(sourceSkillPath, join(activeDir, skillName), { recursive: true });
        syncedCount += 1;
      }

      if (syncedCount > 0) {
        console.log(`[ClaudeAgent] Synced ${syncedCount} routed skills to ${targetDir}`);
      }
    } catch (err) {
      console.error('[ClaudeAgent] Failed to sync skills:', err);
      // 同步失败不影响主流程
    }
  }

  /**
   * 构建 settingSources
   * 只使用 'project' source，从项目 .claude/skills/ 加载 skills
   * 不再从 ~/.claude/skills/ 加载
   */
  private buildSettingSources(skillsConfig?: SkillsConfig): ('user' | 'project')[] {
    if (skillsConfig && !skillsConfig.enabled) {
      return ['project'];
    }
    // 只使用 project source，从项目 .claude/skills/ 加载
    // 不再使用 user source (~/.claude/skills/)
    return ['project'];
  }

  private getSkillDirectoryFromSkillId(skillId: string): string {
    const parts = skillId.split(':');
    if (parts.length <= 1) {
      return skillId;
    }
    return parts.slice(1).join(':');
  }

  private resolveRoutedSkills(prompt: string, skillsConfig?: SkillsConfig): RouteSkillsResult {
    const provider = (this.config.provider || 'claude').toLowerCase();
    const settings = getSettings();
    const skillsSettings = settings?.skills;

    if (skillsConfig && !skillsConfig.enabled) {
      const disabledResult = routeSkillsForPrompt({
        prompt,
        provider,
        projectRoot: getProjectRoot(),
        skillsSettings: {
          ...skillsSettings,
          enabled: false,
        },
        includeExplain: true,
      });
      return {
        ...disabledResult,
        shouldApply: false,
        selected: [],
      };
    }

    return routeSkillsForPrompt({
      prompt,
      provider,
      projectRoot: getProjectRoot(),
      skillsSettings,
      includeExplain: true,
    });
  }

  private buildRoutedSkillsContext(routed: RouteSkillsResult): string {
    if (!routed.selected.length || routed.routing.mode === 'off') {
      return '';
    }

    const selectedSkills = routed.selected.slice(0, 5);
    const modeLabel = routed.routing.mode === 'auto' ? 'AUTO_APPLIED' : 'RECOMMENDED_ONLY';
    const skillLines = selectedSkills.map((skill, index) => {
      const reason = skill.reasons.length > 0
        ? ` (${skill.reasons.slice(0, 2).join('; ')})`
        : '';
      return `${index + 1}. ${skill.name}${reason}`;
    }).join('\n');

    return `
## ROUTED SKILLS (${modeLabel})
The system selected these skills for this task:
${skillLines}

Prioritize these skills when they are relevant.

`;
  }

  private recordRoutedSkillOutcomes(
    routed: RouteSkillsResult,
    success: boolean,
    latencyMs: number,
    errorMessage?: string
  ): void {
    if (routed.routing.mode === 'off') {
      return;
    }
    if (!routed.selected.length) {
      return;
    }

    const skillIds = routed.selected.map((item) => item.skillId);
    try {
      recordSkillRouteOutcomes(getProjectRoot(), skillIds, {
        success,
        latencyMs,
        error: errorMessage,
      });
    } catch (error) {
      console.error('[ClaudeAgent] Failed to record skill route outcomes:', error);
    }
  }

  /**
   * 构建环境变量配置
   *
   * 关键逻辑：
   * 1. 当用户配置了自定义 API 时，使用 ANTHROPIC_AUTH_TOKEN 而不是 ANTHROPIC_API_KEY
   *    因为 Claude SDK 会优先使用 ANTHROPIC_AUTH_TOKEN，这样可以确保我们的配置覆盖 ~/.claude/settings.json
   * 2. 删除 ANTHROPIC_API_KEY 以确保 AUTH_TOKEN 优先级
   * 3. 设置 CLAUDE_CODE_SKIP_CONFIG=1 来跳过读取 ~/.claude/settings.json 中的配置
   */
  private buildEnvConfig(): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env };

    env.PATH = this.getExtendedPath();

    // 清除可能导致嵌套会话问题的环境变量
    // Claude Code CLI 不允许在另一个 Claude Code 会话中启动
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_SESSION;
    delete env.CLAUDE_SESSION_ID;

    // 当用户在 EasyWork 中配置了自定义 API 时，需要确保配置优先于 ~/.claude/settings.json
    // 通过使用 ANTHROPIC_AUTH_TOKEN 并删除 ANTHROPIC_API_KEY 来实现优先级控制
    if (this.config.apiKey) {
      // 使用 ANTHROPIC_AUTH_TOKEN 作为主要认证方式
      env.ANTHROPIC_AUTH_TOKEN = this.config.apiKey;
      // 删除 ANTHROPIC_API_KEY 以确保 AUTH_TOKEN 优先级高于 ~/.claude/settings.json 中的配置
      delete env.ANTHROPIC_API_KEY;

      // Base URL: 自定义端点则设置，否则删除以使用 Anthropic 默认
      if (this.config.baseUrl) {
        env.ANTHROPIC_BASE_URL = this.config.baseUrl;
        console.log('[ClaudeAgent] Using custom API from settings:', {
          baseUrl: this.config.baseUrl,
        });
      } else {
        // 删除以确保使用默认 Anthropic API，而不是 ~/.claude/settings.json 中的配置
        delete env.ANTHROPIC_BASE_URL;
        console.log('[ClaudeAgent] Using custom API key with default Anthropic base URL');
      }
    } else {
      console.log('[ClaudeAgent] Using API config from environment');
    }

    // Model: 设置所有模型层级（兼容 OpenRouter 等第三方模型名）
    if (this.config.model) {
      env.ANTHROPIC_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = this.config.model;
      console.log('[ClaudeAgent] Model configured:', this.config.model);
    } else if (this.config.apiKey) {
      // 使用自定义 API 但没有指定模型时，清除 ~/.claude/settings.json 中的模型设置
      // 让第三方 API 使用其默认模型
      delete env.ANTHROPIC_MODEL;
      delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
      delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
      console.log('[ClaudeAgent] Custom API without model: cleared local model settings');
    }

    // 自定义 API 模式：禁用遥测、跳过配置读取、延长超时
    if (this.isUsingCustomApi()) {
      env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
      // 强制 SDK 不使用缓存的配置，跳过 ~/.claude/settings.json
      env.CLAUDE_CODE_SKIP_CONFIG = '1';
      env.CLAUDE_CODE_SKIP_MODEL_VALIDATION = '1';
      env.API_TIMEOUT_MS = '600000';

      // GLM 特定配置
      if (this.config.baseUrl?.includes('bigmodel.cn')) {
        env.CLAUDE_CODE_USE_BETA = '1';
        console.log('[ClaudeAgent] GLM provider detected, enabling beta features');
      }
    }

    // 调试日志：输出最终的 API 配置
    console.log('[ClaudeAgent] Final env config:', {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY === undefined ? '(deleted)' : env.ANTHROPIC_API_KEY ? `${env.ANTHROPIC_API_KEY.slice(0, 10)}...` : 'not set',
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? `${env.ANTHROPIC_AUTH_TOKEN.slice(0, 10)}...` : 'not set',
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL === undefined ? '(deleted - use default)' : env.ANTHROPIC_BASE_URL || 'not set',
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || 'not set',
    });

    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        filteredEnv[key] = value;
      }
    }
    return filteredEnv;
  }

  /**
   * 检查是否使用自定义 API
   */
  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  /**
   * 扩展 PATH 环境变量
   */
  private getExtendedPath(): string {
    const home = homedir();
    const os = platform();
    const isWindows = os === 'win32';
    const pathSeparator = isWindows ? ';' : ':';

    const paths = [process.env.PATH || ''];

    if (isWindows) {
      paths.push(
        join(home, 'AppData', 'Roaming', 'npm'),
        join(home, 'AppData', 'Local', 'Programs', 'nodejs'),
        join(home, '.volta', 'bin'),
        'C:\\Program Files\\nodejs'
      );
    } else {
      paths.push(
        '/usr/local/bin',
        '/opt/homebrew/bin',
        join(home, '.local', 'bin'),
        join(home, '.npm-global', 'bin'),
        join(home, '.volta', 'bin')
      );

      // 添加 nvm 路径
      const nvmDir = join(home, '.nvm', 'versions', 'node');
      try {
        if (existsSync(nvmDir)) {
          const versions = readdirSync(nvmDir);
          for (const version of versions) {
            paths.push(join(nvmDir, version, 'bin'));
          }
        }
      } catch {
        // nvm not installed
      }
    }

    return paths.join(pathSeparator);
  }

  /**
   * 使用 SDK 内置的 cli.js
   * 项目依赖 @anthropic-ai/claude-agent-sdk，直接使用其内置 cli.js，无需查找外部 claude 二进制
   */
  private async ensureClaudeCode(): Promise<string | undefined> {
    if (this.claudeCodePath) {
      return this.claudeCodePath;
    }

    // SDK cli.js 使用 `#!/usr/bin/env node` shebang，spawn 时依赖进程 PATH 找到 node
    // Tauri sidecar 环境 PATH 被剥离，需要提前写回扩展 PATH
    process.env.PATH = this.getExtendedPath();

    const require = createRequire(import.meta.url);
    const sdkCliPath = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js');
    if (!existsSync(sdkCliPath)) {
      console.error(`[Claude] SDK cli.js not found at: ${sdkCliPath}`);
      return undefined;
    }

    this.claudeCodePath = sdkCliPath;
    console.log(`[Claude] Using bundled SDK cli.js at: ${sdkCliPath}`);
    return this.claudeCodePath;
  }

  /**
   * 获取会话工作目录
   */
  private getSessionWorkDir(
    baseWorkDir?: string,
    prompt?: string,
    taskId?: string
  ): string {
    const workDir = baseWorkDir || process.cwd();
    const expandedPath = workDir.startsWith('~')
      ? join(homedir(), workDir.slice(1))
      : workDir;

    // 如果已经是会话路径，直接使用
    if (
      expandedPath.includes('/sessions/') ||
      expandedPath.includes('\\sessions\\')
    ) {
      return expandedPath;
    }

    // 生成会话文件夹名称
    const sessionsDir = join(expandedPath, 'sessions');
    let folderName: string;

    if (taskId) {
      // 优先使用 taskId 作为文件夹名，确保与 AgentService 保持一致
      folderName = taskId;
    } else if (prompt) {
      // 没有 taskId 但有 prompt 时，使用 slug
      folderName = this.generateSlug(prompt, '');
    } else {
      folderName = `session-${Date.now()}`;
    }

    return join(sessionsDir, folderName);
  }

  /**
   * 生成会话 slug
   */
  private generateSlug(prompt: string, taskId?: string): string {
    let slug = prompt
      .toLowerCase()
      .replace(/[\u4e00-\u9fff]/g, '') // 移除中文
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '');

    if (!slug || slug.length < 3) {
      slug = 'task';
    }

    // 如果有 taskId，添加后6位；否则添加时间戳
    const suffix = taskId ? taskId.slice(-6) : Date.now().toString(36).slice(-6);
    return `${slug}-${suffix}`;
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create directory:', error);
    }
  }

  /**
   * 保存图片到磁盘
   */
  private async saveImagesToDisk(
    images: ImageAttachment[],
    workDir: string
  ): Promise<string[]> {
    const savedPaths: string[] = [];

    if (images.length === 0) {
      return savedPaths;
    }

    await this.ensureDir(workDir);

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const ext = image.mimeType.split('/')[1] || 'png';
      const filename = `image_${Date.now()}_${i}.${ext}`;
      const filePath = join(workDir, filename);

      try {
        let base64Data = image.data;
        if (base64Data.includes(',')) {
          base64Data = base64Data.split(',')[1];
        }

        const buffer = Buffer.from(base64Data, 'base64');
        await writeFile(filePath, buffer);
        savedPaths.push(filePath);
        console.log(`[Claude] Saved image to: ${filePath}`);
      } catch (error) {
        console.error(`[Claude] Failed to save image: ${error}`);
      }
    }

    return savedPaths;
  }

  /**
   * 获取工作目录指令
   */
  private getWorkspaceInstruction(workDir: string, sandbox?: SandboxConfig, mcpConfig?: McpConfig): string {
    let instruction = `
## CRITICAL: Workspace Configuration
**MANDATORY OUTPUT DIRECTORY: ${workDir}**

ALL files you create MUST be saved to this directory.
- ALWAYS use absolute paths starting with ${workDir}/
- NEVER use ~/Documents/, /tmp/, or any other default paths

## CRITICAL: Read Before Write Rule
**ALWAYS use the Read tool before using the Write tool, even for new files.**

`;

    const configuredMcpServers = mcpConfig?.mcpServers
      ? Object.keys(mcpConfig.mcpServers).filter((name) => name.trim().length > 0)
      : [];

    if (configuredMcpServers.length > 0) {
      instruction += `
## MCP Servers Available In This Session
The current application has these MCP servers configured: ${configuredMcpServers.join(', ')}.
- Use these MCP tools directly when they match the task.
- Do NOT use Bash to probe whether these servers exist.
- If a needed tool is missing from the tool list, report that the MCP tools were not exposed in this session.

`;
    }

    instruction += `
## Web Automation Preference
For authenticated or internal web applications, prefer browser automation tools/MCP (such as chrome-devtools or playwright-style tools).
- Do NOT use generic web-search skills to operate interactive internal pages.
- If a web-search skill is only a placeholder, skip it and use browser automation directly.

`;

    if (sandbox?.enabled) {
      instruction += `
## Sandbox Mode (ENABLED)
You MUST use sandbox tools for running scripts.
- Use \`sandbox_run_script\` to run scripts
- NEVER use Bash tool to run scripts directly
- NEVER run long-lived servers in foreground (e.g. \`flask run\`, \`python app.py\`, \`npm run dev\`).
- Start long-lived services in background, then run a separate health check command and continue.

`;
    }

    return instruction;
  }

  /**
   * 格式化对话历史
   */
  private formatConversationHistory(
    conversation?: ConversationMessage[]
  ): string {
    if (!conversation || conversation.length === 0) {
      return '';
    }

    const maxHistoryTokens = (this.config.providerConfig?.maxHistoryTokens as number) || 2000;
    const minMessagesToKeep = 3;

    const allFormattedMessages = conversation.map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let messageContent = `${role}: ${msg.content}`;

      if (msg.imagePaths && msg.imagePaths.length > 0) {
        const imageRefs = msg.imagePaths
          .map((p, i) => `  - Image ${i + 1}: ${p}`)
          .join('\n');
        messageContent += `\n[Attached images:\n${imageRefs}\n]`;
      }

      return messageContent;
    });

    // 简单的 token 估算
    const messageTokens = allFormattedMessages.map((msg) => ({
      content: msg,
      tokens: Math.ceil(msg.length / 4),
    }));

    let totalTokens = 0;
    const selectedMessages: string[] = [];
    const startIndex = Math.max(0, messageTokens.length - minMessagesToKeep);

    for (let i = messageTokens.length - 1; i >= startIndex; i--) {
      const message = messageTokens[i];
      if (totalTokens + message.tokens <= maxHistoryTokens) {
        selectedMessages.unshift(message.content);
        totalTokens += message.tokens;
      } else {
        break;
      }
    }

    if (selectedMessages.length === 0) {
      return '';
    }

    const formattedMessages = selectedMessages.join('\n\n');
    const truncationNotice =
      conversation.length > selectedMessages.length
        ? `\n\n[Note: Conversation history truncated. Showing ${selectedMessages.length} of ${conversation.length} messages.]`
        : '';

    return `## Previous Conversation Context
${formattedMessages}${truncationNotice}

---
## Current Request
`;
  }

  /**
   * 加载 MCP Servers
   */
  private async loadMcpServers(
    mcpConfig?: McpConfig,
    sandbox?: SandboxConfig
  ): Promise<Record<string, SdkMcpServerConfig>> {
    const servers: Record<string, SdkMcpServerConfig> = {};

    // 从配置加载（转换为 SDK 兼容格式）
    if (mcpConfig?.mcpServers) {
      for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
        // 转换为 SDK 的 McpServerConfig 格式
        if (config.type === 'stdio' && config.command) {
          servers[name] = {
            type: 'stdio',
            command: config.command,
            args: config.args,
            env: config.env,
          };
        } else if (config.type === 'sse' && config.url) {
          servers[name] = {
            type: 'sse',
            url: config.url,
            headers: config.headers,
          };
        } else if (config.type === 'http' && config.url) {
          servers[name] = {
            type: 'http',
            url: config.url,
            headers: config.headers,
          };
        }
        // 支持 stdio、sse、http 三种传输类型
      }
    }

    return servers;
  }

  /**
   * 创建 Sandbox MCP Server
   */
  private createSandboxMcpServer(sandbox: SandboxConfig) {
    const configuredEndpoint = sandbox.apiEndpoint?.trim();
    const endpointBase = configuredEndpoint && configuredEndpoint.length > 0
      ? configuredEndpoint
      : 'http://localhost:2026';
    const normalizedBase = endpointBase.replace(/\/$/, '');
    const sandboxApiUrl = normalizedBase.endsWith('/api')
      ? normalizedBase
      : `${normalizedBase}/api`;

    return createSdkMcpServer({
      name: 'sandbox',
      version: '1.0.0',
      tools: [
        tool(
          'sandbox_run_script',
          `Run a script file in an isolated sandbox container. Automatically detects the runtime (Python, Node.js, Bun) based on file extension.`,
          {
            filePath: z
              .string()
              .describe('Absolute path to the script file to execute'),
            workDir: z
              .string()
              .describe('Working directory containing the script'),
            args: z
              .array(z.string())
              .optional()
              .describe('Optional command line arguments'),
            packages: z
              .array(z.string())
              .optional()
              .describe('Optional packages to install'),
            timeout: z
              .number()
              .optional()
              .describe('Execution timeout in milliseconds'),
          },
          async (args) => {
            try {
              const requestTimeout = typeof args.timeout === 'number' && args.timeout > 0
                ? Math.max(1000, args.timeout + 5000)
                : 65000;

              const result = await this.postSandboxJson<{
                success: boolean;
                exitCode: number;
                runtime?: string;
                duration?: number;
                stdout?: string;
                stderr?: string;
                error?: string;
                timedOut?: boolean;
                classification?: 'succeeded' | 'timed_out' | 'started_with_timeout' | 'failed';
                started?: boolean;
                healthPassed?: boolean | null;
                healthUrl?: string | null;
              } | null>(
                `${sandboxApiUrl}/sandbox/run/file`,
                { ...args, provider: sandbox.provider },
                requestTimeout
              );

              if (!result) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: 'Sandbox service returned empty response.',
                    },
                  ],
                  isError: true,
                };
              }

              let output = '';
              const classification = result.classification || (result.success ? 'succeeded' : 'failed');
              if (result.success) {
                output = classification === 'started_with_timeout'
                  ? `Script command reached running state at timeout boundary (exit code: ${result.exitCode})\n`
                  : `Script executed successfully (exit code: ${result.exitCode})\n`;
                output += `Runtime: ${result.runtime || 'unknown'}\n`;
                output += `Duration: ${result.duration || 0}ms\n\n`;
                if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
                if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
              } else {
                output = `Script execution failed (exit code: ${result.exitCode})\n`;
                if (result.error) output += `Error: ${result.error}\n`;
                if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
                if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              }
              output += `Classification: ${classification}\n`;
              if (typeof result.timedOut === 'boolean') output += `Timed out: ${result.timedOut}\n`;
              if (typeof result.started === 'boolean') output += `Started: ${result.started}\n`;
              if (result.healthPassed !== null && result.healthPassed !== undefined) {
                output += `Health check: ${result.healthPassed ? 'passed' : 'failed'}`;
                if (result.healthUrl) output += ` (${result.healthUrl})`;
                output += '\n';
              }

              return {
                content: [{ type: 'text' as const, text: output }],
                isError: !result.success,
              };
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Sandbox service unavailable: ${errorMsg}`,
                  },
                ],
                isError: true,
              };
            }
          }
        ),
        tool(
          'sandbox_run_command',
          `Execute a shell command in an isolated sandbox container.`,
          {
            command: z.string().describe('The command to execute'),
            args: z.array(z.string()).optional().describe('Arguments'),
            workDir: z.string().describe('Working directory'),
            image: z.string().optional().describe('Container image'),
            timeout: z.number().optional().describe('Timeout in milliseconds'),
          },
          async (args) => {
            try {
              const requestTimeout = typeof args.timeout === 'number' && args.timeout > 0
                ? Math.max(1000, args.timeout + 5000)
                : 65000;

              const result = await this.postSandboxJson<{
                success: boolean;
                exitCode: number;
                duration?: number;
                stdout?: string;
                stderr?: string;
                error?: string;
                timedOut?: boolean;
                classification?: 'succeeded' | 'timed_out' | 'started_with_timeout' | 'failed';
                started?: boolean;
                healthPassed?: boolean | null;
                healthUrl?: string | null;
              } | null>(
                `${sandboxApiUrl}/sandbox/exec`,
                {
                  command: args.command,
                  args: args.args,
                  cwd: args.workDir,
                  image: args.image,
                  timeout: args.timeout,
                  provider: sandbox.provider,
                },
                requestTimeout
              );

              if (!result) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: 'Sandbox service returned empty response.',
                    },
                  ],
                  isError: true,
                };
              }

              let output = '';
              const classification = result.classification || (result.success ? 'succeeded' : 'failed');
              if (result.success) {
                output = classification === 'started_with_timeout'
                  ? `Command reached running state at timeout boundary (exit code: ${result.exitCode})\n`
                  : `Command executed successfully (exit code: ${result.exitCode})\n`;
                output += `Duration: ${result.duration || 0}ms\n\n`;
                if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
                if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
                if (classification === 'started_with_timeout') {
                  output += 'Detected long-running service startup. Continue with explicit health checks.\n';
                }
              } else {
                output = `Command failed (exit code: ${result.exitCode})\n`;
                if (result.error) output += `Error: ${result.error}\n`;
                if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
                if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              }
              output += `Classification: ${classification}\n`;
              if (typeof result.timedOut === 'boolean') output += `Timed out: ${result.timedOut}\n`;
              if (typeof result.started === 'boolean') output += `Started: ${result.started}\n`;
              if (result.healthPassed !== null && result.healthPassed !== undefined) {
                output += `Health check: ${result.healthPassed ? 'passed' : 'failed'}`;
                if (result.healthUrl) output += ` (${result.healthUrl})`;
                output += '\n';
              }

              return {
                content: [{ type: 'text' as const, text: output }],
                isError: !result.success,
              };
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Sandbox service unavailable: ${errorMsg}`,
                  },
                ],
                isError: true,
              };
            }
          }
        ),
      ],
    });
  }

  private async postSandboxJson<T>(
    url: string,
    payload: unknown,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Sandbox service error: HTTP ${response.status}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('aborted')) {
        throw new Error(`Sandbox request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * 处理 SDK 消息并转换为 AgentMessage
   */
  private *processSdkMessage(
    message: unknown,
    sessionId: string,
    sentTextHashes: Set<string>,
    sentToolIds: Set<string>,
    contextManager?: import('../../../services/context-manager').ContextManager
  ): Generator<AgentMessage> {
    const msg = message as {
      type: string;
      message?: { content?: unknown[] };
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      [key: string]: unknown;
    };

    // 只在开发模式下输出详细调试日志（通过环境变量控制）
    if (process.env.DEBUG_SDK_MESSAGES === 'true') {
      console.log(`[Claude ${sessionId}] Raw SDK message:`, JSON.stringify(msg, null, 2));
    }

    // 处理 assistant 消息
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        // 跳过 thinking 块，不输出到日志也不发送给前端
        if ('type' in block && block.type === 'thinking') {
          continue;
        }
        if ('text' in block) {
          const text = this.sanitizeText(block.text as string);
          const textHash = text.slice(0, 100);
          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            // 只在文本较长时输出日志，减少噪音
            if (text.length > 50) {
              console.log(`[Claude ${sessionId}] Text: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
            }
            yield {
              id: this.generateMessageId(),
              type: 'text' as AgentMessageType,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
            };
          }
        } else if ('name' in block && 'id' in block) {
          const toolId = block.id as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            const toolName = block.name as string;
            const toolInput = block.input as Record<string, unknown>;
            // 简化工具调用日志，只显示关键信息
            const inputSummary = toolInput.command
              ? `command: ${String(toolInput.command).slice(0, 60)}${String(toolInput.command).length > 60 ? '...' : ''}`
              : toolInput.pattern
              ? `pattern: ${String(toolInput.pattern).slice(0, 40)}`
              : `${Object.keys(toolInput).length} params`;
            console.log(`[Claude ${sessionId}] Tool: ${toolName} (${inputSummary})`);
            contextManager?.onToolUse(toolName, toolId, toolInput);
            yield {
              id: this.generateMessageId(),
              type: 'tool_use' as AgentMessageType,
              toolName: toolName,
              toolUseId: toolId,
              toolInput: toolInput,
              timestamp: Date.now(),
            };
          }
        }
      }
    }

    // 处理 user 消息中的 tool_result
    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ('type' in block && block.type === 'tool_result') {
          const toolUseId =
            (block as { tool_use_id?: unknown }).tool_use_id ||
            (block as { toolUseId?: unknown }).toolUseId ||
            '';
          const isError =
            (block as { is_error?: unknown }).is_error ||
            (block as { isError?: unknown }).isError ||
            false;
          // 只在出错时输出日志，减少正常情况的噪音
          if (isError) {
            console.log(`[Claude ${sessionId}] Tool result ERROR for: ${String(toolUseId).slice(0, 30)}`);
          }
          contextManager?.onToolResult(
            toolUseId as string,
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          );
          yield {
            id: this.generateMessageId(),
            type: 'tool_result' as AgentMessageType,
            toolUseId: toolUseId as string,
            toolOutput:
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
            timestamp: Date.now(),
          };
        }
      }
    }

    // 处理 result 消息 - 不发送给前端，也不输出日志
    if (msg.type === 'result') {
      // Result 消息只包含执行状态，不包含有用内容，跳过
      // 最后的 assistant text 消息会作为实际结果
    }

    // 处理其他可能包含内容的消息类型
    if (msg.type === 'content' || msg.type === 'response') {
      console.log(`[Claude ${sessionId}] Content/Response message:`, msg);
      if (typeof msg.content === 'string' && msg.content.trim()) {
        const text = this.sanitizeText(msg.content);
        const textHash = text.slice(0, 100);
        if (!sentTextHashes.has(textHash)) {
          sentTextHashes.add(textHash);
          yield {
            id: this.generateMessageId(),
            type: 'text' as AgentMessageType,
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
          };
        }
      }
    }
  }

  /**
   * 清理文本内容
   */
  private sanitizeText(text: string): string {
    let sanitized = text;

    // 检测 API Key 相关错误
    const apiKeyPatterns = [
      /Invalid API key/i,
      /invalid_api_key/i,
      /authentication.*fail/i,
      /Unauthorized/i,
      /身份验证失败/,
      /认证失败/,
      /密钥无效/,
    ];

    const hasApiKeyError = apiKeyPatterns.some((pattern) =>
      pattern.test(sanitized)
    );

    // 替换进程退出错误
    sanitized = sanitized.replace(
      /Claude Code process exited with code \d+/gi,
      '__AGENT_PROCESS_ERROR__'
    );

    // 移除 /login 提示
    sanitized = sanitized.replace(/\s*[·•\-–—]\s*Please run \/login\.?/gi, '');
    sanitized = sanitized.replace(/Please run \/login\.?/gi, '');

    if (hasApiKeyError) {
      return '__API_KEY_ERROR__';
    }

    return sanitized;
  }

  /**
   * 映射错误
   */
  private mapError(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'An unexpected error occurred';
    }

    const errorMessage = error.message;

    // API Key 相关错误
    const apiKeyPatterns = [
      /Invalid API key/i,
      /invalid_api_key/i,
      /authentication.*fail/i,
      /Unauthorized/i,
      /Please run \/login/i,
      /身份验证失败/,
      /认证失败/,
      /密钥无效/,
    ];

    if (apiKeyPatterns.some((pattern) => pattern.test(errorMessage))) {
      return '__API_KEY_ERROR__';
    }

    // 进程退出错误
    if (errorMessage.includes('exited with code')) {
      if (this.isUsingCustomApi()) {
        return `__CUSTOM_API_ERROR__|${this.config.baseUrl}`;
      }
      return '__AGENT_PROCESS_ERROR__';
    }

    // Claude Code 未找到
    if (errorMessage.includes('claude') && errorMessage.includes('not found')) {
      return '__CLAUDE_CODE_NOT_FOUND__';
    }

    return errorMessage;
  }
}

/**
 * Claude Provider 能力（更新后）
 */
const CLAUDE_CAPABILITIES: AgentCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsVision: true,
  supportsSystemPrompt: true,
  supportsSession: true,
  supportsPlanning: true,
  supportsParallelToolCalls: true,
  supportsSkills: true,
  supportsSandbox: true,
  supportsMcp: true,
  maxContextLength: 200000,
  supportedModels: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-haiku-20240307',
  ],
};

/**
 * Claude Provider 实现类
 */
export class ClaudeProvider implements IAgentProvider {
  readonly type = 'claude' as const;
  readonly name = 'Claude (Anthropic)';
  private _state: ProviderState = 'uninitialized';
  private config?: AgentProviderConfig;

  get state(): ProviderState {
    return this._state;
  }

  async isAvailable(): Promise<boolean> {
    const apiKey = this.config?.apiKey || process.env.ANTHROPIC_API_KEY;
    return !!apiKey;
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    this._state = 'initializing';
    try {
      this.config = config as AgentProviderConfig | undefined;
      this._state = 'ready';
    } catch (error) {
      this._state = 'error';
      throw error;
    }
  }

  async stop(): Promise<void> {
    this._state = 'stopped';
  }

  async shutdown(): Promise<void> {
    this.config = undefined;
    this._state = 'stopped';
  }

  getCapabilities(): AgentCapabilities {
    return CLAUDE_CAPABILITIES;
  }

  createAgent(config: AgentProviderConfig): ClaudeAgent {
    const mergedConfig = {
      ...this.config,
      ...config,
    };
    return new ClaudeAgent(mergedConfig);
  }

  validateConfig(config: AgentProviderConfig): boolean {
    return !!(config.apiKey && config.model);
  }

  getDefaultModel(): string {
    return 'claude-sonnet-4-20250514';
  }

  getSupportedModels(): string[] {
    return CLAUDE_CAPABILITIES.supportedModels || [];
  }
}

/**
 * 导出 Provider 工厂函数（用于插件注册）
 */
export function createClaudeProvider(config?: AgentProviderConfig): ClaudeProvider {
  const provider = new ClaudeProvider();
  if (config) {
    provider.init(config as unknown as Record<string, unknown>);
  }
  return provider;
}
