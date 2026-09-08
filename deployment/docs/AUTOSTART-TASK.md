# 小主机自动开演计划任务

本页记录 PELADN WO4 当前的主机级启动配置。计划任务属于 Windows 外部状态，不由部署 ZIP
自动创建，也不写入 Git 工作 应用源码。

## 当前配置

| 项目 | 值 |
| --- | --- |
| 新任务 | `\Start_JanVim_Exhibition` |
| 状态 | Enabled / Ready |
| 触发 | 用户登录后 |
| 延时 | `PT30S`，即 30 秒 |
| 用户 | `hxj` 交互会话 |
| 权限 | Highest |
| 重复实例 | `IgnoreNew` |
| 程序 | PowerShell 7.6.5 `pwsh.exe` |
| 参数 | `-NoLogo -NoProfile -WindowStyle Minimized -File "D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1"` |
| 工作目录 | `D:\github\JanVim-Exhibition-Deploy` |

旧任务 `\Start_JianShan_Boid` 已禁用但没有删除。它仍保留原来的
`C:\JianShan02Boid\release\win-unpacked\restart_once.bat` 动作及 30 秒延时，作为配置回退。

这里沿用原任务的“登录后延时 30 秒”，不是 Windows 尚未登录时的系统启动触发。三屏 GUI、
相机和当前用户声卡必须运行在交互式桌面，因此登录触发是正确语义。

## 日常开机

1. Windows 登录 `hxj` 后不要手动再次运行 `Start-Exhibition.ps1`。
2. 等待 30 秒触发计划任务；完整展演通常还需要十几秒完成验证和启动。
3. 应自动出现 JanVim、叙事页和 `SCREEN-3` 的《见山》无边框全屏。
4. 计划任务启动入口会先执行部署验证；验证失败时不会继续开启半套展演。
5. 正常关闭仍使用 B 屏 `STOP SHOW`，也可按一次 `Ctrl+Shift+S`。
6. 正常 Stop 后任务回到 Ready，不会在当前登录会话中自动重启；下一次需要手动开演，或重新登录。

需要开机后暂不展演时，应在关机或注销前由管理员禁用新任务。不要等登录后的 30 秒窗口内
抢先结束进程。

## 查看状态

以下命令只读：

```powershell
Get-ScheduledTask -TaskName 'Start_JanVim_Exhibition'
Get-ScheduledTaskInfo -TaskName 'Start_JanVim_Exhibition'
```

正常未运行时应为 `Ready`。计划任务手动触发或登录启动后为 `Running`；正常 Stop 完成后，
`LastTaskResult` 应为 `0`。

## 维护模式与恢复自动启动

以下命令需要管理员 PowerShell。维护前禁用：

```powershell
Disable-ScheduledTask -TaskName 'Start_JanVim_Exhibition'
```

维护完成后恢复：

```powershell
Enable-ScheduledTask -TaskName 'Start_JanVim_Exhibition'
```

修改状态后必须再次执行只读查询，确认新任务与旧任务没有同时启用。

## 回退到旧《见山》自动启动

只有明确需要恢复旧单独《见山》时，才在管理员 PowerShell 中执行：

```powershell
Disable-ScheduledTask -TaskName 'Start_JanVim_Exhibition'
Enable-ScheduledTask -TaskName 'Start_JianShan_Boid'
```

恢复 JanVim 三屏时执行相反操作。任一时刻只允许其中一个任务启用。不要删除任务；原始和
迁移后 XML 均保存在：

```text
D:\github\exhibition-mini-pc-receipt-20260907\scheduled-task-20260908
```

## 已执行验证

2026-09-08 已手动触发新任务进行冒烟测试：约 17 秒内建立活动会话，三屏及《见山》无边框
全屏正常出现；随后在相同权限级别通过唯一 `STOP SHOW` 正常关闭。最终任务状态为 Ready，
`LastTaskResult=0`，部署进程、57140/57141 监听端口及活动指针均为 0。

该测试不替代真正的“重启 Windows → 登录 → 等待 30 秒”验收。下次计划停机窗口应完成一次
真实重启观察，并把结果追加到同一证据目录。

