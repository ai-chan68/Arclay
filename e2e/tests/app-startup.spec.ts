import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
  })
})

test('desktop-style startup waits for API readiness and reaches home', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()
  await expect(page.getByPlaceholder('描述你的任务，AI 将帮你完成...')).toBeVisible()
})
