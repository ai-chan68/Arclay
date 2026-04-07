/**
 * Task Decomposer - Breaks down tasks into subtasks using different strategies
 */

import type {
  SubTask,
  DecompositionStrategy,
  SubTaskPriority,
  TaskAnalysis
} from '@shared-types'
import { randomUUID } from 'crypto'

export class TaskDecomposer {
  /**
   * Decompose a task into subtasks based on the analysis
   */
  decompose(
    parentTaskId: string,
    prompt: string,
    analysis: TaskAnalysis
  ): SubTask[] {
    if (!analysis.requiresDecomposition && analysis.estimatedSubtasks <= 1) {
      return [this.createSingleTask(parentTaskId, prompt)]
    }

    switch (analysis.decompositionStrategy) {
      case 'file-based':
        return this.decomposeByFiles(parentTaskId, prompt, analysis)
      case 'range-based':
        return this.decomposeByRange(parentTaskId, prompt, analysis)
      case 'type-based':
        return this.decomposeByType(parentTaskId, prompt, analysis)
      case 'scene-based':
        return this.decomposeByScene(parentTaskId, prompt, analysis)
      case 'artifact-based':
        return this.decomposeByArtifact(parentTaskId, prompt, analysis)
      case 'preview-aware':
        return this.decomposePreviewAware(parentTaskId, prompt, analysis)
      default:
        return [this.createSingleTask(parentTaskId, prompt)]
    }
  }

  /**
   * Create a single task (no decomposition)
   */
  private createSingleTask(parentTaskId: string, prompt: string): SubTask {
    return {
      id: randomUUID(),
      parentTaskId,
      description: prompt,
      scope: {},
      dependencies: [],
      priority: 'high'
    }
  }

  /**
   * File-based decomposition: one subtask per file
   */
  private decomposeByFiles(
    parentTaskId: string,
    prompt: string,
    analysis: TaskAnalysis
  ): SubTask[] {
    const files = this.extractFiles(prompt)
    const subtasks: SubTask[] = []

    files.forEach((file, index) => {
      subtasks.push({
        id: randomUUID(),
        parentTaskId,
        description: this.createFileDescription(prompt, file),
        scope: { files: [file] },
        dependencies: [],
        priority: index === 0 ? 'high' : 'medium'
      })
    })

    return this.validateDecomposition(subtasks)
  }

  /**
   * Range-based decomposition: split by line ranges
   */
  private decomposeByRange(
    parentTaskId: string,
    prompt: string,
    analysis: TaskAnalysis
  ): SubTask[] {
    const ranges = this.extractRanges(prompt)
    const subtasks: SubTask[] = []

    ranges.forEach((range, index) => {
      subtasks.push({
        id: randomUUID(),
        parentTaskId,
        description: this.createRangeDescription(prompt, range),
        scope: { range },
        dependencies: index > 0 ? [subtasks[index - 1].id] : [],
        priority: index === 0 ? 'high' : 'medium'
      })
    })

    // If no ranges found, create single task
    if (subtasks.length === 0) {
      return [this.createSingleTask(parentTaskId, prompt)]
    }

    return this.validateDecomposition(subtasks)
  }

  /**
   * Type-based decomposition: one subtask per entity type
   */
  private decomposeByType(
    parentTaskId: string,
    prompt: string,
    analysis: TaskAnalysis
  ): SubTask[] {
    const types = this.extractTypes(prompt)
    const subtasks: SubTask[] = []

    types.forEach((type, index) => {
      subtasks.push({
        id: randomUUID(),
        parentTaskId,
        description: this.createTypeDescription(prompt, type),
        scope: { type },
        dependencies: [],
        priority: this.getTypePriority(type)
      })
    })

    return this.validateDecomposition(subtasks)
  }

  /**
   * Extract file names from prompt
   */
  private extractFiles(prompt: string): string[] {
    const patterns = [
      /\b(\w+\.(ts|tsx|js|jsx|py|java|go|rs))\b/g,
      /(components?|src|lib)\/([\w\/]+)/gi
    ]

    const files = new Set<string>()
    patterns.forEach(pattern => {
      const matches = Array.from(prompt.matchAll(pattern))
      matches.forEach(match => {
        files.add(match[0])
      })
    })

    return Array.from(files).slice(0, 5) // Limit to 5 files
  }

  /**
   * Extract line ranges from prompt
   */
  private extractRanges(prompt: string): Array<[number, number]> {
    const rangePattern = /lines?\s*(\d+)\s*(-|to|–)\s*(\d+)/gi
    const ranges: Array<[number, number]> = []

    const matches = Array.from(prompt.matchAll(rangePattern))
    matches.forEach(match => {
      const start = parseInt(match[1], 10)
      const end = parseInt(match[3], 10)
      if (start < end) {
        ranges.push([start, end])
      }
    })

    return ranges
  }

  /**
   * Extract entity types from prompt
   */
  private extractTypes(prompt: string): string[] {
    const typePattern = /(components?|utils?|services?|models?|tests?|hooks?|helpers?)/gi
    const types = new Set<string>()

    const matches = Array.from(prompt.matchAll(typePattern))
    matches.forEach(match => {
      types.add(match[1].toLowerCase())
    })

    return Array.from(types)
  }

  /**
   * Create description for file-based subtask
   */
  private createFileDescription(prompt: string, file: string): string {
    return `Process ${file}: ${prompt}`
  }

  /**
   * Create description for range-based subtask
   */
  private createRangeDescription(prompt: string, range: [number, number]): string {
    return `Lines ${range[0]}-${range[1]}: ${prompt}`
  }

  /**
   * Create description for type-based subtask
   */
  private createTypeDescription(prompt: string, type: string): string {
    return `For all ${type}: ${prompt}`
  }

  /**
   * Get priority based on entity type
   */
  private getTypePriority(type: string): SubTaskPriority {
    const highPriority = ['component', 'service']
    const lowPriority = ['test', 'doc']

    if (highPriority.includes(type)) return 'high'
    if (lowPriority.includes(type)) return 'low'
    return 'medium'
  }

  /**
   * Validate decomposition quality
   */
  private validateDecomposition(subtasks: SubTask[]): SubTask[] {
    if (subtasks.length === 0) {
      throw new Error('Decomposition produced no subtasks')
    }

    // Check for circular dependencies
    this.checkCircularDependencies(subtasks)

    // Validate each subtask has scope
    subtasks.forEach(subtask => {
      if (Object.keys(subtask.scope).length === 0) {
        console.warn(`Subtask ${subtask.id} has no scope defined`)
      }
    })

    return subtasks
  }

  /**
   * Check for circular dependencies in subtasks
   */
  private checkCircularDependencies(subtasks: SubTask[]): void {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycle = (id: string): boolean => {
      if (recursionStack.has(id)) return true
      if (visited.has(id)) return false

      visited.add(id)
      recursionStack.add(id)

      const subtask = subtasks.find(s => s.id === id)
      if (subtask) {
        for (const depId of subtask.dependencies) {
          if (hasCycle(depId)) return true
        }
      }

      recursionStack.delete(id)
      return false
    }

    for (const subtask of subtasks) {
      if (hasCycle(subtask.id)) {
        throw new Error('Circular dependency detected in subtasks')
      }
    }
  }

  /**
   * Decompose by application scenes (pages, slides, sections)
   */
  private decomposeByScene(
    parentTaskId: string,
    prompt: string,
    analysis: TaskAnalysis
  ): SubTask[] {
    const lowerPrompt = prompt.toLowerCase()
    const subtasks: SubTask[] = []

    // Website scenes
    if (lowerPrompt.includes('website') || lowerPrompt.includes('web')) {
      const scenes = this.extractWebsiteScenes(prompt)
      scenes.forEach((scene, index) => {
        subtasks.push({
          id: randomUUID(),
          parentTaskId,
          description: `Create ${scene} page/section`,
          scope: { scene, type: 'webpage' },
          dependencies: index === 0 ? [] : [subtasks[index - 1].id],
          priority: index === 0 ? 'high' : 'medium'
        })
      })
    }

    // Presentation scenes
    else if (lowerPrompt.includes('presentation') || lowerPrompt.includes('slides')) {
      const scenes = this.extractPresentationScenes(prompt)
      scenes.forEach((scene, index) => {
        subtasks.push({
          id: randomUUID(),
          parentTaskId,
          description: `Create ${scene} slide/section`,
          scope: { scene, type: 'slide' },
          dependencies: index === 0 ? [] : [subtasks[index - 1].id],
          priority: 'medium'
        })
      })
    }

    // Document scenes
    else if (lowerPrompt.includes('document') || lowerPrompt.includes('report')) {
      const scenes = this.extractDocumentScenes(prompt)
      scenes.forEach((scene, index) => {
        subtasks.push({
          id: randomUUID(),
          parentTaskId,
          description: `Write ${scene} section`,
          scope: { scene, type: 'section' },
          dependencies: index === 0 ? [] : [subtasks[index - 1].id],
          priority: 'medium'
        })
      })
    }

    return subtasks.length > 0 ? subtasks : [this.createSingleTask(parentTaskId, prompt)]
  }

  /**
   * Decompose by output artifact types
   */
  private decomposeByArtifact(
    parentTaskId: string,
    prompt: string,
    analysis: TaskAnalysis
  ): SubTask[] {
    const artifacts = this.extractExpectedArtifacts(prompt)
    const subtasks: SubTask[] = []

    artifacts.forEach((artifact, index) => {
      subtasks.push({
        id: randomUUID(),
        parentTaskId,
        description: `Create ${artifact.type} artifact: ${artifact.name}`,
        scope: { 
          artifactType: artifact.type,
          artifactName: artifact.name,
          outputFormat: artifact.type
        },
        dependencies: this.determineArtifactDependencies(artifact, subtasks),
        priority: this.determineArtifactPriority(artifact)
      })
    })

    return subtasks.length > 0 ? subtasks : [this.createSingleTask(parentTaskId, prompt)]
  }

  /**
   * Decompose with preview capabilities in mind
   */
  private decomposePreviewAware(
    parentTaskId: string,
    prompt: string,
    analysis: TaskAnalysis
  ): SubTask[] {
    const subtasks: SubTask[] = []

    // Create preview-ready components first
    if (this.isPreviewableTask(prompt)) {
      subtasks.push({
        id: randomUUID(),
        parentTaskId,
        description: 'Create main previewable content (HTML/React components)',
        scope: { 
          type: 'preview-primary',
          previewable: true,
          priority: 'high'
        },
        dependencies: [],
        priority: 'high'
      })

      // Then supporting files
      subtasks.push({
        id: randomUUID(),
        parentTaskId,
        description: 'Create supporting files (CSS, JS, assets)',
        scope: { 
          type: 'preview-supporting',
          previewable: false
        },
        dependencies: [subtasks[0].id],
        priority: 'medium'
      })

      // Finally configuration and setup
      subtasks.push({
        id: randomUUID(),
        parentTaskId,
        description: 'Setup preview configuration and dependencies',
        scope: { 
          type: 'preview-config',
          previewable: false
        },
        dependencies: subtasks.map(t => t.id),
        priority: 'low'
      })
    } else {
      // Fall back to file-based decomposition
      return this.decomposeByFiles(parentTaskId, prompt, analysis)
    }

    return subtasks
  }

  /**
   * Extract website scenes from prompt
   */
  private extractWebsiteScenes(prompt: string): string[] {
    const defaultScenes = ['home', 'about', 'contact']
    const mentionedScenes: string[] = []

    // Look for explicit page mentions
    const pagePatterns = [
      /home\s*page/i,
      /about\s*(us|page)?/i,
      /contact\s*(us|page)?/i,
      /services?\s*page/i,
      /products?\s*page/i,
      /portfolio\s*page/i,
      /blog\s*page/i,
      /login\s*page/i,
      /signup\s*page/i
    ]

    pagePatterns.forEach(pattern => {
      const match = prompt.match(pattern)
      if (match) {
        mentionedScenes.push(match[0].toLowerCase().replace(/\s*page/i, ''))
      }
    })

    return mentionedScenes.length > 0 ? mentionedScenes : defaultScenes
  }

  /**
   * Extract presentation scenes from prompt
   */
  private extractPresentationScenes(prompt: string): string[] {
    const defaultScenes = ['title', 'introduction', 'main content', 'conclusion']
    const mentionedScenes: string[] = []

    // Look for slide mentions
    const slidePatterns = [
      /title\s*slide/i,
      /intro(duction)?\s*slide/i,
      /agenda\s*slide/i,
      /overview\s*slide/i,
      /conclusion\s*slide/i,
      /summary\s*slide/i,
      /thank\s*you\s*slide/i
    ]

    slidePatterns.forEach(pattern => {
      const match = prompt.match(pattern)
      if (match) {
        mentionedScenes.push(match[0].toLowerCase().replace(/\s*slide/i, ''))
      }
    })

    return mentionedScenes.length > 0 ? mentionedScenes : defaultScenes
  }

  /**
   * Extract document scenes from prompt
   */
  private extractDocumentScenes(prompt: string): string[] {
    const defaultScenes = ['introduction', 'main content', 'conclusion']
    const mentionedScenes: string[] = []

    // Look for section mentions
    const sectionPatterns = [
      /introduction/i,
      /abstract/i,
      /executive\s*summary/i,
      /methodology/i,
      /results/i,
      /discussion/i,
      /conclusion/i,
      /references/i,
      /appendix/i
    ]

    sectionPatterns.forEach(pattern => {
      const match = prompt.match(pattern)
      if (match) {
        mentionedScenes.push(match[0].toLowerCase())
      }
    })

    return mentionedScenes.length > 0 ? mentionedScenes : defaultScenes
  }

  /**
   * Extract expected artifacts from prompt
   */
  private extractExpectedArtifacts(prompt: string): Array<{type: string, name: string}> {
    const artifacts: Array<{type: string, name: string}> = []

    // File type patterns
    const filePatterns = [
      { pattern: /\.html?\b/gi, type: 'html' },
      { pattern: /\.css\b/gi, type: 'css' },
      { pattern: /\.jsx?\b/gi, type: 'javascript' },
      { pattern: /\.tsx?\b/gi, type: 'typescript' },
      { pattern: /\.py\b/gi, type: 'python' },
      { pattern: /\.md\b/gi, type: 'markdown' },
      { pattern: /\.json\b/gi, type: 'json' },
      { pattern: /\.csv\b/gi, type: 'csv' },
      { pattern: /\.pdf\b/gi, type: 'pdf' }
    ]

    filePatterns.forEach(({ pattern, type }) => {
      const matches = prompt.match(pattern)
      if (matches) {
        matches.forEach(match => {
          artifacts.push({
            type,
            name: match.replace('.', '')
          })
        })
      }
    })

    // If no specific files mentioned, infer from task type
    if (artifacts.length === 0) {
      if (prompt.toLowerCase().includes('website')) {
        artifacts.push(
          { type: 'html', name: 'index.html' },
          { type: 'css', name: 'styles.css' }
        )
      } else if (prompt.toLowerCase().includes('document')) {
        artifacts.push({ type: 'markdown', name: 'document.md' })
      }
    }

    return artifacts
  }

  /**
   * Determine artifact dependencies
   */
  private determineArtifactDependencies(
    artifact: {type: string, name: string}, 
    existingSubtasks: SubTask[]
  ): string[] {
    // CSS depends on HTML
    if (artifact.type === 'css') {
      const htmlTask = existingSubtasks.find(t => 
        t.scope?.artifactType === 'html'
      )
      return htmlTask ? [htmlTask.id] : []
    }

    // JavaScript depends on HTML
    if (artifact.type === 'javascript' || artifact.type === 'typescript') {
      const htmlTask = existingSubtasks.find(t => 
        t.scope?.artifactType === 'html'
      )
      return htmlTask ? [htmlTask.id] : []
    }

    return []
  }

  /**
   * Determine artifact priority
   */
  private determineArtifactPriority(artifact: {type: string, name: string}): SubTaskPriority {
    // HTML is usually the foundation
    if (artifact.type === 'html') return 'high'
    
    // CSS and JS are supporting
    if (artifact.type === 'css' || artifact.type === 'javascript') return 'medium'
    
    // Documents are usually primary
    if (artifact.type === 'markdown' || artifact.type === 'pdf') return 'high'
    
    return 'medium'
  }

  /**
   * Check if task can be previewed
   */
  private isPreviewableTask(prompt: string): boolean {
    const previewablePatterns = [
      /website/i,
      /web\s*page/i,
      /html/i,
      /react/i,
      /vue/i,
      /angular/i,
      /frontend/i,
      /ui/i,
      /interface/i
    ]

    return previewablePatterns.some(pattern => pattern.test(prompt))
  }
}
