import { access, mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import path from 'path'

export interface PlanningFilesBootstrapInput {
  workDir: string
  taskId: string
  goal: string
  steps: string[]
  notes?: string
  originalPrompt?: string
}

export interface PlanningFilesBootstrapResult {
  sessionDir: string
  createdFiles: string[]
  skippedFiles: string[]
  error?: string
}

function isSessionPath(targetPath: string): boolean {
  return /[\\/]sessions[\\/]/.test(targetPath)
}

function summarizeLine(value: string | undefined, maxLength = 260): string {
  if (!value) return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

function normalizeSteps(rawSteps: string[]): string[] {
  const normalized = rawSteps
    .map((step) => summarizeLine(step, 120))
    .filter((step) => step.length > 0)

  if (normalized.length > 0) {
    return normalized
  }

  return [
    'Clarify requirements and constraints',
    'Execute implementation tasks and collect evidence',
    'Validate outcomes and prepare final delivery',
  ]
}

function resolveSessionWorkDir(baseWorkDir: string, taskId: string): string {
  const trimmedWorkDir = baseWorkDir.trim()
  const resolvedBase = trimmedWorkDir.startsWith('~')
    ? path.join(homedir(), trimmedWorkDir.slice(1))
    : trimmedWorkDir

  if (isSessionPath(resolvedBase)) {
    return resolvedBase
  }

  return path.join(resolvedBase, 'sessions', taskId)
}

function renderTaskPlanContent(input: PlanningFilesBootstrapInput, now: Date): string {
  const steps = normalizeSteps(input.steps)
  const phaseBlocks = steps
    .map((step, index) => {
      const status = index === 0 ? 'in_progress' : 'pending'
      return `### Phase ${index + 1}: ${step}
- [ ] ${step}
- **Status:** ${status}`
    })
    .join('\n\n')

  const notesLine = summarizeLine(input.notes, 260)
  const requestLine = summarizeLine(input.originalPrompt, 260)

  return `# Task Plan

## Goal
${summarizeLine(input.goal, 260)}

## Current Phase
Phase 1

## Phases

${phaseBlocks}

## Key Questions
- [ ] Which constraints could block delivery?
- [ ] Which acceptance checks prove the outcome is complete?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
|          |           |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       | 1       |            |

## Notes
- Bootstrap initialized at ${now.toISOString()}
${notesLine ? `- Plan notes: ${notesLine}` : '- Plan notes: (none)'}
${requestLine ? `- Original request: ${requestLine}` : '- Original request: (none)'}
`
}

function renderFindingsContent(input: PlanningFilesBootstrapInput, now: Date): string {
  const requestLine = summarizeLine(input.originalPrompt, 260)

  return `# Findings & Decisions

## Requirements
- Goal: ${summarizeLine(input.goal, 260)}
- Scope constraints: (to be discovered)

## Research Findings
- Pending

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
|          |           |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
- Session initialized at ${now.toISOString()}
${requestLine ? `- Original request: ${requestLine}` : '- Original request: (none)'}

## Visual/Browser Findings
- Pending
`
}

function renderProgressContent(input: PlanningFilesBootstrapInput, now: Date): string {
  const [firstStep] = normalizeSteps(input.steps)
  const sessionDate = now.toISOString().slice(0, 10)

  return `# Progress Log

## Session: ${sessionDate}

### Phase 1: ${firstStep}
- **Status:** in_progress
- **Started:** ${now.toISOString()}
- Actions taken:
  - Initialized planning files before execution.
- Files created/modified:
  - task_plan.md
  - findings.md
  - progress.md

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
|      |       |          |        |        |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
|           |       | 1       |            |
`
}

async function ensureFile(
  filePath: string,
  content: string,
  result: PlanningFilesBootstrapResult
): Promise<void> {
  try {
    await access(filePath)
    result.skippedFiles.push(path.basename(filePath))
    return
  } catch {
    // File does not exist; create it below.
  }

  await writeFile(filePath, content, 'utf-8')
  result.createdFiles.push(path.basename(filePath))
}

export async function bootstrapPlanningFiles(
  input: PlanningFilesBootstrapInput
): Promise<PlanningFilesBootstrapResult> {
  const taskId = input.taskId.trim()
  const sessionDir = resolveSessionWorkDir(input.workDir, taskId)
  const now = new Date()
  const result: PlanningFilesBootstrapResult = {
    sessionDir,
    createdFiles: [],
    skippedFiles: [],
  }

  if (!taskId) {
    result.error = 'taskId is required for planning file bootstrap'
    return result
  }

  try {
    await mkdir(sessionDir, { recursive: true })

    await Promise.all([
      ensureFile(path.join(sessionDir, 'task_plan.md'), renderTaskPlanContent(input, now), result),
      ensureFile(path.join(sessionDir, 'findings.md'), renderFindingsContent(input, now), result),
      ensureFile(path.join(sessionDir, 'progress.md'), renderProgressContent(input, now), result),
    ])
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown bootstrap error'
  }

  return result
}
