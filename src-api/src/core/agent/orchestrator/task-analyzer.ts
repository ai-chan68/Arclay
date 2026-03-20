/**
 * Task Analyzer - Determines task complexity and decomposition strategy
 *
 * Uses rule-based heuristics to analyze tasks and recommend decomposition approach.
 */

import type { TaskAnalysis, TaskComplexity, DecompositionStrategy } from '@shared-types'

// Application scenario types
export type ApplicationScenario = 
  | 'website-generation'
  | 'document-creation'
  | 'data-processing'
  | 'presentation-creation'
  | 'code-development'
  | 'file-organization'
  | 'general-task'

export interface ScenarioAnalysis {
  scenario: ApplicationScenario
  confidence: number // 0-1
  outputTypes: string[] // Expected file types
  toolsRequired: string[] // Recommended tools
  previewCapable: boolean // Can use live preview
}

export class TaskAnalyzer {
  /**
   * Analyze a task prompt to determine complexity and decomposition strategy
   */
  analyze(prompt: string): TaskAnalysis {
    const complexity = this.detectComplexity(prompt)
    const strategy = this.selectStrategy(prompt)
    const requiresDecomposition = complexity === 'complex'
    const estimatedSubtasks = this.estimateSubtasks(prompt, complexity, strategy)
    const recommendedParallelism = this.recommendParallelism(complexity, estimatedSubtasks)

    return {
      complexity,
      requiresDecomposition,
      estimatedSubtasks,
      recommendedParallelism,
      decompositionStrategy: strategy
    }
  }

  /**
   * Analyze application scenario from task prompt
   */
  analyzeScenario(prompt: string): ScenarioAnalysis {
    const lowerPrompt = prompt.toLowerCase()
    
    // Website generation scenario
    if (this.isWebsiteGeneration(lowerPrompt)) {
      return {
        scenario: 'website-generation',
        confidence: this.calculateScenarioConfidence(lowerPrompt, 'website-generation'),
        outputTypes: ['html', 'css', 'js', 'jsx'],
        toolsRequired: ['Write', 'Read', 'WebSearch'],
        previewCapable: true
      }
    }

    // Document creation scenario
    if (this.isDocumentCreation(lowerPrompt)) {
      return {
        scenario: 'document-creation',
        confidence: this.calculateScenarioConfidence(lowerPrompt, 'document-creation'),
        outputTypes: ['markdown', 'pdf', 'docx'],
        toolsRequired: ['Write', 'Read'],
        previewCapable: false
      }
    }

    // Data processing scenario
    if (this.isDataProcessing(lowerPrompt)) {
      return {
        scenario: 'data-processing',
        confidence: this.calculateScenarioConfidence(lowerPrompt, 'data-processing'),
        outputTypes: ['csv', 'xlsx', 'json'],
        toolsRequired: ['Write', 'Read', 'Bash'],
        previewCapable: false
      }
    }

    // Presentation creation scenario
    if (this.isPresentationCreation(lowerPrompt)) {
      return {
        scenario: 'presentation-creation',
        confidence: this.calculateScenarioConfidence(lowerPrompt, 'presentation-creation'),
        outputTypes: ['html', 'pptx', 'pdf'],
        toolsRequired: ['Write', 'Read', 'WebSearch'],
        previewCapable: true
      }
    }

    // Code development scenario
    if (this.isCodeDevelopment(lowerPrompt)) {
      return {
        scenario: 'code-development',
        confidence: this.calculateScenarioConfidence(lowerPrompt, 'code-development'),
        outputTypes: ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java'],
        toolsRequired: ['Write', 'Read', 'Edit', 'Bash'],
        previewCapable: true
      }
    }

    // File organization scenario
    if (this.isFileOrganization(lowerPrompt)) {
      return {
        scenario: 'file-organization',
        confidence: this.calculateScenarioConfidence(lowerPrompt, 'file-organization'),
        outputTypes: [],
        toolsRequired: ['Read', 'Write', 'Bash', 'Glob'],
        previewCapable: false
      }
    }

    // Default to general task
    return {
      scenario: 'general-task',
      confidence: 1.0,
      outputTypes: [],
      toolsRequired: ['Write', 'Read'],
      previewCapable: false
    }
  }

  /**
   * Detect task complexity based on prompt patterns
   */
  private detectComplexity(prompt: string): TaskComplexity {
    const lowerPrompt = prompt.toLowerCase()

    // Simple tasks: single file, single operation, short prompt
    if (this.isSimpleTask(lowerPrompt)) {
      return 'simple'
    }

    // Complex tasks: multiple files, multiple operations, mentions of parallelization
    if (this.isComplexTask(lowerPrompt)) {
      return 'complex'
    }

    return 'moderate'
  }

  /**
   * Check if task is simple (single operation, single scope)
   */
  private isSimpleTask(prompt: string): boolean {
    const simplePatterns = [
      /^(explain|describe|what is|show me|tell me)/i,
      /single file/i,
      /this function/i,
      /this class/i,
      /this method/i
    ]

    const wordCount = prompt.split(/\s+/).length
    const fileCount = this.countFileMentions(prompt)

    return (
      (simplePatterns.some(p => p.test(prompt)) && fileCount <= 1) ||
      (wordCount < 20 && fileCount <= 1)
    )
  }

  /**
   * Check if task is complex (multiple files, parallelizable)
   */
  private isComplexTask(prompt: string): boolean {
    const fileCount = this.countFileMentions(prompt)
    const hasMultipleOps = this.hasMultipleOperations(prompt)
    const mentionsParallel = /parallel|concurrent|at once|simultaneously|all (the )?(files|components|modules)/i.test(prompt)

    return (
      fileCount >= 3 ||
      (fileCount >= 2 && hasMultipleOps) ||
      mentionsParallel ||
      /refactor (all|every|multiple)/i.test(prompt)
    )
  }

  /**
   * Count number of file mentions in prompt
   */
  private countFileMentions(prompt: string): number {
    // Match file patterns: filename.ext, path/to/file.ext
    const filePatterns = [
      /\b\w+\.(ts|tsx|js|jsx|py|java|go|rs|c|cpp|h)\b/g,
      /components?\/\w+/gi,
      /src\/\w+/gi
    ]

    const files = new Set<string>()
    filePatterns.forEach(pattern => {
      const matches = prompt.match(pattern)
      if (matches) {
        matches.forEach(m => files.add(m.toLowerCase()))
      }
    })

    return files.size
  }

  /**
   * Check if prompt mentions multiple operations
   */
  private hasMultipleOperations(prompt: string): boolean {
    const operations = [
      /add|create|implement|write/i,
      /update|modify|change|refactor/i,
      /delete|remove/i,
      /test|verify/i,
      /document|comment/i
    ]

    let opCount = 0
    operations.forEach(op => {
      if (op.test(prompt)) opCount++
    })

    return opCount >= 2
  }

  /**
   * Select decomposition strategy based on prompt content and scenario
   */
  private selectStrategy(prompt: string): DecompositionStrategy {
    const lowerPrompt = prompt.toLowerCase()
    const scenario = this.analyzeScenario(prompt)

    // Scenario-aware strategy selection
    switch (scenario.scenario) {
      case 'website-generation':
        return 'scene-based' // Group by page/component
      case 'document-creation':
        return 'artifact-based' // Group by document type
      case 'data-processing':
        return 'type-based' // Group by data type
      case 'presentation-creation':
        return 'scene-based' // Group by slide/section
      case 'code-development':
        // Use existing logic for code
        break
      case 'file-organization':
        return 'type-based' // Group by file type
    }

    // File-based: mentions specific files
    if (this.countFileMentions(prompt) >= 2) {
      return 'file-based'
    }

    // Range-based: mentions line numbers or ranges
    if (/lines?\s*\d+\s*(-|to)\s*\d+/i.test(prompt) || /range/i.test(prompt)) {
      return 'range-based'
    }

    // Type-based: mentions entity types
    if (/(all|every)\s+(components?|utils?|services?|models?|tests?|files?)/i.test(prompt)) {
      return 'type-based'
    }

    // Preview-aware: if can use preview, prefer artifact-based
    if (scenario.previewCapable) {
      return 'preview-aware'
    }

    // Default to file-based for complex tasks
    return 'file-based'
  }

  /**
   * Estimate number of subtasks based on analysis
   */
  private estimateSubtasks(
    prompt: string,
    complexity: TaskComplexity,
    strategy: DecompositionStrategy
  ): number {
    if (complexity === 'simple') return 1
    if (complexity === 'moderate') return 2

    // Complex tasks
    switch (strategy) {
      case 'file-based':
        return Math.min(this.countFileMentions(prompt), 5)
      case 'type-based':
        return 3 // Estimate based on typical entity counts
      case 'range-based':
        return 2 // Typically split into 2-3 ranges
      default:
        return 3
    }
  }

  /**
   * Recommend parallelism level (1-5)
   */
  private recommendParallelism(
    complexity: TaskComplexity,
    estimatedSubtasks: number
  ): number {
    if (complexity === 'simple') return 1
    if (complexity === 'moderate') return 2

    // Complex tasks: limit to max 5 concurrent agents
    return Math.min(estimatedSubtasks, 5)
  }

  /**
   * Check if task is website generation
   */
  private isWebsiteGeneration(prompt: string): boolean {
    const websitePatterns = [
      /create\s+(a\s+)?(website|web\s*page|landing\s*page|site)/i,
      /build\s+(a\s+)?(website|web\s*app|web\s*application)/i,
      /generate\s+(a\s+)?(website|web\s*page|html\s*page)/i,
      /(html|css|javascript|react)\s+(website|page|app)/i,
      /responsive\s+(website|page)/i,
      /portfolio\s*site/i,
      /blog\s*(website|site)/i
    ]

    return websitePatterns.some(pattern => pattern.test(prompt))
  }

  /**
   * Check if task is document creation
   */
  private isDocumentCreation(prompt: string): boolean {
    const documentPatterns = [
      /create\s+(a\s+)?(document|report|article|essay|paper)/i,
      /write\s+(a\s+)?(document|report|article|essay|paper)/i,
      /generate\s+(a\s+)?(document|report|article|essay|paper)/i,
      /(markdown|pdf|word|docx)\s+(document|file)/i,
      /documentation/i,
      /readme/i,
      /manual/i,
      /guide/i
    ]

    return documentPatterns.some(pattern => pattern.test(prompt))
  }

  /**
   * Check if task is data processing
   */
  private isDataProcessing(prompt: string): boolean {
    const dataPatterns = [
      /process\s+(data|csv|excel|spreadsheet)/i,
      /analyze\s+(data|dataset|csv|excel)/i,
      /convert\s+(csv|excel|json|xml)/i,
      /parse\s+(data|csv|json|xml)/i,
      /extract\s+(data|information)/i,
      /transform\s+(data|csv|excel)/i,
      /clean\s+(data|dataset)/i,
      /(csv|excel|spreadsheet|json)\s+(file|data)/i,
      /data\s+(analysis|processing|transformation)/i
    ]

    return dataPatterns.some(pattern => pattern.test(prompt))
  }

  /**
   * Check if task is presentation creation
   */
  private isPresentationCreation(prompt: string): boolean {
    const presentationPatterns = [
      /create\s+(a\s+)?(presentation|slideshow|slides)/i,
      /build\s+(a\s+)?(presentation|slideshow|slides)/i,
      /generate\s+(a\s+)?(presentation|slideshow|slides)/i,
      /(powerpoint|ppt|pptx)\s+(presentation|slides)/i,
      /slide\s*deck/i,
      /pitch\s*deck/i,
      /presentation\s+(slides|deck)/i
    ]

    return presentationPatterns.some(pattern => pattern.test(prompt))
  }

  /**
   * Check if task is code development
   */
  private isCodeDevelopment(prompt: string): boolean {
    const codePatterns = [
      /(implement|create|build|develop)\s+(a\s+)?(function|class|component|module|api)/i,
      /(write|create)\s+(code|script|program)/i,
      /refactor\s+(code|function|class|component)/i,
      /add\s+(feature|functionality)/i,
      /fix\s+(bug|issue|error)/i,
      /(javascript|typescript|python|java|go|rust|react|vue|angular)/i,
      /algorithm/i,
      /unit\s*test/i,
      /debug/i
    ]

    return codePatterns.some(pattern => pattern.test(prompt))
  }

  /**
   * Check if task is file organization
   */
  private isFileOrganization(prompt: string): boolean {
    const organizationPatterns = [
      /organize\s+(files|folders|directory)/i,
      /sort\s+(files|folders)/i,
      /clean\s*up\s+(files|folders|directory)/i,
      /restructure\s+(files|folders|project)/i,
      /move\s+(files|folders)/i,
      /rename\s+(files|folders)/i,
      /delete\s+(files|folders)/i,
      /file\s+(organization|management|cleanup)/i,
      /folder\s+(structure|organization)/i
    ]

    return organizationPatterns.some(pattern => pattern.test(prompt))
  }

  /**
   * Calculate confidence score for a scenario (0-1)
   */
  private calculateScenarioConfidence(prompt: string, scenario: ApplicationScenario): number {
    const patterns = this.getScenarioPatterns(scenario)
    let matches = 0
    let totalPatterns = patterns.length

    patterns.forEach(pattern => {
      if (pattern.test(prompt)) {
        matches++
      }
    })

    // Base confidence from pattern matching
    let confidence = matches / totalPatterns

    // Boost confidence for explicit mentions
    const explicitMentions = this.getExplicitMentions(scenario)
    explicitMentions.forEach(mention => {
      if (prompt.toLowerCase().includes(mention)) {
        confidence += 0.2
      }
    })

    return Math.min(confidence, 1.0)
  }

  /**
   * Get regex patterns for a scenario
   */
  private getScenarioPatterns(scenario: ApplicationScenario): RegExp[] {
    switch (scenario) {
      case 'website-generation':
        return [
          /website|web\s*page|landing\s*page/i,
          /html|css|javascript|react/i,
          /responsive|mobile/i
        ]
      case 'document-creation':
        return [
          /document|report|article/i,
          /markdown|pdf|docx/i,
          /write|create|generate/i
        ]
      case 'data-processing':
        return [
          /data|csv|excel|json/i,
          /process|analyze|convert/i,
          /spreadsheet|dataset/i
        ]
      case 'presentation-creation':
        return [
          /presentation|slides|slideshow/i,
          /powerpoint|ppt/i,
          /pitch|deck/i
        ]
      case 'code-development':
        return [
          /function|class|component|api/i,
          /implement|develop|code/i,
          /javascript|python|react/i
        ]
      case 'file-organization':
        return [
          /organize|sort|clean/i,
          /files|folders|directory/i,
          /move|rename|delete/i
        ]
      default:
        return []
    }
  }

  /**
   * Get explicit mention keywords for a scenario
   */
  private getExplicitMentions(scenario: ApplicationScenario): string[] {
    switch (scenario) {
      case 'website-generation':
        return ['website', 'webpage', 'html', 'css', 'react', 'vue']
      case 'document-creation':
        return ['document', 'markdown', 'pdf', 'docx', 'readme']
      case 'data-processing':
        return ['csv', 'excel', 'json', 'data', 'spreadsheet']
      case 'presentation-creation':
        return ['presentation', 'slides', 'powerpoint', 'ppt']
      case 'code-development':
        return ['function', 'class', 'component', 'api', 'code']
      case 'file-organization':
        return ['organize', 'files', 'folders', 'directory']
      default:
        return []
    }
  }
}
