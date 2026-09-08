# 小主机自动开演计划任务

本页记录 PELADN WO4 当前的主机级启动配置。计划任务属于 Windows 外部状态，不由部署 ZIP
自动创建。

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
当前用户声卡及可选相机交互需要交互式桌面，因此登录触发是正确语义。

## 日常开机

1. Windows 登录 `hxj` 后不要手动再次运行 `Start-Exhibition.ps1`。
2. 等待 30 秒触发计划任务；随后立即校验并启动，没有额外固定等待。冷启动读取可能明显慢于再次运行。
3. 应自动出现 JanVim、叙事页和 `SCREEN-3` 的《见山》无边框全屏。
4. 计划任务启动入口会先执行部署验证；验证失败时不会继续开启半套展演。
5. 正常关闭仍使用 B 屏 `STOP SHOW`，也可按一次 `Ctrl+Shift+S`；B 屏出现黄色退出提示即表示请求已受理，请等待当前循环到复位边界，不要重复操作。
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

若窗口自行退出且未开演，先记录 `LastRunTime` 和 `LastTaskResult`。修复候选会在校验前创建
`D:\VirtualData\JanVim-Exhibition-Rehearsals\deployment-<时间>-<编号>`，其中：

- `startup.json`：本次启动时间和校验时限。
- `verification-progress.jsonl`：每项校验的开始或完成及累计毫秒数，最多 32 条；超时前的记录仍保留。
- `verification-Stdout.txt`、`verification-Stderr.txt`：校验退出后保存的输出，各最多 32,768 字符。
- `startup-failure.txt`：失败原因。仅有目录不表示已经开演或验收通过。
- `display-resolution-Stdout.txt`、`display-resolution-Stderr.txt`：无窗口解析结果和有限诊断。
- `display-map.json`：本次运行实际采用的三屏映射，不覆盖技术人员保存的配置。

完整校验最多 240 秒，包清单单项最多 120 秒；这是失败截止时间，不是每次必须等待的时间。
校验失败仍停止启动，不自动重试，文件身份、音频端点和三屏映射继续严格检查。
相机属于可选交互：未连接或 PnP 枚举不可用时记录情况并继续；《见山》沿用已有的自动展示降级。

包校验通过后，启动器用最多 20 秒读取当前显示拓扑，不打开配置器。Windows 需有至少三台
显示设备，且处于扩展模式（桌面区域不重叠）。有效人工映射中的三个 ID 都仍存在时，沿用其
角色分配，并记录当前分辨率、工作区和缩放；显示名称变化不影响匹配。
没有人工配置、配置损坏或原设备 ID 不适用时，按桌面位置从左到右、同列从上到下，依次
分配 JanVim、叙事画面和《见山》。超过三台时选择这个顺序的前三台，其余保持未分配。
本次映射只写入新运行目录，包含当前拓扑与哈希；不会覆盖 `site-config/display-map.json`。
技术人员仅在实测发现画面对应错误时，正常 Stop 后手动打开桌面“展览显示配置器”修正。
少于三台、复制模式、解析期间或运行中拓扑变化仍停止启动或运行，并保存诊断。

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

14:57 用户真实重启后，任务于 14:58:21 触发，结果为 1，没有创建展演目录，真实重启验收失败。
旧入口只给整套验证 60 秒，且缓存输出、不保存启动前失败。相同任务身份的只读诊断第一次
耗时 43.7 秒、第二次 5.8 秒；首次失败的原始错误未留存，因此冷启动超时为有证据支持的推断。

修复候选解决嵌套时限冲突并保存逐项进度；黄金 ZIP 和标签不变。修复后的真实
“重启 Windows → 登录 → 等待 30 秒 → 三屏与可听声音 → 正常 Stop”仍须现场复验。

21:00 工作室续测：20:40:11 的登录任务同样返回 1，未进入建立场次的阶段。原部署验证器
只读实测于 61.794 秒以 `deployment-probe-timeout` 退出，当时子进程正在读取包清单。
紧接着直接清单校验耗时 40.631 秒通过，9,136 个固定文件身份仍匹配。当前没有连接相机。
本轮据此修复时限、有限诊断和可选相机，并加入默认扩展三屏分配；安装及重启结果另见接收回执。

首个修复候选的手动任务预检和显示解析已通过，随后暴露声音端口初次绑定的竞态：Windows
对暂未存在的 UDP 端口抛出明确的 ObjectNotFound，被旧辅助脚本当成一般查询失败。
后续候选仅将这一精确结果交回已有的有界等待，保持错误所有者、权限及其他系统异常的拒绝。
单次归属检查仍最多 3 秒，声音服务启动仍最多 30 秒，不追加无限重试。
