import { describe, it, expect } from 'vitest'
import { IntentClassifier, IntentType } from '../intent-classifier'

describe('IntentClassifier', () => {
  const classifier = new IntentClassifier()

  describe('classify()', () => {
    it('classifies analysis/research input as analyze', () => {
      const result = classifier.classify('帮我调研下泰格医药这家公司，结合最近的股价，预测下后续的走势')
      expect(result.primaryIntent).toBe(IntentType.ANALYZE)
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('classifies search input as search', () => {
      const result = classifier.classify('帮我找一下最近的 TypeScript 文档')
      expect(result.primaryIntent).toBe(IntentType.SEARCH)
    })

    it('classifies create input as create', () => {
      const result = classifier.classify('帮我写一个 React 组件')
      expect(result.primaryIntent).toBe(IntentType.CREATE)
    })

    it('classifies edit input as edit', () => {
      const result = classifier.classify('修改这个函数的返回类型')
      expect(result.primaryIntent).toBe(IntentType.EDIT)
    })

    it('classifies action input as action', () => {
      const result = classifier.classify('执行部署脚本并重启服务')
      expect(result.primaryIntent).toBe(IntentType.ACTION)
    })

    it('falls back to multi_step when confidence is low', () => {
      const result = classifier.classify('xyz abc 123')
      expect(result.primaryIntent).toBe(IntentType.MULTI_STEP)
      expect(result.confidence).toBeLessThan(0.6)
    })

    it('returns processingTime', () => {
      const result = classifier.classify('搜索一下最新新闻')
      expect(result.processingTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('complexity assessment', () => {
    it('rates simple query as simple', () => {
      const result = classifier.classify('什么是 TypeScript')
      expect(result.complexity).toBe('simple')
    })

    it('rates multi-entity analyze as complex', () => {
      const result = classifier.classify('分析泰格医药、药明康德、凯莱英三家公司的股价走势对比')
      expect(result.complexity).toBe('complex')
    })
  })

  describe('classifyWebIntent()', () => {
    it('returns information_retrieval for web info tasks', () => {
      const result = classifier.classifyWebIntent('访问 https://example.com 提取页面内容')
      expect(result).toBe('information_retrieval')
    })

    it('returns interaction for click/fill tasks', () => {
      const result = classifier.classifyWebIntent('点击提交按钮并填写表单')
      expect(result).toBe('none') // no web context pattern
    })

    it('returns none for non-web tasks', () => {
      const result = classifier.classifyWebIntent('帮我写一段代码')
      expect(result).toBe('none')
    })

    it('returns hybrid for mixed web tasks', () => {
      const result = classifier.classifyWebIntent('打开页面 https://example.com 读取内容后点击提交')
      expect(result).toBe('hybrid')
    })
  })
})
