# 展厅故障排查

本页供技术人员使用。先记录终端最后一条诊断；优先正常停止或重启 Windows，不做广域进程清理。

| 诊断或现象 | 安全处理 |
|---|---|
| `deployment-display-resolution-failed` | 确认至少三台设备通电且为扩展模式；保留本次目录中的 `display-resolution-Stderr.txt`。无需为了缺少人工配置而打开配置器。 |
| 三屏顺序错误 | 正常 Stop 后，由技术人员运行“展览显示配置器”，重新识别并保存 A/B/C；日常开机自动选用适用映射，否则按桌面从左到右默认分配。 |
| 《见山》不在 C 屏 | 正常停止，重新配置三屏，再启动；不要拖窗后把临时位置当成新配置。 |
| 《见山》出现标题栏、任务栏或需要按 F | 正常停止并重新运行 `Start-Exhibition.ps1`；保底应自动无边框全屏。不要按 F 掩盖问题。 |
| C 屏占位页盖住《见山》或置顶丢失 | 正常停止并重新运行 `Start-Exhibition.ps1`；置顶只属于本次精确《见山》窗口。 |
| `jianshan-window-placement-failed:<具体原因>` | 保存当次目录的 `jianshan-placement-*-Stdout.txt`、`Stderr.txt` 及 `startup-failure.txt`。启动器只对已知暂未就绪错误最多尝试三次；不要因此重配已正确的屏幕。 |
| C 屏鼠标看不见或不能点击 | 把鼠标移入《见山》窗口再试；仍异常则正常停止并重启。不要使用坐标点击或键盘注入脚本。 |
| `camera` / 相机失败 | 自动展示可继续。需要交互时再检查 USB、设备管理器、隐私权限及相机占用；相机缺席不应阻止整个展示。 |
| `GPU` 或《见山》启动失败 | 更新本机显卡驱动，确认 DX12 Compute 可用；保留日志并重启后重试。 |
| `supercollider-*` | 确认 SuperCollider 3.14.1 位于固定目录，且没有遗留的试听程序占用端口。 |
| `耳机输出端点`失败或无声 | 确认有线耳机接入小主机 Realtek 输出，Windows 端点为 ACTIVE、48 kHz 立体声，且 SC 枚举名称为 `Windows WASAPI : Speakers (Realtek High Definition Audio)`。保留错误证据，待有人值守时试听。 |
| `show-stop-shortcut-unavailable` | 关闭占用 `Ctrl+Shift+S` 的软件后重启展演；本次启动已安全中止。 |
| `active-deployment-already-exists` | 先运行 `Stop-Exhibition.ps1`。若仍失败，正常重启 Windows，再运行同一停止脚本和验证脚本。 |
| `deployment-cleanup-incomplete` | 记录诊断并重启 Windows；重启后执行 `Stop-Exhibition.ps1`，再验证和启动。 |
| 登录后没有自动开演、PowerShell 自行退出 | 查询 `Start_JanVim_Exhibition` 的 `LastRunTime` 和 `LastTaskResult`；保留最新启动目录中的 `verification-progress.jsonl`、`startup-failure.txt`。登录后 30 秒触发，冷启动校验可能较慢，整套校验最多 240 秒。不要同时手动启动。完整步骤见 `AUTOSTART-TASK.md`。 |
| 自动任务重复启动 | 新任务必须使用 `IgnoreNew`，旧 `Start_JianShan_Boid` 必须为 Disabled。不要启用两个任务。 |

技术后备停止命令：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Stop-Exhibition.ps1'
```

该脚本只使用当次 `active-deployment.json` 中的 PID、启动时间和可执行文件身份。不要手工删除
lease、token、descriptor、源码或配置；不要按 `electron`、`pwsh`、`node`、`jianshan` 等进程名
批量终止。该脚本是技术后备，不计作正常 Stop 验收；它可能令原启动命令返回非零清理诊断。
无法恢复时保留外部运行目录，由工作人员正常重启主机并重新验证。
