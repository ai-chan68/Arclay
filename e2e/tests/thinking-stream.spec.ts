/**
 * Thinking Stream E2E Test
 *
 * Verifies that thinking messages are captured and displayed in the UI
 */

import { expect, test } from '@playwright/test'

test.describe('Thinking Stream Display', () => {
  test('should display thinking process in ThinkingSection', async ({ page }) => {
    await page.goto('/')

    // Wait for home page
    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    // Submit a simple task
    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('创建一个 hello.txt 文件，内容是 Hello World')
    await page.getByTitle('发送').click()

    // Wait for task page
    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    // Wait for thinking section to appear
    const thinkingSection = page.locator('button:has-text("思考过程"), button:has-text("思考中")')
    await expect(thinkingSection).toBeVisible({ timeout: 15000 })

    // Click to expand thinking section if collapsed
    const isCollapsed = await thinkingSection.locator('svg').first().isVisible()
    if (isCollapsed) {
      await thinkingSection.click()
    }

    // Verify tool calls are displayed
    await expect(page.locator('text=/Write|Bash|Read/')).toBeVisible({ timeout: 10000 })

    // Verify thinking section shows completion status
    await expect(page.locator('text=/思考过程|正常|异常/')).toBeVisible({ timeout: 20000 })
  })

  test('should show tool execution results', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible()

    // Submit task
    await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('列出当前目录的文件')
    await page.getByTitle('发送').click()

    await expect(page).toHaveURL(/\/task\//, { timeout: 10000 })

    // Wait for thinking section
    await expect(page.locator('button:has-text("思考过程"), button:has-text("思考中")')).toBeVisible({ timeout: 15000 })

    // Verify execution status indicators (success/error icons)
    await expect(page.locator('text=/执行完成|执行失败/')).toBeVisible({ timeout: 20000 })
  })
})
