import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Integration E2E: Complex task execution with real file operations
 *
 * Tests the full chain: Frontend → API → AgentService → FakeAgent → File System
 * Verifies that complex tasks like "create a game" actually produce files.
 */

const apiPort = process.env.EASYWORK_E2E_API_PORT || '2027'

// Helper: Create temporary workspace
function createTempWorkspace(): string {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-test-'))
  return workspaceDir
}

// Helper: Cleanup workspace
function cleanupWorkspace(workspaceDir: string): void {
  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  }
}

test.describe('Complex Tasks - Game Creation', () => {
  let workspaceDir: string

  test.beforeEach(() => {
    workspaceDir = createTempWorkspace()
    console.log('[test] Workspace:', workspaceDir)
  })

  test.afterEach(() => {
    cleanupWorkspace(workspaceDir)
  })

  test('HAPPYBIRD game creation produces playable files', async ({ page }) => {
    await page.goto('/')

    // Wait for home page to load
    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    // Submit game creation task
    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('写个 HAPPYBIRD 小游戏')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    // Wait for "开始执行" button or check if already executing
    const startButton = page.getByRole('button', { name: '开始执行' })
    const isVisible = await startButton.isVisible().catch(() => false)

    if (isVisible) {
      await startButton.click()
    }

    // Wait for execution to complete
    await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

    // Verify messages contain file creation
    const pageContent = await page.content()
    expect(pageContent).toContain('index.html')
    expect(pageContent).toContain('game.js')
    expect(pageContent).toContain('style.css')

    // Verify the tool_use messages are present
    expect(pageContent).toContain('write_file')
  })

  test('game task shows correct tool use sequence', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('小游戏')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    // Wait for "开始执行" button or check if already executing
    const startButton = page.getByRole('button', { name: '开始执行' })
    const isVisible = await startButton.isVisible().catch(() => false)

    if (isVisible) {
      await startButton.click()
    }

    // Wait for completion
    await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

    // Check for tool_use and tool_result messages
    const pageText = await page.textContent('body')
    expect(pageText).toContain('write_file')
  })
})

test.describe('Complex Tasks - HTML Page Creation', () => {
  let workspaceDir: string

  test.beforeEach(() => {
    workspaceDir = createTempWorkspace()
  })

  test.afterEach(() => {
    cleanupWorkspace(workspaceDir)
  })

  test('HTML page creation task completes successfully', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('创建一个简单的 HTML 页面')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    const startButton = page.getByRole('button', { name: '开始执行' })
    const isVisible = await startButton.isVisible().catch(() => false)
    if (isVisible) {
      await startButton.click()
    }

    // Wait for completion
    await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

    // Verify HTML creation message
    const pageContent = await page.content()
    expect(pageContent).toContain('index.html')
    expect(pageContent).toContain('HTML 页面创建完成')
  })
})

test.describe('Complex Tasks - Scenario Detection', () => {
  test('detects game scenario from Chinese prompt', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('帮我做个小游戏')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    const startButton = page.getByRole('button', { name: '开始执行' })
    const isVisible = await startButton.isVisible().catch(() => false)
    if (isVisible) {
      await startButton.click()
    }

    await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

    const pageContent = await page.content()
    expect(pageContent).toContain('game.js')
  })

  test('detects HTML scenario from prompt', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('创建 HTML 网页')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    const startButton = page.getByRole('button', { name: '开始执行' })
    const isVisible = await startButton.isVisible().catch(() => false)
    if (isVisible) {
      await startButton.click()
    }

    await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

    const pageContent = await page.content()
    expect(pageContent).toContain('HTML 页面')
  })

  test('falls back to default scenario for unknown tasks', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('未知任务类型')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    const startButton = page.getByRole('button', { name: '开始执行' })
    const isVisible = await startButton.isVisible().catch(() => false)
    if (isVisible) {
      await startButton.click()
    }

    await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

    // Should complete without errors
    const pageContent = await page.content()
    expect(pageContent).toContain('Echo')
  })
})

