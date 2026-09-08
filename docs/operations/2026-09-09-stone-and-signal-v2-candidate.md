# 空山远讯 II · 石与电：隔离声音候选交接

## 身份与状态

- 仓库：`D:\github\JanVim-Exhibition-mini-pc`
- 隔离 worktree：`D:\github\JanVim-Exhibition-mini-pc\.worktrees\sound-stone-and-signal-v2`
- 分支：`feat/sound-stone-and-signal-v2-candidate`
- 基点：`dab0a0b005b9ff69bd2cda2d6fbcca31388527ea`
- 实现提交：`ae2bb0a3d5e2f90883e93aca205999b7ba6c9f57`
- 状态：仅为人工试听前候选；没有 push、merge、tag、打包安装或生产切换。

黄金部署仍是 `D:\github\JanVim-Exhibition-Deploy`。其 Electron main 为 554384 字节，
SHA-256 `54e189293b9e1675ad9af3309d39e42cfb663bd12a05af2b28d157624e7aedc2`；
《见山》EXE 为 9799168 字节，SHA-256
`ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`。
本轮没有写入黄金目录、显示映射、计划任务、声卡或系统音量。

实际交接包为 `D:\JanVim-Sound-Upgrade-Handoff-20260909`；`SHA256SUMS` 的 9 项均已按
实际文件重新计算并匹配，两份 JSON 回执均可解析。用户认可的附件第二版 WAV 为
24576300 字节，SHA-256
`eb4567a671bb9c7d3ec051bf3bbb9b9ce097e981872a558e556294e2657e0d59`。
其中记录的旧绝对输出路径仅作为历史证据，没有作为候选启动路径。

## 候选行为

未传 `-InstrumentProfile` 时继续使用原 `LegacyPluckV1`，因此旧命令与黄金行为不变。
只有同时显式使用 `-Input RealCursor -InstrumentProfile StoneAndSignalV2` 才启用候选。

候选在现有已认证真实光标消息之后选择事件，仍由唯一 OSC sender 送入同一个 SC 服务。
初次光标后保留 4 秒静默；之后最多每 4 秒出现一次机会，固定种子决定低鸣、老式收音机寻台、
石器敲击、稀有琴音、偶发地鸣、剑鸣或电贝斯低音，并分别执行 12 至 60 秒分类冷却。
跳过的机会不排队、不补播；所有候选声部合计最多 8 个。Wind 仍由原鸟群路径独立控制，
候选不会生成持续风底。两路继续使用现场持久化增益，统一 Stop 仍经过现有 1.5 秒总线淡出，
停止后晚到光标不能重新发声。

现场增益文件保持未改：
`D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config\sound-mix-v1.json`，
当前为 Wind `+6 dB`、Instrument `-10 dB`，SHA-256
`0f9804ba04950d7711dd2d2351bdc1952b0baa9ba1f0c48445e62270b149258e`。

## 离线试听件

人工回来后可直接试听：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\sound-stone-signal-v2-F5j3j7\stone-and-signal-v2-candidate.wav
```

对应回执：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\sound-stone-signal-v2-F5j3j7\stone-and-signal-v2-candidate.receipt.json
```

WAV 为 133.501333 秒、48 kHz、双声道 PCM16、25632300 字节，SHA-256
`f965e3511af119d4d25c5ea437e9818d78c078d89094790de64a5563bf5173da`。
左右峰值为 0.05350 / 0.03687，削波样本均为 0；132.0 至 133.4 秒的 Stop 后区间全零。
它由固定种子的模拟光标和生产 SynthDef 静音 NRT 渲染，没有打开实时音频设备，
也没有持续风底。该数值检查不等于人工听感或真实光标现场验收。

## 人工在场时启动与停止

以下命令只启动候选声音部件。`RealCursor` 模式必须由现有展演控制器以同一 `runRoot`
接入后才会收到真实光标；在联合试听方案确认前，不要把它接入黄金快捷方式或计划任务。
命令默认无声；仅在有人控制硬件音量并准备试听时增加 `-Listen`。

```powershell
$candidate = 'D:\github\JanVim-Exhibition-mini-pc\.worktrees\sound-stone-and-signal-v2'
$node = 'D:\github\exhibition-mini-pc-tools\node-v22.23.0-win-x64\node.exe'
$runRoot = Join-Path 'D:\VirtualData\JanVim-Exhibition-Rehearsals' `
  ('sound-stone-signal-live-' + [guid]::NewGuid().ToString('N'))
pwsh -NoProfile -File "$candidate\sound\start-sound.ps1" `
  -Input RealCursor -FlockIngress -InstrumentProfile StoneAndSignalV2 `
  -Duration 3600 -RunRoot $runRoot -NodeExecutable $node
```

人工试听时只给上一条命令末尾增加 `-Listen`。启动后保留控制台输出的本次 `runRoot`。
停止必须从另一 PowerShell 7 窗口指定同一个目录：

```powershell
pwsh -NoProfile -File `
  'D:\github\JanVim-Exhibition-mini-pc\.worktrees\sound-stone-and-signal-v2\sound\stop-sound.ps1' `
  -RunRoot (Read-Host 'Paste the CURRENT candidate runRoot') `
  -NodeExecutable 'D:\github\exhibition-mini-pc-tools\node-v22.23.0-win-x64\node.exe'
```

看到 `STOP_REQUESTED` 后继续等待启动窗口出现 `SOUND_RUN_COMPLETE`，并确认本次
`summary.json` 的 `clean` 为 `true`。不要根据旧目录或磁盘 PID 停止进程。

## 回退

生产版本没有被替换，因此展览回退就是继续使用现有黄金快捷方式和部署目录。
若正在做候选人工试听，先按上节停止并确认清理，再启动未带
`-InstrumentProfile StoneAndSignalV2` 的原声音命令；缺省值会回到 `LegacyPluckV1`。
不要复制候选文件覆盖 `D:\github\JanVim-Exhibition-Deploy`。

## 自动验证与待人工项

- 完整声音 Node suite：182/182，零失败、零跳过；含真实 NVIM 0.10.1 Lua 光标链、
  真实静音 SC 服务、Wind 独立性、双路增益、统一 Stop、故障回收与 NRT。
- `run-instrument-profile.ps1`、`run-policy.ps1`、`run-policy-isolation.check.ps1`、
  `run-sclang.check.ps1` 全部退出 0；确定性用例使用假时钟，不等待真实 8 分钟循环。
- 实际 `start-sound.ps1` 候选静音烟测干净退出，结束 `summary.json` 保留
  `instrumentProfile: stone-and-signal-v2`；没有连接输入 owner 或创建硬件输出。
- `npm ci`、`npm run typecheck`、`npm run build`、`npm run lint` 退出 0。
- 应用总测试在冻结 Node/.NET 与恢复的非 Git runtime 下为 1321/1322；唯一失败是
  `offline-package.test.ts` 的既有负向用例实际约 5.79 秒，超过固定 5 秒预算；保持预算不改。
  同一用例以 10 秒诊断预算单独执行时断言通过，不能据此把正式门禁写成通过。
- 非 Git runtime 从最新展示机开发检出复制到本候选并逐文件核验：2151 个文件，规范清单
  SHA-256 `5a4d41d35bdcbca75901e1a020060d7e43f3abf19d2311fcaa042f07476261dd`。
  回执为
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\stone-signal-v2-runtime-copy.receipt.json`。

仍待人工完成：试听音色、层次与主观音量；真实三屏光标联合试听；Stop 听感；三次物理循环、
离线运行和强制恢复演练。用户对附件固定小样第二版的认可，不视为对本实时候选的验收。
