# 同规格展览主机部署

当前发行版为“#002 的美术馆现场维护版”，正式入口保留已通过三屏联调的光标节奏声音，
并增加屏序持久化、JanVim 原生最大化和快捷键退出后关机。黄金 #002 原包保持可回退。
版本身份、最终混音和上一版回退位置见 `GOLDEN-BASELINE.md`。

本包用于有人值守的 Windows 11 Pro x64 三屏展演。安装根固定为
`D:\github\JanVim-Exhibition-Deploy`，运行证据和现场配置固定写入
`D:\VirtualData\JanVim-Exhibition-Rehearsals`。不要从源码工作树直接开演。
现场启动、运行和关闭请按 `docs\EXHIBITION-OPERATOR-RUNBOOK.md`；每日简表见
`docs\DAILY-OPERATOR-CARD.md`。

PELADN WO4 当前另有主机级计划任务，登录后延时 30 秒启动固定目录；详见
`docs\AUTOSTART-TASK.md`。部署 ZIP 不会在其他主机上自动创建或修改计划任务。

## 第三方准备

目标机必须具备：

- PowerShell 7.6.5 x64；`pwsh.exe` 可由 PATH 唯一找到。
- SuperCollider 3.14.1，安装于 `C:\Program Files\SuperCollider-3.14.1`。
- 当前 GPU 的 Windows 11 驱动，并能运行 DX12 Compute。
- 需要相机交互时才要求 UVC 驱动与 Windows 桌面应用相机权限；无相机可直接自动展示。
- 小主机输出端点 `Windows WASAPI : Speakers (Realtek High Definition Audio)`，48 kHz、立体声；现场确认接入的有线耳机。
- 至少三台显示设备采用 Windows“扩展这些显示器”，不要求沿用旧接口或旧显示器 ID。

Node.js 22.23.0、Electron、JavaScript 依赖、《见山》VC144/MediaPipe/OpenCV 文件和手势模型
已经随包提供。目标机不需要 Git、npm、Rust、Cargo、Python、Visual Studio 或 ASIO。

## 拷贝与首次验证

1. 将 ZIP 和 `deployment-handoff.json` 一并复制到目标机。先以
   `Get-FileHash -Algorithm SHA256 -LiteralPath '<ZIP>'` 对照回执中的 `archive.sha256`。
2. 确认 `D:\github\JanVim-Exhibition-Deploy` 不存在。若有旧包，先由技术人员把整个目录
   改名备份；不要覆盖安装。
3. 解压 ZIP 内容到唯一目录 `D:\github\JanVim-Exhibition-Deploy`。
4. 在 PowerShell 7 执行：

   ```powershell
   Set-Location 'D:\github\JanVim-Exhibition-Deploy'
   pwsh -NoProfile -File '.\operator\Verify-Deployment.ps1' `
     -HandoffReceiptPath '<deployment-handoff.json 的绝对路径>' -DeferDisplayMapping
   ```

   只有看到 `DEPLOYMENT_VERIFY_PASS` 才继续。校验不会打开相机、GUI 或播放声音。

## 三屏配置

接好至少三屏并设为扩展模式即可启动。有适用的人工映射时沿用；否则按桌面从左到右、
同列从上到下在前三屏依次显示 JanVim、叙事页和《见山》。只有实测映射错误时，正常 Stop 后
由技术人员手动执行：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Configure-Displays.ps1'
```

按配置器画面把 A、B、C 对应为 `SCREEN-1`、`SCREEN-2`、`SCREEN-3`，保存并关闭。
配置写入外部 `site-config\display-map.json`，不会改部署包。每次启动生成独立运行映射，
自动选择不会覆盖这里保存的人工配置。

## 第一次开演

先把耳机音量调低；需要相机交互时确认相机无遮挡，然后执行：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1'
```

系统自动启动声音、《见山》和 JanVim 展演，不再点击 `Start Rehearsal`。《见山》应自动位于
C 屏、无标题栏、无任务栏、无需按 F 的无边框全屏并永久置顶。A 屏持续长文回写，B 屏显示
叙事和声音控制；鼠标进入或移动到 B 屏后显示，再移动时会重新显示。若静止 20 秒后仍未隐藏，
把指针移到 B 屏空白处单击一次即可隐藏，不要点击控制按钮。正常停止首选点击 B 屏
一次 `STOP SHOW`（只退出展示）；需要退出后关闭小主机时按一次 `Ctrl+Shift+S`。
B 屏中央出现黄色退出提示后，等待当前循环
到复位边界、声音淡出和启动命令返回，不要重复停止。

每次会话最多 3,600 秒，且需要工作人员在场。本包不声明断网、强制恢复、HP 性能、热插拔
自愈或 7×24 小时无人值守能力。
