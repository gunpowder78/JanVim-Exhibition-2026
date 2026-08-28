# G2 双显示器闭环彩排

本手册用于两台真实显示器模拟双投影，运行冻结的 JanVim artifact 与真实 Electron
副屏，完成一次 90 秒因果闭环。它不会修改 `show/display-map.json`，也不修改 JanVim
产品源码、用户 Neovim 配置、源诗或源媒体。

## 开始前

1. 在 Windows“显示设置”中先决定副屏方向（横屏或竖屏），完成物理旋转，并确认两台
   显示器的分辨率、缩放比例和排列位置。
2. 从 Capture 到 Run 结束，方向、分辨率、缩放和排列都必须保持不变。
3. 任一显示设置发生变化，都要放弃当前彩排目录，生成新的 `$runId`，从 Capture
   重新开始；不得手工修补旧映射。
4. 确认依赖和生产构建已完成：`npm ci`、`npm run typecheck`、`npm test`、
   `npm run build`。
5. 保持网络可断开；现场循环不依赖网络。不要启动或修改 `D:\github\JanVim`。

## 四步命令

以下命令必须从当前隔离 worktree 执行。Capture 是唯一允许创建彩排根目录的模式。

```powershell
Set-Location 'D:\github\JanVim-Exhibition-2026\.worktrees\task1'
$runId = "g2-monitor-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$rehearsalRoot = Join-Path 'D:\VirtualData\JanVim-Exhibition-Rehearsals' $runId
$displayMapPath = Join-Path $rehearsalRoot 'display-map.json'

pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode Capture -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath

Get-Content -Raw -LiteralPath $displayMapPath
$primaryDisplayId = Read-Host 'Enter the Electron ID physically verified as the primary monitor'
$secondaryDisplayId = Read-Host 'Enter the Electron ID physically verified as the secondary monitor'
pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode Confirm -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath -PrimaryDisplayId $primaryDisplayId -SecondaryDisplayId $secondaryDisplayId

pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode ValidateOnly -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath -RunId $runId

pwsh -NoProfile -File .\scripts\start-g2-rehearsal.ps1 -Mode Run -RehearsalRoot $rehearsalRoot -DisplayMapPath $displayMapPath -RunId $runId
```

每个模式最后输出一行压缩 JSON：

- Capture：成功时进程退出码为 `0`，末行包含
  `{"schema":1,"mode":"Capture","exitCode":0,...}`；外部映射必须为
  `mappingStatus: "unconfirmed"`。
- Confirm：在人工核对两个物理屏幕后传入两个不同 ID；成功时退出码为 `0`，末行
  `mode` 为 `Confirm`，外部映射变为 `mappingStatus: "confirmed"`。
- ValidateOnly：artifact、内容、确认映射和当前显示拓扑全部匹配时退出码为 `0`；任何
  不匹配返回非零，且不会打开 BrowserWindow 或启动 JanVim。
- Run：只有完成一轮、复位成功、自然关闭且证据写入成功时退出码为 `0`；任何失败返回
  非零。末行的 `exitCode` 与 Electron 的真实退出码完全一致。

任一步返回非零都应停止。不要复用一个失败或显示设置已变化的彩排根目录。

## Run 人工闭环

1. 等副屏显示本地 Ready 状态后，用鼠标点击一次 **Start**。不要使用全局键盘注入、
   坐标点击脚本或远程页面触发。
2. 观察完整 90 秒循环。复位 ACK 成功后，副屏进入 `complete-awaiting-close`。
3. 只有确认原诗已经恢复、没有残留生成内容后，才在 60 秒人工关闭窗口内对 JanVim
   使用 **Alt+F4**。不要提前关闭，也不要用 `:q` 代替本次自然前端关闭验收。
4. 控制器随后关闭 Bridge 和副屏、写入证据并退出。超过 60 秒会只终止所保留的精确
   JanVim 子进程，并将本轮记为失败。

## 六项 G2 观察（逐项确认）

以下六项是批准设计中的原文验收要求：

1. The primary surface is the real JanVim window.
2. The secondary result completes before primary cursor/edit movement begins.
3. Key Overlay and the real semantic editor action agree.
4. Inserted text is visible and unclipped.
5. Reset restores the original poem after 90 seconds with no residual buffer content.
6. Closing JanVim yields a natural frontend shutdown record.

任一项不能确认，本轮即不能判定为 G2 通过，并应在 operator notes 中如实记录。

## 证据位置

Run 只在当前外部彩排根目录写以下证据：

```powershell
Get-Content -Raw -LiteralPath "$rehearsalRoot\g2-run.json"
Get-Content -Raw -LiteralPath "$rehearsalRoot\controller.ndjson"
Get-Content -Raw -LiteralPath "$rehearsalRoot\janvim.stdout.log"
Get-Content -Raw -LiteralPath "$rehearsalRoot\janvim.stderr.log"
```

检查 `g2-run.json` 至少满足：`outcome` 为 `passed`、`completedLoops` 为 `1`、
`resetRestoredPoem` 为 `true`、shutdown 为 natural、显示映射 SHA-256 与本轮外部映射
一致，并且 `physicalProjectorsTested` 明确为 `false`。证据中不得出现 Bridge token、
用户配置路径或用户 Neovim 配置内容。

## 验收边界

两台真实显示器上的成功只建立“投影模拟”G2。它不替代两台物理投影上的三轮连续
循环、离线运行和强制重启恢复验收。真实投影可用后，必须用新的外部彩排根重新执行
Capture、Confirm、ValidateOnly 和 Run；不得把显示器 ID 写入已签入的
`show/display-map.json`。
