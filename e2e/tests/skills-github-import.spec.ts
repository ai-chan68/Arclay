/**
 * Skills GitHub Import E2E Test
 */

import { test, expect } from '@playwright/test'

async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
}

test.describe('Skills GitHub Import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420')
    await page.waitForLoadState('networkidle')
  })

  test('should show two import methods in import dialog', async ({ page }) => {
    await openSettings(page)

    // Navigate to Skills tab
    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByText('保存 Skills 设置').waitFor()

    // Click import button
    const importButton = page.locator('button:has-text("导入已有")')
    await importButton.click()

    // Wait for import dialog
    await page.waitForSelector('text=导入 Skill')

    // Verify two import method buttons are visible
    await expect(page.locator('button:has-text("从文件夹导入")')).toBeVisible()
    await expect(page.locator('button:has-text("从 GitHub 导入")')).toBeVisible()

    // Verify folder import is selected by default
    const folderButton = page.locator('button:has-text("从文件夹导入")')
    await expect(folderButton).toHaveClass(/border-\[color:var\(--ui-accent\)\]/)
  })

  test('should switch between folder and GitHub import methods', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByText('保存 Skills 设置').waitFor()

    // Click import button
    const importButton = page.locator('button:has-text("导入已有")')
    await importButton.click()
    await page.waitForSelector('text=导入 Skill')

    // Initially on folder import
    await expect(page.locator('label:has-text("Skill 文件夹")')).toBeVisible()
    await expect(page.locator('input[placeholder*="点击右侧按钮"]')).toBeVisible()

    // Switch to GitHub import
    await page.locator('button:has-text("从 GitHub 导入")').click()
    await expect(page.locator('label:has-text("GitHub URL")')).toBeVisible()
    await expect(page.locator('input[placeholder*="github.com"]')).toBeVisible()

    // Switch back to folder import
    await page.locator('button:has-text("从文件夹导入")').click()
    await expect(page.locator('label:has-text("Skill 文件夹")')).toBeVisible()
  })

  test('should accept GitHub URL in GitHub import mode', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByText('保存 Skills 设置').waitFor()

    // Click import button
    const importButton = page.locator('button:has-text("导入已有")')
    await importButton.click()
    await page.waitForSelector('text=导入 Skill')

    // Switch to GitHub import
    await page.locator('button:has-text("从 GitHub 导入")').click()

    // Enter a GitHub URL
    const input = page.locator('input[placeholder*="github.com"]')
    await input.fill('https://github.com/user/repo/tree/main/skills/test-skill')

    // Verify import button becomes enabled after entering valid input
    const submitButton = page.locator('button:has-text("导入")').last()
    await expect(submitButton).toBeEnabled()
  })

  test('should accept repository root URL', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByText('保存 Skills 设置').waitFor()

    // Click import button
    const importButton = page.locator('button:has-text("导入已有")')
    await importButton.click()
    await page.waitForSelector('text=导入 Skill')

    // Switch to GitHub import
    await page.locator('button:has-text("从 GitHub 导入")').click()

    // Enter a repository root URL (like baoyu-skills)
    const input = page.locator('input[placeholder*="github.com"]')
    await input.fill('https://github.com/JimLiu/baoyu-skills')

    // Verify import button becomes enabled
    const submitButton = page.locator('button:has-text("导入")').last()
    await expect(submitButton).toBeEnabled()
  })
})
