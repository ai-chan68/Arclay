/**
 * Vite Preview Component
 *
 * Live preview interface with iframe integration
 */

import React from 'react';
import { Play, Square, RefreshCw, ExternalLink, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { PreviewStatus } from '../../shared/types/artifacts';

export interface VitePreviewProps {
  previewUrl: string | null;
  status: PreviewStatus;
  error: string | null;
  onStart?: () => void;
  onStop?: () => void;
  onRefresh?: () => void;
  embedded?: boolean;
}

export function VitePreview({
  previewUrl,
  status,
  error,
  onStart,
  onStop,
  onRefresh,
  embedded = false
}: VitePreviewProps) {
  const handleOpenExternal = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  const getStatusMeta = (currentStatus: PreviewStatus) => {
    switch (currentStatus) {
      case 'running':
        return { text: '实时渲染中', tone: 'text-emerald-500', dot: 'bg-emerald-500' };
      case 'starting':
        return { text: '正在启动预览服务', tone: 'text-amber-500', dot: 'bg-amber-500 animate-pulse' };
      case 'stopping':
        return { text: '正在停止预览服务', tone: 'text-orange-500', dot: 'bg-orange-500' };
      case 'error':
        return { text: '预览服务异常', tone: 'text-red-500', dot: 'bg-red-500' };
      default:
        return { text: '实时预览未启动', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/60' };
    }
  };

  const statusMeta = getStatusMeta(status);

  const renderEmptyState = (
    icon: React.ReactNode,
    title: string,
    description: string,
    action?: React.ReactNode
  ) => (
    <div className={cn(
      'flex h-full items-center justify-center p-6',
      embedded ? '' : 'bg-[color-mix(in_oklab,var(--ui-panel-2)_70%,#fff_30%)]'
    )}>
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--ui-accent-soft)_72%,transparent)] text-[var(--ui-subtext)]">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-[var(--ui-text)]">{title}</h3>
        <p className="mt-1 max-w-xs text-xs text-[var(--ui-subtext)]">{description}</p>
        {action}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded && (
        <div className="ew-card mx-2 mt-2 flex shrink-0 items-center justify-between rounded-xl px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', statusMeta.dot)} />
              <span className={cn('text-xs font-medium', statusMeta.tone)}>
                {statusMeta.text}
              </span>
            </div>
            {previewUrl && (
              <span className="truncate text-xs text-[var(--ui-subtext)]">{previewUrl}</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {status === 'idle' && onStart && (
              <button
                onClick={onStart}
                className="ew-button-primary rounded-md px-2.5 py-1 text-xs font-medium"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Play className="size-3.5" />
                  启动
                </span>
              </button>
            )}

            {(status === 'starting' || status === 'running') && onStop && (
              <button
                onClick={onStop}
                className="rounded-md bg-[var(--ui-danger-soft)] px-2.5 py-1 text-xs font-medium text-red-500"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Square className="size-3.5" />
                  停止
                </span>
              </button>
            )}

            {status === 'running' && onRefresh && (
              <button
                onClick={onRefresh}
                className="ew-button-ghost rounded-md px-2 py-1 text-xs font-medium"
                title="刷新"
              >
                <RefreshCw className="size-3.5" />
              </button>
            )}

            {previewUrl && (
              <button
                onClick={handleOpenExternal}
                className="ew-button-ghost rounded-md px-2 py-1 text-xs font-medium"
                title="在新窗口打开"
              >
                <ExternalLink className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className={cn(
        'min-h-0 flex-1 p-2',
        embedded ? 'p-0' : ''
      )}>
        <div className={cn(
          'h-full overflow-hidden rounded-lg',
          embedded
            ? 'bg-[color-mix(in_oklab,var(--ui-panel)_82%,#fff_18%)]'
            : 'bg-[color-mix(in_oklab,var(--ui-panel-2)_76%,#fff_24%)] p-2'
        )}>
          {status === 'starting' && renderEmptyState(
            <Loader2 className="size-6 animate-spin" />,
            '正在启动预览服务',
            '首次启动可能需要一点时间，请稍候。'
          )}

          {status === 'error' && renderEmptyState(
            <AlertCircle className="size-6 text-red-500" />,
            '预览启动失败',
            error || '请检查依赖安装和入口文件配置。',
            onStart ? (
              <button
                onClick={onStart}
                className="ew-button-primary mt-3 rounded-md px-3 py-1.5 text-xs font-medium"
              >
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className="size-3.5" />
                  重新启动
                </span>
              </button>
            ) : undefined
          )}

          {status === 'idle' && renderEmptyState(
            <Play className="size-6" />,
            '实时预览已就绪',
            '点击启动后可自动刷新查看变更。',
            onStart ? (
              <button
                onClick={onStart}
                className="ew-button-primary mt-3 rounded-md px-3 py-1.5 text-xs font-medium"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Play className="size-3.5" />
                  启动预览
                </span>
              </button>
            ) : undefined
          )}

          {status === 'running' && previewUrl && (
            <div className={cn(
              'h-full rounded-lg',
              embedded
                ? 'bg-[color-mix(in_oklab,var(--ui-panel-2)_84%,#fff_16%)] p-1.5'
                : 'bg-[color-mix(in_oklab,var(--ui-panel)_84%,#fff_16%)]'
            )}>
              <div className={cn(
                'h-full overflow-hidden rounded-md',
                embedded
                  ? 'bg-[color-mix(in_oklab,var(--ui-panel)_84%,#fff_16%)]'
                  : 'bg-white'
              )}>
                <iframe
                  src={previewUrl}
                  className="h-full w-full border-0"
                  title="Live Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                />
              </div>
            </div>
          )}

          {status === 'stopping' && renderEmptyState(
            <Loader2 className="size-6 animate-spin text-orange-500" />,
            '正在停止预览服务',
            '请稍候...'
          )}
        </div>
      </div>
    </div>
  );
}
