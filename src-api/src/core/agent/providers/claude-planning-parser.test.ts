import { describe, expect, it } from 'vitest'
import { ClaudeAgent } from './claude'

function parsePlanningResponse(response: string) {
  const agent = new ClaudeAgent({
    provider: 'claude',
    apiKey: 'test-key',
    model: 'test-model',
  })

  return (agent as unknown as {
    parsePlanningResponse: (text: string) => {
      type: 'direct_answer' | 'plan' | 'clarification_request' | 'unknown'
      clarification?: { question?: string }
    }
  }).parsePlanningResponse(response)
}

function toTaskPlan(
  plan: { goal?: string; steps: string[]; notes?: string },
  prompt: string
) {
  const agent = new ClaudeAgent({
    provider: 'claude',
    apiKey: 'test-key',
    model: 'test-model',
  })

  return (agent as unknown as {
    toTaskPlan: (
      input: { goal?: string; steps: string[]; notes?: string },
      promptText: string
    ) => {
      goal: string
      steps: Array<{ description: string }>
      notes?: string
    }
  }).toTaskPlan(plan, prompt)
}

describe('Claude planning response parser', () => {
  it('infers clarification_request from freeform text with missing-context hints', () => {
    const result = parsePlanningResponse(
      '要给出可执行计划，我还需要一些信息。请提供今天可用时长、必须完成事项和优先级规则。'
    )

    expect(result.type).toBe('clarification_request')
    expect(result.clarification?.question?.length).toBeGreaterThan(5)
  })

  it('uses fallback clarification question when freeform text only states information gap', () => {
    const result = parsePlanningResponse('信息不足，缺少关键约束，当前无法确定可执行计划。')

    expect(result.type).toBe('clarification_request')
    expect(result.clarification?.question).toContain('请先补充关键约束')
  })

  it('keeps unknown when response is freeform text without clarification intent', () => {
    const result = parsePlanningResponse('我会先分析任务，然后产出计划。')

    expect(result.type).toBe('unknown')
  })

  it('normalizes english plans into chinese when the original prompt is chinese', () => {
    const result = toTaskPlan(
      {
        goal: 'Access NetEase mail system and retrieve OMS order number',
        steps: [
          'Navigate to the NetEase OMS URL',
          'Locate and click the radio button for batch query',
          'Input the batch number and execute the search query',
        ],
        notes: 'This requires web automation to interact with the system',
      },
      '打开网易 OMS 页面并查询统一订单号'
    )

    expect(result.goal).toBe('打开网易 OMS 页面并查询统一订单号')
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0]?.description).toBe('Navigate to the NetEase OMS URL')
    expect(result.notes).toContain('已按中文默认规范')
  })

  it('rewrites internal interactive web plans away from web-search placeholders', () => {
    const result = toTaskPlan(
      {
        goal: '访问网易邮箱OMS系统，通过出库批次号查询并获取统一订单号',
        steps: [
          '使用web-search技能打开指定的OMS系统URL',
          '定位并点击"出库批次号"单选框',
          '输入批次号并执行查询',
        ],
        notes: '需要访问网页系统',
      },
      '打开https://yx.mail.netease.com/yx-oms/oms-micro-center/#/orderSearch，点击单选框并输入批次号查询'
    )

    expect(result.steps[0]?.description).toBe('使用浏览器自动化工具打开指定的OMS系统URL')
    expect(result.steps.some((step) => step.description.includes('web-search'))).toBe(false)
  })

  it('salvages plan json when a step contains unescaped quotes', () => {
    const result = parsePlanningResponse(`\`\`\`json
{"type":"plan","goal":"访问网易邮箱OMS系统，通过出库批次号查询并获取统一订单号","steps":["使用web-search技能打开指定的OMS系统URL","定位并点击"出库批次号"单选框","输入批次号并执行查询"],"notes":"需要访问网页系统"}
\`\`\``)

    expect(result.type).toBe('plan')
    expect(result.plan?.goal).toContain('访问网易邮箱OMS系统')
    expect(result.plan?.steps).toEqual([
      '使用web-search技能打开指定的OMS系统URL',
      '定位并点击"出库批次号"单选框',
      '输入批次号并执行查询',
    ])
  })
})
