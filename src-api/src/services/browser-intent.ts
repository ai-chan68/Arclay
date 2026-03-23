import type { TaskPlan } from '../types/agent-new'

const BROWSER_AUTOMATION_PATTERN = /chrome-devtools|playwright|浏览器|radio button|单选框|点击|填入|输入|查询/i
const URL_PATTERN = /https?:\/\/\S+/i

export function looksLikeBrowserAutomationIntentInText(text: string): boolean {
  return BROWSER_AUTOMATION_PATTERN.test(text) && URL_PATTERN.test(text)
}

export function isBrowserAutomationIntent(promptText: string, plan: TaskPlan): boolean {
  const corpus = [promptText, plan.goal, ...plan.steps.map((step) => step.description)].join('\n')
  return looksLikeBrowserAutomationIntentInText(corpus)
}
