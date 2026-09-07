# Mini PC 双仓接收回执

接管于 2026-09-07 开始，2026-09-08（Asia/Shanghai）汇总。目标机为 PELADN WO4，Windows 11 Pro x64 / 10.0.26100。证据目录沿用接管日期：`D:\github\exhibition-mini-pc-receipt-20260907`。

当前状态：`MINI_PC_SOURCE_AND_ASSET_HANDOFF_READY`。两个源码工作树、所需运行资产和开发工具已接收，按交接第 13 节完成开发接管。READY 发布后已完成 Realtek WASAPI 适配及实际静音服务运行，修正启动器测试的计时观察方式，并为新包加入完整 Electron 门禁。最新全量执行 1,232 项，1,231 通过、1 项因 Windows 临时文件重命名 EPERM 失败；随后整份租约测试 28/28 通过，不能将全量命令改记为成功。独立候选包已生成并核验，尚未安装。本标记不表示测试全绿、部署包可开演或硬件验收通过；现场状态继续为 `awaiting-mini-pc-attended-acceptance`。最新结果及包身份见末节；下文保留各阶段原始失败和限制。

## 两仓身份与保全

| 对象 | JanVim 展演控制器 | 《见山》 |
| --- | --- | --- |
| origin（fetch/push 相同） | `https://github.com/gunpowder78/JanVim-Exhibition-2026.git` | `https://github.com/gunpowder78/jianshan02Boid.git` |
| 交付分支 | `feat/sound-flock-ingress-v1` | `feat/site-mix-v2-handoff` |
| 实时 `git ls-remote` 与 fetch 后匹配的完整交付 SHA | `9b9662e7290e3ec102a1e218bbcfcc8cf42007a7` | `250685ec54011e898267fce7413343fe59b2e4b8` |
| 已记录应用源码基准 | `959495d806060f9017f3e8f04bc60c01701909f1` | `d2ee805b36effa1c6a01f2f54488803704c09f95` |
| 本机新工作树 | `D:\github\JanVim-Exhibition-mini-pc` | `D:\github\JianShan02-mini-pc-v2` |
| 新开发分支 | `feat/exhibition-mini-pc-integration` | `feat/exhibition-mini-pc-integration` |
| 接收文档提交 | `7e37c7018f5c33d55bf644c982fbb145e9023898`；后续端点适配另提交 | `6d1a4577a9484092fde94308352c80ee710ed18f` |

两个新工作树均直接从各自完整交付 SHA 创建；没有整仓合并。祖先检查均 exit 0。JanVim 应用基准到交付 HEAD 仅变更 README 和两份迁移文档；《见山》v2 基准到交付 HEAD 仅新增交接文档。《见山》历史四文件差异复算为 47,310 bytes / SHA-256 `1583e94bab0729ae984496dc8db4a33e7cb2ff12fcaf6235752b21e377a8773e`，与交付一致。两仓接收提交只增加回执；READY 后的 JanVim 设备适配见末节，《见山》没有功能修改，冻结内容与跨仓协议均未改变。

旧 JanVim 检出 `D:\github\JanVim-Exhibition-2026` 保持 `main` / `a750a99947ff0be21feb0c91bd2eaec725e41b1a`，跟踪 `origin/main`，接管前后均干净，无本地独有提交。旧《见山》检出 `C:\GitHub\JianShan02` 保持 `main` / `a739f4de986631319d6dbd973279eb6a7d0b30a1`，跟踪 `origin/main`，相对该本地远端引用有一个独有提交；它是旧 Electron release，涉及 7,703 文件，完整文件列表另存 `jianshan-old-local-commit-files.txt`。

旧《见山》的 `.vscode/settings.json`、`新项目开机自启配置指南.md` 原件保持未跟踪状态，副本保存于证据目录的 `jianshan-old-untracked/`，已比对源/副本大小及哈希。它们没有自动迁入原生 v2。旧目录 `C:\JianShan02Boid` 是 release 存档而非 Git 仓库；另一个 `C:\GitHub\JianShan` 是不同项目，检查后保持原样。

完整读取旧 JanVim 与两个新工作树的 `AGENTS.md`；旧《见山》检出没有该文件，故从交付提交通过 `git show` 读取，随后再读新工作树实文件。三份指定交接文档均已完整读到 EOF；部署操作文档、声音说明和《见山》两版协议文档也已读取。未发现嵌套 `AGENTS.md`。

接管前的 branch、HEAD、origin、upstream、status、worktree list、本地独有提交记录见 `janvim-before-fetch.json`、`jianshan-before-fetch.json`；空的 tracked/staged patch 也已保存。旧检出的 HEAD、分支、工作树状态及未跟踪文件已复核未变。没有 reset、clean、stash、强推、自动合并或覆盖旧检出。

## 包与非 Git 资产

| 本机保留文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `D:\github\JanVim-Exhibition-Deploy.zip` | 169524590 | `06b8a9079b499f399673443639d52bb551eb2ffa5a7437fa24e95b97dcb3341d` |
| `D:\github\deployment-handoff.json` | 1169 | `aea479420b361133c3409da24f464ae2a32bea3a68fad8ba61d3bca4574c6837` |
| `D:\github\JanVim-Exhibition-Deploy\package-manifest.json` | 1466466 | `c42c5d05298681da14c4b507abebc642b732f0f01494ded30c72ab150decde73` |

包内工具 `package-manifest.mjs verify --root D:\github\JanVim-Exhibition-Deploy` 实跑 exit 0，**9,095/9,095** payload 文件通过。包的 `sourceCommit` 仍为 `959495d806060f9017f3e8f04bc60c01701909f1`，不改写成后续文档 HEAD。旧包、旧 ZIP 及原 acceptance 字段未修改。

另一个本机 ZIP 副本 `D:\JanVim-Exhibition-Temp\JanVim-Exhibition-Deploy.zip` 的大小及 SHA 同样匹配。GMK 原件按交接保留于 `D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-package-20260907T014254718Z-f5ab9308946e\JanVim-Exhibition-Deploy.zip`；本轮没有访问 GMK，GMK 身份沿用交付记录。GMK 与 Mini PC 是两台主机；Mini PC 的两个 D 盘路径不计为两份独立物理备份。

开发资产按清单逐文件复制并重新核验：

- 包中 `app/runtime/janvim/` 的 **2,143** 文件整体恢复至新 JanVim 工作树的 `runtime/janvim/`，包括 watchdog、内置 Neovim、Lua、字体、原 ZIP、provenance、build log。artifact 仍为 tag `v0.10.1-gmk.4.punctuation.2` / commit `abbd5a5b942b202e7fe4324bcd3ddab47c672cb9`；core 18,869,248 bytes / `3fc76259677185c619db2a76e302b9588df0bdd3e58600ed30a5ea08b4194f54`。
- 新的 `runtime/user-root` 只按当前 `prepare-janvim-runtime.ps1` 的锁定模板及当前 7 个展演 Lua 模块生成；模板 SHA 为 `b47803728c52086ed384db00d8c9dd262b345b7ea9ebe1f8f900ce7313979965`。没有复制旧 user-root、用户 Neovim 配置、运行状态或会话文件。原 `verify-runtime.ps1` 实跑通过。
- 新外部 builder 输入根为 `D:\github\exhibition-mini-pc-assets`，内含同级 `jianshan-rust/`（10 文件）与 `public/`（1 模型），**11/11** 复制后匹配完整包 manifest。后续 builder 的 `-JianShanCandidateRoot` 指向这个父目录。
- 《见山》源码工作树另恢复两个指定 native DLL 与手势模型，3/3 源/目标哈希匹配且 ignored。原生 EXE 未复制到源码树冒充新构建。其回执见 `D:\github\JianShan02-mini-pc-v2\docs\2026-09-07-mini-pc-receipt.md`。

发现一个交付描述与实际清单的差异：旧包及其 manifest **没有** `app/node_modules/electron/dist/electron.exe` 和 `app/node_modules/electron/path.txt`。整包 manifest 通过只证明已有清单一致，不能据此宣称旧包具有完整 Electron 或可开演。已在新开发工作树从锁定 npm 包的官方安装器恢复 Electron **44.0.0**，按其 `checksums.json` 校验 ZIP，并检查完整 dist、path.txt、version 文件。ZIP 为 157,455,369 bytes / SHA-256 `e61aa3bcea8152bc0730abd015e47c032d778a0ef10e2a1c78ba3c4ea47942f9`；EXE 为 244,440,576 bytes / `1dc2d12e5c60341782e68c4b65a8e49cbd86217f81568f90575547cec13b5610`。ZIP 保留于 `D:\github\exhibition-mini-pc-tools\electron-runtime-44.0.0`；独立下载源为 [Electron 官方 v44.0.0 资产](https://github.com/electron/electron/releases/download/v44.0.0/electron-v44.0.0-win32-x64.zip)。未来必须生成新包并检查其包含完整 Electron，不能修补旧部署包后沿用原回执。

本机包的 `evidence/` 只有 `source-identities.json`。以下历史证据尚未作为本机独立文件接收，列为后续定点保全项；这限制本机独立追溯历史 EXE 构建及人工验收的证据链，不否定本次运行资产哈希核验。本轮不扫描历史会话目录或冒用历史验收。

- GMK `D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c\candidate-receipt.json`：5,511 bytes / `b53925491ed9a611038c755dd9cc6880130c1168cbce0f44416888387f545d57`。
- 同一 GMK candidate 根的 `evidence\jianshan-inventory-v2.json`：2,989 bytes / `4996f71f2a723519fadd5bc6569f63d533ad0e44174ea674cafffd14bc1294d3`。
- GMK `D:\VirtualData\JanVim-Exhibition-Rehearsals\joint-session-20260906T151629220Z-6176c30955c0\attended-hardware-acceptance.json`：5,741 bytes / `58d916dbfa907f29a5d0580c2290abe1578774e468c593647158a2a0eae6559e`；属于旧 547,650-byte main，不能验证当前自动部署。

接收时 builder 只复制已有依赖，manifest 验证器只核对所列文件，不能阻止再次漏装 Electron。此项已在新分支补齐失败测试和 builder/verifier 门禁，并实际生成新候选，详见末节。旧部署包和原身份校验均未改写。

## 开发工具与自动验证

| 工具 | 本机结果 |
| --- | --- |
| Node / npm | 原系统 v24.12.0 / 11.6.2 保持；另置 `D:\github\exhibition-mini-pc-tools\node-v22.23.0-win-x64`，实测 v22.23.0 / 10.9.8 |
| Node 下载身份 | 官方 ZIP 35,681,216 bytes / SHA-256 `425a5bd68cc95e8eb16bcccd0a75081b48983fc6a26f67126bd4d6c7198231e8`，匹配官方 SHASUMS；node.exe SHA 与包内 `17347995...` 一致，邻接 LICENSE 已核验 |
| PowerShell | PATH 的实际 `pwsh` 为 Microsoft Store 分发 7.6.5 x64，版本符合要求 |
| SuperCollider | `C:\Program Files\SuperCollider-3.14.1\sclang.exe`，实测 3.14.1 / 426edf6 |
| .NET 测试依赖 | 交接文档漏列；`tests/start-show.test.ts` 编译 net9.0 fake Node。新建隔离 SDK 9.0.317 / runtime 9.0.19，官方 ZIP SHA-512 匹配，编译及运行无 GUI 的预热测试通过 |
| Rust / Cargo | 隔离 1.97.1，MSVC x64；保留 Cargo.lock 与默认 mediapipe-native |
| MSVC / Windows SDK | 现有 VS 2022 Build Tools，MSVC 14.44.35207 / cl 19.44.35222，Windows SDK 10.0.26100.0 |
| Python | `C:\Python314\python.exe` 3.14.2；与交付 3.11.15 的差异已记录，指定纯 Python 测试实跑通过 |

新 PowerShell 开发窗口先执行以下命令，仅设置当前进程环境并进入新工作树，不启动展演：

```powershell
. 'D:\github\exhibition-mini-pc-tools\Enter-JanVim-Development.ps1'
```

本机验证记录：

| 检查 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | exit 0，184 packages；Electron 二进制单独按上述方法恢复 |
| `npm run typecheck` / `npm run lint` | 均 exit 0 |
| `npm run build` | exit 0；新构建 main 为 **549,054 bytes / `db7901a4a34eb1ecc07d151b2366c4d1ece6f17e239a8c3d9dccb9dd47b7add8`**，与交付包一致 |
| Lua suite | 使用 artifact 内 NVIM v0.10.1，`-u NONE -i NONE --noplugin --headless`，两个 suite exit 0 |
| `scripts/verify-runtime.ps1` | exit 0，锁定产物及新生成运行配置通过 |
| JanVim 接收基准完整 suite | **exit 1**；61/62 文件、1203/1206 项通过，3 项失败；1079.79 秒，详见 `test-restored-result.json` / `npm-test-restored.log` |
| JanVim 原失败项定点复核 | **exit 1**；相同 3 项失败、其余 144 项未在该定点命令执行；40.40 秒，详见 `test-focused-launcher-timing-result.json` / `test-focused-launcher-timing.log` |
| 《见山》静音检查 | `flock_input` 67 passed、`external_wind_gain` 8 passed、`cargo check --locked`、Python 28/28 均 exit 0；Rust 两组有重叠，不相加为 75 项 |

保留了首次标准 `npm test` 的失败记录：60/62 文件、1057/1206 通过；145 项启动器用例受缺失 .NET 9 的首个 fixture 编译失败影响，另外 4 项文件操作用例超出默认 5 秒预算。隔离诊断确认一个三场景用例执行六次 PowerShell 子命令，共约 5.7 秒，每项退出码符合预期。恢复工具后完整复核使用 `npm test -- --maxWorkers=1 --testTimeout=10000`；此参数只设置测试框架的默认单例墙钟总预算，不能覆盖测试中显式的 15 秒等预算，没有改动测试断言、子进程界限、生产代码或假时钟边界。原始失败未删除或改写。

接收基准当时剩余三项均在 `tests/start-show.test.ts`，用原文件及同样环境单独执行也失败，不能作为偶发噪声忽略：

| 用例 / 原断言 | 完整 suite | 原样定点复核 |
| --- | --- | --- |
| `rejects unknown parameters, an existing terminal marker, and frozen content mutations`；8 场景共享显式 15,000 ms 框架预算 | 16,355 ms，框架超时 | 20,115 ms，框架超时 |
| `terminates a hung network snapshot before any show process starts`；启动器总体耗时 `< 7,000 ms` | 7,024 ms | 7,269 ms |
| `times out a 3000 ms close helper at 2000 ms without settling or forcing the child`；子进程 `started` 记录到父调用返回的间隔 `>= 1,800 ms` | 1,711 ms | 1,752 ms |

静态复核发现关闭助手生产 Stopwatch 在 `Process.Start()` 后起计，而测试 `started` 在子 PowerShell 完成启动后才写入，两个计时起点不同；本机子进程启动开销会缩短测试测得的区间。网络检查生产 5,000 ms 与关闭助手生产 2,000 ms 上限均未改动。当时的证据没有证明上述失败需要放宽生产安全边界，也不能宣称所有后续断言都执行通过。随后已只修正测试计时观察并复核，详见末节；这不删除或改写原始完整基准失败记录。

真实 Windows symlink fixture 由于权限不足早退，虽然 Rust 工具显示 1 passed，实际文件系统覆盖仍未执行；Linux no-follow 也未在本机验证。

## 实际音频及现场未验项

Windows Core Audio 的 `IMMDevice.GetState`、`IPropertyStore`、`IAudioClient.GetMixFormat` 和隔离 SC `ServerOptions.outDevices` 都已实测。首轮及 00:36 源码适配核验期间未 Initialize/Start 音频流，也未 boot SC server；01:18 实际静音服务运行的新增结果见末节。首轮证据为 `core-audio-endpoints.json`、`sc-audio-enumeration.json/.log`；以下表格保留 READY 发布前观察，00:26 的状态变化与适配记录紧接其后。最初注册表原始格式偏移解析无效，数值已废弃，最终采样率只引用 Core Audio API 输出。

| 端点 | 首轮状态 | 可确认格式 |
| --- | --- | --- |
| `Speakers (Realtek High Definition Audio)` | **UNPLUGGED (8)**；SC 仅见 WDM-KS 层，没有该设备的 WASAPI 输出 | 未查询：端点非 ACTIVE |
| `Windows WASAPI : 2 - Mi TV (AMD High Definition Audio Device)` | ACTIVE，Windows 默认多媒体输出 | 2 channels / 48,000 Hz；共享混合格式 32-bit |

Realtek 驱动 6.0.1.7899 / oem22.inf、AMD 音频 10.0.1.40 / oem21.inf 均存在。`UNPLUGGED` 的解释依据 [Microsoft Core Audio 状态定义](https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-state-xxx-constants)。当前证据不支持预先安装 ASIO；没有切换默认设备、提高系统音量或把电视作为已确认耳机输出。

READY 发布后，2026-09-08 00:26:32 +08:00 的只读复核观察到 Realtek 已变为 **ACTIVE / 默认多媒体输出 / 2 channels / 48,000 Hz / 32-bit 共享混合格式**；SC 同时实测列出 **`Windows WASAPI : Speakers (Realtek High Definition Audio)`**。没有通过脚本切换默认设备、插拔设备或改音量，不能仅凭该变化断言用户已准备好试听。独立保留本次证据于 `audio-after-ready-20260908T0026/`，未覆盖首轮证据。

以当前系统默认 Realtek 作为本机候选目标，统一了 `deployment/config/site-defaults.json`、`deployment/operator/lib/Exhibition.Deployment.psm1` 的验证与 `sound/service.scd` 最终设备名。精确匹配仍生效；schema 测试另外暴露 PowerShell 的数组比较可能误收 `["设备名"]`，已增加字符串类型检查。Senary、HDMI 电视、WDM-KS、空字符串、错误大小写和非字符串均拒绝。SC 保持双声道 48 kHz、零输入及既有 Listen 边界。

适配验证：测试先行日志 `audio-adapter-schema-red.log` 确认旧实现拒绝 Realtek、接受 Senary；最小替换后 `audio-adapter-schema-initial-green.log` 记录数组类型失败，再修复类型检查。`npm test -- tests/deployment-operator.test.ts tests/deployment-package.test.ts --maxWorkers=1 --testTimeout=10000` **41/41 passed，exit 0，27.27 秒**；typecheck、lint 与 build 均 exit 0，main bundle 的 549,054 bytes / SHA 保持匹配。隔离 sclang 通过 `compileFile` 仅编译 SC 服务，未调用返回的服务函数，同时确认所选端点在真实输出列表中；`audio-adapter-sc-check.json` 记录两项通过且 server 未 boot。独立审阅未发现阻止本次提交的缺陷，并复核旧部署三处对应文件仍匹配原 manifest。00:36 的这一阶段尚未执行实时无声合成或生成新包，后续新增结果见末节。

接下来由现场确认实际耳机/音箱接线及就绪状态，再在有人值守条件下验证可听输出与联合声音。当前已从最初的“找不到 Realtek WASAPI 端点”推进到精确端点选中、实际静音服务启动及清理通过；音量、听感及 Stop 淡出仍未验收。

接收时未发现 present Camera/Image 设备，GPU 为 AMD Radeon 760M，驱动 32.0.13028.3，仅静态确认了 1920×1080 桌面；DX12 Compute、三屏和两台物理投影仪尚未实跑。`D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config\display-map.json` 与 `sound-mix-v1.json` 当时均缺失；显示映射须等现场用配置器确认，混音缺失按现有规则从 0/0 dB 起步，不迁入 GMK +5/-1 作为耳机安全响度。

Windows 测试音、SC 官方示例听音、真实光标拨弦与相机鸟群风声、自动 Start、C 屏黑底白鸟/最大化/置顶/鼠标、独立增益保存继承、正常 Stop 淡出无复响、正常重启后新开演均待有人值守确认。GUI、相机与可听声音未启动；新候选只单独生成和核验，旧部署包未替换。

作品要求保持：`songfeng-source` / `20260902-songfeng-source-r8` 长文，唯一 show clock；A 屏剑客光标和四行原诗 reset（64 bytes / `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`）；SCREEN-2 为 Web 展示表面；鸟群默认 10 Hz、原采样 500 ms 截止期，统一 Stop 优先且终态不可复响；WIND/INSTRUMENT 独调并由 JanVim 唯一持久化。声音单会话 3,600 秒上限保留，全天续航未解决。

本次接管不等于硬件验收。三次连续物理投影循环、离线、强制恢复等均未获得本机证据；本阶段依照交接不额外启动这些现场步骤，也不作长期无人值守声明。GMK 按用户约定只留备用，后续功能开发集中在本机新分支。

## 01:22 新候选与最终自动检查

新候选源码为 `986c8e5249a98ad552e158605951b835f05ccf46`，包含 Realtek 适配、测试计时修正与 Electron 运行时门禁。后续本回执提交只改文档；包的 sourceCommit 保持实际构建点，不改写为最终文档 HEAD。《见山》仍为 `6d1a4577a9484092fde94308352c80ee710ed18f`，没有追加功能修改。

启动器测试修正只在 fixture 副本中观察实际 `Invoke-BoundedProcess` 的 Stopwatch、超时预算、终止原因与进程退出；生产 `scripts/start-show.ps1` SHA 仍为 `336a9545b12d72ddbed741ecac9673b9ae0c88ef9c4aa29a51f165a22216f59c`。原八场景合并用例拆成八个独立用例，每个仍有 15 秒界限；网络 5 秒及关闭助手 2 秒边界未放宽，相关租约、子进程存活和不重试断言保留。定点 10/10 通过，随后全量中的全部 154 个启动器用例通过。

Electron 门禁先运行失败测试，再加入锁定官方 ZIP 的全部 73 个 dist 文件大小与 SHA、入口 path.txt 和 npm/dist 版本检查。builder 在创建输出前检查源运行时，复制后再次检查，部署 verifier 在普通 manifest 后独立检查。即使重新生成普通 manifest，缺失必需运行文件仍被拒绝。`deployment/config/electron-runtime.lock.json` 的全部条目已和官方 ZIP 及本机文件逐项比对，未启动 Electron GUI。相关 53/53 测试通过，独立代码审阅未发现阻止该改动的问题。

| 最终检查 | 结果与证据 |
| --- | --- |
| typecheck / lint / build | 全部 exit 0；`package-gate-static-results.json`；main bundle 字节数和 SHA 不变 |
| 完整 `npm test -- --maxWorkers=1 --testTimeout=10000 --reporter=verbose` | **exit 1，62/63 文件、1231/1232 项通过，1129.45 秒**；`npm-test-candidate-final.log` / `test-candidate-final-result.json` |
| 唯一失败 | `run lease settlement removal > keeps a settled lease when the file has changed or is malformed`；fixture 更新 generation 时临时文件 rename 返回 EPERM，5 次有界重试耗尽，尚未进入目标断言；未修改生产租约逻辑，未确认 OS 占用原因 |
| 整份租约测试复查 | 无代码改动，**28/28 passed，exit 0，1.77 秒**；`run-lease-recheck.log` / `run-lease-recheck-result.json`；不据此将前一全量 exit 1 改记为成功 |
| 真实 SC 静音服务 | 原有单例 `boots and cleans up one captured silent service without an audible output` **1/1 passed，exit 0**，约 10 秒；`audio-silent-realtek.log` / `audio-silent-realtek-result.json` |
| 旧安装包最终复核 | **9095/9095** 文件仍匹配原 manifest；`old-package-final-integrity.log` |

静音用例于 01:17:58 至 01:18:08 运行：使用当前 Realtek WASAPI 配置 boot 实际 SC server，零输入、48 kHz 双声道，1 秒服务请求按既有淡出/清理逻辑生成 2.5 秒 PCM16LE 捕获；两声道 peak/RMS/clippedSamples 均为 0，`hardwareOutput=false`，完成原因 `duration`、`clean=true`。01:20 复核没有遗留 sclang/scsynth 进程及 57140/57141 UDP 端口。没有创建硬件声音输出节点，不能将静音启动替代可听输出验收。捕获保留于 `D:\VirtualData\JanVim-Exhibition-Rehearsals\sound-service-mraANP\silent-capture.wav`。

独立候选根：`D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-package-20260907T171913233Z-d7eb6a614269`。

| 新候选文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `JanVim-Exhibition-Deploy.zip` | 331516660 | `c6a6cfe540728676bb9a0e1bc971f47727901025873ee455101b57c42e24c9b3` |
| `JanVim-Exhibition-Deploy/package-manifest.json` | 1465744 | `79e8d5bb6778ff30bf7c747628dd381657bb628cc01a6e220b90dfbc0ca4953d` |

builder exit 0；包目录的 **9,134** payload 文件通过 manifest 核验；另外独立打开 ZIP，**9,135** 个文件（含 manifest）集合、大小及逐项 SHA 全部匹配，Electron 为 44.0.0 / 73 文件。证据为 `build-new-package.log`、`build-new-package-result.json`、`new-package-zip-verification.json`。没有用缺失文件也能通过的旧清单作为新包完整性的唯一依据。

该包是可供检查的开发候选，**尚未安装、未人工验收，全量自动门禁保留一次 EPERM 失败**；不称为可开演包，不替换最后可回退包。历史 GMK 构建/验收证据未接收及真实 symlink 覆盖不足等限制仍保留。完整接收、早期音频与最终状态分别保存在证据目录 `mini-pc-receipt.json`、`mini-pc-audio-candidate.json`、`mini-pc-final-status.json`，历史快照未覆盖。
