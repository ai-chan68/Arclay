# EasyWork 演进方案：从对话助手到办公执行官 (Final Spec)

## Context

EasyWork 目前已具备扎实的底层能力，包括 V2 二阶段执行架构（规划与执行分离）、深度 MCP 集成。然而，核心挑战在于如何将这些能力转化为用户可感知的生产力，并解决复杂办公场景下的自动化难题。本方案整合了“全能办公执行官”核心愿景，并引入“多 Agent 协同”与“录制回放”作为进阶能力。

## 1. 全能办公执行官 (The Executive Assistant)

### 核心设计
- **规划可视化与审批 (Plan Approval UI)**：
    - 现有 `PlanApproval.tsx` 已实现基础展示。下一步需支持**单个步骤的微调（编辑/删除/排序）**，让用户能精细化干预 AI 方案。
- **办公资产自动化 (Multi-Modal Assets)**：
    - 强化 `PptxPreview`、`ExcelPreview` 的集成，支持从大纲一键生成 PPT/报表。
    - 引入 **“轻量编辑”** 模式：允许用户在预览界面直接修改生成的表格或幻灯片内容，并同步回服务器。
- **网页自动化 (Web Interaction)**：
    - 策略注入：针对 Web 意图，自动开启更符合办公场景的交互策略，优化元素定位和长页面处理。

## 2. 多 Agent 协同 (Multi-Agent Orchestration)

### 设计方向
- **后端闭环**：在 `/api/v2/agent/multi` 路由组中正式对接 `MultiAgentOrchestrator`。
- **Planner-Worker 模式**：
    - 主 Agent (Opus/Sonnet) 负责任务拆解（Decompose）。
    - 子 Agent (Haiku) 负责具体执行（如并行编写多份文档）。
- **可视化增强**：激活 `AgentVisualization` 组件，实时展示子任务节点网络图和并行执行进度。

## 3. 录制与回放 (Record & Replay)

### 创新路径
- **浏览器操作录制**：在 `agent-browser` 窗口集成操作记录器。用户手动演示一遍登录或查询流程，系统自动生成 JSON 格式的 Action 序列。
- **AI 增强回放**：当页面结构变化导致回放失败时，AI 介入进行自动修复（Self-Healing），通过视觉或语义定位新元素。
- **低门槛自动化**：让不具备编程能力的用户，也能通过“演示一次”来创建专属的自动化机器人。

## 关键架构变更

- **后端 (API)**:
    - `src-api/src/services/task-planner.ts`: 注入 Web 交互和多 Agent 协同策略。
    - `src-api/src/routes/agent-new.ts`: 增加多 Agent 并行执行的路由支持。
- **前端 (Web)**:
    - `src/components/task-detail/PlanApproval.tsx`: 增加步骤编辑能力。
    - `src/components/artifacts/ArtifactPreview.tsx`: 增加交互式编辑入口。
    - `src/components/task/agent-visualization.tsx`: 完整集成多 Agent 协同状态。

## 验证方案 (End-to-End)

1.  **PPT 一键生成**：输入“写一份关于 EasyWork 演进的 PPT”，验证是否能生成 PPTX 并允许用户微调大纲后继续生成。
2.  **多任务并行**：输入“同时调研 3 家竞品的定价并汇总”，验证是否启动了 3 个并行子任务并由 `ResultAggregator` 汇总报告。
3.  **录制回放**：手动录制登录 OA 流程，保存为脚本，并在新会话中验证是否能一键复现登录操作。

---
*本规格说明书定义了 EasyWork 未来一个阶段的核心演进路线。*