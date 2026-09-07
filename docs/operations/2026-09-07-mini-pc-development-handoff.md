# 展览 Mini PC 开发迁移总交接

日期：2026-09-07。移交方：GMK 开发主机上的 JanVim 总协调 agent 与《见山》协作 agent。
接收方：展览 Mini PC WO4 7640HS / 32 GB / 1 TB / Windows 11 Pro x64 上的 Codex CLI。

## 1. 当前任务与优先级

用户已经决定把后续内容、视觉、声音及现场联调开发集中到展示小主机，减少双机往返。
本次迁移须保全两个仓库、交接非 Git 资源，并让小主机自行核对旧检出与交付提交。
接管完成后，GMK 保留现有源码及包作为备用，停止并行功能开发。这是工作约定，不修改目录 ACL。

当前首个现场阻塞是 `Verify-Deployment.ps1` 找不到音频/耳机端点。
现有包为 GMK 的 Senary 声卡制作；小主机音频设备尚未枚举，不能据此判定驱动损坏或必须安装 ASIO。
先恢复开发环境和源码身份，再在小主机处理实际端点及后续表现细节。

用户授权覆盖本次双仓文档、必要的源码保全提交与普通 push，并允许在小主机的新开发分支继续工作。
旧操作卡中的“不得 fetch/commit/push”“等待先前人工窗口”等是当时阶段的约束，不应阻止此次已授权迁移。
两个仓库各自的 AGENTS.md 仍须完整阅读；节目运行期间不改源码、冻结资产、用户 Neovim 配置或原诗。

本轮采用有人看护的工作标准：偶发异常允许工作人员正常停止或重启电脑，再重新开演。
用户已明确本轮不追加离线、强制恢复、HP 性能及 7×24 小时无人值守验收。
现有一小时声音会话上限保留；它尚不满足全天不间断声音，不能偷偷提高常量或宣称已解决。

## 2. 分别记录源码、文档与包身份

| 对象 | 本次基准 | 含义 |
| --- | --- | --- |
| JanVim 应用源码 | `959495d806060f9017f3e8f04bc60c01701909f1` | 已推送、已完整自动测试、当前部署包的 sourceCommit |
| JanVim 迁移文档 | `feat/sound-flock-ingress-v1` 上包含本文件的提交 | 在应用基准之后只追加交接文档；以此次交付回执的远端完整 SHA 为准 |
| 《见山》v2 源码 | `d2ee805b36effa1c6a01f2f54488803704c09f95` | 七项既有 v2 源码/文档已独立保全，旧 `d890caa…` 不能代替它 |
| 部署 ZIP | 第 4 节的固定 SHA-256 | 已生成的不可变传输包；新文档提交不会改变它 |

接收 agent 必须分别报告应用基准、文档交付 HEAD、两仓目标机 HEAD 与包 SHA。
不要要求旧包的 `sourceCommit` 等于后续纯文档提交；不要因为文档提交前进而重写旧包回执。
定位本交接文件所属提交可用 `git log -1 --format=%H -- docs/operations/2026-09-07-mini-pc-development-handoff.md`。

## 3. 双仓源码与职责

### JanVim 展演控制器

- 远端：`https://github.com/gunpowder78/JanVim-Exhibition-2026.git`
- 交付分支：`feat/sound-flock-ingress-v1`
- GMK 工作树：`D:\github\JanVim-Exhibition-2026\.worktrees\sound-flock-ingress-v1`
- 小主机现有仓库：`D:\github\JanVim-Exhibition-2026`
- 建议小主机开发分支：`feat/exhibition-mini-pc-integration`
- 建议独立工作树：`D:\github\JanVim-Exhibition-2026\.worktrees\exhibition-mini-pc-integration`

本仓负责唯一展演时钟、冻结文本与 cue、JanVim Bridge、SCREEN-2、显示映射、声音服务、
Site Mix 持久化和部署启动器。JanVim 编辑器产品源码不在本仓，当前只消费锁定 artifact。

### 《见山》原生 Rust / wgpu 程序

- 远端：`https://github.com/gunpowder78/jianshan02Boid.git`
- GMK 源码根：`D:\github\JianShan02`
- 迁移前分支与 HEAD：`feat/flock-ingress-v1` / `d890caa5e9a3077bf1538d83f3695cdb32019d9a`
- 此前未提交：`protocol.rs`、`transport.rs`、`render/mod.rs`，及 `USER_MANUAL.md`、v2 使用说明、设计、计划，共七项。
- v2 保全分支：`feat/site-mix-v2-handoff`；不改写旧 v1 分支或 PR16。
- v2 源码提交：`d2ee805b36effa1c6a01f2f54488803704c09f95`。
- 包含详细交接的最终远端 HEAD：`250685ec54011e898267fce7413343fe59b2e4b8`，已普通 push 并经实时 `git ls-remote` 核对。
- 详细交接：该仓 `docs/2026-09-07-exhibition-mini-pc-handoff.md`。
- 建议小主机开发分支：`feat/exhibition-mini-pc-integration`（两个仓库可同名）。

《见山》agent 独占其仓库写入，负责实际 CPU/GPU 鸟群统计、相机/手势、v2 风声调节客户端。
JanVim agent 负责声音接收和输出、显示调度与整套启动。共享协议的改动先在同机书面同步，
确认双方字段/时序兼容后各自修改，避免两个 agent 同时改同一仓库文件。

《见山》协作核验：源码保全提交的四个原已跟踪文件差异为 47,310 bytes，
SHA-256 `1583e94bab0729ae984496dc8db4a33e7cb2ff12fcaf6235752b21e377a8773e`，
与既有候选构建证据一致；其余三份当时未跟踪的 Markdown 同时保全。
该映射与第 4 节的 v2 EXE 哈希共同标识现有候选，不宣称重新编译必然逐字节相同。

## 4. 必须保留的部署包与运行产物

GMK 上权威包根：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-package-20260907T014254718Z-f5ab9308946e
```

其中 `JanVim-Exhibition-Deploy.zip` 和 `deployment-handoff.json` 都需在小主机保存。
已解压安装目录固定为 `D:\github\JanVim-Exhibition-Deploy`。
若小主机已经复制，先核验现有文件，不必再次传输相同大包。
GMK 保留原 ZIP，小主机保存并核验其副本，可作为两处不同物理主机的存储位置；
记录实际路径，尚未核验的目标副本仍属待办。额外外置盘可选，不作为源码接管的新阻塞。

| 文件（相对包根） | Bytes | SHA-256 |
| --- | ---: | --- |
| `JanVim-Exhibition-Deploy.zip` | 169524590 | `06b8a9079b499f399673443639d52bb551eb2ffa5a7437fa24e95b97dcb3341d` |
| `deployment-handoff.json` | 1169 | `aea479420b361133c3409da24f464ae2a32bea3a68fad8ba61d3bca4574c6837` |
| `JanVim-Exhibition-Deploy/package-manifest.json` | 1466466 | `c42c5d05298681da14c4b507abebc642b732f0f01494ded30c72ab150decde73` |

Manifest 列出 9,095 个 payload 文件；逐文件路径、大小和 SHA 以此完整清单为准，不靠文件名判断版本。
回执 acceptance 仍为 `awaiting-mini-pc-attended-acceptance`。

| 已解压包内相对路径 | Bytes | SHA-256 |
| --- | ---: | --- |
| `app/apps/controller/dist/main/electron-main.js` | 549054 | `db7901a4a34eb1ecc07d151b2366c4d1ece6f17e239a8c3d9dccb9dd47b7add8` |
| `runtime/jianshan/jianshan.exe` | 9799168 | `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f` |
| `runtime/jianshan/jianshan-flock-v1.toml` | 6238 | `510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae` |
| `tools/node/node.exe` | 86988616 | `17347995af08dadcc73a1a154f0942559fbc3f37b9ba57d4576b4d2bcb2834a2` |
| `app/janvim-artifact.lock.json` | 1629 | `9cb5f25c91d8fd7186465de0f90e6ddde8b4a54fadee431d907992a797e54a7c` |
| `app/content/fixture/show.manifest.json` | 23026 | `c7bc0e0299e5a5dadb62c1a4446e53e950341c98e8312eda259cd2bf09f0dd99` |
| `app/content/p0.1/content-lock.json` | 2332 | `5d27312d2dfd3ccebc28771314df1846e50fcd724effabfe8dc83c0577ffd08d` |

JanVim artifact：tag `v0.10.1-gmk.4.punctuation.2`；产品提交
`abbd5a5b942b202e7fe4324bcd3ddab47c672cb9`；core 18,869,248 bytes，SHA
`3fc76259677185c619db2a76e302b9588df0bdd3e58600ed30a5ea08b4194f54`。
包中 `app/runtime/janvim` 包括 core/watchdog、内置 Neovim、Lua/runtime、字体、原 ZIP、provenance 和 build log。
它们必须作为整体保留，不能仅复制 core.exe。

**文件完整性与声卡适配可分别核实。**
小主机先核对上述 ZIP/receipt/manifest SHA，再用包自带工具检查所有 payload：

```powershell
$p = 'D:\github\JanVim-Exhibition-Deploy'
$node = Join-Path $p 'tools\node\node.exe'
$manifestTool = Join-Path $p 'operator\lib\package-manifest.mjs'
& $node $manifestTool verify --root $p
if ($LASTEXITCODE -ne 0) { throw 'package-integrity-failed' }
```

此命令只证明包完整，不跳过生产启动校验，不代表 Senary 端点、三屏、相机或听感已通过。
原包完整但设备不匹配时，在源码候选中做适配并生成新包；不直接修改已安装包以消除报错。

## 5. 旧检出如何自行对齐

接收 agent 先对两个仓库分别记录：根目录、branch、HEAD、origin fetch/push URL、upstream、
`git status --short --untracked-files=all`、本地独有提交及工作树列表。
`origin/*` 的本地引用不代表实时远端，fetch 后再以 `git ls-remote`核对本次交付回执。

分支处理规则：

1. 旧仓库只是落后：fetch 新分支，在新开发分支/工作树中接管。
2. 旧仓库有本地提交或未提交修改：保留原分支/工作树，先列出差异；从交付提交另建工作树继续核验。
   后续只选择性迁入确有价值的小主机改动。不得 `reset --hard`、`clean -fd`、强制覆盖或整仓复制。
3. 若先前已经创建建议分支/工作树，检查它的基准和现有改动后复用；不要重复创建同名分支失败后再清理它。
4. 新工作树也要完整读 AGENTS.md。两个工作树的 ignored runtime/node_modules 不会自动随 Git 创建。

JanVim 的无损检出示例（由接收 agent 核对路径和分支尚不存在后执行）：

```powershell
$repo = 'D:\github\JanVim-Exhibition-2026'
$ref = 'refs/heads/feat/sound-flock-ingress-v1'
$tracking = 'refs/remotes/origin/feat/sound-flock-ingress-v1'
$sourceBase = '959495d806060f9017f3e8f04bc60c01701909f1'
$worktree = Join-Path $repo '.worktrees\exhibition-mini-pc-integration'

git -C $repo fetch origin "${ref}:${tracking}"
if ($LASTEXITCODE -ne 0) { throw 'janvim-fetch-failed' }
$tip = (git -C $repo rev-parse $tracking).Trim()
if ($LASTEXITCODE -ne 0) { throw 'janvim-tracking-ref-missing' }
git -C $repo merge-base --is-ancestor $sourceBase $tip
if ($LASTEXITCODE -ne 0) { throw 'janvim-source-base-not-contained' }
git -C $repo diff --name-only $sourceBase $tip
if ($LASTEXITCODE -ne 0) { throw 'janvim-diff-failed' }
# 核对 tip 等于此次迁移回执；其后差异应仅为本轮交接文档及 README。
# 如出现新源码差异，先审阅并记录；不要把它误报为原基准已验证。
git -C $repo worktree add -b feat/exhibition-mini-pc-integration $worktree $tip
if ($LASTEXITCODE -ne 0) { throw 'janvim-worktree-create-failed' }
git -C $worktree rev-parse HEAD
```

《见山》同样从第 3 节的已保全 v2 完整 SHA 建立小主机开发分支。
不要 `git pull` 后默认停在 main、`MulityStat-clean`、`feat/osc-supercollider` 或旧 v1 分支。
本次迁移不要求先合并 PR，分支已推送即可按精确提交取得全部已提交源码。

## 6. 非 Git 资源与开发环境

Git 不包含运行时、node_modules、构建输出、大型模型和现场会话。源码接管和资源核验都完成才具备开发条件。

| 资源 | 目标机取得方式 | 注意 |
| --- | --- | --- |
| 冻结内容、show TOML、展演 Lua、SC 脚本 | 新 Git 工作树 | 保留当前长文，禁止在运行期间改变 |
| JanVim runtime | 从已验证包的 `app/runtime/janvim` 复制到新工作树同名 ignored 路径 | 目标缺失才复制；已有内容先校验；含字体、Neovim、provenance/build log |
| Node 运行时 | 包中 `tools/node` | 22.23.0；builder 同时核验邻接 LICENSE；仅 node.exe 不等于完整 npm 开发环境 |
| Node/npm 开发环境 | 安装 Node 22.23.0 对应开发分发，核对 `node --version`、`npm --version` | 不使用 Bun 替代 Node 测试；安装后在新工作树 `npm ci` |
| Electron | 按锁定依赖恢复 44.0.0 的完整 Windows runtime | 检查 `dist/electron.exe`、`path.txt`；包内有已鉴定副本，不能只靠 npm 包元数据 |
| 《见山》EXE、四个 VC DLL、MediaPipe/OpenCV DLL | 包中 `runtime/jianshan` | 实际资产身份见 package-manifest 及《见山》交接；不要换成 HP 或旧 v1 EXE |
| 手势模型 | 包中 `runtime/public/models/hand_landmarker.task` | 与 DLL 一并核验，保留相对目录布局 |
| SuperCollider | 3.14.1，`C:\Program Files\SuperCollider-3.14.1` | 程序与驱动为系统前置条件；不必打开 IDE 或安装全局扩展 |
| PowerShell | 7.6.5 x64 | 使用 `pwsh`，不要换成 Windows PowerShell 5；确认 PATH 解析到正确版本 |
| Rust/Cargo/MSVC/Python | 按《见山》交接安装 | 只为原生开发与测试需要；运行包本身不要求 Cargo/Python |
| GPU/UVC | 小主机实际厂商驱动、相机权限 | 三屏 Windows 扩展模式、DX12 Compute；不从 GMK 复制系统驱动 |

新工作树只恢复已核验的 `runtime/janvim`，不拷贝旧 `runtime/user-root` 运行状态、`.operator`、
`.superpowers`、旧 logs、active-deployment、lease、SessionFile、ready/control、liveConfig 或 descriptor/token。
`runtime/user-root` 是本地隔离运行区域，由当前启动流程准备，不是需要迁移的用户 Neovim 配置。

现场状态分三类处理：

- `site-config/display-map.json`：用目标机 GUI 重新识别并确认 SCREEN-1/2/3，不能照搬 GMK ID。
- `site-config/sound-mix-v1.json`：非敏感且跨会话持久化，可由用户选择保留目标机现值；缺失默认 0/0。
  GMK 人工确认的参考值为 WIND `+5 dB`、INSTRUMENT `-1 dB`，不等于新耳机的合适响度。
- descriptor/token/ownership：每个新会话创建，不迁移、不打印、不提交；旧 owner 不能沿用。

如果需要从已安装包重建《见山》builder 输入，应在**新的外部开发资产目录**还原为
`jianshan-rust/` 与 `public/` 两个同级目录：分别复制包中的 `runtime/jianshan/` 和 `runtime/public/`。
builder 的 `-JianShanCandidateRoot` 指向这两个目录的父目录，不能直接指向改名后的 `runtime/jianshan`。
复制前后按 manifest 对照，不更改原包、安全模板或 EXE。

## 7. 已完成的作品表现

当前锁定内容为 `songfeng-source` / `20260902-songfeng-source-r8`，已在基准提交中选择，
不是早期 191-byte 短文。另有 `river-channel`、`tower-codebook` 和 `p0-baseline` profile。
人工长文回写节奏已确认；进一步调整从冻结内容和 cue 时间入手，先保持唯一时钟和 reset 约束。

- A 屏：Catppuccin Mocha 深底；英文技术词蓝、中文信息论术语黄、山水意象绿、过程词紫、数字/缩写桃色。
- 竖排参数：column_width=26、column_gap=26、glyph_advance=24；展演 margin=0/0；保留 Neovim 逻辑行号。
- 标点显示层使用英文标点和实心 `•`，朱批红 `#B74133`；buffer 原文不被替换；当前 artifact 支持已确认的小标点效果。
- 剑客光标、连续长文、自然段落与原诗 reset 已人工确认。光标核心透明度 95% 曾做预览备忘，仍搁置，不能当作已实现。
- 原诗必须恢复为四行，64 bytes / SHA `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`。

后续文字/视觉改动入口：`content/p0.1/`、`content/fixture/show.manifest.json`、
`scripts/select-show-profile.ps1`、`show/janvim-show.toml`、`nvim/lua/janvim_exhibition/`。
它们各有锁和 reset/字节边界；修改后按既有流程审阅并冻结新身份，不能只改哈希让门禁通过。
JanVim 核心渲染改动属于独立产品候选构建，不自动包含在日常内容与声音润色任务中。

## 8. 声音与显示的接线

| 部件 | 权威职责 | 主要源码 |
| --- | --- | --- |
| Show controller | cue/时钟、生命周期、自动开始与正常停止 | `apps/controller/src/show-run-coordinator.ts`、`show-electron-command.ts` |
| 光标接入 | 实际 Lua 观察、Bridge、限频/保留采样年龄 | `show-sound-client.ts`、`sound/real-input.mjs` |
| 鸟群接入 | 认证 TCP/NDJSON、单 owner、epoch 与原采样截止期 | `sound/flock-input.mjs`、`sound/flock-protocol.mjs` |
| 声音 supervisor/sender | 唯一声音会话、统一顺序、Stop | `sound/run.mjs`、`sound/osc.mjs` |
| SC | 拨弦/风声、独立增益、公共限幅与淡出 | `sound/service.scd`、`sound/synths.scd`、`sound/policy.scd` |
| Site Mix | 唯一持久化作者，先保存再应用 | `sound/site-mix.mjs`；B 屏现有控件 |
| 部署启动器 | Sound →《见山》→ Show，C 屏窗口与清理 | `deployment/operator/Start-Exhibition.ps1`、`scripts/place-jianshan-window.ps1` |

《见山》遥测表示真实模拟强度和横向投影重心；默认 10 Hz，最高 20 Hz，CPU/GPU 权威状态来源详见其交接。
500 ms 新鲜度从原采样时间计算；旧 490 ms 样本不会因转发又获得 500 ms。
断鸟群只淡出风声，光标拨弦和画面继续；统一 Stop 之后任何新旧鸟群包和调音都不能复响。
统一淡出约 1.5 秒，鸟群独立释放约 0.3 秒。SC 本机端口目前为 57140/57141；生产入口端口由新会话生成。
不得运行 synthetic probe 占用人工试听唯一 owner。

Site Mix 的 WIND/INSTRUMENT 为 `-24..+6 dB` 整数，每次 1 dB、自动保存，无 Save 按钮。
《见山》Debug 方向键只请求外部风声增益，JanVim 才写 `site-config/sound-mix-v1.json`。
其内置音频及独立 OSC 试听链在联合演示配置中关闭，避免重复发声。
古雅拨弦与鸟群风声是当前最小闭环；经典电子音、鲸鸣、宇宙洪荒感、电子杂讯/热噪仍是后续审美方向。

部署版已实现一次命令自动开始；普通开发入口仍默认 Operator，不应把手动入口误当部署自动启动故障。
正常停止为 `Ctrl+Shift+S`（大小写无关）或 B 屏 STOP SHOW，采用现有安全循环边界停止，可能需等待当前循环结束。
C 屏在启动时按当前 SCREEN-3 精确 PID/启动时间定位、最大化、设为置顶且可交互，
生成 TOML 的 `invert_colors=true`、`bird_color_preset="contrast"`，显示黑底白鸟。
不要重复添加屏幕接管循环、模拟键盘或按标题/进程名批量控制。

## 9. 小主机声音适配的首个任务

已读源码确认同一个 Senary 名称至少存在于三处：

1. `deployment/config/site-defaults.json` 的 `audioOutputDevice`。
2. `deployment/operator/lib/Exhibition.Deployment.psm1` 的严格默认值校验。
3. `sound/service.scd` 的 `ServerOptions.device_`。

`Verify-Deployment.ps1` 用前者做 SC 输出枚举匹配。只改 JSON 会被模块拒绝；
只改校验会让真正的声音服务仍请求 Senary。首个适配应让校验与 SC 最终使用同一个已确认设备。
在小主机读出 Windows/SC 实际设备名、输出 API、声道数、采样率后，
选择该机器的精确 WASAPI 输出，做最小配置传递或目标机专用默认值修复，并同步相应测试与文档。

当前服务是 48 kHz、两路输出、零路输入。先验证 Windows 测试音与 SC 官方示例的实际可听输出；
没有问题证据时不增加 ASIO。不得自动切换到任意扬声器、通过提高系统音量掩盖无声，或放宽身份门禁。
先静音测试，再在用户耳机就绪且低音量时试听；记录实际设备名，不预填猜测值。
这段是下一阶段的工作范围，**本次迁移没有实施此适配**。

## 10. 验证证据与未完成项目

### JanVim 当前基准

在 `959495d…` 上已重新执行 Node **v22.23.0** 下完整 Vitest：
62/62 文件、1206/1206 测试通过，2026-09-07 22:26:37 开始，709.21 秒结束，退出码 0。
随后 `git diff --check` 通过、工作树干净；普通 push 成功，`git ls-remote` 已确认完整远端 SHA。
此前受限沙箱中的 Bun/EPERM 失败不能代替该标准 Node 结果，也不应引导接收方修改产品逻辑。
迁移前记录的 npm ci/typecheck/lint/build、Lua 与 runtime verify 已通过；本轮纯文档交接不重复整个构建。
本次迁移重新核验 ZIP、receipt、关键产物 SHA，并实际完成 `package-manifest.mjs verify`：
9,095 个文件通过，manifest SHA 仍为第 4 节的 `c42c5d05…`。
接收方发生代码变更后再按影响范围验证，并在新可用包交付前执行仓库要求的完整门禁。

### 已有人参与的 Site Mix v2

精确证据文件（仅作证据，绝不可复用该会话）：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\joint-session-20260906T151629220Z-6176c30955c0\attended-hardware-acceptance.json
```

5,741 bytes / SHA `58d916dbfa907f29a5d0580c2290abe1578774e468c593647158a2a0eae6559e`；outcome=pass；
scope=`connected-attended-three-display-camera-gpu-headphones`。两次新会话确认：
长文、真实光标拨弦、真实鸟群风声、三画面稳定、原诗 reset、独立调音、WIND +5 / INSTRUMENT -1
自动保存及继承、鸟群退出后仅风声淡出、统一 Stop 后无复响。

这份回执的 Electron 为 **547,650 bytes / bb63c48d…**，在自动部署功能加入之前。
它不能用来证明 **549,054 bytes / db7901a4…** 的自动开始/C 屏定位/全局快捷键已人工通过。
后者已有自动化和包身份验证，目标机仍需直接观察。

### 接收机仍需完成

- 实际 Node/npm、PowerShell、SC、驱动、相机、三屏映射及输出端点核实。
- 自动开始，C 屏黑底白鸟、最大化/置顶、鼠标显示和点击；A/B 长文与叙事稳定。
- 两路真实声音及独立调音，正常 Stop 共同淡出并持续静音；第二个新会话继承。
- 一次正常 Windows 重启后重新启动，满足工作人员可恢复需求。

《见山》当前源码静音测试和推送结果见它的专门交接，不能用 JanVim 测试数量代替。
不增加本轮明确排除的离线/强制恢复/HP 压测；不把目标机“能启动”写成长期无人值守认证。

此次协作在同一 GMK 环境对《见山》运行了 `cargo test --locked flock_input`（67 通过）、
`cargo test --locked external_wind_gain`（8 通过，含与前者重复项，不能相加为 75 项独立测试）、
`cargo check --locked` 和 28 项纯 Python 测试，均退出 0。
Windows symlink fixture 因主机权限不足未真实执行，明确保留此覆盖缺口。
这些是源码保全的针对性验证，没有新 release 构建或 GUI/相机/硬件声音启动。

## 11. 小主机开发、构建与打包

先结束真实展演；新 Git 工作树内配置 Node 22.23.0 + npm，完整依赖恢复后验证：

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
pwsh -NoProfile -File '.\scripts\run-lua-tests.ps1'
pwsh -NoProfile -File '.\scripts\verify-runtime.ps1'
git diff --check
```

每条退出码都必须核实，失败后不继续生成“全通过”标记。`npm ci` 后检查 Electron 实体文件是否齐全。
首次全面建立目标机开发基线及最终可用包才运行全套；普通文档改动用 diff 检查，功能小改先跑相关测试。
声音 suite 与真实 SC 联调占用相同服务端口，应串行，不与完整应用门禁或另一个声音实例并发。
聚焦命令和各自语义见 `sound/README.md`；假时钟/静音 PCM 不等于真实相机和听感。

Controller 源码变化导致 bundle 改变时，按既有测试和 verifier 审阅新 bytes/SHA，
同步 `scripts/start-show.ps1` 与 `tests/electron-build-smoke.test.ts` 的相关锁；不重写历史回执。
SC 或内容的变化也须进入新提交和新 package manifest。

提交已核验的小主机候选后，用 `deployment/build-deployment-package.ps1` 的实际参数：

```text
-SourceRoot            新的干净 JanVim 开发工作树
-JianShanCandidateRoot 已核验且具有 jianshan-rust/ 与 public/ 的外部资产根
-NodeExecutable        22.23.0 node.exe 的绝对路径（旁边有已鉴定 LICENSE）
-OutputParent          D:\VirtualData\JanVim-Exhibition-Rehearsals
```

输出为新的 versioned package 根、ZIP、handoff receipt。安装根仍固定。
原包保留备份；换包须停止展演，已有安装目录先核实路径并改名保留，再安装新包，不能覆盖混装。
每个达到“可展览”效果的提交都推送对应小主机分支，并记录那个包的 SHA，保留至少一个已人工确认的回退包。
如果改了《见山》源码，先按其交接构建独立 EXE、核对新身份和行为，再显式更新相应候选 gates；
不能期待现有 builder 自动接受任意新 EXE。

## 12. 文档阅读次序与历史说明

1. 两仓 AGENTS.md。
2. 本文和同目录 `2026-09-07-mini-pc-takeover-prompt.md`。
3. 《见山》新交接、`docs/FLOCK_SITE_MIX_V2.md`、`docs/FLOCK_INGRESS_V1.md`。
4. `deployment/docs/README-DEPLOYMENT.md`、`DAILY-OPERATOR-CARD.md`、`TROUBLESHOOTING.md`。
5. `sound/README.md`、部署设计/计划，以及将要修改的源码/测试。

旧 `2026-09-06-site-sound-mix-v2-agent-sync.md` 和 `2026-09-06-joint-rehearsal-quickstart.md`
保留了当时未提交/未试听、547,650-byte bundle、手工 Start 和手工挪 C 屏等历史状态。
旧计划尚未勾选的复选框也不是当前 git/测试状态的证据。本交接与实时源码核验用于本次接管，
不回写旧候选回执来消除历史差异。

## 13. 接收回执与切换完成条件

小主机 agent 在其新开发分支提交一份简洁接收回执，记录：

1. 两仓 origin、精确 HEAD、分支/工作树、与本次交付 SHA 的关系；旧本地改动如何保留。
2. 包 ZIP、receipt、manifest 身份和所需外部资产是否完整；缺失项列出精确路径。
3. Node/npm、PowerShell、SC、Rust/MSVC（若需开发《见山》）、GPU/相机、显示和实际音频端点。
4. 从本文件恢复的作品/声音/Stop要求，哪些已有证据、哪些仍待现场确认。
5. 下一个具体任务：小主机输出设备适配；之后按用户反馈迭代内容、声音、视觉。

当两仓与资源已经齐备，报告 `MINI_PC_SOURCE_AND_ASSET_HANDOFF_READY`。
该标记表示开发接管，不等于硬件验收。此后 GMK 停止写入功能代码，小主机成为唯一开发主场。
普通异常由技术人员正常停止/重启并新开会话；不删除租约，不复用凭证，不按程序名批量杀进程。
