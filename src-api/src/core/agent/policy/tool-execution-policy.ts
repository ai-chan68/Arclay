import { resolve, relative, sep } from 'path'

export interface ToolExecutionPolicyInput {
  toolName: string
  input: Record<string, unknown>
  sandboxEnabled: boolean
  sessionDir: string
  approvalEnabled: boolean
  autoAllowTools: Set<string>
  configuredMcpServers: string[]
}

export interface ToolExecutionPolicyResult {
  decision: 'allow' | 'deny' | 'require_approval'
  reason: string
  riskLevel?: 'low' | 'medium' | 'high'
  blockedPath?: string
}

/**
 * Helper to check if a path is inside another directory
 */
function isPathInsideDirectory(targetPath: string, allowedDir: string): boolean {
  try {
    const resolvedTarget = resolve(targetPath)
    const resolvedAllowed = resolve(allowedDir)
    const rel = relative(resolvedAllowed, resolvedTarget)
    return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !rel.startsWith('/'))
  } catch {
    return false
  }
}

/**
 * Helper to get tool name aliases (consistent with ClaudeAgent.getToolNameAliases)
 */
function getToolNameAliases(toolName: string): string[] {
  const aliases = new Set<string>([toolName])

  if (toolName === 'sandbox_run_command') {
    aliases.add('mcp__sandbox__sandbox_run_command')
  } else if (toolName === 'mcp__sandbox__sandbox_run_command') {
    aliases.add('sandbox_run_command')
  } else if (toolName === 'sandbox_run_script') {
    aliases.add('mcp__sandbox__sandbox_run_script')
  } else if (toolName === 'mcp__sandbox__sandbox_run_script') {
    aliases.add('sandbox_run_script')
  }

  return [...aliases]
}

/**
 * Evaluate tool execution policy based on input context.
 * Centralizes trust boundary logic for the agent harness.
 */
export function evaluateToolExecutionPolicy(input: ToolExecutionPolicyInput): ToolExecutionPolicyResult {
  const { toolName, input: toolInput, sandboxEnabled, sessionDir, approvalEnabled, autoAllowTools, configuredMcpServers } = input

  // 1. Sandbox enforcement: Deny host Bash if sandbox is enabled
  if (sandboxEnabled && (toolName === 'Bash' || toolName === 'bash')) {
    return {
      decision: 'deny',
      reason: 'Sandbox mode is enabled. Use sandbox_run_command or sandbox_run_script instead of host Bash for security.',
      riskLevel: 'high',
    }
  }

  // 2. Write scope enforcement: Deny Write/Edit outside sessionDir
  if (['Write', 'Edit', 'MultiEdit', 'write', 'edit', 'multiedit'].includes(toolName.toLowerCase())) {
    const targetPath = (toolInput.file_path as string || toolInput.filePath as string || toolInput.path as string || '').trim()
    if (targetPath) {
      if (!isPathInsideDirectory(targetPath, sessionDir)) {
        return {
          decision: 'deny',
          reason: `File access to ${targetPath} is denied because it is outside the session directory: ${sessionDir}.`,
          riskLevel: 'high',
          blockedPath: targetPath,
        }
      }
    }
  }

  // 3. Bypass Approval: Skill tools always bypass
  if (toolName === 'Skill') {
    return {
      decision: 'allow',
      reason: 'Skill tool invocations always bypass explicit approval.',
      riskLevel: 'low',
    }
  }

  // 4. Auto-allow check (including aliases)
  const aliases = getToolNameAliases(toolName)
  if (aliases.some(alias => autoAllowTools.has(alias))) {
    return {
      decision: 'allow',
      reason: 'Tool is in the auto-allow list.',
      riskLevel: 'low',
    }
  }

  // 5. MCP Bypass check (for configured servers, excluding sandbox)
  if (toolName.startsWith('mcp__') && !toolName.startsWith('mcp__sandbox__')) {
    const serverName = toolName.split('__')[1]
    if (configuredMcpServers.includes(serverName)) {
      return {
        decision: 'allow',
        reason: `Tool belongs to configured MCP server: ${serverName}.`,
        riskLevel: 'low',
      }
    }
  }

  // 6. Default to approval if enabled, otherwise allow
  if (approvalEnabled) {
    return {
      decision: 'require_approval',
      reason: `Tool ${toolName} requires explicit user approval.`,
      riskLevel: 'medium',
    }
  }

  return {
    decision: 'allow',
    reason: 'Approval is disabled, allowing tool execution by default.',
    riskLevel: 'medium',
  }
}
