import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
  })
})

test('workspace plus button opens dialog and creates a workspace', async ({ page }) => {
  await page.goto('/')

  const createButton = page.getByRole('button', { name: '新建工作区' })
  await createButton.click()

  const dialog = page.getByRole('dialog', { name: '新建工作区' })
  await expect(dialog).toBeVisible()

  const workspaceName = `工作区-${Date.now()}`
  await dialog.getByLabel('工作区名称').fill(workspaceName)
  await expect(dialog.getByRole('button', { name: '选择目录' })).toBeVisible()
  await dialog.getByLabel('默认目录').fill('/tmp/arclay-workspace-test')
  await dialog.getByRole('button', { name: '创建工作区' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('combobox', { name: '工作区切换' }).locator('option:checked')).toHaveText(workspaceName)
})

test('deleting a workspace falls back to the default workspace', async ({ page }) => {
  await page.goto('/')

  const createButton = page.getByRole('button', { name: '新建工作区' })
  await createButton.click()

  const dialog = page.getByRole('dialog', { name: '新建工作区' })
  await expect(dialog).toBeVisible()

  const workspaceName = `工作区-${Date.now()}`
  await dialog.getByLabel('工作区名称').fill(workspaceName)
  await dialog.getByRole('button', { name: '创建工作区' }).click()

  await expect(dialog).toBeHidden()
  const switcher = page.getByRole('combobox', { name: '工作区切换' })
  await expect(switcher.locator('option:checked')).toHaveText(workspaceName)

  const deleteButton = page.getByRole('button', { name: '删除工作区' })
  await deleteButton.click()

  const deleteDialog = page.getByRole('dialog', { name: '删除工作区' })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByRole('button', { name: '删除并迁移任务' }).click()

  await expect(deleteDialog).toBeHidden({ timeout: 10000 })
  await expect(switcher.locator('option:checked')).toHaveText('默认工作区')
  await expect(switcher.locator('option', { hasText: workspaceName })).toHaveCount(0)
})
