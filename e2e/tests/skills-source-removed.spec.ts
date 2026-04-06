/**
 * Verify Skills Source Management Panel is Removed
 */

import { test, expect } from '@playwright/test'

test.describe('Skills Source Management Removal', () => {
  test('should not show skill source management panel', async ({ page }) => {
    await page.goto('http://localhost:1420')
    await page.waitForLoadState('networkidle')

    // Open settings
    const settingsButton = page.locator('button[aria-label="设置"], button:has-text("设置")').first()
    await settingsButton.click()

    // Wait for settings modal
    await page.waitForSelector('text=设置')

    // Navigate to Skills tab
    await page.locator('button:has-text("Skills")').click()
    await page.waitForSelector('text=Skills')

    // Verify "技能来源管理" is NOT present
    await expect(page.locator('text=技能来源管理')).not.toBeVisible()

    // Verify "来源名称" input is NOT present
    await expect(page.locator('input[placeholder="来源名称"]')).not.toBeVisible()

    // Verify "添加来源" button is NOT present
    await expect(page.locator('button:has-text("添加来源")')).not.toBeVisible()

    // Verify the simplified import button IS present
    await expect(page.locator('button:has-text("导入已有")')).toBeVisible()
  })
})
