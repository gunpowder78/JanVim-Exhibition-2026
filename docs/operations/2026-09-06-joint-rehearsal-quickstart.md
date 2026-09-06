# 明早联合试听：操作卡

仅用于有人值守的候选联调，不替换可展览保底。先联网试听，不在此流程中做断网或强制重启验收。
声音默认静音；只有本次命令明确加 `-Listen` 才向已确认的有线耳机输出。先由人调低耳机音量。

## Site Mix v2 范围

当前源码候选增加了有人值守的现场混音：JanVim 操作条分别显示 `WIND` 与 `INSTRUMENT`，
《见山》Debug 的 `ArrowUp` / `ArrowDown` 只调外部鸟群风声。每次 `1 dB`，范围 `-24..+6 dB`，
调节立即试听并自动保存，没有 Save 按钮。保存位置固定为：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config\sound-mix-v1.json
```

该值对本机所有节目和以后所有新声音会话生效。《见山》显示 `SAVED`、`PENDING`、
`SAVE ERR` 或 `CONTROL OFF`；JanVim 显示 `SAVED` / `SAVE ERR`。保存失败时两条声路和界面数值
都保留最后确认值。

下文记录的 `d890caa...` 旧 EXE 与原受审 JanVim bundle 是上一轮 v1 候选，不含上述新控件，
不能用它们判断 v2 调音是否通过，也不要原地覆盖它们。本次 v2 使用维护流程后来新建的本地试听候选：

- 候选根：
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c`
- 《见山》EXE：9,799,168 bytes，SHA-256
  `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`
- 安全模板仍为 6,238 bytes，SHA-256
  `510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae`
- JanVim `apps/controller/dist/main/electron-main.js`：547,650 bytes，SHA-256
  `bb63c48dcf63756392e730224b2cbe929b00feafa1c2738ea608f5b9764f4b90`；启动器已精确钉住该身份。

这对产物来自尚未提交的双仓工作树，只是本机 local audition candidate，不是正式 release 或 HP 保底。
公开身份与依赖清单在候选根的 `candidate-receipt.json`、`SHA256SUMS` 和 `evidence` 中；不含 descriptor/token。

## 先收《见山》候选

2026-09-06 收到的生产端候选报告身份如下：

- 仓库 `gunpowder78/jianshan02Boid`，分支 `feat/flock-ingress-v1`；最终提交
  `d890caa5e9a3077bf1538d83f3695cdb32019d9a`。
- 最终源代码/构建锚点 `7955ce69677772008d5789134dbb83d005b461cc`；最终提交在该锚点之后只含文档。
- `jianshan-rust/target/release/jianshan.exe` 应为 9,840,128 bytes，SHA-256
  `d9cae3bcd850fc55d180c5d1bc9ab16fc4fc91b39dfd5c771a9caad96c030417`。
- 对方报告 Rust 164/164、Python 46/46，Intel/RTX DX12 硬件用例各 4/4；这些不是本展示机复验。

该分支后来已推送并建立 Draft PR #16（base `feat/osc-supercollider`，未合并）。本展示机曾用独立
detached worktree 复核远端 `d890caa…` 的源码身份和测试；该临时 worktree 现已清理，不再是操作路径。
这段历史只作为 v1 证据；本次 v2 运行只使用本卡开头列出的外部候选根，不能把源码工作树当作运行候选。

精确 EXE 与 HP ZIP 已转存到 `D:\JianShan-flock-ingress-v1-handoff` 并在本机重新验明大小和 SHA-256。
ZIP 安全审计通过后，只解到新的隔离候选根：
`D:\VirtualData\JanVim-Exhibition-Rehearsals\jianshan-flock-candidate-20260906T050050385Z-fde7b0c71412`。
原 ZIP、旧运行目录和 HP 配置均未覆盖；ZIP 内原 EXE 另存于候选根的 `provenance`。对方确认原 EXE
使用 stable Rust/Cargo 1.94.1；本机 1.97.1 重现产物不用于联调。

本次 Site Mix v2 候选运行前执行以下只读身份门禁；任何一项失败都不启动：

```powershell
$runtime = 'D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c\runtime\jianshan-rust'
$expectedExeHash = 'ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f'
$expectedTemplateHash = '510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae'
$exe = Join-Path $runtime 'jianshan.exe'
$item = Get-Item -LiteralPath $exe -ErrorAction Stop
if ($item.Length -ne 9799168) { throw 'jianshan-exe-size-mismatch' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()
if ($hash -cne $expectedExeHash) { throw 'jianshan-exe-hash-mismatch' }
$template = Join-Path $runtime 'jianshan-flock-v1.toml'
$templateHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $template).Hash.ToLowerInvariant()
if ($templateHash -cne $expectedTemplateHash) { throw 'jianshan-safe-template-mismatch' }
'JIANSHAN_SITE_MIX_V2_CANDIDATE_IDENTITY_PASS'
```

当前源码侧本机证据：Rust 164/164、Python 46/46，AMD Radeon 8060S / DX12 的显式 GPU observer
4/4，真实生产 client 的 synthetic probe 已与 JanVim 当前 TCP 接收器完成一次 8 秒静音挂接；
`status=Ready`、0 rejected，结束后 JanVim `clean:true`、descriptor inactive、固定声音端口释放。
转存 EXE、完整资产与安全待机模板已解除“文件尚未到机”的阻塞；仍不替代真实应用中的 GPU 状态、
相机、画面或听感验收。

## A：准备长文和声音

新开 PowerShell 7；A、B 两窗都先执行这一条进入候选目录：

```powershell
Set-Location 'D:\github\JanVim-Exhibition-2026\.worktrees\sound-flock-ingress-v1'
```

A、B 可以保留并用于同一轮，不必在每个动作前重开；C 单独留给《见山》。新的一轮可以继续用
这三个窗口，但必须重新执行 `Prepare` 并替换三个窗口中的 `$sessionFile`，不能复用旧会话。
建议先分别命名，避免把命令发错窗口：

```powershell
$Host.UI.RawUI.WindowTitle = 'A-声音'
$Host.UI.RawUI.WindowTitle = 'B-状态与画面'
$Host.UI.RawUI.WindowTitle = 'C-见山'
```

每条命名命令只在对应窗口执行一条，不要把三条连续粘贴到同一个窗口。

确认旧展演、旧声音及上次《见山》联调实例已正常结束。在 A 选择已经冻结的长文，然后准备新会话：

```powershell
$repo = 'D:\github\JanVim-Exhibition-2026\.worktrees\sound-flock-ingress-v1'
Set-Location $repo
.\scripts\select-show-profile.ps1 -Profile songfeng-source
$displayMap = (Read-Host '粘贴已人工确认的 display-map.json 完整路径').Trim()
.\sound\joint-rehearsal.ps1 -Action Prepare -Duration 1800 -DisplayMapPath $displayMap
```

按提示提供**人工确认过**的 `display-map.json` 完整路径；硬件映射变化时先用原显示配置流程重新确认。
保存输出的本次 SessionFile 路径，后续提示均粘贴这个路径，不使用历史会话文件。
这里要提供的是确实存在的 `display-map.json`，不是 `session.json`，也不能输入
`<本次新ID>`、`D:\...` 等示例文字。
新 worktree 默认是早期短文本基线，上面的 profile 选择不可省略。它只通过既有 PRE-SHOW 选择器切换派生 manifest，不改原诗或冻结 profile；不在运行中切换。

A 启动声音，按提示粘贴本次 SessionFile，随后保持此窗口打开：

```powershell
$sessionFile = (Read-Host '粘贴本轮 SESSION_FILE 完整路径').Trim()
if (-not (Test-Path -LiteralPath $sessionFile -PathType Leaf)) { throw 'SESSION_FILE-missing' }
.\sound\joint-rehearsal.ps1 -Action Sound -Listen -SessionFile $sessionFile
```

等到 `SOUND_RUN_READY`。无需打开 SuperCollider IDE；不加 `-Listen` 则仅内部录音，无硬件发声。

## B：启动画面、交接鸟群入口

在 B 使用同一个 SessionFile，先只执行 Status：

```powershell
$repo = 'D:\github\JanVim-Exhibition-2026\.worktrees\sound-flock-ingress-v1'
Set-Location $repo
$sessionFile = (Read-Host '粘贴A输出的本轮 SESSION_FILE 完整路径').Trim()
if (-not (Test-Path -LiteralPath $sessionFile -PathType Leaf)) { throw 'SESSION_FILE-missing' }
.\sound\joint-rehearsal.ps1 -Action Status -SessionFile $sessionFile
```

Status 给出的 `flock-input.json` **路径**交给《见山》候选的既有入口参数。不要复制文件内容、token 或旧目录。
本次 v2 有人值守试听不再执行历史 synthetic probe：它只证明传输，却会永久占用本轮唯一鸟群 owner，
迫使操作员停止并重建整个会话。当前源码与静音链路证据已记录；本流程直接使用已核验的新 v2 主程序。
如维护人员另行排查纯传输，必须在独立的新会话和当前源码树中执行，不得占用或复用人工试听会话。

真实主程序使用一份完整候选 TOML 副本，只把重复声音关闭并显式启用新入口：

```toml
[audio]
enabled = false

[osc]
enabled = false

[flock_input]
enabled = true
descriptor_path = "D:/当前 SOUND_RUN_READY 的 runRoot/flock-input.json"
send_hz = 10
v_ref = 4.0
```

确认相机和投影可启动后，在候选 `jianshan-rust` 目录显式指定这份配置再运行；如果命令持续占用终端，
单独开 C 窗，不占用 A、B：

```powershell
$runtime = 'D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c\runtime\jianshan-rust'
$liveConfig = (Read-Host '粘贴维护人员为本轮创建的唯一 liveConfig 完整路径').Trim()
if (-not (Test-Path -LiteralPath $liveConfig -PathType Leaf)) { throw 'live-config-missing' }
Set-Location $runtime
$env:JIANSHAN_CONFIG_PATH = $liveConfig
.\jianshan.exe
```

启动后检查脱敏的 `[FlockInput]` 摘要出现 `status=Ready`。不要输出 descriptor JSON 或 token。
v2 候选还应在 Debug 中显示 `EXT WIND <数值> dB SAVED`；若是 `CONTROL OFF`，停止本轮，
检查候选版本和 descriptor 是否属于同一轮，不能通过读取 token 或复用旧 descriptor 绕过。
然后回 B 执行 Show；脚本会核对本次声音 READY，先 ValidateOnly，成功后才调用原 Show 启动器：

```powershell
.\sound\joint-rehearsal.ps1 -Action Show -SessionFile $sessionFile
```

副屏就绪后点击一次 Start Rehearsal。静止/idle 阶段风声不响不一定是故障。
精确二进制和完整依赖虽已在隔离目录就绪，但在本轮有人值守启动并实际看到真实鸟群前，
仍不能称真实主程序 GPU 联调通过。
本轮只接声音，未实现《见山》对 SCREEN-3 的自动接管。Show 就绪后还需人工确认《见山》窗口未被安全占位遮住、未最小化且仍在持续绘制；若不满足，先 Stop Show 并保留现场情况，不直接判定声音入口故障。

脚本缺省声音为 600 秒；本操作卡的 Prepare 命令已显式使用 `-Duration 1800` 创建 30 分钟会话。
最长仍为 3600 秒，不是全天版。
声音达到时限后不会自动重开，画面也不一定随之关闭；工作人员应在到时前 Stop Show，下一次重新 Prepare。

## 集中看、听四项

1. JanVim 是连续长文而非短句；光标动作能形成拨弦，reset 准确恢复原诗。
2. 真正的鸟群变化驱动风声；暂停/关闭鸟群输入后风声淡出，拨弦仍可工作。
3. 点击 Stop Show，两层声音一起平滑淡出，晚到鸟群帧不能重新发声；A 输出实际完成结果。
4. 旧会话结束后重新 Prepare，以新 SessionFile 完成一次正常开演。不复用旧 token 或删租约来恢复。

Site Mix v2 再增加四项：

1. 《见山》Debug 的方向键只改变外部风声；`A` 只控制《见山》内置风声，二者不能混淆。
2. JanVim 的 `WIND` 和 `INSTRUMENT` 能单独调节；每次点击后立即听到变化并回到 `SAVED`。
3. 记录本轮最终两个 dB 值；Stop Show 后共同平滑淡出，等待约 3 秒不能重新发声。
4. 用第二个全新 30 分钟会话确认初始值继承上轮保存值，然后再判定跨会话保存通过。

如需回到两项 `0 dB`，先 Stop Show 并确认声音已结束，再由维护人员改名/移走
`site-config\sound-mix-v1.json`，下一轮重新 Prepare。不要修改安全模板、原配置或 HP 保底。

## 停止和异常

正常结束用副屏 **Stop Show**。以下命令只用于停止本次声音，不代替关闭整个展演：

```powershell
.\sound\joint-rehearsal.ps1 -Action StopSound -SessionFile $sessionFile
```

`STOP_REQUESTED` 不是结束证明；核对 A 的 `SOUND_RUN_COMPLETE`、`clean:true`，并用 Status 查本次状态。
若 ValidateOnly/Show 报错，不继续盲点；先停本次声音并保留日志。无法正常退出时由工作人员重启电脑，之后使用新会话重新开演。不要批量杀进程、修权限、改驱动或覆盖保底。

当前应用全量仍有 2 项既有失败；此操作卡和静音测试不将它们算作通过。真实图形/试听、现场离线/恢复和 HP 性能各自验收。[候选与测试边界](2026-09-05-flock-ingress-v1-handoff.md)。

## 本轮准备验证（2026-09-06）

- 新操作脚本：10/10 行为测试通过；Node/PowerShell 语法、完整 lint 和 diff 检查通过。
- 两次全新会话，真实静音 SuperCollider 启动、Status、StopSound 均成功；两次均 `clean:true`、`reason:requested`，未开启硬件输出，结束后固定声音端口释放。
- 既有接收器→sender→SC 内部录音链路：7/7 通过，包含输入过期/断连、风声独立淡出和统一 Stop；Show/鸟群生产端均为替身，不是《见山》真实 GPU。
- 未启动图形 Show、未人工试听，未改控制器 bundle、JanVim artifact 锁或冻结内容。以上是候选联调准备，不是合并或发布批准。

本机证据：[两次静音运行回执](D:/VirtualData/JanVim-Exhibition-Rehearsals/joint-night-smoke-20260905T180152979Z-7208f90b/receipt.json)、[脚本测试门禁](D:/VirtualData/JanVim-Exhibition-Rehearsals/flock-v1-gates-20260905-a2d9b87/night-joint-operator.result.json)、[内部录音门禁](D:/VirtualData/JanVim-Exhibition-Rehearsals/flock-v1-gates-20260905-a2d9b87/night-flock-pcm.result.json)。这些已结束的目录仅作证据，不可作为新联调的 SessionFile。
