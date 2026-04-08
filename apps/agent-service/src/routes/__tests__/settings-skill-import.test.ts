import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeState } from '../../runtime/app-runtime'

const analyzeGitHubSkillSourceMock = vi.fn()
const downloadSkillsFromGitHubMock = vi.fn()
const cleanupTempDirMock = vi.fn()
const importSkillMock = vi.fn()
const loadSkillSourceBindingsMock = vi.fn(() => ({}))
const upsertSkillSourceBindingsMock = vi.fn()
const removeSkillSourceBindingMock = vi.fn()
const setSettingsMock = vi.fn()
const saveSettingsToFileMock = vi.fn()

let mockSettings: {
  activeProviderId: string | null
  providers: unknown[]
  skills?: {
    enabled: boolean
    routing: {
      mode: string
      topN: number
      minScore: number
      llmRerank: boolean
      includeExplain: boolean
      fallback: string
    }
    sources: Array<{
      id: string
      name: string
      type: 'local' | 'git' | 'http'
      location: string
      branch?: string
      trusted: boolean
      enabled: boolean
      createdAt: number
      updatedAt: number
    }>
  }
} | null = null

vi.mock('../../services/agent-service', () => ({
  createAgentService: vi.fn(),
}))

vi.mock('../../config', () => ({
  getWorkDir: () => '/tmp/arclay-workdir',
  getProjectRoot: () => '/tmp/arclay-project',
}))

vi.mock('../../settings-store', () => ({
  getSettings: () => mockSettings,
  setSettings: setSettingsMock,
  saveSettingsToFile: saveSettingsToFileMock,
  getActiveProviderConfig: () => null,
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
    sources: (settings as { sources?: unknown[] } | undefined)?.sources || [],
  }),
  normalizeApprovalSettings: () => ({
    enabled: true,
    autoAllowTools: [],
    timeoutMs: 600000,
  }),
  normalizeSandboxSettings: () => ({
    enabled: false,
    provider: 'native',
    apiEndpoint: 'http://localhost:2026/api',
  }),
}))

vi.mock('../../services/skills-service', () => ({
  getAllSkills: vi.fn(() => []),
  getSkillsStats: vi.fn(() => ({ total: 0, project: 0 })),
  importSkill: importSkillMock,
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

vi.mock('../../services/github-skill-importer', () => ({
  analyzeGitHubSkillSource: analyzeGitHubSkillSourceMock,
  downloadSkillsFromGitHub: downloadSkillsFromGitHubMock,
  cleanupTempDir: cleanupTempDirMock,
  parseGitHubUrl: (url: string) => ({
    owner: 'JimLiu',
    repo: 'baoyu-skills',
    branch: 'main',
    skillPath: '',
    branchExplicit: false,
  }),
}))

vi.mock('../../skills/source-binding-store', () => ({
  loadSkillSourceBindings: loadSkillSourceBindingsMock,
  upsertSkillSourceBindings: upsertSkillSourceBindingsMock,
  removeSkillSourceBinding: removeSkillSourceBindingMock,
}))

describe('Settings skill import flow', () => {
  const runtimeState: AgentRuntimeState = {
    agentService: null,
    agentServiceConfig: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings = {
      activeProviderId: null,
      providers: [],
      skills: {
        enabled: true,
        routing: {
          mode: 'assist',
          topN: 3,
          minScore: 0.35,
          llmRerank: false,
          includeExplain: true,
          fallback: 'all_enabled',
        },
        sources: [],
      },
    }
  })

  it('returns multiple install candidates when a GitHub repo contains multiple skills', async () => {
    analyzeGitHubSkillSourceMock.mockResolvedValue({
      mode: 'multiple',
      owner: 'JimLiu',
      repo: 'baoyu-skills',
      branch: 'main',
      analysisKey: 'analysis-1',
      skills: [
        { name: 'alpha', description: 'Alpha skill', path: 'skills/alpha', selected: true },
        { name: 'beta', description: 'Beta skill', path: 'skills/beta', selected: true },
      ],
    })

    const { createSettingsRoutes } = await import('../settings')
    const settingsRoutes = createSettingsRoutes({
      getAgentRuntimeState: () => runtimeState,
      setAgentRuntimeState: vi.fn(),
      workDir: '/tmp/arclay-workdir',
    })

    const response = await settingsRoutes.request('/skills/import/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'https://github.com/JimLiu/baoyu-skills' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mode: 'multiple',
      owner: 'JimLiu',
      repo: 'baoyu-skills',
      branch: 'main',
      analysisKey: 'analysis-1',
      skills: [
        { name: 'alpha', description: 'Alpha skill', path: 'skills/alpha', selected: true },
        { name: 'beta', description: 'Beta skill', path: 'skills/beta', selected: true },
      ],
    })
  })

  it('imports all selected GitHub skills in a single request', async () => {
    downloadSkillsFromGitHubMock.mockResolvedValue({
      tempRoot: '/tmp/skill-import-root',
      skillDirs: ['/tmp/skill-import-root/skills/alpha', '/tmp/skill-import-root/skills/beta'],
    })
    importSkillMock
      .mockReturnValueOnce({
        id: 'project:alpha',
        name: 'alpha',
        description: 'Alpha skill',
        source: 'project',
        path: '/tmp/arclay-project/SKILLs/alpha',
      })
      .mockReturnValueOnce({
        id: 'project:beta',
        name: 'beta',
        description: 'Beta skill',
        source: 'project',
        path: '/tmp/arclay-project/SKILLs/beta',
      })

    const { createSettingsRoutes } = await import('../settings')
    const settingsRoutes = createSettingsRoutes({
      getAgentRuntimeState: () => runtimeState,
      setAgentRuntimeState: vi.fn(),
      workDir: '/tmp/arclay-workdir',
    })

    const response = await settingsRoutes.request('/skills/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'https://github.com/JimLiu/baoyu-skills',
        analysisKey: 'analysis-1',
        skillPaths: ['skills/alpha', 'skills/beta'],
      }),
    })

    expect(response.status).toBe(200)
    expect(downloadSkillsFromGitHubMock).toHaveBeenCalledWith(
      'https://github.com/JimLiu/baoyu-skills',
      ['skills/alpha', 'skills/beta'],
      'analysis-1',
    )
    expect(importSkillMock).toHaveBeenCalledTimes(2)
    expect(importSkillMock).toHaveBeenNthCalledWith(1, '/tmp/skill-import-root/skills/alpha', '/tmp/arclay-project')
    expect(importSkillMock).toHaveBeenNthCalledWith(2, '/tmp/skill-import-root/skills/beta', '/tmp/arclay-project')
    expect(cleanupTempDirMock).toHaveBeenCalledWith('/tmp/skill-import-root')
    expect(setSettingsMock).toHaveBeenCalledTimes(1)
    expect(saveSettingsToFileMock).toHaveBeenCalledTimes(1)
    expect(upsertSkillSourceBindingsMock).toHaveBeenCalledWith('/tmp/arclay-project', {
      'project:alpha': expect.any(String),
      'project:beta': expect.any(String),
    })
    await expect(response.json()).resolves.toEqual({
      success: true,
      skills: [
        {
          id: 'project:alpha',
          name: 'alpha',
          source: 'project',
          path: '/tmp/arclay-project/SKILLs/alpha',
        },
        {
          id: 'project:beta',
          name: 'beta',
          source: 'project',
          path: '/tmp/arclay-project/SKILLs/beta',
        },
      ],
      skill: {
        id: 'project:alpha',
        name: 'alpha',
        source: 'project',
        path: '/tmp/arclay-project/SKILLs/alpha',
      },
    })
  })

  it('exposes GitHub-backed source capabilities in skills list', async () => {
    const skillsServiceModule = await import('../../services/skills-service')
    const getAllSkillsMock = vi.mocked(skillsServiceModule.getAllSkills)
    const getSkillsStatsMock = vi.mocked(skillsServiceModule.getSkillsStats)

    getAllSkillsMock.mockReturnValue([
      {
        id: 'project:alpha',
        name: 'alpha',
        description: 'Alpha skill',
        source: 'project',
        path: '/tmp/arclay-project/SKILLs/alpha',
      },
    ])
    getSkillsStatsMock.mockReturnValue({ total: 1, project: 1 })
    mockSettings = {
      activeProviderId: null,
      providers: [],
      skills: {
        enabled: true,
        routing: {
          mode: 'assist',
          topN: 3,
          minScore: 0.35,
          llmRerank: false,
          includeExplain: true,
          fallback: 'all_enabled',
        },
        sources: [{
          id: 'source_github_alpha',
          name: 'JimLiu/baoyu-skills',
          type: 'git',
          location: 'https://github.com/JimLiu/baoyu-skills.git',
          branch: 'main',
          trusted: true,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        }],
      },
    }
    loadSkillSourceBindingsMock.mockReturnValue({
      'project:alpha': 'source_github_alpha',
    })

    const { createSettingsRoutes } = await import('../settings')
    const settingsRoutes = createSettingsRoutes({
      getAgentRuntimeState: () => runtimeState,
      setAgentRuntimeState: vi.fn(),
      workDir: '/tmp/arclay-workdir',
    })

    const response = await settingsRoutes.request('/skills/list')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      skills: [{
        id: 'project:alpha',
        name: 'alpha',
        description: 'Alpha skill',
        source: 'project',
        path: '/tmp/arclay-project/SKILLs/alpha',
        sourceInfo: {
          sourceId: 'source_github_alpha',
          name: 'JimLiu/baoyu-skills',
          type: 'git',
          location: 'https://github.com/JimLiu/baoyu-skills.git',
          branch: 'main',
          canUpdate: true,
          canRepair: true,
        },
      }],
      stats: { total: 1, project: 1 },
    })
  })
})
