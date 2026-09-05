# 真实逻辑光标声音：候选本地交接

候选仅为 `D:/github/JanVim-Exhibition-2026/.worktrees/sound-real-cursor`、
`feat/sound-real-cursor`。真实 Lua → Bridge → sound client → 认证 real-input listener →
唯一 sender → SuperCollider 的无声录音证据与完整门禁见
`.operator/real-cursor-sound-report.md`（候选内保留的本机报告副本）。
这是 headless 集成证据；人工听音、当前双投影三圈、离线和强制重启恢复验收仍待执行。
历史模拟声音试听结论不自动转为真实输入验收。

## 人工预演：使用已保存脚本

候选已保存本地操作文件
`.operator/real-cursor-sound.ps1`（完整 helper，候选 `.gitignore` 忽略的本机交接附件，
不属于发布源码）。必须保留整个 `.operator/`；清理本轮 SDD scratch 不移动此目录。
helper、邻接 session 和报告入口不依赖 SDD。下面每条命令单独执行；不需要跨窗口变量或长段交互粘贴。
脚本只转调现有 launcher，保存本次明确的 show/sound 路径，不扫描“最新”运行。

1. PRE-SHOW：在 PowerShell 7 执行 Prepare。它先显式选择现有长文
   `songfeng-source`，再为本次创建全新 evidence root 并打开现有显示配置 GUI。
   **跟踪的 active fixture 是短基线**；自动化门禁没有切换内容。这里只由操作者
   在演出开始前选择长文，不修改冻结 profile、原诗或媒体。

```powershell
pwsh -NoProfile -File 'D:/github/JanVim-Exhibition-2026/.worktrees/sound-real-cursor/.operator/real-cursor-sound.ps1' -Step Prepare
```

GUI 中由人 Identify 并确认当前显示器映射、分辨率、缩放和 profile；完整生产路由选择
`production-3`，单屏只能选择 `single-display-preview` 并记录对应限制。
Save 后关闭 GUI；此步骤不自动启动展演。不复用历史显示 ID。
保存的 `real-cursor-sound-session.json` 同时位于该 show root 和候选的
`.operator/real-cursor-sound-session.json`，记录本次精确 SoundRunRoot。
后续三个模式固定读取这个邻接文件；缺失则拒绝启动，需人工重新 Prepare。
本次修复没有复制任何已有 live/private Show session；此文件仅由人工 Prepare 创建。

2. 声音窗口 A：人工确认有线耳机和低音量后，显式启用 Listen。此命令实际调用
   候选 `sound/start-sound.ps1 -Input RealCursor -Listen -Duration 900 -RunRoot <本次保存路径>`。
   等待 `SOUND_RUN_READY`；核对它的 runRoot 等于 session 文件的 soundRunRoot。

```powershell
pwsh -NoProfile -File 'D:/github/JanVim-Exhibition-2026/.worktrees/sound-real-cursor/.operator/real-cursor-sound.ps1' -Step Sound -Listen
```

不加 `-Listen` 时仍为无声诊断。现有 1–3600 秒运行上限和小于 120 秒录音分配上限不变；
900 秒人工听音不会产生自动内部录音。绑定展演前 RealCursor 保持静默；不播放模拟光标或鸟群。
不改设备、驱动或系统音量；沿用既有耳机配置。

3. 展演窗口 B：由人确认当前满足离线策略后执行，随后按现有界面 Start。
   脚本把同一 session 文件的精确 soundRunRoot 传给候选 `scripts/start-show.ps1 -SoundRunRoot`。

```powershell
pwsh -NoProfile -File 'D:/github/JanVim-Exhibition-2026/.worktrees/sound-real-cursor/.operator/real-cursor-sound.ps1' -Step Show
```

默认 `-NetworkPolicy OfflineRequired`。只做联网诊断时可以显式追加
`-NetworkPolicy DiagnosticConnected`，其结果不能登记为离线通过。脚本不切换网络状态。
每次新预演重新 Prepare、新 sound root、新 show root；不可重新启用已 Stop 的声音目录。

4. 人工观察长文真实移动/写入与拨弦相关，静止时没有新拨弦；原有音符可以自然衰减。
   至少观察一次正常 reset 恢复原诗、下一圈继续拨弦。确认配色、标点、列距未变。
   在实际拨弦期间点击 Narrative surface 的 **Stop Show**，确认约 1.5 秒平滑淡出且不再响起。
   该界面不可用时，在 launcher 终端按一次 Ctrl+C 并等待有界清理。
   备用声音停止（仅停止本次声音）：

```powershell
pwsh -NoProfile -File 'D:/github/JanVim-Exhibition-2026/.worktrees/sound-real-cursor/.operator/real-cursor-sound.ps1' -Step StopSound
```

`STOP_REQUESTED` 只是请求回执；窗口 A 的 `SOUND_RUN_COMPLETE` 和 sound root 的
`summary.json` 应为 `clean:true`。Show root 保留 `show-run.json`、`controller-terminal.json`
以及若存在的 `controller-incident.json`。记录显示映射、分辨率/缩放、源/构建/core 哈希、
圈数、漂移、恢复结果和操作者听音备注。只有人明确返回上述观察结果后，才能登记人工通过。

## 失败与保底

声音缺失/连接失败不会等待或阻塞文本 ACK、reset 和画面；有界诊断只关闭可选声音。
普通 reset 可以继续下一圈；Stop 锁定，迟到光标和心跳不能重新唤醒。控制器失联沿用
2 秒租约与 1.5 秒淡出。本轮 JanVim 进程故障终止声音会话，画面按既有策略恢复；
声音不自动重启，需操作者另开全新声音与展演。

启动/验收时串行运行完整应用与声音门禁。本机同时运行两套门禁曾触发既有所有权辅助检查、
进程身份检查及测试期限；原失败日志已保留，未放宽检查。串行声音69/69通过支持资源争用
解释，不代表任意系统负载下的压力保证。

本次没有重编译 JanVim 或改 artifact lock。候选 Electron bundle 为 540860 字节，
SHA-256 `2a166eff47428efe3759b07c26cddcc92b615a4b1bf61d440e6674d8baa97f70`；
core 为 18869248 字节，SHA-256
`3fc76259677185c619db2a76e302b9588df0bdd3e58600ed30a5ea08b4194f54`。
父任务记录的原投影保底 tag `14aef7f2af250e6e770b60b8c33ca0ea53364261`、
原独立声音 `cbde651840805ca1ae8d0a540ea5dac0a05a4056` 和视觉分支
`abd471c1d05d779dd6df5f00bc1511ac9ce1d41d` 未改。需要回退时停止候选，使用原工作树既有入口。

接口已包含本地 `AgentCursorTiming { ageMs }`：
`Bridge.onCursor((event, timing) => client.observe(event, timing))` 必须转发真实 age，不能补零。
wire schema 和 ACK 不变。现有 ESLint 忽略 TypeScript，lint 门禁不代表 TS lint 覆盖。
《见山》仅指向独立的[冻结协作备忘](2026-09-05-jianshan-sound-ingress-confirmation-v1.md)，
不包含真实鸟群实现或其验收授权。
