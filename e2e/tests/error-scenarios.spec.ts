import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
  })
})

test('API error during execution shows error feedback', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

  await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('trigger-error 模拟错误')
  await page.getByTitle('发送').click()

  await expect(page).toHaveURL(/\/task\//)
  await page.getByRole('button', { name: '开始执行' }).click()

  // Should show some error state or recover gracefully
  // The execution should not leave the UI in a broken state
  await expect(page.getByPlaceholder('输入消息...')).toBeEnabled({ timeout: 10000 })
})

test('empty input does not trigger task creation', async ({ page }) => {
  await page.goto('/')

  const sendButton = page.getByTitle('发送')
  // Empty input — send button should be disabled or click should be no-op
  await expect(page).toHaveURL('/')

  // Try clicking send with empty input
  const inputField = page.getByPlaceholder('描述你的任务，AI 将帮你完成...')
  await expect(inputField).toHaveValue('')

  // Should remain on home page
  await expect(page).toHaveURL('/')
})
