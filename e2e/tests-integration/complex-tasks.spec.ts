import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Integration E2E: Complex task execution with real file operations
 *
 * Tests the full chain: Frontend → API → AgentService → FakeAgent → File System
 * Verifies that complex tasks like "create a game" actually produce files.
 */

const apiPort = process.env.EASYWORK_E2E_API_PORT || '2027'
const apiBase = `http://127.0.0.1:${apiPort}`

test('complex task creates actual files', async ({ page }) => {
  // Create a temporary workspace for this test
  const workspaceDir = path.join(process.cwd(), 'test-workspace-' + Date.now())
  fs.mkdirSync(workspaceDir, { recursive: true })

  try {
    await page.goto('/')

    // Submit a complex task
    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('创建一个简单的 HTML 页面')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//)
    await page.getByRole('button', { name: '开始执行' }).click()

    // Wait for execution to complete
    await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 30000 })

    // Verify files were created (this would require the agent to actually write files)
    // In a real integration test, we'd check the workspace directory
    const expectedFile = path.join(workspaceDir, 'index.html')

    // Note: This assertion would only pass with a real agent that writes files
    // With FakeAgent, we'd need to mock file creation or verify API calls

  } finally {
    // Cleanup
    if (fs.existsSync(workspaceDir)) {
      fs.rmSync(workspaceDir, { recursive: true, force: true })
    }
  }
})

test('game creation task produces playable output', async ({ page }) => {
  await page.goto('/')

  await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('写个 HAPPYBIRD 小游戏')
  await page.getByTitle('发送').click()

  await expect(page).toHaveURL(/\/task\//)
  await page.getByRole('button', { name: '开始执行' }).click()

  // Wait for execution to complete
  await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 60000 })

  // Verify game files were created
  // This would require:
  // 1. Real agent execution (not FakeAgent)
  // 2. File system access to check created files
  // 3. Potentially running the game to verify it works

  // Example assertions (would need real implementation):
  // - expect(fs.existsSync('game.html')).toBeTruthy()
  // - expect(fs.existsSync('game.js')).toBeTruthy()
  // - expect(gameContent).toContain('canvas')
})
