# 双投影生成式文本展演设计

- 状态：展演方向与“两仓库＋产品新 worktree”边界已获项目所有者确认
- 修订日期：2026-08-28
- 计划窗口：按本次修订计，距离布展约四天；实际安装时间是不可延后的硬截止
- 展演形态：两台投影并列，不做光学叠加，不把副屏伪装成 JanVim Float
- 内容策略：AI 文本、公式和图像全部提前生成、筛选、校对并固化；现场只做实时感回放
- 产品边界：本仓库不是 JanVim 浮窗、Task26 或社区插件兼容的完成证据
- 主屏首选基线：`v0.10.1-gmk.4` /
  `e95633101d93f8448b0f906e918b5d836ab95273` 的人工实测黄金谱系
- 决策：
  [ADR-0001](../adr/0001-separate-show-repository-and-deterministic-replay.md)
- 实施计划：
  [四日双投影交付计划](../plans/2026-08-28-four-day-dual-projector-delivery.md)

## 1. 决策摘要

展览不再以 JanVim 原生 Float 是否完成为前提。两台投影承担不同、但存在明确因果关系的
叙事职责：

| 屏幕 | 叙事角色 | 主要内容 |
|---|---|---|
| 工程投影主屏 | 行动、身体、痕迹 | 真实 JanVim 竖排诗文、Swordsman 光标、跳转、选择、删除、插入和异化后的混合文本 |
| 坚果投影副屏 | 思考、提示、生成 | 诗句采样、提示词形成、预生成论文逐块显现、采纳过程，间歇出现公式、矩阵场、图像和键盘操作 |

副屏先公开“为什么生成”和“如何生成”，在一个段落获得预编排的采纳状态后发出
`editor-action`。主屏中的真实 JanVim 光标随后完成对应写回：

```text
诗文被读取
  -> 提示词被组织
  -> 预生成论文段落逐块显现
  -> 段落被标记为采纳
  -> 主屏光标飞越、选择和插入
  -> 诗文逐轮异化为信息论论文
```

现场没有模型推理、文生图或网络请求。观众看到的“流式生成”“停顿”“重试”和“选择”
来自一个确定性演出脚本，但素材可以在展前由真实模型生成并保留完整来源记录。

## 2. 艺术目标与验收结果

### 2.1 艺术目标

1. 主屏保持真实编辑器的物质感，不播放预录屏幕录像。
2. 光标是表演主体：短距离穿行如游走，长距离移动如侠客越过文字丛林，落点发生改写。
3. 副屏把提示、限制、重试、生成和采纳公开化，让“论文”具有可见的生产过程。
4. 公式、矩阵和图像只在节奏高潮出现，不取代提示词和生成文本的主线。
5. 中途进入的观众能在 90–120 秒内看到一组完整的“生成 -> 写回”因果事件。
6. 完整观看时，观众能辨认诗文逐步变成论文、同时仍保留诗文碎片的过程。

### 2.2 工程验收

- 两屏连续完成至少三个完整循环，累计可见漂移小于 250 ms。
- 副屏段落只有在“生成完成/采纳”之后，主屏才执行对应编辑动作。
- 键盘可视化与主屏实际语义动作来自同一 cue，不出现伪按键或错序。
- 主屏只编辑内存副本，永不覆盖原诗、JanVim 仓库或用户文件。
- 断网时 Prompt、Response、键盘层和 P1 素材仍完整运行。
- 公式、矩阵或图像失败时，Prompt/Response 主循环继续。
- 任一进程异常后，系统在黑场或安全断点有限恢复，不停留在半段写入状态。
- 两台真实投影完成三轮循环、一次断网和一次强制重启演练。

### 2.3 诚实声明

对外说明必须同时包含：

- 主屏是真实 JanVim/Neovim 编辑；
- 副屏是独立的确定性展演应用；
- AI 内容是展前生成、人工编排的回放；
- 副屏不是 JanVim 原生 Float；
- 展演成功不证明 Task26 或 AstroNvim/社区插件兼容完成。

## 3. 推荐架构

采用“单一 TypeScript 控制器 + Electron 双显示器窗口 + localhost Lua 展演代理”。

```text
冻结内容包
  show.manifest.json
  poem.txt
  generated-segments.json
  formulas.json
  media-manifest.json
  media-local/*
           |
           v
Electron main / Show Controller（唯一单调时钟）
  |- Display Router ----------> 坚果投影：Secondary Web Renderer
  |- PID Window Placer -------> 工程投影：JanVim 外部 Winit 窗口
  |- Cue Scheduler ------------> prompt/token/formula/matrix/image/fade
  |- Key Overlay Stream -------> 与 editor-action 同源的按键可视化
  |- TCP Cue Bridge -----------> Neovim Lua show agent
  |- Process Supervisor -------> 固定 JanVim artifact
  `- bounded log / safe state
                                    |
                                    v
                         工程投影：真实 JanVim
                         Vertical-RL + Swordsman cursor
```

选择该架构的原因：

- 两屏共享一个时间真相；
- 主屏仍然是真实 JanVim 编辑；
- JanVim 窗口按子进程 PID 而不是易变标题定位到工程投影；
- 键盘显示和实际动作不会分叉；
- 内容和时间可以通过 JSON 调整，不改产品代码；
- 副屏失败时可退化为主屏单独循环；
- 重启后可以从循环边界重新同步。

不采用 AutoHotkey、全局按键注入、坐标点击或两侧独立播放同一时间表。

## 4. 仓库和产物边界

本仓库建议结构：

```text
apps/controller/              Electron main、显示路由、进程监督、唯一时钟
apps/secondary-screen/        Prompt/Response/Formula/Matrix/Image/KeyOverlay
packages/show-schema/         manifest、cue、协议和运行时验证
nvim/lua/janvim_exhibition/   展演专用 Lua agent
content/                      可提交的小型文本、提示、时间轴和公式
content/media-local/          不入 Git 的大媒体工作副本
show/                         显示器映射、运行配置、安全页
scripts/                      启动、巡检、打包、hash 和恢复
tests/                        fake-clock、schema、controller、bridge、renderer tests
docs/                         ADR、设计、计划、排练与事故记录
janvim-artifact.lock.json     主屏不可变产物身份
media-manifest.json           大媒体相对路径、大小、hash、来源和备份
```

本仓库不得包含 JanVim 源码或 Git submodule。打包阶段可把通过 hash 校验的便携发布物复制到
忽略目录 `runtime/janvim/`，但 Git 中只保留 lock。

`janvim-artifact.lock.json` 最少记录以下字段；所有 hash 字段都必须由冻结脚本从实际字节
计算，不能由人手抄或使用说明性值：

| 字段 | 固定规则 |
|---|---|
| `schema` | 整数 `1` |
| `sourceRepository` | `D:/github/JanVim` |
| `tag` | `v0.10.1-gmk.4` |
| `commit` | `e95633101d93f8448b0f906e918b5d836ab95273` |
| `archive` | `JanVim-win-x64.zip` |
| `archiveSha256` | 实际 ZIP 的 64 位小写 SHA-256 |
| `coreSha256` | 实际 `janvim-core.exe` 的 64 位小写 SHA-256 |
| `configSha256` | 实际 show config 的 64 位小写 SHA-256 |
| `layoutEngine` | 物理 A/B 后固定为 `dynamic` 或 `orthogonal` |
| `role` | `primary-projector` |

冻结任务必须先在同目录写临时 lock，重新校验全部文件后再原子替换正式文件；未冻结前不创建
伪 lock。

## 5. 控制器与时间轴

### 5.1 Show Controller

控制器是唯一状态机，只负责：

- 枚举显示器并加载人工确认的映射；
- 启动 JanVim 后调用 show-only Windows helper，以子进程 PID 找到唯一顶层窗口并放置到工程
  投影；
- 预载、校验本地内容和媒体；
- 启动副屏窗口和固定 JanVim 进程；
- 等待副屏与 Lua agent ready；
- 用单调时钟调度 cue；
- 对关键编辑 cue 等待有限 ACK；
- 在循环末原子 reset；
- 写有限结构化日志；
- 在安全断点有限重启。

控制器不生成文本、不修改内容、不决定艺术语义。

### 5.2 外部 JanVim 窗口安置

Electron 只能直接安置自己的副屏窗口，不能假设外部 Winit 窗口自动出现在工程投影。
`place-janvim-window.ps1` 使用 Windows `EnumWindows`、`GetWindowThreadProcessId`、
`SetWindowPos` 和 `ShowWindowAsync` 完成一次有界安置：

- 只接受 controller 刚创建的 JanVim PID，不按窗口标题或进程名模糊匹配；
- 最多等待 10 秒，且必须只找到一个可见、非 owned popup 的顶层窗口；
- 目标矩形来自已人工确认的 `display-map.json`；
- 安置后重新读取 window rect，允许每边最多 2 px 的 Windows decoration 偏差；
- 未找到、找到多个或矩形不符时保持副屏 ready，不开始 loop；
- helper 不发送按键、不点击、不改全局显示设置，也不控制其他进程窗口。

窗口自动安置不能替代最后的物理确认。第四天仍须人工确认工程投影/坚果投影角色、焦点、
标题栏/任务栏是否进入投影画面，并据此冻结显示配置。

### 5.3 Cue 模型

```ts
type CueTarget = "main" | "secondary" | "both";

type ShowCue = {
  id: string;
  atMs: number;
  target: CueTarget;
  kind:
    | "prompt"
    | "token-stream"
    | "formula"
    | "matrix"
    | "image"
    | "editor-action"
    | "key-overlay"
    | "fade"
    | "reset";
  durationMs?: number;
  payload: unknown;
};
```

每个 ID 在一个 manifest 中唯一。`loopId + cueId` 是幂等键。普通视觉 cue 可以在轻微
卡顿后追赶；编辑 cue 不得跳过或重复。超过关键 cue deadline 时，控制器进入最近黑场，
丢弃本轮后续编辑并从原诗重启。

### 5.4 同步阈值

- 本机 cue 发出到两端 ACK：P95 小于 100 ms；
- 观众可见的因果错位：小于 250 ms；
- 三个循环累计漂移：小于 250 ms；
- 主屏失败后进入新循环：30 秒内；
- 关键 ACK 超时：单 cue 最大 2 秒，最多一次重试；
- 同一进程 10 分钟内最多三次自动重启，之后显示安全页等待人工处理。

## 6. 主屏 JanVim/Lua agent

Lua agent 是展演插件，不是 JanVim 产品修改。它只接受闭集动作：

- `prepare`：从已校验 poem snapshot 创建新 `nofile` buffer；
- `normal`：执行白名单 Normal-mode keys；
- `insert`：输入一个预编排、长度受限的 UTF-8 text chunk；
- `select`：选择 manifest 中命名的已知范围；
- `replace`：替换已知范围；
- `wait`：只作为动作序列语义，不占用 controller 时钟所有权；
- `reset`：销毁本轮 buffer，从 snapshot 新建；
- `status`：返回 loop/cue/mode/cursor/hash；
- `shutdown`：自然退出展演会话。

安全约束：

- buffer 为 `buftype=nofile`；
- 不设置真实源文件名；
- `swapfile=false`、`undofile=false`；
- 禁止 `:write`、shell command 和任意 Ex 字符串；
- 每个 text chunk 不超过 512 UTF-8 bytes；
- 每个 loop 最多 256 个 editor actions；
- 重复幂等键只返回原 ACK，不再次写入；
- reset 校验当前文本 hash 并丢弃整个临时 buffer。

动作优先走 Neovim 公开 API/输入路径，使真实模式切换、字形变化和 Swordsman 光标可见。

### 6.1 layout engine A/B

gmk.4 的 `dynamic` 排版已获人工接受，`orthogonal` 可能具有更完整的抛物线/火花表现。
第一天做一次真实 A/B：

- orthogonal 若保持目标诗文的已接受竖排、字体和列节奏，展演可固定 orthogonal；
- orthogonal 若破坏排版，保持 dynamic，只编排可见的长距离弹簧/拖尾，不宣称抛物线或
  火花；
- 最终选择写入 artifact lock，不开发新 VFX。

## 7. 副屏 Web Renderer

副屏是一块“推理仪表/生成工作台”，不是聊天软件复制品。P0 模块：

1. Prompt Composer：诗句、约束、术语、拒绝项、最终 prompt 的逐层构成。
2. Response Stream：预定 token chunk、删改/重试、最终采纳状态。
3. Key Overlay：来自 editor-action 的显示键、物理解释和语义目的。
4. Safety/Ready Page：显示器、素材、主屏和 bridge 状态。

P1 模块：

5. Formula Plate：固定 KaTeX 公式与纯文本 fallback。
6. Matrix Field：固定 seed 的 Canvas 2D 场，不依赖运行时 RNG。
7. Image Plate：2–3 幅预生成图片的有限淡入/裁切。

Prompt 和 Result 使用稳定分区，不能随着 token 持续重排全屏。采纳状态使用 JanVim 朱砂
色；公式/图像持续时间短于文本场景，并可独立跳过。

### 7.1 Key Overlay

每项显示：

- `gg`、`12j`、`w`、`v`、`i`、`Esc` 等展示键；
- JanVim 物理方向解释；
- “跳至下一论证节点”“选择诗句”“插入生成段落”等目的；
- bounded dwell/fade。

只保留最近 4–6 项，重复键聚合为 `j × 12`。它不监听系统键盘。

## 8. 默认六分钟循环

原八分钟方案在四日窗口中缩减为六分钟，且完全数据化：

| 时间 | 主屏 | 副屏 |
|---|---|---|
| 00:00–00:35 | 完整诗文、低频巡游 | 标题、诗句采样、ready 退场 |
| 00:35–01:20 | 保持诗文 | 第一组提示词形成 |
| 01:20–01:55 | 等待 | 第一段预生成论文流式显现并采纳 |
| 01:55–02:30 | 跳转、选择、插入第一段 | 同源按键层；P1 可出现一个公式 |
| 02:30–03:15 | 混合文本静置 | 第二组 prompt 与术语重组 |
| 03:15–03:55 | 第二轮删改/插入 | 第二段生成；P1 matrix 15–20 秒 |
| 03:55–04:45 | 诗文/论文之间巡游 | 第三组 prompt、重试、采纳 |
| 04:45–05:25 | 第三轮大跨度写回 | 第三段结果；P1 image 10–15 秒 |
| 05:25–05:45 | 最终巡游 | 显示 prompt/result/落点关系 |
| 05:45–06:00 | 淡出并恢复原诗 | 黑场、reset、下一轮 ready |

如果内容尚未冻结，第一可运行版本只实现第一组 90–120 秒因果闭环并循环；之后再扩成六
分钟，而不是先搭空的完整时间轴。

## 9. 视觉语言

### 9.1 主屏

- 维持黄金基线黑底、竖排、右至左列推进；
- 不增加 Float、状态卡或 Web overlay；
- 生成阶段静，写回阶段动；
- 结构性改写才使用大跨度跳转；
- 插入速度 15–40 汉字/秒，以物理可读为准；
- 不为了更炫而更换未经 A/B 的字体、engine 或 VFX。

### 9.2 副屏

- 以“实验记录、信道、推理仪表”为母题；
- Prompt、Result、状态和 Key Overlay 保持稳定区域；
- 暗底、低饱和蓝青信息层，朱砂只标记采纳/写回；
- 正文优先大字号、短行和留白，不做密集日志墙；
- P1 图像/矩阵不能遮盖 Prompt/Result；
- 不复制 AstroNvim 完整界面，也不伪装实时云服务。

## 10. 内容与版权

每个内容包记录：

- 原诗和来源；
- 完整 prompt；
- 模型、生成日期和原始输出；
- 人工删改稿、最终采用段落和审核人；
- 公式的人工校对；
- 图像 prompt、模型、原图和展演裁切；
- 文件大小和 SHA-256；
- 是否入 Git、外部备份路径和恢复验证日期。

默认使用已确认可用于展览的古典诗文与原创生成文本。任何现代论文或《控制论》译文都
不能因“年代久远”默认进入公共领域；未单独核验版权时，只使用思想概念和原创改写。

## 11. 失败与恢复

| 失败 | 行为 |
|---|---|
| 第二显示器缺失/映射变化 | 不进入 loop，显示明确设备检查页 |
| JanVim HWND 未找到/不唯一/安置失败 | 不进入 loop；保留副屏 ready 并显示 PID 与目标矩形 |
| JanVim artifact/hash 不符 | 不启动主屏，显示 lock mismatch |
| Lua agent 未 ready | 副屏停在 ready，有限重启主屏 |
| 关键 editor cue 超时 | 最近黑场终止本轮，从原诗重启 |
| 重复 cue/ACK | 幂等返回，不重复编辑 |
| Formula 失败 | 显示已校验纯文本公式 |
| Image 缺失 | 跳过图像，保留 Prompt/Result |
| Canvas 不可用 | 跳过 Matrix，不影响 P0 |
| 网络断开 | 无影响；正式 show 不使用网络 |
| Secondary renderer 崩溃 | 主屏可继续安全巡游；controller 在黑场重建副屏 |
| Controller 崩溃 | 外部启动脚本有限退避重启并从新 loop 开始 |

恢复不得修改任何源文件、产品工作树或用户配置。

## 12. 四日范围与预算

### 12.1 P0 必须完成

- 单 controller、双显示器路由、全屏和 ready 页；
- 离线 manifest、内容/hash 校验；
- Prompt/Response 实时感回放；
- Lua agent、localhost bridge 和一次真实写回；
- 同源 Key Overlay；
- 六分钟或更短的完整 loop、黑场 reset 和有限重启；
- 两台真实投影三轮验收。

### 12.2 P1 有余量再做

- KaTeX Formula Plate；
- 一个 fixed-seed Canvas matrix；
- 2–3 幅预生成图像；
- 简单声音 cue。

### 12.3 明确不做

- 现场 LLM/文生图；
- JanVim 原生 Float 或社区插件开发；
- 新 JanVim shader/VFX；
- 光学叠加和像素级投影配准；
- 内容编辑器、拖拽时间轴、多主题系统；
- 三维场景、复杂 WebGL 或实时视频合成。

### 12.4 更新后的工时

| 工作包 | 预算 |
|---|---:|
| Schema、fake-clock scheduler、最小 loop | 4–6 小时 |
| Electron 双显示器、进程和 ready/safe state | 4–6 小时 |
| Lua agent 与本地 bridge | 5–7 小时 |
| Prompt/Response + Key Overlay | 5–7 小时 |
| 内容接入、reset、日志、恢复 | 4–6 小时 |
| 物理投影排练、三轮 soak、冻结 | 5–8 小时 |
| P1 Formula/Matrix/Image | 4–8 小时 |
| **P0 总计** | **27–40 小时** |
| **含 P1** | **31–48 小时** |

第一个可见闭环必须在 8–12 小时内出现：一段 prompt、一段 result、一次真实 JanVim 写回、
一次 reset。若 12 小时仍无闭环，立即移除 Electron 以外的 P1、完整六分钟内容和美术抛光，
先恢复 90–120 秒循环。

## 13. 四日排程

1. 第一天：冻结 artifact 候选与 schema；完成双屏 ready、Lua bridge、第一段真实写回和 reset。
2. 第二天：完成 Prompt/Response、Key Overlay、三段内容和六分钟时间轴。
3. 第三天：完成恢复、离线、三轮 desktop soak；有余量再加入 Formula/Matrix/Image。
4. 第四天：只做两台真实投影、字号/对比/节奏、断网/重启、最终 hash 和备用包。

第三天结束冻结功能。第四天不升级 Electron、JanVim、字体、VFX 或引入新视觉技术。

## 14. 人工物理验收清单

### 工程

- [ ] 显示映射经过人工确认并写入 show config。
- [ ] artifact、content 和 media 全部通过 hash。
- [ ] 主屏实际 engine 和配置已写入 lock。
- [ ] 副屏无窗口边框、滚动条、桌面通知和鼠标指针。
- [ ] Key Overlay 与实际 action 一致。
- [ ] 三个循环无重复写入、漏写、漂移或 reset 残留。
- [ ] 断网循环通过。
- [ ] 主屏失败和副屏失败各完成一次恢复。

### 艺术

- [ ] 主屏静态诗文清晰。
- [ ] 大跨度光标移动可感知为“侠客飞越”，但不过度频繁。
- [ ] 副屏能读清完整 prompt 和被采纳段落。
- [ ] 观众能理解副屏先生成、主屏后写回。
- [ ] Key Overlay 提供理解而不是噪声。
- [ ] P1 公式/矩阵/图像增强叙事，不压过文本。
- [ ] 黑场和 reset 自然，不暴露启动/窗口搬移。

## 15. 与社区 Float 近期目标的关系

JanVim 产品 worktree 正在规划 Neovim 0.10.1 的精确锁定社区横排 Float 证明。该证明可以
在展后成为项目传播材料，但本展演：

- 不等待它；
- 不把它嵌入六分钟 loop；
- 不从 Task26 dirty worktree 构建；
- 不把副屏 Web 界面命名为 Float；
- 不用物理投影验收替代产品真实窗口验收。

如果单一开发者同时推进两条线，展演的 8–12 小时最小闭环优先。只有闭环可重复后，才把
剩余开发时段分配给社区 Float proof。
