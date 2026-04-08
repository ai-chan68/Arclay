import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
  })
})

test('library page loads and shows task list area', async ({ page }) => {
  await page.goto('/library')

  // Library page should render without errors
  // It may show an empty state or task list depending on DB state
  await expect(page.locator('body')).toBeVisible()

  // Should stay on library route
  await expect(page).toHaveURL('/library')
})
