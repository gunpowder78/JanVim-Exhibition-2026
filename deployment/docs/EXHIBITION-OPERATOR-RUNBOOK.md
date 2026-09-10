# 小主机展览启动、运行与关闭操作说明

当前版本：**#002 的美术馆现场维护版**（屏序持久化、JanVim 最大化、快捷键退出后关机）。
原始黄金 #002 保留为回退点；当前源码身份以 `evidence/source-identities.json` 为准。
电贝司、拨弦、寻台和地音跟随文字回写；
停写后只保留尾音。2026-09-10 读取的现场活动混音为 Wind `+6 dB`、Instrument `-6 dB`。
启动时沿用外部保存值；包内 9 月 9 日较早的混音快照仅供历史核对。
无需在启动命令中增加声音参数，正式入口已固定该版本。

适用对象：现场值守人员和技术人员。适用主机：PELADN WO4。固定部署目录：
`D:\github\JanVim-Exhibition-Deploy`。

日常开演只使用固定部署目录中的 `operator` 脚本，不从源码工作树、旧保留目录或 ZIP
内部直接启动。此前黄金保底身份见同目录 `GOLDEN-BASELINE.md` 及外部黄金基线回执；
当前安装身份以本包 `evidence/source-identities.json` 与对应 `deployment-handoff.json` 为准。
本机已配置登录后自动开演，主机级计划任务说明见 `AUTOSTART-TASK.md`。

## 一、开机后检查

1. 确认至少三台显示设备均通电，Windows 使用“扩展这些显示器”。
2. 相机可接可不接；需要交互时再确认相机已连接、无遮挡且未被其他软件占用。无相机时自动展示继续。
3. 确认有线音箱或耳机接在小主机 Realtek 输出。现场输出端点必须为
   `Speakers (Realtek High Definition Audio)`；不要改用电视 HDMI，也不要安装 ASIO。
4. 初次试听时先把 Windows 音量调低，再由现场人员逐步确认安全响度。不要用脚本改变
   Windows 默认输出或系统音量。
5. 确认没有上一场仍在运行。不要同时打开两次启动命令。

当前小主机登录 `hxj` 后，计划任务 `Start_JanVim_Exhibition` 会沿用原设置延时 30 秒并自动
执行固定部署目录的启动入口。自动开演时不要再手工执行启动命令；入口会先完成同样的部署验证。
若本次登录用于维护，应在关机或注销前由管理员禁用任务，详见 `AUTOSTART-TASK.md`。

有适用的人工映射时自动沿用。Windows 重启改变或重新分配设备 ID，但全部屏幕的桌面
位置、分辨率、缩放与旋转仍完全匹配时，按已保存的位置关系恢复人工角色；不修改原映射。
技术人员若主动调整了 Windows 布局或物理接线，需重新确认画面并按需保存新映射。
本次美术馆配置备份在包内 `docs/hall-site-2026-09-09/`，仅供恢复核对，不自动覆盖活动配置。
没有配置或配置不适用于当前设备时，按桌面位置从左到右
（同列从上到下）在前三台屏幕依次显示 JanVim、叙事页和《见山》，不要求先运行配置器。
显示设备名称变化不影响测试。只有技术人员实测发现映射错误时，正常 Stop 后手动运行：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Configure-Displays.ps1'
```

在配置器中把 JanVim、叙事页和《见山》依次保存为 `SCREEN-1`、`SCREEN-2`、
`SCREEN-3`。日常开机且接线未变时不需要重复配置。

## 二、开演前验证

打开 PowerShell 7，执行：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Verify-Deployment.ps1' -DeferDisplayMapping
```

只有最后出现下面一行才可继续：

```text
DEPLOYMENT_VERIFY_PASS
```

验证失败时不要继续启动。记录表格中失败的那一行及终端诊断，按
`TROUBLESHOOTING.md` 处理。验证只读取部署包、运行状态、声卡、相机和显示映射，
不会打开展演画面或播放声音。此命令把映射解析留给启动器，允许没有人工映射配置；
`DEPLOYMENT_VERIFY_PASS` 仅代表部署预检，不等于显示映射或现场验收通过。

## 三、启动

在 PowerShell 7 执行：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-Deploy\operator\Start-Exhibition.ps1'
```

命令启动后保持这个 PowerShell 窗口开启，不要再次执行启动命令，也不要点击旧的
`Start Rehearsal`。系统会依次启动声音、《见山》和展演控制器。

校验阶段会显示本次证据目录。冷启动可能比再次启动慢；完整校验最多 4 分钟，完成后立即继续。
若窗口自行退出且没有画面，保留目录中的 `verification-progress.jsonl` 和 `startup-failure.txt`，
按 `AUTOSTART-TASK.md` 查看任务结果。不要把证据目录存在当作展演已启动。

正常启动应满足：

- `SCREEN-1` 显示原生最大化的 JanVim，并按唯一展演时钟执行编辑回写。
- `SCREEN-2` 显示叙事页和声音控制，页面上可见 `STOP SHOW`。
- `SCREEN-3` 显示黑底白鸟的《见山》，自动无边框全屏、无标题栏、无任务栏；无需按 F。
- 鼠标进入或移动到叙事页后显示，移动后再次显示。若静止 20 秒后仍未隐藏，把指针移到
  叙事页空白处单击一次即可隐藏，不要点击控制按钮。
- JanVim 的真实光标动作产生拨弦声，鸟群产生风声。

若任一画面位置错误、《见山》出现标题栏或任务栏、没有声音，使用下文的正常关闭，
记录现象后重新验证。不要拖动《见山》窗口，不要按 F 临时掩盖问题。

## 四、运行中值守

1. 正式展演按原 90 秒循环持续运行，没有一小时自动结束；闭馆时由工作人员人工停止。
2. 观察三个画面持续更新；《见山》应保持在 `SCREEN-3` 无边框全屏。
3. 确认拨弦和风声都可听见，音量舒适且没有持续爆音。
4. 不修改源诗、媒体、TOML、部署文件或用户 Neovim 配置。
5. 不拔插显示器、相机或声卡。必须换线时，先正常关闭。
6. 不关闭启动命令所在的 PowerShell 窗口，不用任务管理器按进程名批量结束程序。

## 五、正常关闭

**只退出展示、保留 Windows 运行：**在 `SCREEN-2` 点击一次 `STOP SHOW`。

**退出展示后关闭小主机：**按一次 `Ctrl+Shift+S`。这两个入口已区分，请勿混用。

点击或按键后：

1. B 屏中央应立即显示两行黄色提示：“三屏演示正在退出，”和“请等待...”。
2. 不要重复点击或按键。停止请求会等当前 90 秒循环到复位边界，再让声音平滑淡出；随后 JanVim、《见山》、声音和控制器按身份依次退出。
3. 点击 STOP SHOW 时，启动命令的 PowerShell 最终应返回提示符，并显示 `exhibition-complete`、
   `showExitCode: 0` 和 `soundClean: true` 对应的完成信息。
4. 黄色提示应保持到 B 屏关闭；确认淡出后没有复响，三个展演画面均已关闭。
5. 快捷键路径在以上步骤及《见山》、声音服务清理成功后请求 Windows 正常关机。
   错误退出和清理失败不自动关机；不要直接断电。

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
