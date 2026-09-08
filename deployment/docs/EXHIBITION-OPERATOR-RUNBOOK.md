# 小主机展览启动、运行与关闭操作说明

适用对象：现场值守人员和技术人员。适用主机：PELADN WO4。固定部署目录：
`D:\github\JanVim-Exhibition-Deploy`。

日常开演只使用固定部署目录中的 `operator` 脚本，不从源码工作树、旧保留目录或 ZIP
内部直接启动。当前保底的完整身份见同目录 `GOLDEN-BASELINE.md` 及外部黄金基线回执。

## 一、开机后检查

1. 确认三台显示设备均通电，Windows 使用“扩展这些显示器”。
2. 确认相机已连接且无遮挡，没有其他软件占用相机。
3. 确认有线音箱或耳机接在小主机 Realtek 输出。现场输出端点必须为
   `Speakers (Realtek High Definition Audio)`；不要改用电视 HDMI，也不要安装 ASIO。
4. 初次试听时先把 Windows 音量调低，再由现场人员逐步确认安全响度。不要用脚本改变
   Windows 默认输出或系统音量。
5. 确认没有上一场仍在运行。不要同时打开两次启动命令。

若更换了显示接口、投影仪、缩放比例或屏幕排列，先由技术人员重新配置：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Configure-Displays.ps1'
```

在配置器中把 JanVim、叙事页和《见山》依次保存为 `SCREEN-1`、`SCREEN-2`、
`SCREEN-3`。日常开机且接线未变时不需要重复配置。

## 二、开演前验证

打开 PowerShell 7，执行：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Verify-Deployment.ps1'
```

只有最后出现下面一行才可继续：

```text
DEPLOYMENT_VERIFY_PASS
```

验证失败时不要继续启动。记录表格中失败的那一行及终端诊断，按
`TROUBLESHOOTING.md` 处理。验证只读取部署包、运行状态、声卡、相机和显示映射，
不会打开展演画面或播放声音。

## 三、启动

在 PowerShell 7 执行：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1'
```

命令启动后保持这个 PowerShell 窗口开启，不要再次执行启动命令，也不要点击旧的
`Start Rehearsal`。系统会依次启动声音、《见山》和展演控制器。

正常启动应满足：

- `SCREEN-1` 显示 JanVim，并按唯一展演时钟执行编辑回写。
- `SCREEN-2` 显示叙事页和声音控制，页面上可见 `STOP SHOW`。
- `SCREEN-3` 显示黑底白鸟的《见山》，自动无边框全屏、无标题栏、无任务栏；无需按 F。
- 鼠标移入《见山》后仍可显示和点击；相机手势影响鸟群并产生风声。
- JanVim 的真实光标动作产生拨弦声，鸟群产生风声。

若任一画面位置错误、《见山》出现标题栏或任务栏、没有声音，使用下文的正常关闭，
记录现象后重新验证。不要拖动《见山》窗口，不要按 F 临时掩盖问题。

## 四、运行中值守

1. 工作人员必须在场。单场最长 3,600 秒，到时正常关闭并开新场。
2. 观察三个画面持续更新；《见山》应保持在 `SCREEN-3` 无边框全屏。
3. 确认拨弦和风声都可听见，音量舒适且没有持续爆音。
4. 不修改源诗、媒体、TOML、部署文件或用户 Neovim 配置。
5. 不拔插显示器、相机或声卡。必须换线时，先正常关闭。
6. 不关闭启动命令所在的 PowerShell 窗口，不用任务管理器按进程名批量结束程序。

## 五、正常关闭

首选在 `SCREEN-2` 点击一次 `STOP SHOW`。也可按一次 `Ctrl+Shift+S`。

点击或按键后：

1. 不要重复点击，等待声音平滑淡出。
2. 等待最多 45 秒，让 JanVim、《见山》、声音和控制器按身份依次退出。
3. 启动命令的 PowerShell 最终应返回提示符，并显示 `exhibition-complete`、
   `showExitCode: 0` 和 `soundClean: true` 对应的完成信息。
4. 确认淡出后没有复响，三个展演画面均已关闭。

准备下一场时，重新执行“开演前验证”，看到 `DEPLOYMENT_VERIFY_PASS` 后再启动。

## 六、正常 Stop 不可用

若 `STOP SHOW` 和 `Ctrl+Shift+S` 均不可用，打开第二个 PowerShell 7 窗口，执行技术后备停止：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Stop-Exhibition.ps1'
```

该脚本只处理当前活动回执中身份完全匹配的本场进程。技术后备停止可能让第一个启动命令
报告非零清理诊断，因此它不算一次正常 Stop 验收。停止后运行验证脚本；只有重新出现
`DEPLOYMENT_VERIFY_PASS` 才能开下一场。

若后备停止失败或验证仍失败：

1. 保存终端最后一条诊断，不删除任何运行目录或回执。
2. 正常重启 Windows。
3. 重启后先运行后备停止脚本，再运行验证脚本。
4. 验证通过后才重新开演。

禁止手工删除 `active-deployment.json`、lease、token、descriptor、缓存或日志；禁止按
`electron`、`pwsh`、`node`、`jianshan`、`sclang` 或 `scsynth` 等进程名批量终止。

## 七、黄金基线回退

黄金基线只由技术人员切换。当前场必须已停止，活动指针、展演端口和部署进程都已清理。
新效果候选出现问题时：

1. 保留候选目录和证据，不覆盖或删除。
2. 将固定部署目录整体改名保存。
3. 从命名的黄金基线 ZIP 解压到新的 `D:\github\JanVim-Exhibition-Deploy`。
4. 用黄金基线目录中的 `deployment-handoff.json` 对照 ZIP SHA-256。
5. 执行 `Verify-Deployment.ps1 -HandoffReceiptPath <黄金回执绝对路径>`。
6. 看到 `DEPLOYMENT_VERIFY_PASS` 后按本说明重新启动。

不要把效果候选的文件零散复制进黄金目录。完整黄金身份、Git 标签、包哈希和验收边界见
`GOLDEN-BASELINE.md`。

## 八、当前验收边界

本机已确认三屏显示、相机、Realtek 可听拨弦与风声、正常 Stop 淡出无复响，以及《见山》
无需按 F 的无边框全屏。当前记录仍是显示器模拟；物理双投影、离线运行和强制恢复需另行
排练。在这些项目完成前，不把本说明中的本机结果写成物理展场验收通过。

