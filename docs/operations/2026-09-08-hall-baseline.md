# 2026-09-08 展厅联调基线与运行说明

用户在展厅重新映射后确认：“当前配置状态已经联调检验效果良好，请固定下来。”本记录固定该次三屏、声音与《见山》全屏状态，作为后续效果调整的回退点。

## 已固定配置

| 画面 | 显示配置器编号 | displayId | 桌面位置 |
| --- | --- | --- | --- |
| SCREEN-1 JanVim | #2 | 3307128360 | (0, 0) |
| SCREEN-2 Web 叙事 | #3 | 1837957737 | (1920, 0) |
| SCREEN-3《见山》 | #1 | 2334534373 | (-1920, 0) |

三屏均为 1920×1080、Windows 缩放 100%、旋转 0。《见山》直接无边框全屏，无需按 F。配置器编号对应此次拓扑；更换接口、投影设备或系统重新枚举后，应按实际画面确认，不能只看编号。

风声增益 **+6 dB**，拨弦增益 **−10 dB**。声音使用 `Windows WASAPI : Speakers (Realtek High Definition Audio)`，48 kHz、双声道。Windows 主音量未由本快照测量，保持现场当前设置。USB 相机在本次联调时已接入。

活动配置位于 `D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config`；仓库副本位于 `deployment/site-baselines/2026-09-08-hall/`。保存副本不会将活动文件设为只读，配置器与混音面板仍可正常工作。

## 启动、关闭与显示设置

投影和音频设备准备好后，在 PowerShell 运行：

```powershell
pwsh -NoProfile -File "D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1"
```

正常关闭使用界面的 `STOP SHOW`，等待声音淡出、画面退出。需要技术停止时：

```powershell
pwsh -NoProfile -File "D:\github\JanVim-Exhibition-Deploy\operator\Stop-Exhibition.ps1"
```

桌面快捷方式 **展览显示配置器** 用于重新选择三屏。先停止演示，再打开配置器。改变连接后先检查 Windows 三屏均为 1920×1080、100% 缩放，再确认映射。

## 本地恢复点

- 主存档：`D:\VirtualData\JanVim-Exhibition-Rehearsals\golden-baselines\exhibition-hall-2026-09-08`
- 第二份本机副本：`C:\Users\hxj\Documents\JanVim-Exhibition-Baselines\exhibition-hall-2026-09-08`
- 文件校验表：存档内 `files.sha256.json`。
- 旧黄金基线：`exhibition-mini-pc-2026-09-08`，继续保留。

两份均在本机；不代表已完成异机备份。存档含原黄金 ZIP、清单、现场配置、运行摘要、三屏截图、声卡只读探测和计划任务快照。计划任务 XML 用于核对，不作为已验证的自启恢复方案。

仅在演示停止且显示拓扑与本记录一致时，可恢复映射和混音。下列命令先备份现有两个文件，再从基线复制：

```powershell
$hallBaseline = 'D:\VirtualData\JanVim-Exhibition-Rehearsals\golden-baselines\exhibition-hall-2026-09-08'
$hallConfig = 'D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config'
if (Test-Path -LiteralPath "$hallConfig\active-deployment.json") { throw '请先正常停止演示' }
$hallPrevious = Join-Path (Split-Path $hallConfig -Parent) ('config-before-restore-' + (Get-Date -Format 'yyyyMMddTHHmmssfff'))
New-Item -ItemType Directory -Path $hallPrevious -ErrorAction Stop | Out-Null
foreach ($name in @('display-map.json', 'sound-mix-v1.json')) {
    Copy-Item -LiteralPath (Join-Path $hallConfig $name) -Destination (Join-Path $hallPrevious $name) -ErrorAction Stop
}
foreach ($name in @('display-map.json', 'sound-mix-v1.json')) {
    Copy-Item -LiteralPath (Join-Path $hallBaseline "site-config\$name") -Destination (Join-Path $hallConfig $name) -ErrorAction Stop
}
```

拓扑变化时使用配置器生成新映射。完整程序回退按原黄金包内操作说明进行：先停机并完整保留旧目录，核验 ZIP 后整体恢复到固定路径，随后恢复适用于当前拓扑的外部配置；不要将 ZIP 直接覆盖到旧运行目录。

## 程序身份与联调证据

本次固定的是既有黄金程序包加展厅外部配置：

- JanVim 展示包源码：`4b19a77691e7b52de6668f9c0f85e4f09c25a21c`，标签 `exhibition-mini-pc-golden-2026-09-08`。
- 《见山》协调提交：`6d1a4577a9484092fde94308352c80ee710ed18f`；原生可执行文件 9,799,168 字节，SHA-256 `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`。
- 黄金 ZIP：331,532,559 字节，SHA-256 `f2da64042855e8a596d3da26ffd9f509794866ab3b33ff3b26d7a0f1de86877f`。
- 包清单 SHA-256：`1a492a13c4b674234503a225eb8bad63e4f9f205a2d585179bfc5100d3678472`。

现场运行 `joint-show-20260908T093940214Z-ea3d80844fcc` 的聚合记录为 **16 轮**，声音服务运行 **1483.348 秒（约 24 分 43 秒）**；累计可见时序漂移 **171.507 ms**，0 重试、0 恢复，3 次有界的 P0 缺省素材跳过。详细循环记录按上限保留最后 3 轮。操作者正常 Stop，控制器 `intentional-success`，声音 `clean: true`。用户已确认现场画面、声音和本次重新映射效果良好。

机器原报告仍标为 `monitor-simulation` / `diagnostic`，`physicalProjectorsTested: false`；原件保留，本记录补充用户在展厅的人工确认。报告没有断网运行样本，也没有强制恢复记录。当前场次已停止。

此次归档重新校验已安装包的 9,136 个不可变文件，并校验复制文件大小及 SHA-256。仅增加配置快照和文档，没有应用代码变更，未为此次归档重跑构建或应用测试。原黄金包的历史验证记录另行保留。

## 后续事项

冷启动 `deployment-child-timeout` 和真实重启后的 30 秒自启仍需修复与复验；当前已接受的是现场手动启动后的展示效果。`Start_JanVim_Exhibition` 延时 `PT30S` 的任务保留，旧 `Start_JianShan_Boid` 继续禁用并保留。

“相机接入或不接入均可展示”已获用户授权，但当前部署的启动前检查仍要求相机，该兼容改动尚未部署。断网运行和强制重启恢复验收也仍待完成。

工作树中尚未完成验证的启动修复不纳入本次基线提交。后续效果调整使用新候选包和独立验收记录，保留本次基线与旧黄金包。
