import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Code2,
  FileText,
  Presentation,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Wrench,
} from 'lucide-react'

type Capability = {
  icon: ReactNode
  title: string
  description: string
  details: string[]
}

type FlowStep = {
  icon: ReactNode
  title: string
  description: string
}

type QuickStart = {
  title: string
  description: string
  prompt: string
}

function reveal(delay: number): CSSProperties {
  return { '--ew-delay': `${delay}ms` } as CSSProperties
}

export function WelcomePage() {
  const navigate = useNavigate()

  const startChat = (prompt?: string) => {
    if (prompt) {
      navigate('/chat', { state: { prompt } })
      return
    }
    navigate('/chat')
  }

  const capabilities: Capability[] = [
    {
      icon: <FileText className="size-4" />,
      title: '文档与方案',
      description: '把零散需求转成结构化文档，支持评审与直接执行。',
      details: ['技术方案、需求说明、会议纪要与周报', '自动补全目标、边界、风险、里程碑'],
    },
    {
      icon: <Code2 className="size-4" />,
      title: '代码与自动化',
      description: '基于项目上下文生成脚本、页面与改造建议，缩短从想法到验证的距离。',
      details: ['支持快速原型与重复任务自动化', '输出可直接继续修改和复用'],
    },
    {
      icon: <BarChart3 className="size-4" />,
      title: '分析与洞察',
      description: '从数据、日志和历史任务中提炼可行动结论，不止停留在“结论”。',
      details: ['自动生成关键发现、异常信号与后续动作', '可沉淀为固定分析模板'],
    },
    {
      icon: <Presentation className="size-4" />,
      title: '演示与沟通',
      description: '按受众视角整理内容结构，快速形成可汇报、可解释的材料。',
      details: ['支持管理层/业务/技术三种讲述深度', '减少从空白页开始的准备成本'],
    },
  ]

  const flowSteps: FlowStep[] = [
    {
      icon: <WandSparkles className="size-4" />,
      title: 'Planning',
      description: '先生成执行计划和产出清单，明确范围后再动手。',
    },
    {
      icon: <ShieldCheck className="size-4" />,
      title: 'Approval',
      description: '关键工具调用进入审批通道，保留过程可追踪性。',
    },
    {
      icon: <CheckCircle2 className="size-4" />,
      title: 'Execution',
      description: '按计划执行并输出本地可验证结果，沉淀到任务库复用。',
    },
  ]

  const quickStarts: QuickStart[] = [
    {
      title: '发布推进方案',
      description: '生成包含风险、里程碑与负责人建议的发布执行计划。',
      prompt: '请根据当前项目给我一份发布推进方案，包含目标、里程碑、风险和执行清单。',
    },
    {
      title: '仓库优化清单',
      description: '扫描代码上下文并给出可落地的 5 条改进建议。',
      prompt: '请读取当前仓库并输出最值得优先优化的5个点，每个点给出收益和改造步骤。',
    },
    {
      title: '周会纪要行动化',
      description: '把纪要转成可执行任务，并给出后续自动提醒建议。',
      prompt: '把这周周会纪要整理成行动清单，按优先级排序并生成可跟进的执行计划。',
    },
  ]

  return (
    <div className="ew-welcome-page relative isolate h-full overflow-x-hidden overflow-y-auto">
      <div className="pointer-events-none fixed inset-0 z-0 ew-welcome-shell" />
      <div className="pointer-events-none fixed inset-0 z-0 ew-welcome-grid" />
      <div className="pointer-events-none fixed inset-x-0 top-[10vh] z-0 h-[70vh] ew-welcome-river" />
      <div className="pointer-events-none fixed left-[14%] top-[22%] z-0 h-40 w-40 rounded-full ew-welcome-orb ew-welcome-float" />
      <div className="pointer-events-none fixed right-[10%] top-[12%] z-0 h-48 w-48 rounded-full ew-welcome-orb ew-welcome-orb-2 ew-welcome-float" />

      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-6xl flex-col px-6 pb-16 pt-8 sm:px-8 lg:px-10">
        <header className="ew-welcome-reveal ew-welcome-header mb-8 flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={reveal(30)}>
          <div className="flex items-center gap-3">
            <div className="ew-welcome-brand-icon inline-flex h-10 w-10 items-center justify-center rounded-xl">
              <Bot className="size-4" />
            </div>
            <div>
              <p className="ew-welcome-kicker">EasyWork</p>
              <p className="text-sm font-semibold tracking-[0.01em] text-[color:var(--ui-text)]">Execution Desk</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => navigate('/scheduled-tasks')} className="ew-button-ghost rounded-xl px-3.5 py-2 text-sm font-medium">
              自动任务中心
            </button>
            <button onClick={() => startChat()} className="ew-button-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold">
              进入工作台
              <ArrowRight className="size-4" />
            </button>
          </div>
        </header>

        <section className="mb-8 grid items-stretch gap-4 lg:grid-cols-[1.25fr_0.9fr]">
          <article className="ew-welcome-reveal ew-welcome-panel p-6 sm:p-8" style={reveal(90)}>
            <div className="ew-welcome-badge mb-5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium">
              <Sparkles className="size-3.5" />
              桌面优先 AI 执行助手
            </div>

            <h1 className="ew-welcome-title max-w-2xl text-balance text-4xl font-semibold leading-[1.08] sm:text-5xl lg:text-[3.35rem]">
              把需求变成
              <span className="block">可执行、可审批、可交付的结果</span>
            </h1>

            <p className="ew-welcome-subtitle mt-6 max-w-2xl text-sm leading-7 sm:text-base">
              以 `Planning - Approval - Execution` 为主链路，支持任务编排、审批回传、成果沉淀和定时执行，
              减少反复沟通，把产出留在本地工程上下文里。
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button onClick={() => startChat()} className="ew-button-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold">
                开始任务
                <ArrowRight className="size-4" />
              </button>
              <button onClick={() => navigate('/library')} className="ew-button-ghost rounded-xl px-5 py-2.5 text-sm font-medium">
                查看成果库
              </button>
            </div>
          </article>

          <article className="ew-welcome-reveal ew-welcome-panel ew-welcome-metrics p-5 sm:p-6" style={reveal(150)}>
            <h2 className="mb-4 text-sm font-semibold tracking-[0.02em] text-[color:var(--ui-text)]">工作闭环能力</h2>
            <div className="space-y-3">
              <div className="ew-welcome-metric rounded-xl p-3.5">
                <p className="ew-welcome-metric-value">两阶段执行</p>
                <p className="ew-welcome-metric-label">先计划后执行，降低直接运行风险</p>
              </div>
              <div className="ew-welcome-metric rounded-xl p-3.5">
                <p className="ew-welcome-metric-value">审批可恢复</p>
                <p className="ew-welcome-metric-label">重启后仍可发现 pending/orphaned 状态</p>
              </div>
              <div className="ew-welcome-metric rounded-xl p-3.5">
                <p className="ew-welcome-metric-value">结果可复用</p>
                <p className="ew-welcome-metric-label">产物入库，支持后续编辑与流程化沉淀</p>
              </div>
            </div>
          </article>
        </section>

        <section className="ew-welcome-reveal ew-welcome-panel mb-8 p-5 sm:p-6" style={reveal(200)}>
          <div className="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[color:var(--ui-subtext)]">
            <WandSparkles className="size-3.5" />
            Core Flow
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {flowSteps.map((step, index) => (
              <article key={step.title} className="ew-welcome-flow-step rounded-xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="ew-welcome-flow-icon inline-flex h-8 w-8 items-center justify-center rounded-lg">{step.icon}</div>
                  <span className="ew-welcome-flow-index">{`0${index + 1}`}</span>
                </div>
                <h3 className="text-sm font-semibold text-[color:var(--ui-text)]">{step.title}</h3>
                <p className="mt-1.5 text-xs leading-6 text-[color:var(--ui-subtext)]">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="ew-welcome-reveal ew-welcome-panel mb-8 p-5 sm:p-6" style={reveal(260)}>
          <div className="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[color:var(--ui-subtext)]">
            <Sparkles className="size-3.5" />
            What You Can Run
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {capabilities.map((item) => (
              <article key={item.title} className="ew-welcome-capability rounded-xl p-4">
                <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg ew-welcome-capability-icon">{item.icon}</div>
                <h3 className="text-base font-semibold text-[color:var(--ui-text)]">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-[color:var(--ui-subtext)]">{item.description}</p>
                <ul className="mt-3 space-y-1.5 text-xs leading-6 text-[color:var(--ui-subtext)]">
                  {item.details.map((detail) => (
                    <li key={detail} className="flex items-start gap-2">
                      <span className="ew-welcome-dot mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.25fr_0.9fr]">
          <article className="ew-welcome-reveal ew-welcome-panel p-5 sm:p-6" style={reveal(320)}>
            <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[color:var(--ui-subtext)]">
              <Clock3 className="size-3.5" />
              One-click Start
            </div>
            <div className="grid gap-3">
              {quickStarts.map((item) => (
                <button key={item.title} onClick={() => startChat(item.prompt)} className="ew-welcome-prompt rounded-xl p-4 text-left">
                  <p className="text-sm font-semibold text-[color:var(--ui-text)]">{item.title}</p>
                  <p className="mt-1 text-xs leading-6 text-[color:var(--ui-subtext)]">{item.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--ui-accent)]">
                    直接开始
                    <ArrowRight className="size-3.5" />
                  </span>
                </button>
              ))}
            </div>
          </article>

          <article className="ew-welcome-reveal ew-welcome-panel p-5 sm:p-6" style={reveal(380)}>
            <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[color:var(--ui-subtext)]">
              <CalendarClock className="size-3.5" />
              Extendability
            </div>
            <div className="grid gap-3">
              <button onClick={() => navigate('/scheduled-tasks')} className="ew-welcome-link-card rounded-xl p-4 text-left">
                <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-md ew-welcome-link-icon">
                  <CalendarClock className="size-4" />
                </div>
                <p className="text-sm font-semibold text-[color:var(--ui-text)]">自动任务编排</p>
                <p className="mt-1 text-xs leading-6 text-[color:var(--ui-subtext)]">Cron 校验、即时运行、执行历史与熔断保护。</p>
              </button>

              <button onClick={() => navigate('/library')} className="ew-welcome-link-card rounded-xl p-4 text-left">
                <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-md ew-welcome-link-icon">
                  <BookOpen className="size-4" />
                </div>
                <p className="text-sm font-semibold text-[color:var(--ui-text)]">成果库沉淀</p>
                <p className="mt-1 text-xs leading-6 text-[color:var(--ui-subtext)]">任务与文件统一归档，便于追溯和二次加工。</p>
              </button>

              <button onClick={() => startChat('请根据当前项目给我一个可执行的技能路由策略建议。')} className="ew-welcome-link-card rounded-xl p-4 text-left">
                <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-md ew-welcome-link-icon">
                  <Wrench className="size-4" />
                </div>
                <p className="text-sm font-semibold text-[color:var(--ui-text)]">Skills 能力路由</p>
                <p className="mt-1 text-xs leading-6 text-[color:var(--ui-subtext)]">按任务自动选择技能，支持生态来源管理与更新。</p>
              </button>
            </div>
          </article>
        </section>
      </div>
    </div>
  )
}
