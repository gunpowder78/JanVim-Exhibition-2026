# 每日操作卡

完整步骤见同目录 `EXHIBITION-OPERATOR-RUNBOOK.md`；以下只供每日快速核对。

1. 检查主机、电源、三根显示线、相机和有线耳机；Windows 必须为三屏扩展模式。
   本机登录 `hxj` 后会延时 30 秒自动开演；自动启动时不要再执行第 3 步。
2. 在 PowerShell 7 执行：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Verify-Deployment.ps1'
   ```

   必须看到 `DEPLOYMENT_VERIFY_PASS`。
3. 自动任务已禁用或正常 Stop 后需要再次开演时，手动启动：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1'
   ```

4. 无需点击 Start。应自动出现 A 屏 JanVim、B 屏叙事页，以及 C 屏无标题栏、无任务栏、无需按 F 的无边框全屏《见山》；C 屏鼠标仍可显示和点击。
5. 正常结束首选点击 B 屏 `STOP SHOW`；也可按一次 `Ctrl+Shift+S`。
6. 等待最多 45 秒，确认声音淡出无复响、画面退出且启动命令返回提示符；不要重复点击。
7. 正常 Stop 不可用时才运行 `operator\Stop-Exhibition.ps1`；随后重新验证。若仍失败，保留诊断并正常重启 Windows，不要删除运行文件或批量结束进程。
8. 单次有人值守展演最长一小时，到时正常停止并新开一场。
