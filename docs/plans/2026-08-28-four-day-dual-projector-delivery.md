# 四日双投影展演交付实施计划

> **执行要求：** 实施本计划时使用 `superpowers:executing-plans`，按任务逐项执行，并在每个
> 提交点核对测试输出、工作树范围和演出边界。

**目标：** 在不修改 JanVim 产品源码、不调用现场 AI、不中断离线演出的前提下，交付一套
可连续循环的双投影作品：副屏先呈现提示词与预生成论文，主屏随后由真实 JanVim 光标完成
对应的跳转、选择和写回。

**架构：** Electron main 是唯一演出时钟、显示路由器和进程监督器；副屏使用无框 Web
renderer；JanVim `v0.10.1-gmk.4` 的候选便携产物经实际 SHA-256 冻结后作为不可变主屏；
展演专用 Lua agent 通过 IPv4 loopback NDJSON 协议接收闭集语义动作。内容、媒体和 cue 均
在展前固化，现场断网运行。

**技术栈：** Windows 11 Pro x64、Node.js `22.23.0`、npm `12.0.2`、Electron `44.0.0`、
Vite `8.2.2`、TypeScript `7.0.2`、Vitest `4.1.11`、Zod `4.4.3`、ESLint `10.9.1`、
`@eslint/js` `10.0.1`、`typescript-eslint` `8.68.0`、jsdom `30.0.1`；P1 公式使用
KaTeX `0.18.4`。

---

## 0. 执行边界与时间闸门

本计划只在 `D:\github\JanVim-Exhibition-2026` 实施。不得把 Node、Electron、媒体文件、
显示器编号、时间轴或演出 Lua agent 写回 `D:\github\JanVim`。JanVim 仓库只作为来源身份，
不作为展演代码工作区。

计划按四个不可倒置的闸门推进：

| 闸门 | 最迟时间 | 必须看见的结果 | 未通过时的动作 |
|---|---:|---|---|
| G1 | 开工后 4 小时 | fixture manifest 可校验，fake clock 可完成一轮 | 停止视觉开发，只修 schema/scheduler |
| G2 | 开工后 8–12 小时 | 一段 prompt、result、真实 JanVim 写回和 reset | 删除全部 P1，保持 90 秒最小循环 |
| G3 | 第三天结束 | P0 六分钟或稳定短循环、离线、有限恢复、桌面三轮 | 冻结功能，不再增加场景 |
| G4 | 第四天结束 | 两台真实投影三轮、断网、强制重启、冻结包 | 使用已验证短循环，不带故障功能入场 |

单人预算为 P0 `27–40` 小时；P1 额外 `4–8` 小时。P0 与
[展演设计](../specs/2026-08-28-dual-projector-generative-performance-design.md)一致，P1 不得
占用 G2 或物理排练时间。

每个生产行为都先写失败测试。每个任务结束只暂存计划列出的路径，禁止 `git add -A`。

## 1. 目标文件树

实施完成后的受控文件树如下：

```text
JanVim-Exhibition-2026/
  apps/
    controller/
      package.json
      tsconfig.json
      src/
        main.ts
        preload.ts
        display-router.ts
        window-placer.ts
        scheduler.ts
        cue-dispatcher.ts
        bridge-server.ts
        janvim-process.ts
        supervisor.ts
        bounded-log.ts
      tests/
        display-router.test.ts
        window-placer.test.ts
        preload-contract.test.ts
        scheduler.test.ts
        cue-dispatcher.test.ts
        bridge-server.test.ts
        janvim-process.test.ts
        supervisor.test.ts
    secondary-screen/
      package.json
      tsconfig.json
      vite.config.ts
      index.html
      src/
        main.ts
        styles.css
        model.ts
        scene-controller.ts
        prompt-composer.ts
        response-stream.ts
        key-overlay.ts
        ready-page.ts
        formula-plate.ts
        matrix-field.ts
        image-plate.ts
      tests/
        scene-controller.test.ts
        response-stream.test.ts
        key-overlay.test.ts
  packages/
    show-schema/
      package.json
      tsconfig.json
      src/index.ts
      tests/toolchain.test.ts
      tests/manifest.test.ts
      tests/protocol.test.ts
  nvim/
    lua/janvim_exhibition/
      init.lua
      protocol.lua
      actions.lua
      buffer.lua
    tests/
      agent_spec.lua
      protocol_spec.lua
  content/
    fixture/
      poem.txt
      generated-segments.json
      show.manifest.json
      content-ledger.md
    show.manifest.json
    poem.txt
    generated-segments.json
    formulas.json
  show/
    display-map.json
    janvim-show.toml
    safety.html
  scripts/
    prepare-janvim-runtime.ps1
    place-janvim-window.ps1
    verify-runtime.ps1
    start-show.ps1
    package-show.ps1
    run-lua-tests.ps1
  tests/
    first-loop.test.ts
    offline-package.test.ts
    recovery.test.ts
  docs/
    operations/rehearsal-runbook.md
    operations/incident-log-template.md
  eslint.config.js
  package.json
  package-lock.json
  tsconfig.json
  janvim-artifact.lock.json
  media-manifest.json
```

`runtime/janvim/`、`content/media-local/`、`out/` 和日志不入 Git。真实展演内容可以晚于
fixture 冻结，但必须通过同一 schema、hash 和循环验收。

## Task 1：固定工具链并建立可验证骨架（1.5–2.5 小时）

**文件：**

- 新建：`package.json`
- 新建：`package-lock.json`
- 新建：`tsconfig.json`
- 新建：`eslint.config.js`
- 新建：`packages/show-schema/package.json`
- 新建：`packages/show-schema/tsconfig.json`
- 新建：`packages/show-schema/tests/toolchain.test.ts`
- 新建：`apps/controller/package.json`
- 新建：`apps/controller/tsconfig.json`
- 新建：`apps/secondary-screen/package.json`
- 新建：`apps/secondary-screen/tsconfig.json`
- 新建：`apps/secondary-screen/vite.config.ts`
- 新建：`apps/secondary-screen/index.html`

### 1.1 先写版本锁测试

在 `packages/show-schema/tests/toolchain.test.ts` 读取根 `package.json`，断言：

- `engines.node` 精确为 `22.23.0`；
- 所有依赖值都是无 `^`、`~`、`*` 的精确版本；
- `package-lock.json` 的 `lockfileVersion` 为 `3`；
- 根脚本包含 `build`、`test`、`lint`、`typecheck`。

首次运行：

```powershell
npm test -- packages/show-schema/tests/toolchain.test.ts
```

预期：因 package/workspace 尚不存在而失败。

### 1.2 写入最小 workspace

根 `package.json` 使用 npm workspaces，不引入 React 或状态管理框架：

```json
{
  "name": "janvim-exhibition-2026",
  "private": true,
  "type": "module",
  "engines": { "node": "22.23.0" },
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "tsc -b && vite build --config apps/secondary-screen/vite.config.ts",
    "test": "vitest run",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "tsc -b --pretty false"
  },
  "dependencies": {
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/jsdom": "30.0.0",
    "@types/node": "26.4.0",
    "electron": "44.0.0",
    "eslint": "10.9.1",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "typescript-eslint": "8.68.0",
    "vite": "8.2.2",
    "vitest": "4.1.11"
  }
}
```

执行 `npm install --package-lock-only` 后必须审阅 lock diff，不运行自动升级命令；确认 lock
只含上述精确直接依赖后执行 `npm ci`，后续测试不得通过临时 `npx` 下载工具。

### 1.3 验证并提交

```powershell
npm test -- packages/show-schema/tests/toolchain.test.ts
npm run typecheck
npm run lint
git diff --check
git status --short
```

提交：

```powershell
git add package.json package-lock.json tsconfig.json eslint.config.js packages/show-schema/package.json packages/show-schema/tsconfig.json packages/show-schema/tests/toolchain.test.ts apps/controller/package.json apps/controller/tsconfig.json apps/secondary-screen/package.json apps/secondary-screen/tsconfig.json apps/secondary-screen/vite.config.ts apps/secondary-screen/index.html
git commit -m "build: pin exhibition runtime toolchain"
```

## Task 2：定义 manifest、cue 与 loopback 协议（2–3 小时）

**文件：**

- 新建：`packages/show-schema/src/index.ts`
- 新建：`packages/show-schema/tests/manifest.test.ts`
- 新建：`packages/show-schema/tests/protocol.test.ts`
- 新建：`content/fixture/poem.txt`
- 新建：`content/fixture/generated-segments.json`
- 新建：`content/fixture/show.manifest.json`
- 新建：`content/fixture/content-ledger.md`

### 2.1 先写失败的 manifest 契约

至少覆盖：

- cue ID 唯一且 `atMs` 单调非降；
- 最后一个 cue 是 `reset`，且不晚于 `loopDurationMs`；
- `editor-action` 只能使用闭集动作；
- 每个插入 chunk 的 UTF-8 长度不超过 512 bytes；
- 每轮 `editor-action` 不超过 256 项；
- hash 必须是 64 位小写十六进制；
- `editor-action` 必须同时携带 `displayKeys` 与 `semanticLabel`；
- runtime 不接受未知字段。

核心类型使用可辨识联合，而不是 `payload: unknown`：

```ts
type EditorAction =
  | { type: "move"; keys: "h" | "j" | "k" | "l" | "w" | "b" | "e" | "0" | "$" | "G"; repeat: number }
  | { type: "insert"; text: string; charsPerSecond: number }
  | { type: "select"; rangeId: string }
  | { type: "replace"; rangeId: string; text: string }
  | { type: "escape" }
  | { type: "reset" };

type EditorCue = {
  id: string;
  atMs: number;
  target: "main";
  kind: "editor-action";
  payload: {
    action: EditorAction;
    displayKeys: string[];
    semanticLabel: string;
    critical: true;
  };
};
```

`key-overlay` 只允许独立教程说明；真实编辑按键必须从同一 `editor-action` 派生，不能另写一
条看似同步的 key cue。

### 2.2 定义 NDJSON 命令/ACK

每行最大 4096 bytes，只监听 `127.0.0.1`：

```ts
type AgentCommand = {
  schema: 1;
  token: string;
  loopId: string;
  cueId: string;
  action: EditorAction | { type: "prepare"; poem: string; expectedSha256: string } | { type: "status" };
};

type AgentAck = {
  schema: 1;
  loopId: string;
  cueId: string;
  outcome: "applied" | "duplicate" | "rejected" | "failed";
  mode: string;
  cursor: { row: number; col: number };
  bufferSha256: string;
  errorCode?: string;
};
```

协议测试必须拒绝任意 Ex 命令、shell 字符串、未知动作、过大行、错误 token 和非 UTF-8
边界。日志只记录 token 的前 8 位摘要，不记录原 token。

### 2.3 建立 90 秒工程 fixture

fixture 使用公共领域古诗《登鹳雀楼》和明确标记为工程样例的原创段落：

```text
白日依山尽
黄河入海流
欲穷千里目
更上一层楼
```

工程样例结果为：

```text
若把诗句视为离散信源，层楼不是终点，而是观察窗口的扩展；可见序列的熵随候选路径增加而增长。
```

时间轴固定为：0 秒 prepare，5 秒 prompt，20 秒 result stream，45 秒采纳，48 秒主屏移动，
55 秒插入，78 秒静置，86 秒 fade，90 秒 reset。fixture 只证明工程闭环，不冒充最终策展内容。

### 2.4 验证并提交

```powershell
npm test -- packages/show-schema/tests/manifest.test.ts packages/show-schema/tests/protocol.test.ts
npm run typecheck
npm run lint
git diff --check
```

提交：

```powershell
git add packages/show-schema/src/index.ts packages/show-schema/tests/manifest.test.ts packages/show-schema/tests/protocol.test.ts content/fixture/poem.txt content/fixture/generated-segments.json content/fixture/show.manifest.json content/fixture/content-ledger.md
git commit -m "feat: define deterministic show manifest"
```

## Task 3：实现 fake-clock scheduler 与关键 ACK 规则（2.5–4 小时）

**文件：**

- 新建：`apps/controller/src/scheduler.ts`
- 新建：`apps/controller/src/cue-dispatcher.ts`
- 新建：`apps/controller/tests/scheduler.test.ts`
- 新建：`apps/controller/tests/cue-dispatcher.test.ts`

### 3.1 先写时间行为测试

使用注入式 `Clock`，禁止测试真实 sleep。覆盖：

1. 同一 cue 在一轮内只发一次；
2. 同一毫秒 cue 按 manifest 顺序稳定派发；
3. 普通视觉 cue 落后 250 ms 内追赶；
4. 编辑 cue 等待最多 2 秒 ACK，只重试一次；
5. 编辑 ACK 超时后放弃本轮后续编辑并请求安全黑场；
6. reset 生成新 loop ID，并清空幂等集合；
7. wall clock 回拨不影响单调时间；
8. pause/resume 只允许在黑场或 ready 状态发生。

首次运行：

```powershell
npm test -- apps/controller/tests/scheduler.test.ts apps/controller/tests/cue-dispatcher.test.ts
```

预期：模块缺失失败。

### 3.2 实现最小状态机

状态闭集：

```ts
type ShowState =
  | "booting"
  | "ready"
  | "running"
  | "awaiting-editor-ack"
  | "safe-black"
  | "resetting"
  | "stopped";
```

Scheduler 只决定“何时到期”；CueDispatcher 决定“发送到谁”和“如何等待”。不得让 renderer、
TCP socket 或 Electron API 进入 scheduler。

### 3.3 验证并提交

```powershell
npm test -- apps/controller/tests/scheduler.test.ts apps/controller/tests/cue-dispatcher.test.ts
npm run typecheck
npm run lint
git diff --check
git add apps/controller/src/scheduler.ts apps/controller/src/cue-dispatcher.ts apps/controller/tests/scheduler.test.ts apps/controller/tests/cue-dispatcher.test.ts
git commit -m "feat: add deterministic cue scheduler"
```

## Task 4：交付副屏 P0 Prompt/Response/Key Overlay（4–6 小时）

**文件：**

- 新建：`apps/secondary-screen/src/main.ts`
- 新建：`apps/secondary-screen/src/styles.css`
- 新建：`apps/secondary-screen/src/model.ts`
- 新建：`apps/secondary-screen/src/scene-controller.ts`
- 新建：`apps/secondary-screen/src/prompt-composer.ts`
- 新建：`apps/secondary-screen/src/response-stream.ts`
- 新建：`apps/secondary-screen/src/key-overlay.ts`
- 新建：`apps/secondary-screen/src/ready-page.ts`
- 新建：`apps/secondary-screen/tests/scene-controller.test.ts`
- 新建：`apps/secondary-screen/tests/response-stream.test.ts`
- 新建：`apps/secondary-screen/tests/key-overlay.test.ts`

### 4.1 先写 DOM 行为测试

断言：

- Prompt 和 Result 是固定分区，token 增长不会改变外层几何；
- 相同 seed 与 cue 序列产生完全相同 DOM 文本；
- editor-action 的 `displayKeys`、语义、cue ID 同时进入 Key Overlay；
- 最近只保留 6 项，连续相同键聚合为 `j × 12`；
- `prefers-reduced-motion` 或 renderer 低帧率时仅减少过渡，不丢文本；
- 缺少 P1 素材不会阻断 Prompt/Response；
- reset 后不残留上一轮 token、键或采纳标记。

Vitest 对这三组测试固定使用已经锁定的 jsdom `30.0.1` 环境；不允许临时切换 DOM 实现，
也不允许只在浏览器里手测后跳过行为测试。

### 4.2 实现稳定视觉骨架

FHD 默认布局：左侧 42% Prompt，右侧 58% Result；底部 Key Overlay 高度不超过 18%；字号
使用 `clamp()`，最小正文 28 px。颜色只有四级：背景、正文、低饱和蓝青元数据、朱砂采纳。
不显示浏览器滚动条、鼠标、开发工具栏或动态网络状态。

“流式”按 manifest 的既定 chunk 和间隔回放，不自行按字符随机切分。CSS 动效只使用
`opacity` 与 `transform`，单次持续不超过 600 ms。

### 4.3 浏览器人工检查

```powershell
npm run build
npm test -- apps/secondary-screen/tests
npm run typecheck
npm run lint
```

在 1920×1080、100% 缩放下检查 90 秒 fixture。保存一张 ready、一张 prompt、一张采纳态
截图到排练证据目录 `out/evidence/desktop/`；该目录不提交。

### 4.4 提交

```powershell
git add apps/secondary-screen/src apps/secondary-screen/tests
git commit -m "feat: render prompt response and key scenes"
```

## Task 5：实现展演 Lua agent 与本地 bridge（4.5–7 小时）

**文件：**

- 新建：`nvim/lua/janvim_exhibition/init.lua`
- 新建：`nvim/lua/janvim_exhibition/protocol.lua`
- 新建：`nvim/lua/janvim_exhibition/actions.lua`
- 新建：`nvim/lua/janvim_exhibition/buffer.lua`
- 新建：`nvim/tests/agent_spec.lua`
- 新建：`nvim/tests/protocol_spec.lua`
- 新建：`scripts/run-lua-tests.ps1`
- 新建：`apps/controller/src/bridge-server.ts`
- 新建：`apps/controller/tests/bridge-server.test.ts`

### 5.1 先写 bridge 失败测试

Node 侧用真实 IPv4 loopback ephemeral port 测试：

- 只绑定 `127.0.0.1`；
- 未通过 token 的第一条消息立即断开；
- 一条命令对应一条 ACK；
- 分包和合包 NDJSON 均正确；
- 4097-byte 行被拒绝；
- 重复 `loopId + cueId` 返回 duplicate，不再次调用 action handler；
- socket 关闭后所有 timer/listener 均释放。

### 5.2 先写 Neovim 0.10.1 行为测试

`scripts/run-lua-tests.ps1` 必须先执行 `nvim --version` 并拒绝非 `NVIM v0.10.1`。测试在
`-u NONE --headless` 下把本仓库 `nvim/` 加入 runtimepath，覆盖：

- prepare 创建 `buftype=nofile`、`swapfile=false`、`undofile=false` 的新 buffer；
- 原诗文件不被创建或改写；
- insert/replace 只操作当前展演 buffer；
- 未知 range、越界 repeat、过长 text 和任意 Ex/shell action 被拒绝；
- reset 删除旧 buffer，按已校验 poem snapshot 新建；
- 重复 cue 不重复插入；
- status 返回 mode、cursor 和当前 buffer SHA-256；
- shutdown 只关闭 agent 连接，不执行任意用户字符串。

### 5.3 实现闭集动作

Lua agent 使用 `vim.loop`/`vim.uv` 可用性探测，但只走 Neovim 0.10.1 已验证路径。移动动作
通过公开输入 API 分批喂入，使 JanVim 可见真实模式和光标变化；文本插入按 manifest 速度
切块。所有回调经 `vim.schedule_wrap` 回到主线程。

不得实现 `:command`、`lua`、`eval`、任意 key string 或文件写入。range 在 prepare 时由
manifest 名称映射为当前 snapshot 的边界，编辑后失效范围不得静默复用。

### 5.4 接入 Plugin Lab 私有根

`prepare-janvim-runtime.ps1` 后续将 agent 复制到：

```text
runtime/user-root/plugin-lab/local/janvim-exhibition/lua/janvim_exhibition/
```

并写入只返回 lazy spec 的 `plugin-lab/config/init.lua`。agent 从继承环境读取
`JANVIM_EXHIBITION_PORT` 与 `JANVIM_EXHIBITION_TOKEN`；不读取宿主 AstroNvim 或用户配置。

### 5.5 验证并提交

```powershell
pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
npm test -- apps/controller/tests/bridge-server.test.ts
npm run typecheck
npm run lint
git diff --check
git add nvim scripts/run-lua-tests.ps1 apps/controller/src/bridge-server.ts apps/controller/tests/bridge-server.test.ts
git commit -m "feat: bridge closed show actions into Neovim"
```

## Task 6：实现 Electron 双显示器、JanVim 进程与 ready/safe 状态（4–6 小时）

**文件：**

- 新建：`apps/controller/src/display-router.ts`
- 新建：`apps/controller/src/window-placer.ts`
- 新建：`apps/controller/src/preload.ts`
- 新建：`apps/controller/src/janvim-process.ts`
- 新建：`apps/controller/src/supervisor.ts`
- 新建：`apps/controller/src/bounded-log.ts`
- 新建：`apps/controller/src/main.ts`
- 新建：`apps/controller/tests/display-router.test.ts`
- 新建：`apps/controller/tests/window-placer.test.ts`
- 新建：`apps/controller/tests/preload-contract.test.ts`
- 新建：`apps/controller/tests/janvim-process.test.ts`
- 新建：`apps/controller/tests/supervisor.test.ts`
- 新建：`show/display-map.json`
- 新建：`show/janvim-show.toml`
- 新建：`show/safety.html`
- 新建：`scripts/place-janvim-window.ps1`

### 6.1 先写纯逻辑测试

不要在单元测试里创建真实 BrowserWindow。给 display/router/process/supervisor 注入适配器，
覆盖：

- 显示器数量不是 2 或 geometry/hash 与 `display-map.json` 不符时保持 ready；
- 主副屏角色由明确 config 决定，不按枚举顺序猜测；
- 副屏窗口无框、全屏、禁用导航和任意远程 URL；
- JanVim 窗口安置只使用刚创建的 PID，拒绝标题/进程名模糊匹配、多个 HWND 和越界矩形；
- JanVim 环境仅增加演出私有根、port/token，不覆盖用户全局环境；
- artifact lock 未通过时不 spawn；
- 关键进程 10 分钟最多重启 3 次，采用 1/2/4 秒有界退避；
- 崩溃恢复从新 loop 开始，不重放半轮编辑；
- 日志按大小轮换，总量上限 32 MiB，敏感 token 被遮蔽。

### 6.2 实现 controller composition root

启动顺序固定为：

```text
validate manifests and hashes
  -> enumerate displays
  -> open secondary ready window
  -> start loopback bridge
  -> start hash-verified JanVim with show-only Plugin Lab root
  -> await Lua ready/status
  -> require explicit local Start-Show action
  -> begin monotonic loop
```

Electron renderer 启用 `contextIsolation: true`、`nodeIntegration: false`、
`sandbox: true`。IPC 只暴露经过 Zod 校验的 renderer event，不暴露 filesystem、shell 或
arbitrary invoke。`preload.ts` 只用 `contextBridge` 暴露 `onShowEvent` 与 `requestStart`；
测试断言 channel 固定、listener 可注销且 payload 必须先通过 schema。

Controller 启动 JanVim 后，把 child PID 和目标工程投影矩形作为分离参数传给
`scripts/place-janvim-window.ps1`。helper 通过 `EnumWindows` 与
`GetWindowThreadProcessId` 在 10 秒内找到唯一可见顶层 HWND，执行 `SetWindowPos`/
`ShowWindowAsync` 后读取实际矩形并输出 JSON receipt。它不发送按键、不点击、不修改全局
显示设置；失败时 controller 保持副屏 ready，绝不开始时间轴。

### 6.3 验证并提交

```powershell
npm test -- apps/controller/tests/display-router.test.ts apps/controller/tests/window-placer.test.ts apps/controller/tests/preload-contract.test.ts apps/controller/tests/janvim-process.test.ts apps/controller/tests/supervisor.test.ts
npm run build
npm run typecheck
npm run lint
git diff --check
git add apps/controller/src apps/controller/tests scripts/place-janvim-window.ps1 show
git commit -m "feat: supervise the two-screen show runtime"
```

## Task 7：先闭合 90 秒真实演出，再扩内容（3–5 小时）

**文件：**

- 新建：`tests/first-loop.test.ts`
- 修改：`content/fixture/show.manifest.json`
- 修改：`apps/controller/src/main.ts`
- 修改：`apps/controller/src/cue-dispatcher.ts`
- 修改：`apps/secondary-screen/src/scene-controller.ts`

### 7.1 先写端到端 fake 测试

`tests/first-loop.test.ts` 使用 fake renderer 与 fake agent，加载真实 fixture，断言事件序列：

```text
ready
prompt-start
response-complete
accepted
editor-action + exact same-cue key overlay
editor-ack
fade
reset
ready(next loop)
```

同时断言：result 未完成前绝不派发 editor-action；ACK 失败后无后续编辑；下一轮从原诗 hash
开始；运行 100 轮不会增长 listener/timer 数。

### 7.2 接真实 gmk.4 候选做 G2 人工闭环

在完成 Task 8 的候选产物校验后运行 fixture。人工确认：

1. 主屏是 JanVim 真实窗口而非视频；
2. 副屏 result 完成后，主屏光标才开始移动；
3. Key Overlay 与真实语义动作一致；
4. 插入后的文本可见且不裁切；
5. 90 秒后恢复原诗，无残留 buffer；
6. 关闭时 `JANVIM_EXIT` 自然完成。

G2 未通过时，只修这条链；不得开始公式、矩阵、图片或六分钟扩写。

### 7.3 验证并提交

```powershell
npm test -- tests/first-loop.test.ts
npm test
npm run build
npm run typecheck
npm run lint
git diff --check
git add tests/first-loop.test.ts content/fixture/show.manifest.json apps/controller/src/main.ts apps/controller/src/cue-dispatcher.ts apps/secondary-screen/src/scene-controller.ts
git commit -m "feat: close the first causal show loop"
```

## Task 8：溯源并冻结 JanVim 展演产物（2–3.5 小时）

**文件：**

- 新建：`scripts/prepare-janvim-runtime.ps1`
- 新建：`scripts/verify-runtime.ps1`
- 新建：`tests/offline-package.test.ts`
- 生成：`janvim-artifact.lock.json`
- 修改：`show/janvim-show.toml`
- 修改：`.gitignore`

### 8.1 先写拒绝式测试

用小型 fixture 目录测试 PowerShell 脚本与 lock parser：

- 缺 `janvim-core.exe`、`runtime/lua/janvim.lua` 或配置即失败；
- `janvim-core.exe` 小于合理最小尺寸即失败，防止 18-byte 假文件混入；
- tag/commit 必须精确为 `v0.10.1-gmk.4` / `e95633101d93f8448b0f906e918b5d836ab95273`；
- archive、core、config 三个实际 SHA-256 均为 64 位小写十六进制；
- lock 任意 hash 与运行目录不符即不启动；
- 复制目标只能是本仓库 `runtime/janvim/`；
- 脚本不调用 `git checkout-index`、不删除来源目录、也不访问以下三个 JanVim 事故保护目录：
  - `D:\VirtualData\TempCache\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504`；
  - `D:\VirtualData\TempCache\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d`；
  - `D:\VirtualData\TempCache\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb`。

### 8.2 只接受有完整来源链的候选

当前已确认的是 Git tag/commit 和人工体验，不等于已冻结某一份二进制。候选按以下优先级：

1. 当时 CI artifact 保存下来的完整 ZIP 与同名 `.sha256`；
2. 有构建日志和摘要、且能证明来自同一 tag 的完整便携目录；
3. 从该 tag 在隔离工作区重新构建的候选，但必须重新做人工基线测试，不能继承旧二进制的
   “黄金”结论。

`bak003`、18-byte sandbox stub、文件名相似或日期接近都不是来源证据。脚本接收明确的
`-SourceDirectory` 或 `-SourceArchive` 参数，先只读校验，再复制到忽略目录。没有合格候选时
停在 ready 页，并在事故日志记录 `artifact-provenance-unresolved`。

### 8.3 原子生成真实 lock

脚本从实际字节计算 hash，先写临时 lock，验证后再移动为
`janvim-artifact.lock.json`。`layoutEngine` 经过 dynamic/orthogonal 物理 A/B 后只允许一个固定
值。lock 不包含任何说明性伪值。

### 8.4 验证并提交

```powershell
npm test -- tests/offline-package.test.ts
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
Get-FileHash -Algorithm SHA256 .\runtime\janvim\janvim-core.exe
npm run typecheck
npm run lint
git diff --check
```

只有真实候选通过后才暂存 lock：

```powershell
git add scripts/prepare-janvim-runtime.ps1 scripts/verify-runtime.ps1 tests/offline-package.test.ts janvim-artifact.lock.json show/janvim-show.toml .gitignore
git commit -m "build: freeze the verified JanVim show artifact"
```

## Task 9：加入恢复、离线与三轮桌面 soak（3–5 小时）

**文件：**

- 新建：`tests/recovery.test.ts`
- 新建：`scripts/start-show.ps1`
- 新建：`docs/operations/rehearsal-runbook.md`
- 新建：`docs/operations/incident-log-template.md`
- 修改：`apps/controller/src/supervisor.ts`
- 修改：`apps/controller/src/bounded-log.ts`

### 9.1 先写故障注入测试

覆盖：

- renderer 在非关键 cue 崩溃：主屏进入安全巡游，黑场重建副屏；
- agent 在编辑中断线：终止本轮，不继续插入；
- JanVim 退出：有限重启并从原诗新 loop 开始；
- controller 重启：从 ready 开始，不读取半轮 checkpoint；
- image/formula/matrix 缺失：跳过 P1，P0 正常；
- 网络完全断开：不发生 DNS/HTTP 请求；
- SIGINT/窗口关闭：先停止调度、请求 agent shutdown、等待 JanVim 自然退出，再有限强制清理。

### 9.2 写启动脚本和 runbook

`start-show.ps1` 必须：

- 校验 Node、lock、内容、媒体和显示器映射；
- 默认断网运行，不下载 npm 包；
- 使用隐藏后台窗口启动 controller，前台只保留本地操作面板；
- 记录本轮 build/commit/artifact/content hash；
- 只在 black/ready 状态接受 Restart Loop 与 Stop Show；
- 不修改 Windows 全局 PATH、用户 Neovim 配置或 JanVim 仓库。

runbook 写出开机、投影映射、焦点、黑场、启动、停止、断网、进程崩溃和备用短循环的逐步
操作；每一步有可观察结果和失败分支。

### 9.3 桌面三轮 soak

在同一台展示主机上连续运行至少 3 个循环，记录：

- 每个循环开始/结束的单调时间；
- 两端 ACK P50/P95/max；
- 最终漂移；
- JanVim/renderer/controller 进程 RSS；
- listener/timer 数；
- reset 后主屏 buffer hash；
- 是否发生重试、跳过或恢复。

接受阈值：三轮累计可见漂移小于 250 ms，关键 ACK P95 小于 100 ms，无重复写入、无残留
buffer、日志总量有界。

### 9.4 验证并提交

```powershell
npm test -- tests/recovery.test.ts
npm test
npm run build
npm run typecheck
npm run lint
git diff --check
git add tests/recovery.test.ts scripts/start-show.ps1 docs/operations/rehearsal-runbook.md docs/operations/incident-log-template.md apps/controller/src/supervisor.ts apps/controller/src/bounded-log.ts
git commit -m "feat: make show recovery bounded and offline"
```

## Task 10：扩为正式内容；P1 只在余量内加入（3–8 小时）

**文件：**

- 新建：`content/poem.txt`
- 新建：`content/generated-segments.json`
- 新建：`content/show.manifest.json`
- 新建：`content/formulas.json`
- 新建：`media-manifest.json`
- 可选新建：`apps/secondary-screen/src/formula-plate.ts`
- 可选新建：`apps/secondary-screen/src/matrix-field.ts`
- 可选新建：`apps/secondary-screen/src/image-plate.ts`
- 可选修改：`package.json`

### 10.1 先冻结三段 P0 内容

每段内容记录原诗来源、完整 prompt、模型与日期、原始输出、人工删改、最终采纳段落、审核人
和 SHA-256。现代论文或译本没有单独版权核验时不得复制原文。

正式 manifest 先实现三次因果闭环，再把总时长调整到 6 分钟。每个 90–120 秒窗口至少含
一次 prompt -> result -> accepted -> editor-action。若三段内容无法在第三天中午前冻结，
正式展演使用已验收的 90 秒 fixture 结构替换文本，不扩大时间轴。

### 10.2 P1 顺序固定

只有 G2 与桌面三轮通过后，按以下顺序追加：

1. KaTeX Formula Plate，精确依赖 `katex: 0.18.4`，并保留已校验纯文本 fallback；
2. 一个 fixed-seed Canvas 2D Matrix Field；
3. 最多 3 张预生成本地图像，每张有 hash、来源和备用副本。

每加一项都先写测试，证明素材缺失或渲染失败时 P0 继续。不得加入 WebGL、Three.js、实时
视频、声音引擎或在线字体。

### 10.3 验证并提交

```powershell
npm test
npm run build
npm run typecheck
npm run lint
git diff --check
```

P0 内容提交：

```powershell
git add content/poem.txt content/generated-segments.json content/show.manifest.json content/formulas.json media-manifest.json
git commit -m "content: freeze the exhibition narrative loop"
```

P1 若实际实施，单独提交：

```powershell
git add package.json package-lock.json apps/secondary-screen/src/formula-plate.ts apps/secondary-screen/src/matrix-field.ts apps/secondary-screen/src/image-plate.ts apps/secondary-screen/tests media-manifest.json
git commit -m "feat: add bounded secondary visual plates"
```

## Task 11：打包、物理验收与最终冻结（5–8 小时）

**文件：**

- 新建：`scripts/package-show.ps1`
- 修改：`docs/operations/rehearsal-runbook.md`
- 新建：`docs/operations/final-acceptance-2026-09.md`
- 新建：`docs/operations/release-manifest-2026-09.json`

### 11.1 先写打包拒绝测试

`package-show.ps1` 必须在以下情况失败且不产生半包：

- 四个 npm 门禁任一非零；
- JanVim、content、media 或 display hash 不符；
- Electron 依赖需要联网；
- runtime 含未列入 lock 的可执行文件；
- manifest 含绝对媒体路径；
- Git 有未提交的受控文件变更；
- 输出目录已存在且未由本次 staging 创建。

脚本先写唯一 staging 目录，完成验证后原子重命名为
`out/JanVim-Exhibition-2026-show`，并生成整包 SHA-256 清单。不得递归删除来源目录。

### 11.2 两台真实投影三轮验收

在最终摆位、分辨率、缩放和字体下执行：

1. 冷启动并人工确认工程投影为主屏、坚果投影为副屏；
2. 运行三轮，记录每轮漂移、ACK、reset 和视觉异常；
3. 断开网络运行一轮；
4. 在安全黑场强制结束副屏 renderer，验证有限恢复；
5. 在下一安全黑场强制结束 JanVim，验证新 loop 恢复；
6. 检查提示词、结果、按键层在观众距离可读；
7. 检查主屏光标大跨度移动可感知但不过量；
8. 检查关闭时不暴露桌面、终端、窗口搬移或半段文本。

每一项记录实际结果、时间、操作者、照片/录像文件 hash。自动 FHD 测试不能替代这项物理
验收。

### 11.3 最终四门禁与冻结

```powershell
npm test
npm run build
npm run typecheck
npm run lint
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
pwsh -NoProfile -File .\scripts\package-show.ps1
git diff --check
git status --short
```

只有全部通过且物理三轮验收有证据，才填写
`docs/operations/final-acceptance-2026-09.md` 和 release manifest。提交：

```powershell
git add scripts/package-show.ps1 docs/operations/rehearsal-runbook.md docs/operations/final-acceptance-2026-09.md docs/operations/release-manifest-2026-09.json
git commit -m "docs: freeze the physically accepted show build"
```

复制两份展演包到不同物理介质并分别复算 SHA-256。最终安装后不得升级 Node、Electron、
JanVim、字体、GPU 驱动或插件。

## 2. 每日执行顺序

### 第一天：G1 与 G2

- Task 1–3：工具链、schema、fake-clock scheduler；
- Task 4 的 P0 骨架；
- Task 5 的最小 agent/bridge；
- Task 8 的候选产物身份校验；
- Task 7 的 90 秒真实闭环。

当天的唯一成功定义是：副屏结果完成后，真实 JanVim 写回并 reset。视觉是否完整不影响 G2。

### 第二天：P0 叙事完整

- 完成 Task 4–7；
- 接入三段经过校对的内容；
- 形成六分钟或可稳定重复的短循环；
- Key Overlay 必须与 editor-action 同源。

### 第三天：恢复与冻结功能

- 完成 Task 9；
- 完成离线、崩溃、三轮 desktop soak；
- 只有余量存在时才执行 Task 10 的 P1；
- 当天结束不再增加功能和依赖。

### 第四天：只做物理系统

- 完成 Task 11；
- 调整投影位置、字号、对比、节奏和黑场；
- 完成断网、重启和三轮物理验收；
- 生成两份 hash 一致的备用包。

## 3. 停止条件与降级顺序

出现以下任一情况立即停止扩展并回到最近通过的闸门：

- 无法证明 JanVim 候选字节来自 gmk.4；
- 真实写回不能在 12 小时内闭环；
- 主副屏使用不同时间源；
- 任意设计要求修改 JanVim 产品 Rust/WGPU；
- editor action 与按键显示不能共用 cue ID；
- reset 会触碰真实文件；
- 离线运行尝试访问网络；
- 三轮发生重复编辑、累计漂移超过 250 ms 或无界资源增长。

降级顺序固定为：图像 -> 矩阵 -> 公式 -> 六分钟扩展 -> 多段内容。最后保留 90 秒
Prompt/Response/真实写回/Key Overlay/reset 闭环；不得用假装 JanVim 的 Web 主屏替换而不更新
对外说明。

## 4. 与 JanVim 产品近期目标的并行边界

本计划与 JanVim 产品仓库中的
`docs/superpowers/plans/2026-08-28-neovim-0101-astronvim-style-horizontal-float-proof.md`
并行但不互相依赖：

- 展演以 gmk.4 的实测竖排体验为主屏，不等待社区 Float；
- 产品 Float 以 Neovim 0.10.1、精确锁定的 NUI/Which-key/AstroTheme 为证明对象；
- 展演 Web 副屏不得称为 JanVim Float；
- 展演成功不提升产品兼容等级；
- 产品复审发现新的 C/I/M 时停止产品线，不要求展演线同时停止；
- 两仓库只通过人为记录的 artifact 身份交换，不交换源码、submodule 或 dirty bytes。
