/**
 * IntentClassifier — 意图分类服务
 *
 * 将用户输入分类为 7 种意图类型，评估任务复杂度。
 * 主路径：模式匹配（同步，< 10ms）
 * 可选路径：LLM 深度分类（异步，需配置启用）
 */

import type { TaskPlan } from '../types/agent-new'

export enum IntentType {
  QUERY = 'query',           // 简单查询、问答
  SEARCH = 'search',         // 搜索、查找信息
  ACTION = 'action',         // 执行动作、操作
  CREATE = 'create',         // 创建内容、文件
  EDIT = 'edit',             // 编辑、修改
  ANALYZE = 'analyze',       // 分析、调研、预测
  MULTI_STEP = 'multi_step', // 多步骤复杂任务
}

export type ComplexityLevel = 'simple' | 'medium' | 'complex'

export interface IntentClassification {
  primaryIntent: IntentType
  confidence: number
  complexity: ComplexityLevel
  processingTime: number
  webIntent: WebTaskIntent
  reasoning?: string
}

// Web 子意图（保留兼容 claude.ts 的原有分类）
export type WebTaskIntent = 'none' | 'information_retrieval' | 'interaction' | 'hybrid'

const CONFIDENCE_FALLBACK_THRESHOLD = 0.6

// 意图得分（用于复杂度计算）
const INTENT_COMPLEXITY_SCORE: Record<IntentType, number> = {
  [IntentType.QUERY]: 1,
  [IntentType.SEARCH]: 2,
  [IntentType.ACTION]: 3,
  [IntentType.CREATE]: 4,
  [IntentType.EDIT]: 4,
  [IntentType.ANALYZE]: 5,
  [IntentType.MULTI_STEP]: 8,
}

// 各意图的匹配模式
const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  [IntentType.QUERY]: [
    /^(什么是|怎么|如何|为什么|是否|有没有|能否|请问|告诉我|解释)/,
    /^(what is|how (do|does|to)|why|is there|can you|explain|tell me)/i,
  ],
  [IntentType.SEARCH]: [
    /(搜索|查找|找到|查询|检索|寻找|找一下|帮我找)/,
    /(search|find|look for|lookup|query|retrieve)/i,
  ],
  [IntentType.ACTION]: [
    /(执行|运行|启动|停止|删除|移动|复制|重命名|安装|卸载|部署)/,
    /(run|execute|start|stop|delete|remove|move|copy|rename|install|deploy)/i,
  ],
  [IntentType.CREATE]: [
    /(创建|新建|生成|写一个|写一份|制作|建立|构建|生成一个)/,
    /(create|generate|write|make|build|produce|draft)/i,
  ],
  [IntentType.EDIT]: [
    /(修改|编辑|更新|改变|替换|优化|重构|修复|调整)/,
    /(edit|modify|update|change|replace|refactor|fix|adjust|improve)/i,
  ],
  [IntentType.ANALYZE]: [
    /(分析|调研|研究|评估|预测|对比|比较|统计|报告|总结|归纳|调查)/,
    /(analyze|analyse|research|study|evaluate|predict|compare|summarize|report|investigate)/i,
  ],
  [IntentType.MULTI_STEP]: [
    /(然后|接着|之后|并且|同时|步骤|流程|先.*再.*最后)/,
    /(then|after that|next|and also|step by step|first.*then.*finally)/i,
  ],
}

// Web 上下文模式（从 claude.ts 迁移）
const WEB_CONTEXT_PATTERN =
  /(https?:\/\/\S+|网页|页面|浏览器|chrome|playwright|devtools|站点|url|链接|官网|搜索结果|页面内容|网站)/i

const WEB_INFORMATION_PATTERNS = [
  /读取|提取|获取|抓取|爬取|截图|截屏|查看|浏览|访问|打开网页/,
  /\bread\b|\bextract\b|\bfetch\b|\bscrape\b|\bcrawl\b|\bscreenshot\b|\bvisit\b|\bbrowse\b/i,
]

const WEB_INTERACTION_PATTERNS = [
  /点击|输入|填写|提交|上传|下载|勾选|切换|选择|打开|关闭|登录|拖拽|hover|悬停|复制/,
  /\bclick\b|\bfill\b|\btype\b|\bsubmit\b|\bupload\b|\bdownload\b|\bselect\b|\bcheck\b|\blogin\b|\bopen\b/i,
]

export class IntentClassifier {
  /**
   * 分类用户输入意图
   */
  classify(
    input: string,
    plan?: Pick<TaskPlan, 'goal' | 'steps' | 'notes'>
  ): IntentClassification {
    const startTime = Date.now()

    const corpus = this.buildCorpus(input, plan)
    const { intent, confidence } = this.patternMatch(corpus)
    const primaryIntent =
      confidence < CONFIDENCE_FALLBACK_THRESHOLD ? IntentType.MULTI_STEP : intent
    const complexity = this.assessComplexity(primaryIntent, corpus)
    const webIntent = this.classifyWebIntent(corpus)

    return {
      primaryIntent,
      confidence,
      complexity,
      webIntent,
      processingTime: Date.now() - startTime,
    }
  }

  /**
   * 仅获取 Web 子意图（兼容 claude.ts 现有调用）
   */
  classifyWebIntent(
    corpus: string
  ): WebTaskIntent {
    if (!WEB_CONTEXT_PATTERN.test(corpus)) {
      return 'none'
    }
    const hasInfo = WEB_INFORMATION_PATTERNS.some((p) => p.test(corpus))
    const hasInteraction = WEB_INTERACTION_PATTERNS.some((p) => p.test(corpus))
    if (hasInfo && hasInteraction) return 'hybrid'
    if (hasInteraction) return 'interaction'
    if (hasInfo) return 'information_retrieval'
    return 'none'
  }

  private buildCorpus(
    input: string,
    plan?: Pick<TaskPlan, 'goal' | 'steps' | 'notes'>
  ): string {
    return [
      input,
      plan?.goal,
      plan?.notes,
      ...(plan?.steps ?? []).map((s) => s.description),
    ]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join('\
')
      .toLowerCase()
  }

  private patternMatch(corpus: string): { intent: IntentType; confidence: number } {
    const matches: Array<{ intent: IntentType; confidence: number }> = []

    for (const [intentKey, patterns] of Object.entries(INTENT_PATTERNS)) {
      for (const pattern of patterns) {
        const match = corpus.match(pattern)
        if (match) {
          // Fixed base + keyword length bonus to avoid penalizing long inputs
          const confidence = Math.min(0.65 + (match[0].length / 20), 0.95)
          matches.push({ intent: intentKey as IntentType, confidence })
          break
        }
      }
    }

    if (matches.length === 0) {
      return { intent: IntentType.MULTI_STEP, confidence: 0.4 }
    }

    matches.sort((a, b) => b.confidence - a.confidence)
    return matches[0]
  }

  private assessComplexity(intent: IntentType, corpus: string): ComplexityLevel {
    const baseScore = INTENT_COMPLEXITY_SCORE[intent]

    // 多实体信号：逗号、顿号计数
    const entitySignals = (corpus.match(/[,，、]/g) ?? []).length
    const totalScore = baseScore + Math.min(entitySignals, 3)

    if (totalScore <= 2) return 'simple'
    if (totalScore <= 5) return 'medium'
    return 'complex'
  }
}

export const intentClassifier = new IntentClassifier()
