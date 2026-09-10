# 每日操作卡

适用版本：**#002 的美术馆现场维护版**。继续使用原“应急启动三屏展示”桌面快捷方式。

完整步骤见同目录 `EXHIBITION-OPERATOR-RUNBOOK.md`；以下只供每日快速核对。

1. 检查主机、电源、至少三台显示器和 Realtek 有线声音输出；Windows 必须为扩展模式，相机可选。
   本机登录 `hxj` 后会延时 30 秒自动开演；自动启动时不要再执行第 3 步。
   意外断电后，启动器会自动归档上一次开机留下的运行标记并重新开演，不影响人工屏序配置。
   正在启动或运行时重复双击入口会被拒绝，避免拉起两套展示。
2. 在 PowerShell 7 执行：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Verify-Deployment.ps1' -DeferDisplayMapping
   ```

   必须看到 `DEPLOYMENT_VERIFY_PASS`。启动器随后解析映射；设备 ID 改变但完整桌面布局相同时，
   按保存的位置关系恢复人工映射；否则有适用人工配置就沿用，没有时按桌面
   从左到右（同列从上到下）选前三屏。配置器仅在技术人员发现映射错误时手动运行。
3. 自动任务已禁用或正常 Stop 后需要再次开演时，手动启动：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1'
   ```

4. 无需点击 Start。应自动出现 A 屏 JanVim、B 屏叙事页，以及 C 屏无标题栏、无任务栏、无需按 F 的无边框全屏《见山》。鼠标进入或移动到 B 屏后显示；若静止 20 秒后仍未隐藏，把指针移到 B 屏空白处单击一次，不要点击控制按钮。
5. **STOP SHOW：只退出展示。Ctrl+Shift+S：正常退出展示后关闭小主机。**按需选择，勿混用。
6. B 屏应立即显示黄色“两行退出中”提示。等待当前 90 秒循环到复位点并完成声音淡出，确认无复响、画面退出。STOP SHOW 后启动命令返回提示符；Ctrl+Shift+S 后主机关机。不要重复点击或按键。
7. 正常 Stop 不可用时才运行 `operator\Stop-Exhibition.ps1`；随后重新验证。若仍失败，保留诊断并正常重启 Windows，不要删除运行文件或批量结束进程。
8. 正式展演持续循环，没有一小时自动结束。闭馆时使用第 5 步的人工停止；不要关闭启动终端。

JanVim 启动后自动原生最大化。搬机或改动 Windows 显示布局后仍需检查实际屏序。
