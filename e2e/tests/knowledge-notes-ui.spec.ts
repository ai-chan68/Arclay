import { test, expect } from '@playwright/test'

async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
}

test.describe('Knowledge Notes UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420')
    await page.waitForLoadState('networkidle')
  })

  test('should show Knowledge Notes tab in settings', async ({ page }) => {
    await openSettings(page)

    // Click Knowledge Notes tab
    const knowledgeTab = page.getByRole('button', { name: 'Knowledge Notes' })
    await expect(knowledgeTab).toBeVisible()
    await knowledgeTab.click()

    // Verify global section is visible
    await expect(page.getByText('全局 Knowledge Notes')).toBeVisible()
    await expect(page.getByText('全局级别的知识笔记，对所有任务生效')).toBeVisible()
  })

  test('should create global knowledge note', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: 'Knowledge Notes' }).click()

    // Wait for the component to load
    await page.waitForSelector('text=知识笔记')

    // Click create button in global section (first one)
    const createButton = page.locator('button:has-text("添加 Note")').first()
    await createButton.click()

    // Wait for modal
    const noteDialog = page.getByRole('dialog', { name: '新建知识笔记' })
    await expect(noteDialog).toBeVisible()

    // Fill form
    await noteDialog.getByLabel('标题').fill('Test Global Note')
    await noteDialog.getByLabel('类型').selectOption('context')
    await noteDialog.getByLabel('内容').fill('This is a test global context note')

    // Submit
    await noteDialog.getByRole('button', { name: '创建' }).click()

    // Wait for modal to close
    await expect(noteDialog).toBeHidden()

    // Verify note appears in list
    await expect(page.locator('text=Test Global Note').first()).toBeVisible()
  })

  test('should create and delete knowledge note', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: 'Knowledge Notes' }).click()
    await page.waitForSelector('text=知识笔记')

    // Create a note with unique title
    const uniqueTitle = `E2E Test ${Date.now()}`
    const createButton = page.locator('button:has-text("添加 Note")').first()
    await createButton.click()
    const noteDialog = page.getByRole('dialog', { name: '新建知识笔记' })
    await expect(noteDialog).toBeVisible()

    await noteDialog.getByLabel('标题').fill(uniqueTitle)
    await noteDialog.getByLabel('类型').selectOption('context')
    await noteDialog.getByLabel('内容').fill('Will be deleted')
    await noteDialog.getByRole('button', { name: '创建' }).click()
    await expect(noteDialog).toBeHidden()

    // Verify note was created
    await expect(page.locator(`text=${uniqueTitle}`).first()).toBeVisible()

    // Handle the confirm dialog
    page.on('dialog', dialog => dialog.accept())

    // Delete the specific note we just created
    const noteRow = page.locator('[class*="rounded-lg"][class*="border"]').filter({ hasText: uniqueTitle }).first()
    await noteRow.getByRole('button', { name: '删除笔记' }).click()

    // Wait for deletion
    await page.waitForTimeout(1000)

    // Verify note is gone
    await expect(page.locator(`text=${uniqueTitle}`)).toHaveCount(0)
  })
})
