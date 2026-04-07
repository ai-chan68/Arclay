import { describe, it, expect } from 'vitest'
import { evaluateToolExecutionPolicy } from '../tool-execution-policy'

describe('Tool Execution Policy - Long Running Commands', () => {
  const baseInput = {
    sandboxEnabled: true,
    sessionDir: '/tmp/session',
    approvalEnabled: false,
    autoAllowTools: new Set<string>(),
    configuredMcpServers: [],
  }

  describe('Long-running command detection', () => {
    it('should block python http.server in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'python3 -m http.server 8080' },
      })

      expect(result.decision).toBe('deny')
      expect(result.reason).toContain('Long-running command detected')
      expect(result.reason).toContain('suggest the user run this command manually')
      expect(result.riskLevel).toBe('medium')
    })

    it('should block npm run dev in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'npm run dev' },
      })

      expect(result.decision).toBe('deny')
      expect(result.reason).toContain('Long-running command detected')
    })

    it('should block pnpm dev in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'pnpm dev' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block yarn dev in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'yarn dev' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block vite in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'vite' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block next dev in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'next dev' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block flask run in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'flask run' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block uvicorn in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'uvicorn app:app' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block django runserver in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'python manage.py runserver' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block background execution with & suffix', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'node server.js &' },
      })

      expect(result.decision).toBe('deny')
    })

    it('should block mcp__sandbox__sandbox_run_command alias', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'mcp__sandbox__sandbox_run_command',
        input: { command: 'npm run dev' },
      })

      expect(result.decision).toBe('deny')
    })
  })

  describe('Short-lived commands', () => {
    it('should allow npm install in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'npm install' },
      })

      expect(result.decision).toBe('allow')
    })

    it('should allow git status in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'git status' },
      })

      expect(result.decision).toBe('allow')
    })

    it('should allow npm run build in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'npm run build' },
      })

      expect(result.decision).toBe('allow')
    })

    it('should allow python script.py in sandbox', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        toolName: 'sandbox_run_command',
        input: { command: 'python script.py' },
      })

      expect(result.decision).toBe('allow')
    })
  })

  describe('Non-sandbox execution', () => {
    it('should allow long-running commands when sandbox is disabled', () => {
      const result = evaluateToolExecutionPolicy({
        ...baseInput,
        sandboxEnabled: false,
        toolName: 'Bash',
        input: { command: 'npm run dev' },
        autoAllowTools: new Set(['Bash']),
      })

      expect(result.decision).toBe('allow')
    })
  })
})
