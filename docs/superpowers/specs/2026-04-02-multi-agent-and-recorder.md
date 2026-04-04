# EasyWork 演进方案：多 Agent 协同与录制回放 (Record & Replay)

## Context

在“全能办公执行官”方案的基础上，用户提出了两个核心进阶想法：
1.  **多 Agent 协同**：利用多模型/多任务并行处理复杂需求。
2.  **录制与回放 (Record & Replay)**：通过记录用户的 GUI 或浏览器操作，实现低门槛的自动化流水线。

## 1. 多 Agent 协同方案 (Multi-Agent Orchestration)

### 现状分析
- **后端**：已实现 `MultiAgentOrchestrator`、`TaskDecomposer` 和 `ParallelExecutor`，具备任务拆解和并行执行的能力，但处于“模拟执行”或“实验性”阶段。
- **前端**：已具备 `AgentVisualization` 组件，能展示子任务节点和思考流，但尚未与真实后端 API 闭环。

### 设计方案
- **集成路径**：
    - 在 `src-api/src/routes/agent-new.ts` 中新增 `/api/v2/agent/multi` 路由组，对接 `MultiAgentOrchestrator`。
    - **Planner-Worker 模式**：主 Agent (Opus/Sonnet) 负责拆解任务（Decompose），子 Agent (Haiku) 负责具体执行。执行结果通过 `ResultAggregator` 汇总。
    - **实时反馈**：通过 SSE 发送 `multi_agent_status` 消息，驱动前端 `AgentVisualization` 的节点状态更新（Pending -> Running -> Success）。

## 2. 录制与回放方案 (Record & Replay)

### 设计方案
- **浏览器录制 (Browser Recorder)**：
    - 在 `agent-browser` 环境中集成 `Playwright` 的 `codegen` 能力，或者通过注入脚本记录用户在内置预览窗口的操作（Click, Type, Scroll）。
    - **Schema 定义**：定义一套简洁的 JSON 格式 Action 序列（如 `{ action: 'click', selector: '#login-btn' }`）。
- **回放引擎 (Replay Engine)**：
    - 开发一个专用的 `ReplayTool`，读取 Action 序列并驱动浏览器执行。
    - **AI 增强回放**：如果页面结构发生微调，回放失败，AI 介入进行“自我修复（Self-Healing）”，重新定位元素。
- **GUI 录制 (Native Recorder)**：
    - 针对 Tauri 桌面端，利用 `RobotJS` 或原生系统 API 记录鼠标/键盘坐标（需用户高权限授权）。

## 关键文件建议

- `src-api/src/core/agent/orchestrator/multi-agent-orchestrator.ts`: 完善真实 Agent 池的调用逻辑。
- `src/shared/hooks/useMultiAgent.ts`: 封装多 Agent 状态管理 Hook。
- `src-api/src/services/recorder-service.ts` (新): 处理录制数据的存储与解析。
- `src/components/task-detail/ReplayPanel.tsx` (新): 提供录制后的步骤列表查看与单步回放控制。

## 验证方案

1.  **并行任务验证**：输入“同时帮我写 5 个不同主题的周报”，验证是否启动了 5 个子 Agent 并行生成。
2.  **录制回放验证**：用户手动演示一遍登录内网系统的过程，保存为“登录脚本”，后续通过输入“帮我运行登录脚本”验证是否能自动复现操作。

---