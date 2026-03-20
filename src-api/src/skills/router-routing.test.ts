import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAllSkillsMock = vi.fn()
const refreshSkillIndexMock = vi.fn()
const loadSkillRuntimeMock = vi.fn()
const getSkillRuntimeEntryMock = vi.fn()

vi.mock('./skill-scanner', () => ({
  getAllSkills: getAllSkillsMock,
}))

vi.mock('./index-store', () => ({
  refreshSkillIndex: refreshSkillIndexMock,
  loadSkillRuntime: loadSkillRuntimeMock,
  getSkillRuntimeEntry: getSkillRuntimeEntryMock,
}))

describe('routeSkillsForPrompt', () => {
  beforeEach(() => {
    vi.resetModules()
    getAllSkillsMock.mockReset()
    refreshSkillIndexMock.mockReset()
    loadSkillRuntimeMock.mockReset()
    getSkillRuntimeEntryMock.mockReset()

    getAllSkillsMock.mockReturnValue([
      {
        id: 'project:web-search',
        name: 'web-search',
        path: '/skills/web-search',
      },
      {
        id: 'project:playwright-cli',
        name: 'playwright-cli',
        path: '/skills/playwright-cli',
      },
    ])

    refreshSkillIndexMock.mockReturnValue({
      skills: [
        {
          skillId: 'project:web-search',
          name: 'web-search',
          description: 'Search and extract webpage content',
          tags: ['web', 'search'],
          intents: ['打开网页', '搜索网页'],
          examples: ['打开 https://example.com'],
          providerCompatibility: ['claude'],
        },
        {
          skillId: 'project:playwright-cli',
          name: 'playwright-cli',
          description: 'Automate browser interactions for internal web apps',
          tags: ['browser', 'automation'],
          intents: ['点击按钮', '填写表单', '网页自动化'],
          examples: ['打开内部系统并点击查询'],
          providerCompatibility: ['claude'],
        },
      ],
    })

    loadSkillRuntimeMock.mockReturnValue({ skills: {} })
    getSkillRuntimeEntryMock.mockReturnValue({
      successCount: 0,
      failureCount: 0,
      lastUsedAt: 0,
    })
  })

  it('prefers browser automation over web-search for internal interactive pages', async () => {
    const { routeSkillsForPrompt } = await import('./router')

    const result = routeSkillsForPrompt({
      prompt: '打开https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch，点击出库批次号，输入批次号并查询',
      provider: 'claude',
      projectRoot: '/tmp/project',
    })

    expect(result.selected[0]?.skillId).toBe('project:playwright-cli')
    expect(result.selected.some((skill) => skill.skillId === 'project:web-search')).toBe(false)
  })
})
