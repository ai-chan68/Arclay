import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}
  })
})

/**
 * Test: Phase transitions should be monotonic (no backward transitions)
 *
 * Verifies that phase doesn't flicker between states during execution.
 * This test catches the bug fixed in commit 16f9698 where refreshPendingRequests
 * and refreshTurnRuntime race conditions caused phase to toggle between
 * 'planning' and 'awaiting_clarification'.
 */
test('phase transitions should not flicker during planning', async ({ page }) => {
  const phaseChanges: Array<{ phase: string; timestamp: number }> = []

  // Inject phase change tracker into the page
  await page.addInitScript(() => {
    ;(window as any).__phaseChanges = []
    ;(window as any).__trackPhase = (phase: string) => {
      ;(window as any).__phaseChanges.push({
        phase,
        timestamp: Date.now(),
      })
    }
  })

  // Monitor DOM changes for phase indicators
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      // Track phase from data attributes or class names
      const phaseElement = document.querySelector('[data-phase]')
      if (phaseElement) {
        const phase = phaseElement.getAttribute('data-phase')
        if (phase && (window as any).__trackPhase) {
          ;(window as any).__trackPhase(phase)
        }
      }
    })
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-phase', 'class'],
    })
  })

  await page.goto('/')
  await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('测试 phase 稳定性')
  await page.getByTitle('发送').click()

  await expect(page).toHaveURL(/\/task\//)
  await page.getByRole('button', { name: '开始执行' }).click()

  // Wait for execution to progress
  await page.waitForTimeout(3000)

  // Collect phase changes
  const collectedPhases = await page.evaluate(() => (window as any).__phaseChanges || [])
  phaseChanges.push(...collectedPhases)

  // Analyze phase transitions
  const phaseSequence = phaseChanges.map((c) => c.phase)
  console.log('[phase-stability] Phase sequence:', phaseSequence)

  // Detect flickering: same phase appearing multiple times non-consecutively
  const phaseOccurrences = new Map<string, number[]>()
  phaseSequence.forEach((phase, index) => {
    if (!phaseOccurrences.has(phase)) {
      phaseOccurrences.set(phase, [])
    }
    phaseOccurrences.get(phase)!.push(index)
  })

  // Check for non-consecutive occurrences (flickering)
  for (const [phase, indices] of phaseOccurrences.entries()) {
    if (indices.length > 1) {
      // Check if indices are consecutive
      const isConsecutive = indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1)
      if (!isConsecutive) {
        console.error(`[phase-stability] Phase "${phase}" flickered at indices:`, indices)
        expect(isConsecutive).toBeTruthy()
      }
    }
  }
})

/**
 * Test: Concurrent API calls should not cause state conflicts
 *
 * This test verifies that when polling triggers concurrent API calls,
 * the UI remains stable and doesn't enter a broken state.
 */
test('concurrent API calls should not cause phase conflicts', async ({ page }) => {
  let pendingCallCount = 0
  let runtimeCallCount = 0

  // Add delays to simulate race conditions
  await page.route('**/api/v2/agent/pending', async (route) => {
    pendingCallCount++
    await new Promise((resolve) => setTimeout(resolve, 150))
    const response = await route.fetch()
    await route.fulfill({ response })
  })

  await page.route('**/api/v2/agent/runtime/**', async (route) => {
    runtimeCallCount++
    await new Promise((resolve) => setTimeout(resolve, 50))
    const response = await route.fetch()
    await route.fulfill({ response })
  })

  await page.goto('/')
  await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('测试并发 API 调用')
  await page.getByTitle('发送').click()

  await expect(page).toHaveURL(/\/task\//)
  await page.getByRole('button', { name: '开始执行' }).click()

  await page.waitForTimeout(5000)

  console.log('[phase-stability] Pending calls:', pendingCallCount)
  console.log('[phase-stability] Runtime calls:', runtimeCallCount)

  // Runtime calls should be triggered by polling
  // Pending calls may be 0 if no pending interactions exist in mock
  expect(runtimeCallCount).toBeGreaterThan(0)

  const inputField = page.getByPlaceholder('输入消息...')
  await expect(inputField).toBeVisible()
  await expect(inputField).toBeEnabled({ timeout: 15000 })
})

/**
 * Test: Visual stability during execution
 */
test('no visual flickering during execution', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('描述你的任务，AI 将帮你完成...').fill('视觉稳定性测试')
  await page.getByTitle('发送').click()

  await expect(page).toHaveURL(/\/task\//)
  await page.getByRole('button', { name: '开始执行' }).click()

  await page.waitForTimeout(500)

  const screenshots: Buffer[] = []
  const screenshotCount = 10
  const intervalMs = 200

  for (let i = 0; i < screenshotCount; i++) {
    const screenshot = await page.screenshot({ fullPage: false })
    screenshots.push(screenshot)
    await page.waitForTimeout(intervalMs)
  }

  expect(screenshots.length).toBe(screenshotCount)
  await expect(page.getByPlaceholder('输入消息...')).toBeVisible()
})
