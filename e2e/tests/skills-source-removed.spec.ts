/**
 * Verify Skills Source Management Panel is Removed
 */

import { test, expect } from '@playwright/test'

async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
}

test.describe('Skills Source Management Removal', () => {
  test('should not show skill source management panel', async ({ page }) => {
    await page.goto('http://localhost:1420')
    await page.waitForLoadState('networkidle')

    await openSettings(page)

    // Navigate to Skills tab
    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByText('保存 Skills 设置').waitFor()

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
