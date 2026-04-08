import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
  })
})

test('desktop-style task flow supports planning and aborting execution', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

  await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('帮我执行一个模拟任务')
  await page.getByTitle('发送').click()

  await expect(page).toHaveURL(/\/task\//)
  await expect(page.getByRole('button', { name: '开始执行' })).toBeVisible()

  await page.getByRole('button', { name: '开始执行' }).click()

  await expect(page.getByTitle('停止')).toBeVisible()
  await expect(page.getByPlaceholder('输入消息...')).toBeDisabled()

  await page.getByTitle('停止').click()

  await expect(page.getByTitle('停止')).toHaveCount(0)
  await expect(page.getByPlaceholder('输入消息...')).toBeEnabled()
})
