# 展厅故障排查

本页供技术人员使用。先记录终端最后一条诊断；优先正常停止或重启 Windows，不做广域进程清理。

| 诊断或现象 | 安全处理 |
|---|---|
| `display-map-*`、三屏顺序错误 | 确认 Windows 为三屏扩展模式，运行 `Configure-Displays.ps1`，重新识别并保存 A/B/C。 |
| 《见山》不在 C 屏 | 正常停止，重新配置三屏，再启动；不要拖窗后把临时位置当成新配置。 |
| C 屏占位页盖住《见山》或置顶丢失 | 正常停止并重新运行 `Start-Exhibition.ps1`；置顶只属于本次精确《见山》窗口。 |
| C 屏鼠标看不见或不能点击 | 把鼠标移入《见山》窗口再试；仍异常则正常停止并重启。不要使用坐标点击或键盘注入脚本。 |
| `camera` / 相机失败 | 检查 USB、设备管理器及 Windows 相机隐私权限，关闭占用相机的其他软件后重启。 |
| `GPU` 或《见山》启动失败 | 更新本机显卡驱动，确认 DX12 Compute 可用；保留日志并重启后重试。 |
| `supercollider-*` | 确认 SuperCollider 3.14.1 位于固定目录，且没有遗留的试听程序占用端口。 |
| `耳机输出端点`失败或无声 | 确认有线耳机接入小主机 Realtek 输出，Windows 端点为 ACTIVE、48 kHz 立体声，且 SC 枚举名称为 `Windows WASAPI : Speakers (Realtek High Definition Audio)`。保留错误证据，待有人值守时试听。 |
| `show-stop-shortcut-unavailable` | 关闭占用 `Ctrl+Shift+S` 的软件后重启展演；本次启动已安全中止。 |
| `active-deployment-already-exists` | 先运行 `Stop-Exhibition.ps1`。若仍失败，正常重启 Windows，再运行同一停止脚本和验证脚本。 |
| `deployment-cleanup-incomplete` | 记录诊断并重启 Windows；重启后执行 `Stop-Exhibition.ps1`，再验证和启动。 |

技术后备停止命令：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Stop-Exhibition.ps1'
```

该脚本只使用当次 `active-deployment.json` 中的 PID、启动时间和可执行文件身份。不要手工删除
lease、token、descriptor、源码或配置；不要按 `electron`、`pwsh`、`node`、`jianshan` 等进程名
批量终止。无法恢复时保留外部运行目录，由工作人员重启主机并重新验证。
