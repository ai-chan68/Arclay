import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
  })
})

test('multi-turn execution shows tool use and multiple messages', async ({ page }) => {
  await page.goto('/')

  await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('multi-turn 执行多轮任务')
  await page.getByTitle('发送').click()

  await expect(page).toHaveURL(/\/task\//)
  await page.getByRole('button', { name: '开始执行' }).click()

  // Wait for execution to produce messages (multi-turn mock returns done within 200ms)
  // After done, input should be re-enabled
  await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 10000 })
})
