# Arclay Skill 增强 Spec

> 日期: 2026-04-04
> 主题: GitHub URL 导入 + AI 分析式创建 Skill
> 状态: Draft

## 1. 背景

当前 Arclay 的 Skill 能力已经具备一部分底层基础：

- 项目内 `SKILLs/` 目录扫描与加载
- Skills 来源管理
- 从 `local` / `git` / `http` source 安装 skill
- 基于来源的 skill update / repair

但这些能力还没有被组织成一个足够直接的产品入口。

对于普通用户，现有交互仍然偏底层：

- GitHub skill 需要先手工配置 source，再执行安装
- 本地导入依然以目录路径为主
- AI 创建 skill 的流程不存在
- skill 复杂度不同，但系统没有“先分析，再决定生成哪些文件”的能力

因此需要把“GitHub URL 导入”和“AI 创建 skill”收敛成面向用户的两条主流程。

## 2. 目标

本期目标：

- 支持用户直接输入 GitHub URL 导入 skill
- 支持仓库级 URL 和子目录级 URL
- 当识别出多个 skill 时，默认全选，但允许用户取消部分
- 导入完成后，将来源登记为可追踪 source，供后续 update / repair 使用
- 支持用户通过自然语言描述来创建 skill
- AI 创建采用“两阶段”流程：
  - 先分析需求并推荐所需文件结构
  - 用户确认后再生成实际文件
- 生成结果按 skill 复杂度决定，不强制统一生成完整模板

本期不做：

- 不支持单个 `raw SKILL.md` 文件 URL 导入
- 不支持未确认即直接生成文件
- 不支持已有 skill 目录上的覆盖式生成
- 不支持在首期自动推断并生成所有可能的复杂工程骨架

## 3. 用户问题

### 3.1 GitHub 导入

用户已经知道某个 GitHub 仓库里有可用 skill，但当前必须理解 source 概念，并手工输入：

- 来源名称
- 来源类型
- 仓库地址
- 是否 trusted

这对非技术用户过于底层。

用户真正想做的是：

- 粘贴一个 GitHub URL
- 看看系统识别到了哪些 skill
- 选择要导入的 skill
- 一步完成安装

### 3.2 AI 创建

用户知道自己想要什么 skill，但不清楚 skill 应该有哪些文件。

不同 skill 的复杂度差异很大：

- 简单 skill 只需要 `SKILL.md`
- 中等复杂度 skill 可能需要 `references/`
- 带自动化逻辑的 skill 可能需要 `scripts/`
- 某些 skill 可能还需要 `assets/`

如果系统统一生成完整模板，会制造大量噪音文件。

用户真正想要的是：

- 描述需求
- 让系统分析 skill 的复杂度
- 由系统推荐需要哪些文件
- 由用户确认后再生成

## 4. 设计原则

- 先分析，再执行
- 用户确认优先，不做隐式落盘
- 产物结构由 skill 复杂度决定，不使用固定模板
- GitHub URL 的解析与扫描逻辑放后端，避免前后端逻辑漂移
- 导入结果要与 source 体系打通，保证后续 update / repair 可用
- 失败时不留下半成品目录

## 5. 方案概览

新增两个高频入口：

- `从 GitHub 导入`
- `AI 创建`

保留现有入口：

- `来源管理`
- `本地路径导入`

这样分层后的定位如下：

- `从 GitHub 导入`
  - 面向普通用户的快捷入口
- `AI 创建`
  - 面向从零创建 skill 的用户
- `来源管理`
  - 面向进阶用户的长期 source 管理
- `本地路径导入`
  - 面向本地开发和手工调试场景

## 6. GitHub URL 导入设计

### 6.1 支持范围

首期支持两类 URL：

- 仓库级 URL
  - `https://github.com/org/repo`
- 子目录级 URL
  - `https://github.com/org/repo/tree/main/skills/foo`

首期不支持：

- 单文件 `raw` URL
- 非 GitHub 平台 URL 的快捷识别

### 6.2 主流程

1. 用户打开 `从 GitHub 导入` 弹窗
2. 输入 GitHub URL
3. 点击 `分析`
4. 后端解析 URL，识别：
   - 仓库地址
   - 分支
   - 子路径
5. 后端扫描可安装 skill，返回候选列表
6. 前端展示识别结果
7. 如果识别出多个 skill：
   - 默认全选
   - 用户可以取消部分
8. 用户点击 `导入`
9. 后端安装选中的 skill，并登记或复用对应 source
10. 前端刷新 skill 列表并提示成功

### 6.3 多 Skill 仓库行为

当 URL 对应的仓库或路径下识别出多个 skill 时：

- 默认全部选中
- 用户可以取消不需要的 skill
- 如果用户把全部候选取消，则禁止提交

### 6.4 Source 关联

GitHub 导入完成后，必须让结果进入现有 source 体系，而不是只做一次性复制。

要求：

- 若该 URL 对应 source 已存在，则复用
- 若不存在，则创建新的 `git` source
- 后续该 source 可用于：
  - update
  - repair

### 6.5 API 设计

#### `POST /api/settings/skills/import/github/analyze`

输入：

```json
{
  "url": "https://github.com/org/repo/tree/main/skills/foo"
}
```

输出：

```json
{
  "success": true,
  "repoUrl": "https://github.com/org/repo",
  "branch": "main",
  "subpath": "skills/foo",
  "skills": [
    {
      "name": "foo-skill",
      "path": "skills/foo",
      "description": "..."
    }
  ],
  "defaultSelectedSkillNames": ["foo-skill"],
  "sourceDraft": {
    "provider": "github",
    "type": "git",
    "repoUrl": "https://github.com/org/repo",
    "branch": "main",
    "subpath": "skills/foo"
  }
}
```

#### `POST /api/settings/skills/import/github/execute`

输入：

```json
{
  "url": "https://github.com/org/repo/tree/main/skills/foo",
  "selectedSkillNames": ["foo-skill"]
}
```

输出：

```json
{
  "success": true,
  "installed": [
    {
      "skillId": "project:foo-skill",
      "name": "foo-skill",
      "path": "..."
    }
  ],
  "source": {
    "id": "source_xxx",
    "provider": "github",
    "type": "git"
  }
}
```

### 6.6 后端实现要求

- GitHub URL 解析逻辑统一放后端
- 支持识别 repo / branch / subpath
- 分析阶段和执行阶段都应复用同一套解析逻辑
- 对于子目录级 URL，扫描范围应限制在对应子路径
- 执行阶段只安装用户确认的 skill
- source 创建与 skill 安装应保持一致性

## 7. AI 创建 Skill 设计

### 7.1 核心思路

AI 创建不能直接套固定模板。

系统必须先判断 skill 的复杂度，再推荐需要哪些文件。

产物不是“统一模板”，而是“推荐结构”。

### 7.2 主流程

1. 用户打开 `AI 创建` 弹窗
2. 输入 skill 目标描述
3. 可选输入：
   - GitHub URL
   - 参考说明文本
4. 用户点击 `分析需求`
5. 后端返回：
   - 推荐的 skill 名称
   - 摘要说明
   - 推荐文件结构
   - 每个文件的推荐理由
6. 前端展示推荐结构
7. 用户确认后点击 `生成`
8. 后端生成实际文件并写入 `SKILLs/<skill-name>/`
9. 前端刷新 skill 列表并提示成功

### 7.3 结构推荐规则

推荐结构遵循以下原则：

- 简单 skill：
  - 只推荐 `SKILL.md`
- 需要补充说明的 skill：
  - 推荐 `SKILL.md` + `references/...`
- 需要执行脚本的 skill：
  - 推荐 `SKILL.md` + `scripts/...`
- 需要视觉或静态资源的 skill：
  - 在必要时推荐 `assets/...`

系统只推荐必要文件，不为了“完整”而补齐无价值目录。

### 7.4 用户确认机制

用户在生成前必须能看到：

- 推荐文件列表
- 每个文件的作用说明

交互要求：

- 非必需文件允许取消
- 若只保留 `SKILL.md` 也允许生成
- 未经确认不可落盘

### 7.5 API 设计

#### `POST /api/settings/skills/create/analyze`

输入：

```json
{
  "prompt": "我想创建一个 skill，用于根据 GitHub 仓库 README 自动生成发布说明",
  "githubUrl": "https://github.com/org/repo"
}
```

输出：

```json
{
  "success": true,
  "skillName": "release-note-generator",
  "summary": "用于从仓库上下文生成发布说明的 skill",
  "recommendedStructure": [
    {
      "path": "SKILL.md",
      "required": true,
      "reason": "定义 skill 元信息、触发条件和执行流程"
    },
    {
      "path": "references/readme-summary.md",
      "required": false,
      "reason": "保存对仓库背景的结构化提炼，供 SKILL.md 引用"
    }
  ]
}
```

#### `POST /api/settings/skills/create/execute`

输入：

```json
{
  "skillName": "release-note-generator",
  "prompt": "我想创建一个 skill，用于根据 GitHub 仓库 README 自动生成发布说明",
  "selectedStructure": [
    {
      "path": "SKILL.md"
    },
    {
      "path": "references/readme-summary.md"
    }
  ]
}
```

输出：

```json
{
  "success": true,
  "skill": {
    "id": "project:release-note-generator",
    "name": "release-note-generator",
    "path": "..."
  }
}
```

### 7.6 生成约束

- 若目标目录已存在，首期拒绝覆盖
- 生成过程先写入临时目录
- 所有文件成功后，再原子移动到最终目录
- 任意一步失败，清理临时目录，不留下半成品

## 8. 数据模型调整

### 8.1 `SkillSourceConfig`

现有 `SkillSourceConfig` 可继续复用，但建议补充 GitHub 语义字段：

- `provider?: 'github' | 'generic'`
- `repoUrl?: string`
- `subpath?: string`

目的：

- 让 GitHub source 在后续展示上更自然
- 避免只把 GitHub 当作普通 `git` URL 看待

### 8.2 `SkillGenerationDraft`

新增临时草案对象，仅作为分析接口返回值，不写入 settings：

- `skillName`
- `summary`
- `recommendedStructure[]`
- `reasons[]`

该对象用于承接：

- AI 分析输出
- 前端确认状态
- 执行接口输入

## 9. 前端交互设计

### 9.1 Skills 页面入口

在 Skills 页面新增两个入口按钮：

- `从 GitHub 导入`
- `AI 创建`

保留现有：

- 来源管理面板
- 本地导入弹窗

### 9.2 GitHub 导入弹窗

状态流转：

- `idle`
- `analyzing`
- `analyzed`
- `executing`
- `success`
- `error`

展示内容：

- 输入框：GitHub URL
- 分析结果：
  - repo
  - branch
  - subpath
  - 识别出的 skill 列表
- 多选框列表：
  - 默认全选
  - 可取消部分

### 9.3 AI 创建弹窗

状态流转：

- `idle`
- `analyzing`
- `analyzed`
- `executing`
- `success`
- `error`

展示内容：

- 输入框：skill 描述
- 可选输入：GitHub URL / 参考文本
- 推荐结构预览：
  - 文件路径
  - 是否必需
  - 推荐理由
- 用户确认后执行生成

## 10. 错误处理

### 10.1 GitHub 导入

- URL 非法
  - 前端做基础格式校验
  - 后端做严格校验
- URL 可访问但无法识别 skill
  - 返回明确错误：未找到可安装 skill
- 子路径不存在
  - 返回 repo / branch / subpath 级别的具体错误
- 多 skill 全部被取消
  - 前端禁止提交

### 10.2 AI 创建

- 输入描述过于模糊，无法分析出结构
  - 返回可读错误，并允许用户修改描述后重试
- 目标目录已存在
  - 拒绝写入，提示改名或手工清理
- 生成过程失败
  - 不写入任何最终目录
  - 返回失败原因

## 11. 验收标准

### 11.1 GitHub 导入

- 能识别并导入单 skill 仓库
- 能识别并导入子目录级 skill URL
- 多 skill 仓库分析后默认全选，允许用户取消部分
- 导入后 skill 立即出现在 Skills 列表
- 导入结果能够继续使用 update / repair

### 11.2 AI 创建

- 对简单需求，只推荐 `SKILL.md`
- 对复杂需求，可推荐 `scripts/`、`references/`、`assets/` 中的必要子集
- 用户确认后才生成
- 生成结果目录结构与确认内容一致
- 失败时不留下半成品目录

## 12. 测试建议

建议至少覆盖以下测试：

- GitHub URL 解析：
  - repo URL
  - tree URL
  - 非法 URL
- GitHub 扫描：
  - 单 skill
  - 多 skill
  - 子路径不存在
- 执行安装：
  - 全选安装
  - 部分安装
- AI 分析：
  - 简单 skill 仅推荐 `SKILL.md`
  - 复杂 skill 推荐额外文件
- AI 生成：
  - 成功写入
  - 目录冲突
  - 生成失败回滚

## 13. 分阶段实施建议

### Phase 1

- GitHub URL 分析接口
- GitHub URL 导入弹窗
- 多 skill 默认全选并可取消
- source 自动登记

### Phase 2

- AI 创建分析接口
- AI 创建弹窗
- 推荐结构确认流
- 生成落盘与回滚

### Phase 3

- 更丰富的 GitHub source 展示
- AI 创建结果的编辑预览
- 复杂 skill 的更细粒度结构建议

## 14. 结论

本需求的核心不是“再加一个导入按钮”，而是把现有底层能力升级为两个明确的用户级产品流程：

- GitHub URL 导入
- AI 分析式创建

其中最关键的产品原则是：

- GitHub 导入要隐藏 source 底层细节
- AI 创建必须先分析 skill 复杂度，再推荐文件结构
- 用户确认后再生成

只有这样，系统才能同时兼顾：

- 非技术用户的可用性
- skill 复杂度差异
- 现有 source/update/repair 体系的延续性
