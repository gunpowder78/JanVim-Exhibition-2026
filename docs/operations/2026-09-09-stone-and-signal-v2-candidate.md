# 空山远讯 II · 石与电：隔离声音候选交接

## 身份与状态

- 仓库：`D:\github\JanVim-Exhibition-mini-pc`
- 隔离 worktree：`D:\github\JanVim-Exhibition-mini-pc\.worktrees\sound-stone-and-signal-v2`
- 分支：`feat/sound-stone-and-signal-v2-candidate`
- 基点：`dab0a0b005b9ff69bd2cda2d6fbcca31388527ea`
- 初版实现提交：`ae2bb0a3d5e2f90883e93aca205999b7ba6c9f57`
- 本轮修改前 HEAD：`b239086b8a35c8ecd793397d0c4b2601f99bd69c`；本轮最终提交见接收回执。
- 状态：第二轮小样及首次联合试听的音色、音量已获认可，首次联合试听的回写节奏关联未通过；
  已按用户确认范围修订为真实光标逐次起音，修订版待人工联合试听。没有 push、merge、tag、
  打包安装或生产切换。

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
2026-09-09 用户确认最小修订：字速、文本、90 秒循环及调度保持原样。编辑光标连续活动时，
同一组保持一种音色；相邻新样本间隔达到 650 ms 后划为下一组。该分组来自活动间隔，
并非文本语义段落或 cue 编号；鼠标移动不会触发声音。

每组首个有效输入立即起音。电贝司与原有拨弦琴音最多每 300 ms 一次，寻台最多每 375 ms
一次，低鸣/地音最多每 625 ms 一次；均只在新的有效光标到达时触发，跳过的输入不排队。
电贝司每节点只有一次拨弦，寻台完成一次短扫频后保留尾音，低音使用一次起音和自然衰减。
停下回写不再产生新的连续声部起音；已有尾音自然释放。石击、剑鸣和稀有琴音每组最多一次；
石击保留已认可的短三连击手势。寻台、低鸣、地鸣等分组还受独立冷却约束，以保持稀疏点缀。
所有乐器合计最多 8 个节点。

Wind 仍由原鸟群路径独立控制，候选不会生成持续风底。两路继续使用现场持久化增益，
统一 Stop 仍经过现有 1.5 秒总线淡出，
停止后晚到光标不能重新发声。候选 Instrument 在持久化现场增益之后应用 2 倍线性增益，
并继续受既有 `+6 dB` 上限约束；Legacy 模式的增益与行为不变。

本轮保留的实际现场增益文件：
`D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config\sound-mix-v1.json`，
当前为 Wind `0 dB`、Instrument `0 dB`，SHA-256
`0e4f6f8b061539428fcb78ea9ecc8c435ad71e651111e3b3e21e39327f7e2e39`。
文件修改时间为 2026-09-09 04:36:43 UTC，早于本轮节奏修订；本轮未写入此文件。
早前记录的 Wind `+6 dB`、Instrument `-10 dB` 是历史状态，不能用于覆盖当前现场值。

## 已认可的第二轮参考试听件

第二轮固定 NRT 试听件：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\sound-stone-signal-v2-audition-r2-20260909\stone-and-signal-v2-audition-r2.wav
```

对应回执：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\sound-stone-signal-v2-audition-r2-20260909\stone-and-signal-v2-audition-r2.receipt.json
```

WAV 为 125.501333 秒、48 kHz、双声道 PCM16、24096300 字节，SHA-256
`9786fb947682da60cd5071b9892e1c3fd539b1b94ac31cf90ba3dfb298a0b145`。
左右峰值为 0.08524 / 0.12222，削波样本均为 0；123.0 至 125.4 秒的 Stop 后区间全零。
它由固定种子的模拟光标和生产 SynthDef 静音 NRT 渲染，没有打开实时音频设备，
也没有持续风底。2026-09-09 人工第二轮试听确认整体音量、全部音色、电贝司连续拨弦、
留白和 Stop 均合适。该认可限于此固定 NRT 小样，不等于真实光标或生产启用验收。

首次联合试听 `joint-session-20260909T043507645Z-a6ac474fbf11` 随后得到用户确认：
音色、音量合适，但声音与文本回写缺乏内在联系。通过唯一 `STOP SHOW` 正常停止，
Show 退出 0，声音运行 452.3422141 秒，以 `reason=requested / clean=true` 结束。
修订前 10 个未提交文件已逐文件复制并核验 SHA-256，保留在：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\stone-signal-before-cursor-rhythm-20260909T051238923Z
```

## 光标节奏修订版试听件

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\sound-stone-signal-v2-cursor-rhythm-20260909\stone-and-signal-v2-cursor-rhythm.wav
```

相邻同名 `.receipt.json` 保存检查结果。WAV 为 125.501333 秒、48 kHz 双声道 PCM16、
24096300 字节，SHA-256
`1729702841767736727927c3525ec71459b8d8ef27ee33041db2e0553b353657`。
峰值左右 0.18600 / 0.19998，削波样本均为 0；123.0 至 125.4 秒 Stop 后区间全零。
此试听件用 1.5 秒活动、2.5 秒停顿的模拟输入覆盖全部音色，长度不代表实际演示循环长度。
另有独立 NRT 用一次输入与三次新输入，检查电贝司、原拨弦、寻台、低鸣和地音的衰减及再起音；
离线渲染不打开声音设备。修订版尚待人工听感与真实画面同步验收。

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

## 光标节奏修订的自动验证

- 完整声音 Node suite：184/184，零失败、零跳过；真实 Lua 光标链分别覆盖原模式和候选。
  日志为 `D:\VirtualData\JanVim-Exhibition-Rehearsals\stone-signal-cursor-rhythm-sound-suite-20260909.log`。
- 独立代码复核发现联合启动参数大小写可能静默回退；已先确认失败用例，再修正为规范转发，
  完整联合启动测试 13/13 通过。复核无剩余重要问题。
- 假时钟覆盖首个输入、密集输入、650 ms 分组边界、原拨弦旋律、音色冷却、固定种子和停止锁存。
  静音 SC 服务覆盖真实节点上限、双路独立增益、输入停顿不再起音和 Stop 后晚到输入。
- 新增五音色 NRT 脉冲检查，先确认原电贝司会自行再次拨弦，再验证单次输入仅一次起音；
  全音色 NRT 无削波，Stop 后静音。
- 声音策略、语言隔离与有界启动器检查均退出 0。应用门禁的本轮完整结果及最终候选身份
  保存在接收回执；较早的测试次数不能代替本轮结果。
- 本轮 `npm ci`、`npm run typecheck`、`npm run build`、`npm run lint` 全部退出 0。
  编译得到的 Electron main 与上述黄金 main 的字节数、SHA-256 完全一致；声音修改未改变
  应用调度、字速或 90 秒循环。
- `npm test` 原命令完成 1322 项：1316 通过、6 失败。5 项是既有启动/离线打包测试的
  5000 ms 超时，另 1 项是 `npm ci` 后候选 Electron 二进制尚未恢复。保持原测试预算，
  不据此宣称仓库总门禁通过。
- 环境恢复后，以单 worker、原 5000 ms 预算定向复验上述三个文件：34/35 通过。
  Electron 和 G2 启动检查全部通过，仅 `offline-package.test.ts:521` 的既有负向用例
  用时 5325 ms 超时。该应用总门禁仍记为未通过，本轮不扩展打包测试性能修订。
- 已从本机锁定的 Electron 44.0.0 ZIP 恢复候选的 73 个必需文件及 `path.txt`，独立校验
  全部字节数、SHA-256 和入口版本通过。没有启动 GUI。该 npm 包没有自动安装二进制的
  生命周期脚本，今后在此候选执行 `npm ci` 后也必须恢复这份运行时。
  ZIP 为 `D:\github\exhibition-mini-pc-tools\electron-runtime-44.0.0\electron-v44.0.0-win32-x64.zip`，
  SHA-256 `e61aa3bcea8152bc0730abd015e47c032d778a0ef10e2a1c78ba3c4ea47942f9`。
  门禁日志和运行时恢复回执在
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\stone-signal-cursor-rhythm-gates-20260909`。

本轮最终接收回执：
`D:\VirtualData\JanVim-Exhibition-Rehearsals\stone-signal-cursor-rhythm-handoff-20260909.receipt.json`。
其中记录最终提交、修改文件哈希、声音验证、应用门禁限制、试听件与黄金保全结果。

待人工项目：文字回写与起音的听感关联、不同音色辨识度、连续拨弦密度、留白、最终尾音及
统一 Stop。三轮物理投影、离线运行和强制重启恢复属于新候选待验项目；自动测试或此前
黄金版本的现场验收不能代替这些项目。候选没有自动接入黄金启动或计划任务。

## 前一实现的自动验证记录

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

上述 182 项等计数属于节奏修订前的实现。节奏修订后的验证结果见接收回执，不沿用旧计数
宣称修订已通过。

## 联合试听操作补充

使用当前显示设备新解析出的映射，经 `joint-rehearsal.ps1 -Action Prepare` 创建全新会话。
每条命令都传已验证 Node 22 的绝对路径，避免系统 Node 24 与工具链 Node 22 引起歧义。
Sound 动作增加 `-Listen -InstrumentProfile StoneAndSignalV2`，Show 使用同一份新会话文件。
映射不匹配时，现有 Electron `--display-config-mode=resolve` 可以在新的排练目录内按
`default-left-to-right` 生成临时映射；不会覆盖美术馆保留的 `site-config\display-map.json`。

正常停止仍用 Narrative 的 `STOP SHOW` 或 `Ctrl+Shift+S`，等待当前 90 秒循环的安全边界。
声音专用停止使用同脚本的 StopSound 动作，传入本轮 SessionFile 和 NodeExecutable，
然后用 Status 动作确认 `ENDED clean=True`。
候选联合操作不等于黄金三屏生产安装；《见山》实际生产程序、物理投影、离线和恢复验收
应按既有展览流程另行完成。
