# 明早联合试听：操作卡

仅用于有人值守的候选联调，不替换可展览保底。先联网试听，不在此流程中做断网或强制重启验收。
声音默认静音；只有本次命令明确加 `-Listen` 才向已确认的有线耳机输出。先由人调低耳机音量。

## 先收《见山》候选

2026-09-06 收到的生产端候选报告身份如下：

- 仓库 `gunpowder78/jianshan02Boid`，分支 `feat/flock-ingress-v1`；最终提交
  `d890caa5e9a3077bf1538d83f3695cdb32019d9a`。
- 最终源代码/构建锚点 `7955ce69677772008d5789134dbb83d005b461cc`；最终提交在该锚点之后只含文档。
- `jianshan-rust/target/release/jianshan.exe` 应为 9,840,128 bytes，SHA-256
  `d9cae3bcd850fc55d180c5d1bc9ab16fc4fc91b39dfd5c771a9caad96c030417`。
- 对方报告 Rust 164/164、Python 46/46，Intel/RTX DX12 硬件用例各 4/4；这些不是本展示机复验。

该分支后来已推送并建立 Draft PR #16（base `feat/osc-supercollider`，未合并）。本展示机已把远端
`d890caa…` 检入独立 detached worktree `D:\tmp\JianShan02-flock-ingress-v1`，源码身份和测试已复核。
不能把 `D:\github\JianShan02` 旧根工作树当作候选。

对方鉴定的 EXE 和 HP 运行资产仍未传到本机。本机 Rust/Cargo 1.97.1 从相同源码重新生成的 EXE
为 9,763,328 bytes、SHA-256 `818cf44d3cb03425f3573c22b3aa8fd656de1c2196f30aa5188e78ddd083b18f`，
不等于对方鉴定值；仓库又没有锁定 Rust 工具链。因此在取得对方工具链信息或精确 EXE 前，不能把本机
重编译文件冒充对方鉴定二进制。下面的严格 EXE 门禁会按设计阻止它进入真实 GUI 联调。

该 EXE 不是 portable 包。另建候选运行目录，沿用已鉴定只读来源中的 VC144 DLL、
`native/mediapipe` DLL 和 `public/models/hand_landmarker.task` 布局；不要覆盖 HP 保底、原运行目录或原配置，
也不要自动下载依赖、改驱动或更新 GPU 库。实际联调必须在与 JanVim、SuperCollider 相同的展示电脑进行。

候选源码和 EXE 到机后先执行以下只读身份门禁；任何一项失败都不启动：

```powershell
$candidate = 'D:\tmp\JianShan02-flock-ingress-v1'
$expectedHead = 'd890caa5e9a3077bf1538d83f3695cdb32019d9a'
$expectedExeHash = 'd9cae3bcd850fc55d180c5d1bc9ab16fc4fc91b39dfd5c771a9caad96c030417'
$head = (& git -C $candidate rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -cne $expectedHead) { throw 'jianshan-candidate-head-mismatch' }
if ((& git -C $candidate status --porcelain).Count -ne 0) { throw 'jianshan-candidate-not-clean' }
$exe = Join-Path $candidate 'jianshan-rust\target\release\jianshan.exe'
$item = Get-Item -LiteralPath $exe -ErrorAction Stop
if ($item.Length -ne 9840128) { throw 'jianshan-exe-size-mismatch' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()
if ($hash -cne $expectedExeHash) { throw 'jianshan-exe-hash-mismatch' }
'JIANSHAN_CANDIDATE_IDENTITY_PASS'
```

当前源码侧本机证据：Rust 164/164、Python 46/46，AMD Radeon 8060S / DX12 的显式 GPU observer
4/4，真实生产 client 的 synthetic probe 已与 JanVim 当前 TCP 接收器完成一次 8 秒静音挂接；
`status=Ready`、0 rejected，结束后 JanVim `clean:true`、descriptor inactive、固定声音端口释放。
该结果只解除源码/协议/本机 GPU 抽样的准备风险，不解除 EXE、相机、完整资产、画面或听感验收。

## A：准备长文和声音

新开 PowerShell 7；A、B 两窗都先执行这一条进入候选目录：

```powershell
Set-Location 'D:\github\JanVim-Exhibition-2026\.worktrees\sound-flock-ingress-v1'
```

确认旧展演、旧声音及上次《见山》联调实例已正常结束。在 A 选择已经冻结的长文，然后准备新会话：

```powershell
.\scripts\select-show-profile.ps1 -Profile songfeng-source
.\sound\joint-rehearsal.ps1 -Action Prepare
```

按提示提供**人工确认过**的 `display-map.json` 完整路径；硬件映射变化时先用原显示配置流程重新确认。
保存输出的本次 SessionFile 路径，后续提示均粘贴这个路径，不使用历史会话文件。
新 worktree 默认是早期短文本基线，上面的 profile 选择不可省略。它只通过既有 PRE-SHOW 选择器切换派生 manifest，不改原诗或冻结 profile；不在运行中切换。

A 启动声音，按提示粘贴本次 SessionFile，随后保持此窗口打开：

```powershell
.\sound\joint-rehearsal.ps1 -Action Sound -Listen
```

等到 `SOUND_RUN_READY`。无需打开 SuperCollider IDE；不加 `-Listen` 则仅内部录音，无硬件发声。

## B：启动画面、交接鸟群入口

在 B 使用同一个 SessionFile，先只执行 Status：

```powershell
.\sound\joint-rehearsal.ps1 -Action Status
```

Status 给出的 `flock-input.json` **路径**交给《见山》候选的既有入口参数。不要复制文件内容、token 或旧目录。
首次可先做不启窗口/相机的 synthetic 传输探针，但它只证明传输，并会永久占用本轮唯一鸟群 owner：

```powershell
Set-Location 'D:\tmp\JianShan02-flock-ingress-v1\jianshan-rust'
cargo build --locked --example flock_input_probe
.\target\debug\examples\flock_input_probe.exe --descriptor '粘贴 Status 给出的当前 flock-input.json 绝对路径' --duration 15
```

输出必须含 `synthetic=true acceptance=transport-only`。随后完整 StopSound；真实主程序必须重新 Prepare/Sound，
使用全新的 SessionFile、runRoot 和 descriptor，绝不能复用探针会话。

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
$env:JIANSHAN_CONFIG_PATH = 'D:\NEW_RUNTIME\jianshan-rust\jianshan-flock-v1.toml'
.\jianshan.exe
```

启动后检查脱敏的 `[FlockInput]` 摘要出现 `status=Ready`。不要输出 descriptor JSON 或 token。
然后回 B 执行 Show；脚本会核对本次声音 READY，先 ValidateOnly，成功后才调用原 Show 启动器：

```powershell
.\sound\joint-rehearsal.ps1 -Action Show
```

副屏就绪后点击一次 Start Rehearsal。静止/idle 阶段风声不响不一定是故障。
对方鉴定二进制及完整运行依赖未实际传到本展示机前，只能做源码、接收端或 synthetic probe 验证，
不能称真实主程序 GPU 联调通过。
本轮只接声音，未实现《见山》对 SCREEN-3 的自动接管。Show 就绪后还需人工确认《见山》窗口未被安全占位遮住、未最小化且仍在持续绘制；若不满足，先 Stop Show 并保留现场情况，不直接判定声音入口故障。

本次默认声音 600 秒；如需更长，可在 Prepare 时加 `-Duration 1800`。最长仍为 3600 秒，不是全天版。
声音达到时限后不会自动重开，画面也不一定随之关闭；工作人员应在到时前 Stop Show，下一次重新 Prepare。

## 集中看、听四项

1. JanVim 是连续长文而非短句；光标动作能形成拨弦，reset 准确恢复原诗。
2. 真正的鸟群变化驱动风声；暂停/关闭鸟群输入后风声淡出，拨弦仍可工作。
3. 点击 Stop Show，两层声音一起平滑淡出，晚到鸟群帧不能重新发声；A 输出实际完成结果。
4. 旧会话结束后重新 Prepare，以新 SessionFile 完成一次正常开演。不复用旧 token 或删租约来恢复。

## 停止和异常

正常结束用副屏 **Stop Show**。以下命令只用于停止本次声音，不代替关闭整个展演：

```powershell
.\sound\joint-rehearsal.ps1 -Action StopSound
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
