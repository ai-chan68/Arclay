/**
 * Scenario Indicator Component
 * 
 * Displays detected application scenario and provides scenario-specific actions
 */

import React from 'react';
import { 
  Globe, 
  FileText, 
  Database, 
  Presentation, 
  Code, 
  FolderTree, 
  Zap,
  Eye,
  Download,
  Share2,
  ExternalLink
} from 'lucide-react';
import { cn } from '../../shared/lib/utils';

export type ApplicationScenario = 
  | 'website-generation'
  | 'document-creation'
  | 'data-processing'
  | 'presentation-creation'
  | 'code-development'
  | 'file-organization'
  | 'general-task';

export interface ScenarioIndicatorProps {
  scenario: ApplicationScenario;
  confidence: number;
  outputTypes: string[];
  previewCapable: boolean;
  onPreview?: () => void;
  onExport?: () => void;
  onShare?: () => void;
  onOpenExternal?: () => void;
  className?: string;
}

const scenarioConfig = {
  'website-generation': {
    icon: Globe,
    label: '网站生成',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    description: '正在创建响应式网站'
  },
  'document-creation': {
    icon: FileText,
    label: '文档创建',
    color: 'text-orange-500',
    bgColor: 'bg-orange-50 dark:bg-orange-950/20',
    borderColor: 'border-orange-200 dark:border-orange-800',
    description: '正在生成结构化文档'
  },
  'data-processing': {
    icon: Database,
    label: '数据处理',
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-950/20',
    borderColor: 'border-green-200 dark:border-green-800',
    description: '正在处理和分析数据'
  },
  'presentation-creation': {
    icon: Presentation,
    label: '演示文稿',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-950/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
    description: '正在创建演示文稿'
  },
  'code-development': {
    icon: Code,
    label: '代码开发',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/20',
    borderColor: 'border-indigo-200 dark:border-indigo-800',
    description: '正在开发和优化代码'
  },
  'file-organization': {
    icon: FolderTree,
    label: '文件整理',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/20',
    borderColor: 'border-yellow-200 dark:border-yellow-800',
    description: '正在整理和管理文件'
  },
  'general-task': {
    icon: Zap,
    label: '通用任务',
    color: 'text-gray-500',
    bgColor: 'bg-gray-50 dark:bg-gray-950/20',
    borderColor: 'border-gray-200 dark:border-gray-800',
    description: '正在执行通用任务'
  }
};

export function ScenarioIndicator({
  scenario,
  confidence,
  outputTypes,
  previewCapable,
  onPreview,
  onExport,
  onShare,
  onOpenExternal,
  className
}: ScenarioIndicatorProps) {
  const config = scenarioConfig[scenario];
  const Icon = config.icon;

  return (
    <div className={cn(
      'rounded-lg border p-4',
      config.bgColor,
      config.borderColor,
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg bg-background/50',
            config.color
          )}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{config.label}</h3>
            <p className="text-sm text-muted-foreground">{config.description}</p>
          </div>
        </div>

        {/* Confidence Badge */}
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-background/50 px-2 py-1">
            <span className="text-xs font-medium text-muted-foreground">
              {Math.round(confidence * 100)}% 匹配
            </span>
          </div>
        </div>
      </div>

      {/* Output Types */}
      {outputTypes.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground mb-2">预期输出类型:</p>
          <div className="flex flex-wrap gap-1">
            {outputTypes.map((type) => (
              <span
                key={type}
                className="inline-flex items-center rounded-md bg-background/50 px-2 py-1 text-xs font-medium text-foreground"
              >
                {type.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        {previewCapable && onPreview && (
          <button
            onClick={onPreview}
            className="inline-flex items-center gap-1.5 rounded-md bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/70 transition-colors"
          >
            <Eye className="h-3 w-3" />
            预览
          </button>
        )}

        {onExport && (
          <button
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-md bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/70 transition-colors"
          >
            <Download className="h-3 w-3" />
            导出
          </button>
        )}

        {onShare && (
          <button
            onClick={onShare}
            className="inline-flex items-center gap-1.5 rounded-md bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/70 transition-colors"
          >
            <Share2 className="h-3 w-3" />
            分享
          </button>
        )}

        {onOpenExternal && (
          <button
            onClick={onOpenExternal}
            className="inline-flex items-center gap-1.5 rounded-md bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/70 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            打开
          </button>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>场景识别置信度</span>
          <span>{Math.round(confidence * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-background/50 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              confidence >= 0.8 ? 'bg-green-500' :
              confidence >= 0.6 ? 'bg-yellow-500' :
              'bg-orange-500'
            )}
            style={{ width: `${confidence * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}