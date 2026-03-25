/**
 * Memory Tool — system prompt instructions for Agent memory operations
 *
 * Rather than registering custom SDK tools (which requires MCP server setup),
 * we guide the Agent to use existing file tools (read/write/edit) with
 * memory.md as the target. This is simpler and more reliable.
 *
 * The Agent can:
 *   - Save facts: use Edit tool to append to memory.md
 *   - Recall facts: use Read tool to read memory.md
 *   - Search: use Grep tool to search memory.md
 */

/**
 * Get the system prompt section for memory tool usage.
 * This instructs the Agent how to save and recall memories
 * using existing file tools.
 */
export function getMemoryToolInstruction(workDir: string): string {
  return `## Memory System

You have access to a persistent memory file at \`${workDir}/memory.md\` that survives across sessions.

### Saving Memories
When you learn something important that should be remembered for future sessions, use the **Edit** tool to append to \`${workDir}/memory.md\`:

**What to save:**
- User preferences and working style
- Key decisions and their rationale
- Important facts about the project or environment
- Lessons learned from errors or debugging

**Format:** Append a new section using this pattern:
\`\`\`
### [YYYY-MM-DDTHH:MM:SSZ] category
content here
\`\`\`

Where category is one of: \`fact\`, \`preference\`, \`decision\`, \`lesson\`

### Recalling Memories
At the start of complex tasks, use **Read** to check \`${workDir}/memory.md\` for relevant context.
Use **Grep** to search memory for specific topics: \`grep -i "keyword" ${workDir}/memory.md\`

### Guidelines
- Save sparingly — only facts that would be useful in a future session
- Don't save ephemeral task details (those are in progress.md)
- Don't duplicate what's already in task_plan.md or findings.md
- Keep each entry concise (2-5 lines)
`
}
