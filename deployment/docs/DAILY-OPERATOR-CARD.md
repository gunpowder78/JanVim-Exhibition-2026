# 每日操作卡

适用版本：**展示版黄金极限 #002**。继续使用原“应急启动三屏展示”桌面快捷方式。

完整步骤见同目录 `EXHIBITION-OPERATOR-RUNBOOK.md`；以下只供每日快速核对。

1. 检查主机、电源、至少三台显示器和 Realtek 有线声音输出；Windows 必须为扩展模式，相机可选。
   本机登录 `hxj` 后会延时 30 秒自动开演；自动启动时不要再执行第 3 步。
2. 在 PowerShell 7 执行：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Verify-Deployment.ps1' -DeferDisplayMapping
   ```

   必须看到 `DEPLOYMENT_VERIFY_PASS`。启动器随后解析映射；有适用人工配置就沿用，否则按桌面
   从左到右（同列从上到下）选前三屏。配置器仅在技术人员发现映射错误时手动运行。
3. 自动任务已禁用或正常 Stop 后需要再次开演时，手动启动：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1'
   ```

4. 无需点击 Start。应自动出现 A 屏 JanVim、B 屏叙事页，以及 C 屏无标题栏、无任务栏、无需按 F 的无边框全屏《见山》。鼠标进入或移动到 B 屏后显示；若静止 20 秒后仍未隐藏，把指针移到 B 屏空白处单击一次，不要点击控制按钮。
5. 正常结束首选点击 B 屏 `STOP SHOW`；也可按一次 `Ctrl+Shift+S`。
6. B 屏应立即显示黄色“两行退出中”提示。等待当前 90 秒循环到复位点并完成声音淡出，确认无复响、画面退出且启动命令返回提示符；不要重复点击或按键。
7. 正常 Stop 不可用时才运行 `operator\Stop-Exhibition.ps1`；随后重新验证。若仍失败，保留诊断并正常重启 Windows，不要删除运行文件或批量结束进程。
8. 单次有人值守展演最长一小时，到时正常停止并新开一场。
