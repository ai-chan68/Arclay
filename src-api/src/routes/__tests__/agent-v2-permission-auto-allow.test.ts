import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../settings-store'

describe('V2 Agent Permission Auto Allow', () => {
  let app: Hono
  let oldHome: string | undefined
  let tempHome = ''
  let approvalCoordinator: {
    capturePermissionRequest: (permission: {
      id: string
      type: 'file_write' | 'file_delete' | 'command_exec' | 'network_access' | 'other'
      title: string
      description: string
      metadata?: Record<string, unknown>
    }) => void
  }
  let getSettings: () => Settings | null

  beforeAll(async () => {
    oldHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-agent-v2-permission-'))
    process.env.HOME = tempHome

    vi.resetModules()
    const routesModule = await import('../agent-new')
    const coordinatorModule = await import('../../services/approval-coordinator')
    const settingsModule = await import('../../settings-store')

    approvalCoordinator = coordinatorModule.approvalCoordinator
    getSettings = settingsModule.getSettings

    app = new Hono()
    app.route('/api/v2/agent', routesModule.agentNewRoutes)
  })

  afterAll(() => {
    process.env.HOME = oldHome
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('adds tool to auto-allow list when approved with addToAutoAllow', async () => {
    const permissionId = `perm_${Date.now()}_bash`
    approvalCoordinator.capturePermissionRequest({
      id: permissionId,
      type: 'command_exec',
      title: '请求执行工具: Bash',
      description: 'Tool Bash requires approval.',
      metadata: {
        toolName: 'Bash',
      },
    })

    const res = await app.request('/api/v2/agent/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permissionId,
        approved: true,
        addToAutoAllow: true,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      success?: boolean
      autoAllowUpdated?: boolean
      autoAllowToolName?: string | null
    }
    expect(body.success).toBe(true)
    expect(body.autoAllowUpdated).toBe(true)
    expect(body.autoAllowToolName).toBe('Bash')

    const settings = getSettings()
    expect(settings?.approval?.autoAllowTools).toContain('Bash')
  })

  it('does not update auto-allow list when permission is rejected', async () => {
    const permissionId = `perm_${Date.now()}_edit`
    approvalCoordinator.capturePermissionRequest({
      id: permissionId,
      type: 'file_write',
      title: '请求执行工具: Edit',
      description: 'Tool Edit requires approval.',
      metadata: {
        toolName: 'Edit',
      },
    })

    const res = await app.request('/api/v2/agent/permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permissionId,
        approved: false,
        addToAutoAllow: true,
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      success?: boolean
      autoAllowUpdated?: boolean
      autoAllowToolName?: string | null
    }
    expect(body.success).toBe(true)
    expect(body.autoAllowUpdated).toBe(false)
    expect(body.autoAllowToolName).toBeNull()

    const settings = getSettings()
    expect(settings?.approval?.autoAllowTools || []).not.toContain('Edit')
  })
})
