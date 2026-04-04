# Deliverable Type System & Runtime Gate Redesign

**Date**: 2026-04-04  
**Status**: Design Approved  
**Author**: Claude (with user collaboration)

## Problem Statement

EasyWork's current runtime gate mechanism has three critical issues:

1. **Misclassification**: Keyword-based detection (`isRuntimeRunIntent`) cannot distinguish between "runnable static files" (HTML that opens in browser) and "services requiring startup" (npm run dev)
2. **Sandbox incompatibility**: Agent attempts to start long-running background processes in sandbox, causing timeouts and triggering unnecessary auto-repair loops
3. **Unclear task boundaries**: Agent doesn't know when to stop (e.g., generating HTML file vs. starting HTTP server to preview it)

### Real-world failure case

User request: "帮我写个贪吃蛇的小游戏"

Expected behavior:
- Generate `snake_game.html`
- Tell user to open it in browser
- Task complete

Actual behavior:
1. Agent generates HTML ✓
2. Agent tries to start `python3 -m http.server 8080 &` in sandbox ✗
3. Sandbox times out (background processes not supported)
4. Runtime gate detects "No healthy local endpoint"
5. Auto repair triggered → Agent retries entire task
6. Loop repeats until max attempts exhausted

**Root cause**: Plan contains "可运行的贪吃蛇小游戏" → keyword "运行" triggers runtime gate, even though deliverable is a static HTML file.

## Solution: Deliverable Type System

### Core Concept

Replace keyword-based runtime gate detection with **explicit deliverable type classification** in the task plan.

```typescript
type DeliverableType = 
  | 'static_files'      // HTML/PDF/images, no server needed
  | 'local_service'     // Requires local dev server (npm run dev)
  | 'deployed_service'  // Requires remote deployment
  | 'script_execution'  // One-time script execution
  | 'data_output'       // Data analysis/processing results
  | 'unknown'           // Unclear (conservative fallback)
```

**Runtime gate policy**:
- `static_files`, `script_execution`, `data_output` → **No runtime gate**
- `local_service`, `deployed_service` → **Enable runtime gate**
- `unknown` → **Enable runtime gate** (conservative fallback)

## Architecture Changes

### 1. Type Definitions (shared-types)

```typescript
// shared-types/src/agent.ts

export type DeliverableType = 
  | 'static_files'
  | 'local_service' 
  | 'deployed_service'
  | 'script_execution'
  | 'data_output'
  | 'unknown'

export interface TaskPlan {
  id: string
  goal: string
  steps: PlanStep[]
  notes?: string
  deliverableType?: DeliverableType  // NEW: Optional for backward compatibility
  createdAt: string
}
```

### 2. System Prompt Enhancement

**File**: `src-api/src/core/agent/system-prompt.ts`

Add deliverable type classification guidance:

```markdown
## Task Planning Requirements

When creating a task plan, you MUST classify the deliverable type:

### Deliverable Types

**static_files**: Output is static files that can be opened directly
- Examples: "Create a snake game HTML file", "Generate a PDF report", "Export images"
- No server startup required
- User opens files directly (double-click, file:// protocol)

**local_service**: Output requires starting a local development server
- Examples: "Build a React app", "Create a Flask API", "Set up Next.js project"
- Requires `npm run dev`, `python app.py`, etc.
- Accessed via http://localhost:PORT

**deployed_service**: Output needs deployment to remote server
- Examples: "Deploy to production", "Publish to Vercel", "Push to Heroku"
- Requires deployment commands and remote health checks

**script_execution**: One-time script execution with output
- Examples: "Run data migration", "Execute batch processing", "Convert file formats"
- Script runs once and exits

**data_output**: Data analysis or processing results
- Examples: "Analyze CSV and generate report", "Process images", "Extract data"
- Output is data files or analysis results

**unknown**: When deliverable type is unclear
- Will enable runtime gate as conservative fallback

### How to specify

Include `deliverableType` in your plan JSON:

```json
{
  "goal": "创建一个可运行的贪吃蛇小游戏",
  "deliverableType": "static_files",
  "steps": [...]
}
```

### Classification rules

- If output can be opened directly without starting a server → `static_files`
- If output requires `npm run dev` or similar → `local_service`
- If task involves deployment → `deployed_service`
- If task is one-time script → `script_execution`
- If task produces data/analysis → `data_output`
- If unclear → `unknown`
```

### 3. Runtime Gate Decision Logic

**File**: `src-api/src/services/execution-entry.ts`

```typescript
function shouldEnableRuntimeGate(plan: TaskPlan): boolean {
  // 1. Explicit type takes precedence
  if (plan.deliverableType) {
    return plan.deliverableType === 'local_service' || 
           plan.deliverableType === 'deployed_service'
  }
  
  // 2. Fallback to legacy keyword detection (backward compatibility)
  return isRuntimeRunIntentLegacy(plan)
}

// Rename existing function for clarity
function isRuntimeRunIntentLegacy(plan: TaskPlan): boolean {
  if (isBrowserAutomationIntent(plan.goal, plan)) {
    return false
  }

  const corpus = stripUrls(
    [plan.goal, plan.notes, ...plan.steps.map((step) => step.description)]
      .filter(Boolean)
      .join('\n')
  ).toLowerCase()
  
  const runHint = /运行|启动|可跑起来|本地启动|\brun\b|\bstart\b|\bserve\b|\bpreview\b|\bdev\s+server\b/.test(corpus)
  const targetHint = /项目|仓库|前端|后端|服务|页面|界面|应用|\bproject\b|\brepo(?:sitory)?\b|\bfrontend\b|\bbackend\b|\bserver\b|\bservice\b|\bweb\b|\bapp\b|\bapi\b/.test(corpus)
  
  return runHint && targetHint
}
```

### 4. Sandbox Policy Enhancement

**File**: `src-api/src/core/agent/policy/tool-execution-policy.ts`

Add long-running command detection:

```typescript
function isLongRunningCommand(command: string): boolean {
  const patterns = [
    /\bhttp\.server\b/,
    /\bnpm\s+run\s+dev\b/,
    /\bpnpm\s+dev\b/,
    /\byarn\s+dev\b/,
    /\bvite\b/,
    /\bnext\s+dev\b/,
    /\bnuxt\s+dev\b/,
    /\bflask\s+run\b/,
    /\buvicorn\b/,
    /\bgunicorn\b/,
    /\bdjango.*runserver\b/,
    /&\s*$/  // Background execution suffix
  ]
  return patterns.some(pattern => pattern.test(command))
}

export function evaluateToolExecutionPolicy(
  input: ToolExecutionPolicyInput
): ToolExecutionPolicyResult {
  // ... existing logic ...
  
  // NEW: Block long-running commands in sandbox
  const isSandboxTool = 
    input.toolName === 'sandbox_run_command' || 
    input.toolName === 'mcp__sandbox__sandbox_run_command'
  
  if (input.sandboxEnabled && isSandboxTool) {
    const command = input.input.command as string
    if (isLongRunningCommand(command)) {
      return {
        decision: 'deny',
        reason: `Long-running command detected: "${command}". Sandbox does not support background processes. Please suggest the user run this command manually in their terminal.`,
        riskLevel: 'medium',
      }
    }
  }
  
  // ... rest of existing logic ...
}
```

Add sandbox limitations to system prompt:

```markdown
## Sandbox Limitations

The sandbox environment does NOT support:
- Long-running background processes (dev servers, watchers)
- Commands with `&` suffix for background execution
- Interactive commands requiring user input

When you need to start a development server:
1. Generate all necessary files
2. Provide clear instructions for the user to run the command manually
3. Example: "Run `npm run dev` in your terminal to start the server at http://localhost:5173"

DO NOT attempt to start servers in sandbox - it will timeout and trigger unnecessary retries.
```

### 5. Auto Repair Improvements

**File**: `src-api/src/services/execution-attempt-loop.ts`

```typescript
export interface RunExecutionAttemptLoopInput {
  // ... existing fields ...
  deliverableType?: DeliverableType  // NEW
}

export async function runExecutionAttemptLoop(
  input: RunExecutionAttemptLoopInput
): Promise<RunExecutionAttemptLoopResult> {
  const now = input.now || (() => new Date())
  const buildRepairPrompt = input.buildRuntimeRepairPrompt
    || ((executionPrompt, gate) => executionPrompt)

  let abortedByUser = false
  let executionFailed = false
  let executionFailureReason = ''
  let runtimeGatePassed = !input.runtimeGateRequired
  let runtimeGateResult: RuntimeGateResult | null = null

  for (let attempt = 0; attempt < input.maxExecutionAttempts; attempt += 1) {
    const observation = input.createObservation()
    const isRepairAttempt = attempt > 0
    const promptForAttempt = isRepairAttempt && runtimeGateResult
      ? buildRepairPrompt(input.executionPrompt, runtimeGateResult, input.executionWorkspaceDir)
      : input.executionPrompt

    if (isRepairAttempt && runtimeGateResult) {
      const timestamp = now()
      await input.emitMessage(
        createRuntimeAutoRepairMessage(attempt + 1, runtimeGateResult.reason, input.createId, timestamp)
      )
      await input.appendProgressEntry(input.progressPath, [
        `### Runtime Auto Repair (${timestamp.toISOString()})`,
        `- Attempt: ${attempt + 1}/${input.maxExecutionAttempts}`,
        `- Reason: ${runtimeGateResult.reason}`,
      ])
    }

    let attemptFailed = false
    for await (const message of input.streamExecution(promptForAttempt)) {
      if (input.isAborted()) {
        abortedByUser = true
        break
      }

      input.collectObservation(message, observation)
      const processingResult = await input.handleMessage(message, observation)
      if (processingResult.executionFailed) {
        executionFailed = true
        executionFailureReason = processingResult.executionFailureReason || 'Execution failed before completion.'
        attemptFailed = true
      }

      if (!processingResult.shouldForward) {
        continue
      }

      await input.emitMessage(message)
    }

    if (abortedByUser || executionFailed || attemptFailed) {
      break
    }

    if (!input.runtimeGateRequired) {
      runtimeGatePassed = true
      break
    }

    runtimeGateResult = await input.evaluateRuntimeGate(observation, input.effectiveWorkDir)
    
    if (runtimeGateResult.passed) {
      runtimeGatePassed = true
      const timestamp = now()
      await input.appendProgressEntry(input.progressPath, [
        `### Runtime Verification (${timestamp.toISOString()})`,
        '- Status: passed',
        `- Healthy URLs: ${runtimeGateResult.healthyUrls.join(', ') || '(none)'}`,
      ])
      input.executionSummary.resultMessageCount += 1
      await input.emitMessage(
        createRuntimePassedMessage(runtimeGateResult.previewUrl, input.createId, timestamp)
      )
      break
    }

    // NEW: Distinguish between required and optional failures
    const isOptionalFailure = 
      input.deliverableType === 'static_files' || 
      input.deliverableType === 'data_output' ||
      input.deliverableType === 'script_execution'
    
    if (isOptionalFailure) {
      // Optional failure: log warning but don't retry
      const timestamp = now()
      await input.appendProgressEntry(input.progressPath, [
        `### Runtime Verification (${timestamp.toISOString()})`,
        '- Status: skipped (optional for this deliverable type)',
        `- Deliverable Type: ${input.deliverableType}`,
        `- Reason: ${runtimeGateResult.reason}`,
      ])
      runtimeGatePassed = true  // Mark as passed to avoid retry
      break
    }

    // Required failure: continue retry logic
    if (attempt < input.maxExecutionAttempts - 1) {
      continue
    }

    // Final attempt failed
    executionFailed = true
    executionFailureReason = `Runtime verification failed: ${runtimeGateResult.reason}`
    const timestamp = now()
    await input.appendProgressEntry(input.progressPath, [
      `### Runtime Verification (${timestamp.toISOString()})`,
      '- Status: failed',
      `- Reason: ${runtimeGateResult.reason}`,
      `- Checked URLs: ${runtimeGateResult.checkedUrls.join(', ') || '(none)'}`,
      `- Healthy URLs: ${runtimeGateResult.healthyUrls.join(', ') || '(none)'}`,
    ])
    await input.emitMessage(
      createRuntimeFailedMessage(executionFailureReason, input.createId, timestamp)
    )
  }

  return {
    abortedByUser,
    executionFailed,
    executionFailureReason,
    runtimeGatePassed,
    runtimeGateResult,
  }
}
```

### 6. Runtime Gate Relaxed Mode

**File**: `src-api/src/services/execution-runtime-gate.ts`

```typescript
export async function evaluateRuntimeGate(
  observation: ExecutionObservation,
  workDir: string,
  deliverableType?: DeliverableType  // NEW parameter
): Promise<RuntimeGateResult> {
  // NEW: Relaxed mode for static deliverables
  if (deliverableType === 'static_files' || 
      deliverableType === 'data_output' ||
      deliverableType === 'script_execution') {
    // Only fail if there are obvious errors (port conflicts)
    if (observation.portConflicts.length === 0) {
      return {
        passed: true,
        reason: 'Static deliverable type, no port conflicts detected.',
        checkedUrls: [],
        healthyUrls: [],
        previewUrl: null,
        frontendExpected: false,
        frontendHealthy: false,
        backendExpected: false,
        backendHealthy: false,
      }
    }
  }

  // Strict mode for service deliverables (existing logic)
  const candidates = buildUrlCandidates(observation)
    .filter((url) => !shouldExcludeRuntimeUrl(url, workDir))
  const healthy: string[] = []

  for (const url of candidates) {
    if (await probeUrlHealth(url)) {
      healthy.push(url)
    }
  }

  const frontendExpected = observation.frontendCommandCount > 0
  const backendExpected = observation.backendCommandCount > 0
  const frontendHealthy = healthy.some((url) => {
    try {
      const parsed = new URL(url)
      return !parsed.pathname.startsWith('/api')
    } catch {
      return false
    }
  })
  const backendHealthy = healthy.some((url) => {
    try {
      const parsed = new URL(url)
      return parsed.pathname.startsWith('/api') || parsed.pathname.startsWith('/health')
    } catch {
      return false
    }
  })

  const hasAnyHealthy = healthy.length > 0
  let passed = true
  let reason = 'Runtime verification passed.'

  if (frontendExpected && !frontendHealthy) {
    passed = false
    reason = 'Frontend server did not pass health check after execution.'
  } else if (backendExpected && !backendHealthy) {
    passed = false
    reason = 'Backend server did not pass health check after execution.'
  } else if (!frontendExpected && !backendExpected && !hasAnyHealthy) {
    passed = false
    reason = 'No healthy local endpoint detected after run execution.'
  } else if (observation.portConflicts.length > 0 && !hasAnyHealthy) {
    passed = false
    reason = 'Port conflict detected and no healthy endpoint recovered.'
  }

  const previewUrl = frontendHealthy
    ? healthy.find((url) => {
        try {
          return !new URL(url).pathname.startsWith('/api')
        } catch {
          return false
        }
      }) || null
    : null

  return {
    passed,
    reason,
    checkedUrls: candidates,
    healthyUrls: healthy,
    previewUrl,
    frontendExpected,
    frontendHealthy,
    backendExpected,
    backendHealthy,
  }
}
```

### 7. Error Correction (Optional Enhancement)

**File**: `src-api/src/services/execution-entry.ts`

Add validation to catch obvious agent classification errors:

```typescript
function validateDeliverableType(plan: TaskPlan): {
  valid: boolean
  correctedType?: DeliverableType
  reason?: string
} {
  if (!plan.deliverableType) {
    return {
      valid: false,
      correctedType: 'unknown',
      reason: 'Agent did not specify deliverable type'
    }
  }
  
  const corpus = [plan.goal, plan.notes, ...plan.steps.map(s => s.description)]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  
  // Rule 1: Contains "HTML 文件" but classified as local_service
  if (plan.deliverableType === 'local_service' && 
      /html\s*文件|静态.*html|单.*html/.test(corpus) &&
      !/npm|yarn|pnpm|webpack|vite|server/.test(corpus)) {
    return {
      valid: false,
      correctedType: 'static_files',
      reason: 'Detected static HTML file generation, corrected to static_files'
    }
  }
  
  // Rule 2: Contains "启动服务" but classified as static_files
  if (plan.deliverableType === 'static_files' &&
      /启动.*服务|npm.*dev|本地.*服务器/.test(corpus)) {
    return {
      valid: false,
      correctedType: 'local_service',
      reason: 'Detected service startup requirement, corrected to local_service'
    }
  }
  
  return { valid: true }
}

// Use in resolveExecutionEntry:
export async function resolveExecutionEntry(
  input: ResolveExecutionEntryInput
): Promise<RunExecutionSessionInput> {
  // ... existing logic ...
  
  // NEW: Validate and correct deliverable type
  const validation = validateDeliverableType(passthrough.plan)
  if (!validation.valid && validation.correctedType) {
    console.warn(`[ExecutionEntry] ${validation.reason}`)
    passthrough.plan.deliverableType = validation.correctedType
  }
  
  const runtimeGateRequired = shouldEnableRuntimeGate(passthrough.plan)
  
  // ... rest of logic ...
}
```

## Data Flow

### Before (Current System)

```
User: "帮我写个贪吃蛇游戏"
    ↓
Plan: { goal: "创建一个可运行的贪吃蛇小游戏" }
    ↓
isRuntimeRunIntent() → keyword "运行" detected → runtimeGateRequired = true
    ↓
Agent executes → generates HTML → tries to start http.server
    ↓
Sandbox times out (background process not supported)
    ↓
Runtime gate: "No healthy endpoint" → FAILED
    ↓
Auto repair triggered → Agent retries entire task
    ↓
Loop repeats → Max attempts exhausted → Task fails
```

### After (Deliverable Type System)

```
User: "帮我写个贪吃蛇游戏"
    ↓
Plan: { 
  goal: "创建一个可运行的贪吃蛇小游戏",
  deliverableType: "static_files"  ← Agent classifies
}
    ↓
shouldEnableRuntimeGate(plan) → deliverableType === "static_files" → runtimeGateRequired = false
    ↓
Agent executes → generates HTML
    ↓
Agent tries to start http.server → Sandbox policy BLOCKS:
  "Long-running command detected. Please suggest user run manually."
    ↓
Agent adjusts → outputs: "直接用浏览器打开 HTML 文件即可游玩"
    ↓
Task completes (no runtime gate, no auto repair)
```

## Testing Strategy

### Unit Tests

**File**: `src-api/src/services/__tests__/execution-entry.test.ts`

```typescript
describe('shouldEnableRuntimeGate', () => {
  it('disables runtime gate for static_files deliverable', () => {
    const plan: TaskPlan = {
      id: 'test',
      goal: '创建贪吃蛇游戏',
      steps: [],
      deliverableType: 'static_files',
      createdAt: new Date().toISOString()
    }
    expect(shouldEnableRuntimeGate(plan)).toBe(false)
  })
  
  it('enables runtime gate for local_service deliverable', () => {
    const plan: TaskPlan = {
      id: 'test',
      goal: '创建 React 应用',
      steps: [],
      deliverableType: 'local_service',
      createdAt: new Date().toISOString()
    }
    expect(shouldEnableRuntimeGate(plan)).toBe(true)
  })
  
  it('enables runtime gate for deployed_service deliverable', () => {
    const plan: TaskPlan = {
      id: 'test',
      goal: '部署到生产环境',
      steps: [],
      deliverableType: 'deployed_service',
      createdAt: new Date().toISOString()
    }
    expect(shouldEnableRuntimeGate(plan)).toBe(true)
  })
  
  it('falls back to legacy detection when deliverableType is missing', () => {
    const plan: TaskPlan = {
      id: 'test',
      goal: '启动前端项目',
      steps: [],
      createdAt: new Date().toISOString()
    }
    expect(shouldEnableRuntimeGate(plan)).toBe(true)
  })
  
  it('disables runtime gate for script_execution deliverable', () => {
    const plan: TaskPlan = {
      id: 'test',
      goal: '运行数据迁移脚本',
      steps: [],
      deliverableType: 'script_execution',
      createdAt: new Date().toISOString()
    }
    expect(shouldEnableRuntimeGate(plan)).toBe(false)
  })
})

describe('validateDeliverableType', () => {
  it('corrects local_service to static_files for HTML file generation', () => {
    const plan: TaskPlan = {
      id: 'test',
      goal: '创建一个 HTML 文件',
      steps: [],
      deliverableType: 'local_service',
      createdAt: new Date().toISOString()
    }
    const result = validateDeliverableType(plan)
    expect(result.valid).toBe(false)
    expect(result.correctedType).toBe('static_files')
  })
  
  it('corrects static_files to local_service when service startup detected', () => {
    const plan: TaskPlan = {
      id: 'test',
      goal: '启动 React 开发服务器',
      steps: [],
      deliverableType: 'static_files',
      createdAt: new Date().toISOString()
    }
    const result = validateDeliverableType(plan)
    expect(result.valid).toBe(false)
    expect(result.correctedType).toBe('local_service')
  })
})
```

**File**: `src-api/src/core/agent/policy/__tests__/tool-execution-policy.test.ts`

```typescript
describe('isLongRunningCommand', () => {
  it('detects http.server as long-running', () => {
    expect(isLongRunningCommand('python3 -m http.server 8080')).toBe(true)
  })
  
  it('detects npm run dev as long-running', () => {
    expect(isLongRunningCommand('npm run dev')).toBe(true)
  })
  
  it('detects background execution suffix', () => {
    expect(isLongRunningCommand('node server.js &')).toBe(true)
  })
  
  it('allows short-lived commands', () => {
    expect(isLongRunningCommand('npm install')).toBe(false)
    expect(isLongRunningCommand('git status')).toBe(false)
  })
})

describe('evaluateToolExecutionPolicy - sandbox long-running commands', () => {
  it('blocks long-running commands in sandbox', () => {
    const result = evaluateToolExecutionPolicy({
      toolName: 'sandbox_run_command',
      input: { command: 'npm run dev' },
      sandboxEnabled: true,
      sessionDir: '/tmp/session',
      approvalEnabled: false,
      autoAllowTools: new Set(),
      configuredMcpServers: []
    })
    
    expect(result.decision).toBe('deny')
    expect(result.reason).toContain('Long-running command detected')
    expect(result.reason).toContain('suggest the user run this command manually')
  })
  
  it('allows long-running commands when sandbox is disabled', () => {
    const result = evaluateToolExecutionPolicy({
      toolName: 'Bash',
      input: { command: 'npm run dev' },
      sandboxEnabled: false,
      sessionDir: '/tmp/session',
      approvalEnabled: false,
      autoAllowTools: new Set(['Bash']),
      configuredMcpServers: []
    })
    
    expect(result.decision).toBe('allow')
  })
})
```

### Integration Test Scenarios

1. **Static file generation (snake game)**
   - User: "帮我写个贪吃蛇游戏"
   - Expected: HTML generated, no server startup, no runtime gate, task completes
   
2. **Local service startup (React app)**
   - User: "创建一个 React 应用并启动开发服务器"
   - Expected: Files generated, dev server started, runtime gate verifies http://localhost:5173, task completes
   
3. **Classification error correction**
   - Agent classifies HTML generation as `local_service`
   - Expected: System auto-corrects to `static_files`, no runtime gate
   
4. **Sandbox blocking**
   - Agent tries `python3 -m http.server 8080 &` in sandbox
   - Expected: Policy blocks with helpful message, agent adjusts strategy
   
5. **Legacy fallback**
   - Old plan without `deliverableType` field
   - Expected: Falls back to keyword detection, maintains backward compatibility

## Migration Path

### Phase 1: Soft Launch (Week 1)
- Add `deliverableType` field to `TaskPlan` (optional)
- Update system prompt with classification guidance
- Keep legacy `isRuntimeRunIntent` as fallback
- Monitor agent classification accuracy

### Phase 2: Sandbox Protection (Week 2)
- Deploy long-running command detection in sandbox policy
- Add system prompt guidance about sandbox limitations
- Monitor blocked commands and agent adaptation

### Phase 3: Runtime Gate Refinement (Week 3)
- Implement relaxed mode for static deliverables
- Add optional failure handling in auto repair loop
- Deploy error correction for obvious misclassifications

### Phase 4: Validation (Week 4)
- Analyze metrics: classification accuracy, false positives, auto repair frequency
- If accuracy > 90%, consider making `deliverableType` required
- If accuracy < 80%, refine system prompt or add more correction rules

## Success Metrics

- **Classification accuracy**: > 90% of plans have correct `deliverableType`
- **Auto repair reduction**: < 5% of tasks trigger unnecessary auto repair
- **Sandbox timeout reduction**: 0 timeouts from long-running commands
- **User satisfaction**: Fewer "agent keeps retrying" complaints

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agent misclassifies deliverable type | Validation rules auto-correct obvious errors; fallback to legacy detection |
| Breaking change for existing code | `deliverableType` is optional; legacy detection remains as fallback |
| System prompt too complex | Provide clear examples and decision tree; iterate based on agent behavior |
| Edge cases not covered | Monitor production logs; add new deliverable types as needed |

## Future Enhancements

1. **User override**: Allow users to manually specify deliverable type in UI
2. **Learning from corrections**: Track validation corrections to improve system prompt
3. **Deliverable-specific tooling**: Different tool sets for different deliverable types
4. **Token budget optimization**: Allocate different budgets based on deliverable complexity

## References

- Original issue: Runtime gate triggered for static HTML generation
- Related: Sandbox timeout handling, auto repair loop optimization
- Harness engineering principles: Clear task boundaries, explicit over implicit
