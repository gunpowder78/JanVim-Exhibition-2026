# 每日操作卡

1. 检查主机、电源、三根显示线、相机和有线耳机；Windows 必须为三屏扩展模式。
2. 在 PowerShell 7 执行：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Verify-Deployment.ps1'
   ```

   必须看到 `DEPLOYMENT_VERIFY_PASS`。
3. 启动：

   ```powershell
   pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1'
   ```

4. 无需点击 Start。应自动出现 A 屏 JanVim、B 屏叙事页，以及 C 屏最大化、永久置顶、黑底白鸟的《见山》；C 屏鼠标仍可显示和点击。
5. 正常结束按 `Ctrl+Shift+S`（不区分字母大小写）。
6. 若快捷键不可用，点击 B 屏 `STOP SHOW`。
7. 若程序异常，先正常重启 Windows，再重复第 2、3 步；不要删除运行文件或批量结束进程。
8. 单次有人值守展演最长一小时，到时正常停止并新开一场。
