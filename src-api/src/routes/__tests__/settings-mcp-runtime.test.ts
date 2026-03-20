import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockSettings = {
  activeProviderId: string | null
  providers: Array<{
    id: string
    name: string
    provider: string
    apiKey: string
    model: string
    baseUrl?: string
    enabled: boolean
    createdAt: number
    updatedAt: number
  }>
  mcp?: {
    enabled: boolean
    mcpServers: Record<string, {
      type: 'stdio' | 'http' | 'sse'
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
    }>
  }
  skills?: {
    enabled: boolean
  }
  sandbox?: {
    enabled: boolean
    provider?: 'native' | 'claude' | 'docker' | 'e2b'
    apiEndpoint?: string
    image?: string
  }
}

const createAgentServiceMock = vi.fn(() => ({ id: 'agent-service' }))
const setNewAgentServiceMock = vi.fn()
const setSettingsMock = vi.fn()
const saveSettingsToFileMock = vi.fn()

let mockSettings: MockSettings | null = null
let activeProvider: MockSettings['providers'][number] | null = null

vi.mock('../../services/agent-service', () => ({
  createAgentService: createAgentServiceMock,
}))

vi.mock('../agent-new', () => ({
  setAgentService: setNewAgentServiceMock,
}))

vi.mock('../../config', () => ({
  getWorkDir: () => '/tmp/easywork-workdir',
  getProjectRoot: () => '/tmp/easywork-project',
}))

vi.mock('../../settings-store', () => ({
  getSettings: () => mockSettings,
  setSettings: setSettingsMock,
  saveSettingsToFile: saveSettingsToFileMock,
  getActiveProviderConfig: () => activeProvider,
  getDefaultSkillRoutingSettings: () => ({
    mode: 'assist',
    topN: 3,
    minScore: 0.35,
    llmRerank: false,
    includeExplain: true,
    fallback: 'all_enabled',
  }),
  normalizeSkillSettings: (settings?: { enabled?: boolean }) => ({
    enabled: settings?.enabled ?? true,
    routing: {
      mode: 'assist',
      topN: 3,
      minScore: 0.35,
      llmRerank: false,
      includeExplain: true,
      fallback: 'all_enabled',
    },
    sources: [],
  }),
  normalizeApprovalSettings: () => ({
    enabled: true,
    autoAllowTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'LS', 'LSP'],
    timeoutMs: 600000,
  }),
  normalizeSandboxSettings: (settings?: MockSettings['sandbox']) => ({
    enabled: settings?.enabled ?? false,
    provider: settings?.provider ?? 'native',
    apiEndpoint: settings?.apiEndpoint ?? 'http://localhost:2026/api',
    image: settings?.image,
  }),
}))

vi.mock('../../services/skills-service', () => ({
  getAllSkills: vi.fn(() => []),
  getSkillsStats: vi.fn(() => ({})),
  importSkill: vi.fn(),
  deleteSkill: vi.fn(),
}))

vi.mock('../../skills/router', () => ({
  routeSkillsForPrompt: vi.fn(),
}))

vi.mock('../../skills/ecosystem-service', () => ({
  installSkillFromSource: vi.fn(),
  updateSkillFromSources: vi.fn(),
  repairSkillFromSources: vi.fn(),
  validateSourceForInstall: vi.fn(),
}))

describe('Settings MCP runtime integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSettings = {
      activeProviderId: 'provider-1',
      providers: [
        {
          id: 'provider-1',
          name: 'Claude',
          provider: 'claude',
          apiKey: 'sk-test-key',
          model: 'claude-sonnet',
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      mcp: {
        enabled: true,
        mcpServers: {
          feishu: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@company/feishu-mcp'],
          },
        },
      },
      skills: {
        enabled: true,
      },
      sandbox: {
        enabled: false,
      },
    }

    activeProvider = mockSettings.providers[0]
  })

  it('recreates the agent service after saving MCP settings for the active provider', async () => {
    const { settingsRoutes } = await import('../settings')

    const response = await settingsRoutes.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockSettings?.mcp),
    })

    expect(response.status).toBe(200)
    expect(createAgentServiceMock).toHaveBeenCalledTimes(1)
    expect(createAgentServiceMock.mock.calls[0]?.[3]).toEqual({
      enabled: true,
      userDirEnabled: false,
      appDirEnabled: false,
      mcpServers: {
        feishu: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@company/feishu-mcp'],
          env: undefined,
          url: undefined,
          headers: undefined,
        },
      },
    })
    expect(setNewAgentServiceMock).toHaveBeenCalledTimes(1)
  })

  it('keeps MCP runtime config when activating a provider', async () => {
    const { settingsRoutes } = await import('../settings')

    const response = await settingsRoutes.request('/providers/provider-1/activate', {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(createAgentServiceMock).toHaveBeenCalledTimes(1)
    expect(createAgentServiceMock.mock.calls[0]?.[3]).toEqual({
      enabled: true,
      userDirEnabled: false,
      appDirEnabled: false,
      mcpServers: {
        feishu: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@company/feishu-mcp'],
          env: undefined,
          url: undefined,
          headers: undefined,
        },
      },
    })
  })
})
