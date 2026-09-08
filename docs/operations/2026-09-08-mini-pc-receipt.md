# Mini PC 双仓接收回执

接管于 2026-09-07 开始，2026-09-08（Asia/Shanghai）汇总。目标机为 PELADN WO4，Windows 11 Pro x64 / 10.0.26100。证据目录沿用接管日期：`D:\github\exhibition-mini-pc-receipt-20260907`。

当前状态：`MINI_PC_SOURCE_AND_ASSET_HANDOFF_READY`。两个源码工作树、所需运行资产和开发工具已接收，按交接第 13 节完成开发接管。READY 发布后已完成 Realtek WASAPI 适配、实际静音服务运行、四轮有人值守启动诊断、长路径系统修复、声音连接预算修复及运行后缓存门禁。用户已在候选 5 实际听见拨弦和风声，并确认正常 Stop 平滑淡出且没有复响；其《见山》只最大化的缺陷由候选 6 修正。候选 6 完成 3 个连续显示器模拟循环、正常 Stop 和机器全屏审计；用户进一步确认右侧《见山》无标题栏、无任务栏且无需按 F 即全屏。本机三屏现场验收据此通过，最新完整测试为 **1,289/1,289 passed**。随后生成只增加操作说明及身份记录的候选 7，严格证明 9,128 个运行与冻结文件和候选 6 一致，安装验证通过并冻结为命名黄金基线。物理双投影、离线及强制恢复仍未执行，不能据此扩展为物理展场验收通过。最新结果及包身份见末节；下文保留此前全量测试 EPERM、四次启动失败和其他阶段性限制，不用后来的成功覆盖原始失败证据。

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

现场随后确认了实际耳机/音箱接线及就绪状态。候选 5 的联合展演中，用户实际听见拨弦和风声，并确认正常 Stop 平滑淡出且没有复响；声卡现场听音和 Stop 声音终态据此通过。候选 6 只改变《见山》窗口全屏助手，声音文件保持冻结；其机器记录同样显示 Realtek 硬件输出、拨弦与风群均被接收、正常 Stop 后活动拨弦归零且声音服务 clean 退出。

接收时未发现 present Camera/Image 设备，GPU 为 AMD Radeon 760M，驱动 32.0.13028.3，仅静态确认了 1920×1080 桌面；DX12 Compute、三屏和两台物理投影仪尚未实跑。`D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config\display-map.json` 与 `sound-mix-v1.json` 当时均缺失；显示映射须等现场用配置器确认，混音缺失按现有规则从 0/0 dB 起步，不迁入 GMK +5/-1 作为耳机安全响度。

Windows 测试音、真实光标拨弦与相机鸟群风声、自动 Start、正常 Stop 淡出无复响均已在有人值守条件下执行；用户已确认显示和相机正常，并确认拨弦、风声及 Stop 听感。候选 5 暴露 C 屏只有最大化而非默认全屏；候选 6 已用精确窗口句柄改为无边框全屏并完成机器审计，用户随后确认右侧《见山》无标题栏、无任务栏且无需按 F 即全屏。独立增益保存继承和正常重启后新开演没有在本轮另行登记为人工通过。

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

该包是当时可供检查的开发候选，**当时尚未安装、未人工验收，全量自动门禁保留一次 EPERM 失败**；后续候选与安装状态见下一节。历史 GMK 构建/验收证据未接收及真实 symlink 覆盖不足等限制仍保留。完整接收、早期音频与当时最终状态分别保存在证据目录 `mini-pc-receipt.json`、`mini-pc-audio-candidate.json`、`mini-pc-final-status.json`，这些历史快照未覆盖。

## 03:09 夜航部署就绪，现场验收待继续

用户已现场确认显示和相机正常，并授权管理员确认后启用 Windows 长路径。随后切换为夜航模式：继续代码、测试、打包、保全和安装，但不再启动会亮屏、占用相机或产生可听声音的流程。下述自动化结果没有冒充人工现场验收。

### 有人值守诊断与修复

固定部署的四次联合启动均保留原始失败结果，没有改记为成功：

1. 首次启动发现原生《见山》子进程需要接受空参数列表；修复提交为 `a74d86e`。
2. 第二次启动发现 Windows 原生进程身份元数据在创建后短暂不可读；加入有界身份确认及原始 `Process` 对象清理，修复提交为 `e505547`。
3. 第三次启动发现 Electron 租约时间戳含毫秒，而 PowerShell 使用 `ParseExact('o')` 后按 ticks 比较；改为保留毫秒精度，修复提交为 `c6f7f8d2ff481a1e123e182aba7c91dc4523194e`。
4. 第四次启动中 JanVim 已产生 `surface-ready`，但 plugin-lab 在长路径下读取 Lua 缓存报 `ENOENT`，同时声音客户端在异步读取回执期间提前耗尽 1 秒 socket 连接预算。展演在首循环前执行有界清理并退出；没有把该次启动算作循环成功。

管理员脚本把 `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` 从 0 改为 1，退出码为 0。随后在原失败长度下重新运行 plugin-lab，0.126 秒正常退出并加载 `lazy.nvim` 与 `local:janvim-exhibition`；当前进程无需重启。提案、执行与复核见 `attended-20260908/windows-long-paths-proposal.json`、`windows-long-paths-20260907T182715974Z.json`、`windows-long-paths-verified.json`，没有请求系统重启。

声音客户端现在分别给予回执读取 5 秒和 socket attach 1 秒的有限预算，避免三屏启动期间把文件读取耗时误算为网络连接耗时；回执仍失败关闭、连接仍不重试，Stop 终态不变。运行后部署验证只额外接受以下四个精确目录，并限制为最多 1,024 个文件、单文件 16 MiB、合计 64 MiB：

- `app/runtime/user-root/safe-mode/cache`
- `app/runtime/user-root/safe-mode/state`
- `app/runtime/user-root/plugin-lab/cache`
- `app/runtime/user-root/plugin-lab/state`

额外状态仍拒绝重解析点、硬链接、私有运行文件和清单外其他路径；清单所列文件即使位于这些目录下也必须逐项匹配。builder 只允许源树中存在空状态目录，发现状态文件即停止，不会自动删除。

上述修改及新的 Electron 身份锁提交为 `a90f456fe9b567e11b7c44d496846aad20e91c7e`，已推送到 `origin/feat/exhibition-mini-pc-integration`。《见山》仍为 `6d1a4577a9484092fde94308352c80ee710ed18f`，没有并行功能修改。

### 夜航自动化结果

| 检查 | 最新结果 |
| --- | --- |
| 声音客户端、运行缓存、部署包与操作脚本合并回归 | 136/136 passed |
| Electron 身份锁及部署相关复核 | 114/114 passed |
| `npm run typecheck` / `npm run lint` | 均 exit 0 |
| `npm run build` | exit 0；main 为 **549,304 bytes / `77408bde85dc374ba21d011cecb088278197ae6c7785f205a58bc7130bdc8826`** |
| 完整 `npm test -- --maxWorkers=1 --testTimeout=10000` | **66/66 文件、1,289/1,289 项通过，exit 0，1,169.90 秒** |

本次完整测试没有复现上一节记录的临时文件 EPERM；上一轮失败日志仍原样保留。运行缓存门禁的独立 RED、补充 RED、102/102 回归及静态检查记录在 `runtime-state-verification.json`。声音读取预算的 RED 与 34/34 最终回归记录在 `attended-20260908/sound-connect-budget-*.log`。

### 候选 5、旧包保全与固定安装

候选 5 的独立构建根为 `D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-package-20260907T190046199Z-288d6993a666`，sourceCommit 为 `a90f456fe9b567e11b7c44d496846aad20e91c7e`。

| 候选 5 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `JanVim-Exhibition-Deploy.zip` | 331610425 | `7b558f085d3811493f71e9b3b191ded745daff5c8bd573637954888c56109aa8` |
| `JanVim-Exhibition-Deploy/package-manifest.json` | 1473637 | `2ac5eb0c80dd34185a2a747a2dbddf70e26741cf264c28cfde8d8eb6dfa974ef` |

builder exit 0；包目录 9,182 个 payload 文件通过严格 manifest 核验。独立打开 ZIP 后，9,183 个文件（含 manifest）的集合、大小和逐项 SHA 全部匹配；Electron 为 44.0.0 / 73 文件。证据见 `attended-20260908/candidate-5/new-package-zip-verification.json`。

安装前再次确认没有 active pointer、固定包进程或 57140/57141 listener。候选 4 当时的 9,134 个固定文件全部匹配，额外运行状态为 16 文件 / 89,184 bytes，且全部位于允许目录。候选 4 随后在同一卷整体改名保留为 `D:\github\JanVim-Exhibition-Deploy-preserved-20260907T190654029Z`；移动前后核验身份一致，没有删除旧目录内容。

候选 5 复制到 `D:\github\JanVim-Exhibition-Deploy` 后，严格模式通过 9,182 个固定文件，installed 模式通过相同固定文件且额外运行状态为 0。安装记录见 `attended-20260908/candidate-5/installation-result.json`。此前原包及候选 1–3 的保留目录、原始 ZIP 和各阶段部署包均保持；没有 reset、clean、强推、自动合并或直接修补旧部署包。

固定路径执行 `operator\Verify-Deployment.ps1` exit 0 并输出 `DEPLOYMENT_VERIFY_PASS`：包清单、运行状态、Electron、JanVim 固定产物、《见山》运行时、PowerShell、SuperCollider、精确 Realtek WASAPI 端点、相机存在性及 schema 2 / confirmed / production-3 三屏映射全部通过。相机检查只确认设备存在，没有打开相机；日志为 `attended-20260908/candidate-5/verify-deployment.log`。

真实音频目标已确定为 `Windows WASAPI : Speakers (Realtek High Definition Audio)`，设备为 ACTIVE、默认多媒体输出、双声道 48 kHz 共享模式；没有安装 ASIO、改变默认端点或修改系统音量。Windows 播放设置中的该端点测试按钮已通过 UI Automation 调用并正常返回，设置未改变。代码层声音连接根因和长路径根因已经修复；用户随后在候选 5 联合展演中实际听见拨弦和风声，并确认正常 Stop 平滑淡出且没有复响，声卡现场听音据此通过。

上述用户配合项中，三屏、相机、可听拨弦/风声、正常 Stop 听感及候选 6 最终全屏观感均已执行并获得用户确认；本机三屏的有人值守验收完成。当前机器记录的是三台显示器，不能据此声称两台物理投影仪验收通过；交接还明确排除了本阶段追加离线与强制故障验收，因此这些项目继续保留为以后单独排练。候选 6 不能称为已通过物理展场验收的可开演包。

## 13:02 候选 6 默认全屏修复与现场复验

候选 5 的联合展演完成后，用户确认“实际听见拨弦和风声，Stop 后平滑淡出且没有复响”，同时指出《见山》仅为最大化窗口，仍需人工按 F 才能进入全屏。当前原生 TOML 的 `[display]` 只读取 `invert_colors` 与 `bird_color_preset`，不存在启动全屏键；直接增加未知字段不会改变运行行为。由于《见山》启动时还未确定展演 SCREEN-3，改原生启动全屏也可能落到错误显示器。

修复提交 `8f1ed4d2fcdd93e0d43d14a4fa92bcfe1c307744` 只修改部署侧精确窗口助手及其测试。助手仍要求本次子进程的启动时间身份及唯一初始可见顶层 HWND，随后移除边框样式，将窗口外框精确设为 SCREEN-3，并在原 10 秒有限预算内核验无边框、非最大化、置顶、可交互及实际像素边界。没有使用全局键盘注入、F 快捷键或坐标点击，也没有修改《见山》冻结二进制、TOML 或旧部署包。真实 EXE 隔离探针及完整联合运行都通过。

修复后的定点窗口测试 4/4 通过，相关部署与恢复回归 80/80 通过；typecheck、lint、build 均 exit 0。完整 `npm test -- --maxWorkers=1 --testTimeout=10000` 为 **66/66 文件、1,289/1,289 项通过，exit 0，1,163.04 秒**。main bundle 保持 549,304 bytes / `77408bde85dc374ba21d011cecb088278197ae6c7785f205a58bc7130bdc8826`。

候选 6 构建根为 `D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-package-20260908T044531712Z-46276dbcea8d`：

| 候选 6 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `JanVim-Exhibition-Deploy.zip` | 331524857 | `a4a700ae349d43eb187d7ff558dacfff83694f3d0a0c2ee2e4f2bb4f02db67c7` |
| `JanVim-Exhibition-Deploy/package-manifest.json` | 1465745 | `70132fe1706a59a826846defa4391ec17ddcdc2181d48ae0b1ff230bd07f24cd` |

builder exit 0；包目录 9,134 个 payload 文件通过严格清单核验。独立打开 ZIP 后，9,135 个条目的集合、大小和逐项 SHA 全部匹配；Electron 为 44.0.0 / 73 文件。候选 5 在移动前后都通过 installed 核验，并完整保存在 `D:\github\JanVim-Exhibition-Deploy-preserved-20260908T044959961Z`，包括 9,182 个不可变文件和 39 个允许状态文件；没有删除或覆盖旧包。候选 6 安装后严格核验 9,134 个固定文件，固定入口再次输出 `DEPLOYMENT_VERIFY_PASS`。

候选 6 的联合运行 `joint-show-20260908T045449997Z-2acd5f514535` 持续约 319 秒，完成 3 个连续 90 秒显示器模拟循环；每轮 45 个 cue、41 个 primary 完成、5 个 secondary 呈现，重试和恢复均为 0。3 次有界 P1 fixture skip 是既有缺失 formula/image/matrix 资产，不是运行时失败。声音侧接收拨弦 583、风群 2,437、拒绝 0、限流丢弃 4、最大同时拨弦 8；正常 Stop 后活动拨弦为 0，`clean=true`。

运行中只读 Win32 审计确认《见山》主窗口实际外框为 `(1920, -123) 1920×1200`，`fullscreen=true`、`borderless=true`、`maximized=false`、`topmost=true`，且没有 click-through 或 no-activate。另一个 16×16、空标题的 `Winit Thread Event Target` 是透明且不可激活的事件窗口，不构成画面。桌面截图显示右侧屏幕没有标题栏或任务栏。正常 Stop 通过唯一可见 `STOP SHOW` 的 UI Automation `InvokePattern` 执行；退出码 0。3 秒后部署进程 0、监听端口 0、active pointer 不存在，固定包 installed 核验继续通过。

以上仍是三台显示器上的 `monitor-simulation`，`physicalProjectorsTested=false`、`offlineVerified=false`、`forcedRestartRecoveryVerified=false`。2026-09-08 13:34 +08:00，用户确认“刚才右侧《见山》已经无标题栏、无任务栏，而且无需按 F 就全屏”。结合此前显示、相机、可听拨弦与风声、正常 Stop 平滑淡出且无复响的人工反馈，候选 6 的本机三屏有人值守验收通过；物理双投影、离线与强制恢复按交接边界另行排练。

## 14:03 操作说明与黄金基线冻结

完整中文操作说明已写入 `deployment/docs/EXHIBITION-OPERATOR-RUNBOOK.md`，覆盖开机接线、
三屏配置、开演前验证、启动、运行值守、正常 Stop、技术后备停止、重启恢复和黄金包整体
回退。快速卡、部署说明及故障排查同步改为《见山》默认无边框全屏，并明确无需按 F；正常
结束首选 B 屏 `STOP SHOW`，`Stop-Exhibition.ps1` 只作为技术后备，不计作正常 Stop 验收。

操作说明提交为 `4b19a77691e7b52de6668f9c0f85e4f09c25a21c`。相关部署、操作入口和全屏回归
**47/47 passed**。从该提交构建候选 7 后，独立打开 ZIP 校验 9,137 个条目的集合、字节数和
逐项 SHA；与已人工验收候选 6 比较时，9,128 个运行及冻结文件完全一致。允许差异严格限定
为五份操作文档、接收回执、sourceCommit 身份文件及 Vitest 测试结果缓存，没有运行文件删除。

| 黄金包文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `JanVim-Exhibition-Deploy.zip` | 331532559 | `f2da64042855e8a596d3da26ffd9f509794866ab3b33ff3b26d7a0f1de86877f` |
| `package-manifest.json` | 1466006 | `1a492a13c4b674234503a225eb8bad63e4f9f205a2d585179bfc5100d3678472` |

候选 7 已安装到固定目录，严格核验 9,136 个 payload 文件，固定入口输出
`DEPLOYMENT_VERIFY_PASS`。已人工验收的候选 6 在移动前后均通过 installed 核验，并整体保存于
`D:\github\JanVim-Exhibition-Deploy-preserved-20260908T055947633Z`；没有删除旧包。

两个仓库均创建并推送注释标签 `exhibition-mini-pc-golden-2026-09-08`：JanVim 标签目标为
`4b19a77691e7b52de6668f9c0f85e4f09c25a21c`，《见山》协同标签目标为
`6d1a4577a9484092fde94308352c80ee710ed18f`。现场实际《见山》身份仍以 9,799,168 bytes /
`ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f` 为准。

命名黄金目录为
`D:\VirtualData\JanVim-Exhibition-Rehearsals\golden-baselines\exhibition-mini-pc-2026-09-08`，
其中保存 ZIP、handoff、manifest、操作说明、验证日志及 `golden-baseline.json`。后续少量效果
修改必须从黄金标签另建分支、生成新包并保留本目录；不得覆盖黄金包或把候选文件零散混入。
黄金验收边界仍为本机三屏 `monitor-simulation`，不包含物理双投影、离线和强制恢复。

PR 已创建并保持未合并：JanVim 展演控制器
[#2](https://github.com/gunpowder78/JanVim-Exhibition-2026/pull/2) 从
`feat/exhibition-mini-pc-integration` 合入 `feat/sound-flock-ingress-v1`；《见山》
[#17](https://github.com/gunpowder78/jianshan02Boid/pull/17) 从同名集成分支合入
`feat/site-mix-v2-handoff`。后者只提交接收回执，不修改《见山》功能。

## 14:48 登录计划任务迁移

本机原任务 `\Start_JianShan_Boid` 实际为 `MSFT_TaskLogonTrigger`，即用户登录后触发，延时
`PT30S`；它以 `hxj` 的 Interactive / Highest 身份执行
`C:\JianShan02Boid\release\win-unpacked\restart_once.bat`。它不是 Windows 尚未登录时的
系统启动触发；交互登录语义应继续保留，才能访问三屏 GUI、相机及当前用户音频端点。

管理员确认后已新建 `\Start_JanVim_Exhibition`，保留同一登录身份、权限和 30 秒延时，动作改为
固定黄金包的 `operator\Start-Exhibition.ps1`，工作目录为
`D:\github\JanVim-Exhibition-Deploy`。PowerShell 窗口以 Minimized 启动，重复实例策略使用
`IgnoreNew`，避免再次触发时停止正在展出的场次。新任务验证为 Ready 后，旧任务才被禁用；
旧任务没有删除，原始 XML、禁用后 XML 和新任务 XML 均保存于
`D:\github\exhibition-mini-pc-receipt-20260907\scheduled-task-20260908`。

新任务已手动触发冒烟测试：约 17 秒内建立 active pointer，三屏及《见山》无边框全屏均出现；
由于 Highest 任务的 Electron 控件受 Windows UIPI 隔离，Stop 审计提升到相同权限后，通过唯一
`STOP SHOW` 的 UI Automation `InvokePattern` 正常关闭。最终任务回到 Ready，
`LastTaskResult=0`，部署进程、57140/57141 listener 及 active pointer 均为 0。没有使用坐标点击、
键盘注入或按进程名批量终止。

主机级维护说明写入 `deployment/docs/AUTOSTART-TASK.md`，并同步更新每日卡、完整操作说明、
部署说明、故障排查和黄金基线说明。计划任务属于外部系统配置，不改变已经冻结的黄金 ZIP、
manifest 或 Git 标签。真正的“重启 Windows → 登录 → 等待 30 秒”仍需在下一次计划停机窗口
执行；本次手动触发成功不冒充真实重启验收。

## 14:58 真实登录自启失败与诊断

用户于 14:57:33 重启本机，登录后约 30 秒看到空白 PowerShell 窗口，约一分钟后窗口退出，
三屏未开演。任务实际于 14:58:21 运行，LastTaskResult=1，未创建任何新展演目录。
这次真实重启验收失败；此前手动触发成功不改变此结论。

在同一 hxj / Interactive / Highest 身份下新建无触发器的临时只读诊断任务，确认 PowerShell
解析到固定 Store 7.6.5 路径。原部署验证第一次 43.7 秒通过，第二次 5.8 秒通过，音频端点、
相机、映射和固定文件均通过。两次差异支持冷读取耗时风险；首次失败没有原始错误输出，
不能把超时推断写成已捕获的事实。

代码确认了时限冲突：整套验证的父进程仅允许 60 秒，包清单单项也允许 60 秒，之后还有
JanVim、Electron、SuperCollider、PnP 等检查。新回归测试用模拟耗时复现 90 秒合法验证被
旧入口终止。修复将包清单上限设为 120 秒，整套校验上限设为 240 秒，并在启动校验前
建立证据目录、逐项刷新最多 32 条进度、保存有限错误输出。触发仍延时 30 秒，无自动重试。

修改位于集成工作树，重新构建独立候选；不修改已冻结 ZIP、标签或原安装目录中的文件。
诊断证据位于 `scheduled-task-20260908/reboot-failure-1458`。修复后还需真实重启现场复验，
不因程序检查通过而自动升级人工验收结论。

## 工作室自启续修与默认三屏规则

用户确认桌面“应急启动三屏展示”在展厅双击后画面、声音和效果正常，并通过 `STOP SHOW`
正常关闭。随后主机移回工作室，连接三台显示器；此次目标是修复登录自启，不改展览效果。

20:40:11 的登录任务返回 1，未建立新场次。原部署 Verify 只读复现于 61.794 秒以
`deployment-probe-timeout` 退出，子进程仍在读取清单；直接清单验证随后于 40.631 秒通过，
9,136 个固定文件身份仍匹配。工作室未连接相机，旧强制相机检查会构成另一阻碍。
本轮把清单/完整预检有限上限改为 120/240 秒，预检前建立日志目录，并将相机改为可选。

用户要求三台及以上扩展显示器在没有适用人工映射时自动展示。新增无窗口 Resolve 在包校验
后、声音与 GUI 启动前执行：适用的人工映射保留角色；否则按桌面 x、再 y 的顺序分配前三屏。
每次使用独立运行映射，保持原控制器和终端对实际映射的严格校验。配置器仅供技术人员纠错。
当前工作室默认顺序为 DELL S2309W → Mi TV → DELL U2410；最后一台为 1920×1200。

代理早先为复验临时保存的工作室映射已独立归档，外部 site-config 恢复展厅人工映射，SHA-256
`2ba4526770f4f1498116d81be846950e26701183700d5b252dbcffc5000fe675`。黄金标签与部署 ZIP 保留。
诊断、旧代码草案及后续安装回执位于
`D:\github\exhibition-mini-pc-receipt-20260907\studio-autostart-20260908-2100`。
本次修复的真实重启、三屏可见画面与可听声音仍待复验；自动测试不能代替这些结论。

无窗口本机解析实测耗时 214 ms，生成上述默认三屏顺序；展厅人工映射的 SHA-256 前后
一致。解析过程没有打开配置窗口、展演窗口或相机。新控制器 bundle 为 553,166 bytes /
`e0bc73cf3860b209c598bca26dfcf0505caf3fc1c0b1e4e240c8ae15491e20af`；
JanVim core、《见山》EXE 与声音混音沿用已固定身份。

本轮 `npm ci`、typecheck、lint、build 通过。完整测试 67 文件 / 1,310 项中，1,309 项
通过，唯一失败为启动器发布身份仍指向旧 bundle。同步启动器、部署校验器及身份测试的
字节数/SHA 后，相关 `electron-build-smoke` 24 项全部通过，并再次通过 typecheck、lint、
build 与真实 bundle 身份核对。完整测试的原始失败日志保留，没有伪写为全量首次通过。

21:55 首个修复候选完成独立安装，旧黄金目录完整保留为
`D:\github\JanVim-Exhibition-Deploy-preserved-20260908T135313666Z`，移动后仍匹配原清单。
同一计划任务的完整预检于 6.461 秒通过，默认映射也成功；声音服务却在就绪前退出，原因是
旧 `server-port-owner.ps1` 把暂未绑定的 UDP 端口查询当作一般异常，返回 4。只读实测明确
捕获 `CmdletizationQuery_NotFound_LocalPort,Get-NetUDPEndpoint` / `ObjectNotFound`；
该 helper 在旧包与候选包中原本字节完全相同，因此这是进一步暴露的启动竞态。

修复仅将这个精确错误归为既有的“端口尚未就绪”返回 2，保留 30 秒整体启动和 3 秒单次
检查上限。真实 UDP 回归先复现旧代码返回 4，再验证新代码的空闲端口 2、自身端口 0、
外来所有者 3；权限异常和无关 ObjectNotFound 仍为 4。连同启动预检 17 项通过，并通过
typecheck、lint、build；控制器 bundle 身份不变。随后构建第二个独立候选继续任务复验。

## 22:10 新启动包安装与任务复测回执

固定安装目录当前为提交 `2a17a5c27e444357839503cb546d6b2e58fae1ab` 的独立包。
ZIP 331,559,140 bytes，SHA-256
`88a192996aabc2dfc8b9e290c6b9dd30e900e4895889ee3caa5a0f5f818dacb1`；
manifest 1,466,941 bytes，SHA-256
`850c36cf215e9c42f94b9793f6b0b79b5b62b911c64a6c8251fac52717e900d8`。
第一次修复候选完整保留于 `D:\github\JanVim-Exhibition-Deploy-preserved-20260908T140404260Z`；
此前黄金包、黄金 ZIP、标签和展厅映射仍保留，没有覆盖或自动合并。

22:05:54 手动触发原 `Start_JanVim_Exhibition`，47.915 秒建立完整场次。当前无相机，
三屏按默认顺序映射；实际窗口边界和截图确认《见山》在 `(3840,-133)` 的 1920×1200
第三屏无边框全屏。维护终端在截图中遮挡了第一屏的一部分，不将截图当作完整物理投影验收。
运行完成 2 个循环，漂移 28.6551 ms、0 重试、0 恢复；保留既有 3 个有界素材缺省跳过。
声音运行 224.3346 秒、最多同时 8 个拨弦节点，正常 Stop 后 `clean=true`。

最初自动化 Stop 定位脚本按顶层窗口过滤未找到唯一控件，失败回执保留。随后按按钮语义
查找、核对其当前控制器进程归属，并用 `UIAutomation.InvokePattern` 执行正常 `STOP SHOW`；
未使用坐标点击或键盘注入。控制器终态为 `intentional-success / operator-stop`，JanVim 自然
退出、lease 移除；最终任务 `Ready / LastTaskResult=0`，活动指针、展示进程和声音端口均无残留。

运行后再次校验 9,142 个不可变文件通过，39 个允许的运行状态文件共 171,767 bytes；清单
身份仍一致。展厅人工映射 SHA-256 前后均为
`2ba4526770f4f1498116d81be846950e26701183700d5b252dbcffc5000fe675`。
本轮完整外部证据位于 `studio-autostart-20260908-2100/port-binding-fix`，最终结果为
`verified-task-smoke.json`；保留早先失败记录，没有覆盖其状态。

任务保持 Interactive / Highest、登录延时 `PT30S`、IgnoreNew；旧《见山》任务 Disabled。
真实 Windows 重启后的自动开演，以及本轮用户现场确认画面和可听声音仍待完成。
此次手动任务试运行不冒充真实重启、离线、强制恢复或全天无人值守验收。

## 2026-09-09 登录自启验收与 Narrative 退出反馈

用户于 22:38:59 实际重启 Windows，并确认登录后的三屏演示自动启动、演示效果正确；由此完成
登录自启的人工验收。该场运行 13 个循环后以 `operator-stop` 正常结束，任务返回 0。用户同时
报告 `Ctrl+Shift+S` 看似无效、Narrative 难以显示鼠标。代码和现场日志确认全局快捷键在 Windows
层注册，不依赖 Narrative 焦点；页面原样式会隐藏一般区域的鼠标，而停止请求在当前 90 秒循环
的复位边界前没有视觉反馈。旧日志出现一次 `stop-already-queued`，说明第一次停止已受理，但旧版
没有记录来源，不能把该条历史记录单独当作快捷键验收。

提交 `1a2d1f84e25088bca7d5d4fda5e8b695a4cd4447` 增加以下有界行为：鼠标进入或移动到
Narrative 后立即显示，静止 20 秒隐藏，再次移动恢复；按钮或全局快捷键的 Stop 一旦受理，立即
发布精确的 `running / operator-stop-pending` 状态，并在 Narrative 中央以 60% 画面宽度显示
两行黄色文字“三屏演示正在退出，”与“请等待...”。提示锁存到窗口关闭。停止排队后若会话或
Narrative surface 恰好故障，控制器直接进入原有有界关闭流程，不会清除 Stop 后自动恢复演示。
现有复位边界停止、声音淡出和无复响策略保持不变；日志现在区分 `renderer` 与 `shortcut`。

实现遵循先失败后修复的测试顺序。独立审查发现并推动修复了预加载 schema 丢弃 pending 状态、
会话故障清除 Stop、surface 丢失重建 Narrative 三条竞态。最终相关 46 个测试文件 / 904 项通过，
typecheck、lint、build 通过；没有重复声明耗时较长的全量 1,310 项测试。最终控制器 bundle 为
554,384 bytes，SHA-256
`54e189293b9e1675ad9af3309d39e42cfb663bd12a05af2b28d157624e7aedc2`。

独立部署包位于
`D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-package-20260908T154214142Z-9eb2c1cb1bf2`。
ZIP 331,656,863 bytes，SHA-256
`b707703ee5d2a9a957c975b708898e0c72fb58b747aadf7388b49dc333612116`；manifest
1,474,833 bytes，SHA-256
`dab991f5bc20c96ad0ad328a9621e1d88d79b2625a092952e2292a4c093d5253`。原已通过重启
验收的包完整保留于 `D:\github\JanVim-Exhibition-Deploy-preserved-20260908T154835972Z`，其
manifest 仍为 `850c36cf215e9c42f94b9793f6b0b79b5b62b911c64a6c8251fac52717e900d8`。

新包安装后以原计划任务进行两次实跑。第一次用当前控制器进程所属的唯一 UI Automation 按钮
调用 `STOP SHOW`，未使用坐标或键盘注入；截图确认黄色提示正确居中显示，日志记录
`source=renderer / disposition=queued`。第二次由用户实际按下 `Ctrl+Shift+S`，用户确认退出提示
出现，日志唯一记录 `source=shortcut / disposition=queued`。第二场完成 2 个循环、0 重试、
0 恢复，终态 `intentional-success / operator-stop`；声音运行 220.4757 秒并以 `clean=true`
结束，任务回到 `Ready / LastTaskResult=0`，活动指针、展示进程及 57140/57141 端口均无残留。
运行后 9,190 个不可变文件再次通过，允许的运行状态为 39 文件 / 171,757 bytes。外部展厅映射
SHA-256 仍为 `2ba4526770f4f1498116d81be846950e26701183700d5b252dbcffc5000fe675`。

本轮证据位于
`D:\github\exhibition-mini-pc-receipt-20260907\studio-stop-feedback-20260908-2345`，包括按钮和
快捷键两次黄色提示截图。用户已完成人工快捷键与提示验收；20 秒鼠标静止隐藏已通过确定性测试，
仍待用户肉眼确认。新功能包安装后的再次真实重启、离线和强制恢复验收仍分别待完成。

## Narrative 光标现场复测与接受

用户首次现场复测发现：鼠标进入 Narrative 后会立即显示，再移动后也会重新显示，但在窗口上方
静止超过 20 秒时不会自动隐藏；点击一次左键后等待可隐藏。诊断确认页面原实现对每一个
`pointermove` 都重新计时，Chromium 即使报告相同坐标也可能不断延长空闲期限。提交
`3ae81a3eaa3a6bdbc70880d8ecf651d0907e0906` 因此记录上一次指针坐标，只让坐标实际变化重新开始
20 秒计时；同坐标重复事件被忽略，离开和销毁时清理位置状态，仍只保留一个有限计时器。

回归测试先在旧实现上复现第 20 秒仍为 `visible`，修复后 Narrative 场景 26/26 通过；typecheck、
lint、build 和 Electron 模块图验证通过。完整测试运行 68 个文件 / 1,322 项，其中 1,316 项通过，
其余 6 项均为 Windows 并行负载下超过用例固定的 5 秒上限。G2 文件随后单独运行 6/6 通过；离线
包文件单独运行 16/17 通过，最后一个用例实耗约 6.1 秒，在仅对本次命令放宽为 10 秒后断言通过。
仓库测试配置没有修改。独立审查未发现 Critical 或 Important 问题。

本次独立部署包位于
`D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-package-20260908T165259438Z-c4826e2aa612`。
ZIP 331,569,254 bytes，SHA-256
`709c493e68a6686268f31b181d0636d56c5a6114bdb1dba9c85bdcb5cca3d37e`；manifest
1,466,941 bytes，SHA-256
`1bbd8f18ea425b258d9beeea14f7062b5c7fedf9d86e010925e412ba6e561b7c`。此前已安装的退出反馈包
完整保留于 `D:\github\JanVim-Exhibition-Deploy-preserved-20260908T165931815Z`，其 manifest 仍为
`dab991f5bc20c96ad0ad328a9621e1d88d79b2625a092952e2292a4c093d5253`。

新包通过原计划任务在工作室三台显示器上实跑。用户再次观察到鼠标移动后立即显示；静止超过
20 秒仍未隐藏，点击一次左键后立即隐藏；再次移动后重新显示。用户明确表示接受当前效果、算作
测试通过并不再继续修复。此结论作为“带已知现场行为的人工接受”记录，不将静止 20 秒自动隐藏
写成已实现。用户随后点击 `STOP SHOW`，退出通过。

该场完成 3 个循环，0 重试、0 恢复；控制器终态为
`intentional-success / operator-stop`，按钮日志为 `source=renderer / disposition=queued`。声音运行
315.688141 秒，最多同时 8 个拨弦节点，以 `clean=true` 正常结束。任务回到 Ready，
`LastTaskResult=0`，活动指针、展示进程及 57140/57141 端口均无残留。运行后 9,142 个不可变文件
再次通过，允许的运行状态为 39 文件 / 171,772 bytes。本轮证据位于
`D:\github\exhibition-mini-pc-receipt-20260907\studio-pointer-idle-20260909-0100`，最终结果为
`verified-pointer-idle-smoke.json`。

本次使用工作室显示器默认映射，`acceptanceScope` 仍为 `monitor-simulation`，不冒充实体投影验收。
此更新包安装后的再次真实 Windows 重启、离线和强制恢复验收仍待完成。
