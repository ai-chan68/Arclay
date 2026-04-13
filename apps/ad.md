1. Sidecar 与 Tauri 的生命周期耦合存在单点脆弱性
现状：

Tauri 启动时拉取 Sidecar，通过 stdout 解析端口。

如果 Sidecar 崩溃，前端所有 Agent 功能失效，且目前未见 Sidecar 健康检查与自动重启 机制。

改进建议：

在 Tauri 层实现 Sidecar 的 heartbeat 探测（如定期 GET /health），异常时自动重启。

前端应能感知 Sidecar 不可用状态，给予用户友好提示而非静默失败。

2. 状态同步存在潜在一致性问题
现状：

settings.json 与 SQLite settings 表双写，由前端同时维护。

若某一侧写入失败或网络抖动，可能导致配置不一致。

改进建议：

明确单一数据源：以 SQLite 为准，Sidecar 启动时从 SQLite 读取，settings.json 降级为导出快照。

或反之，以文件系统为准，前端只读不写，通过 Tauri 文件监听刷新 UI。

3. Sandbox 默认 native provider 的隔离强度有限
现状：

原生 provider 仅做路径校验和超时控制，无法防御 fork bomb、资源耗尽、网络滥用等攻击。

虽然策略层阻断了一些高风险模式，但模型可能通过编码绕过（如用 Python subprocess.Popen 间接执行）。

改进建议：

优先推荐用户使用 Docker / E2B 等强隔离 provider，并在首次启动时明确提示风险。

在 native provider 下增加 cgroup / ulimit 等资源限制（仅 Linux / macOS 可行，Windows 较困难）。

4. 可观测性不足
现状：

仅有 history.jsonl 记录执行流水，缺乏结构化日志和 metrics。

用户无法查看 Agent 的性能趋势（如平均规划耗时、工具调用成功率）。

改进建议：

在 Sidecar 中引入 pino 等结构化日志库，输出 JSON 格式日志。

在 Tauri 层提供简单的 Dashboard，展示 Agent 运行统计（基于 SQLite 聚合即可）。

5. MCP 配置热加载缺失
现状：

MCP 配置在 Sidecar 启动时读取一次，修改后需重启 Sidecar 生效。

改进建议：

提供 POST /api/v2/config/reload 接口，支持热重载 MCP 和 Skills 配置，提升用户体验。

6. 对多用户 / 多项目场景支持较弱
现状：

全局单一 ~/.arclay/ 目录，所有会话和记忆混在一起。

无法为不同项目隔离上下文和长期记忆。

改进建议：

引入 Workspace 概念，允许用户在项目根目录下创建 .arclay/ 覆盖全局配置。

记忆和计划与项目绑定，提升实用性。