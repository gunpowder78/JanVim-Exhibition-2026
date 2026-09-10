# 展示版黄金极限 #002

当前安装可为基于 #002 的美术馆现场维护版，实际身份以包内 `evidence/source-identities.json`
为准。维护版增加重启设备 ID 变化时按完整桌面几何恢复人工映射、JanVim 原生最大化，
并将 Ctrl+Shift+S 改为完整退出后关机；STOP SHOW 仍只退出展示。下文的 #002 标签和
归档保持原件，不把维护版新增行为归给旧黄金包。日常操作以本包操作说明为准。

2026-09-09，用户确认完整三屏“画面和整体声音都正常”，授权正式固化为本版本。
声音实现基点为 `b5fbadb43cdcc70b4303b533bcb1a6ead195fea9`；本包完整源码身份以
`evidence/source-identities.json` 为准，包与 ZIP 的身份以外部 `deployment-handoff.json` 为准。
本地冻结标签为 `exhibition-golden-limit-002-2026-09-09`，不覆盖任何旧标签。

## 本版固定行为

- 沿用字速和 90 秒循环。电贝司、原拨弦、寻台和地音随真实文字光标起音，停写仅保留自然尾音。
- 正式启动入口显式选择 `StoneAndSignalV2`；保留已认可音色、稀疏点缀、8 节点上限和统一淡出。
- 《见山》沿用原 EXE：9,799,168 字节，SHA-256
  `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`。
  黑底白鸟、第三屏无边框全屏及独立 Wind 通路保持原样。
- 用户最后保存的混音面板值为 Wind `+6 dB`、Instrument `-2 dB`。
  这是面板值；新音色内部保留已认可的 2 倍线性增益及既有上限。Windows 主音量不由脚本改动。
- 正式启动、应急桌面快捷方式和登录后 30 秒计划任务继续使用固定部署路径。

正常启动和关闭见 `EXHIBITION-OPERATOR-RUNBOOK.md`。本包的配置快照在
`docs/golden-002-site/`：`sound-mix-v1.json` 为最终混音，
`saved-hall-display-map.json` 为保留的展厅人工映射，
`studio-acceptance-display-map.json` 为本轮工作室实际映射。不要把工作室映射自动覆盖到展厅；
启动器继续按当前设备选择有效人工映射或默认扩展屏顺序。

## 归档与回退

完整 ZIP、包清单、源码身份、现场配置及验收回执归档到：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\golden-baselines\exhibition-golden-limit-002-20260909
C:\Users\hxj\Documents\JanVim-Exhibition-Baselines\exhibition-golden-limit-002-20260909
```

两份位置均在本机，不代表异机灾难备份。旧部署整体改名保留，精确路径写在 #002 的
`golden-baseline.json`。旧黄金 ZIP 与标签继续保留。回退必须先正常停止、保存当前目录，
再整体恢复旧包；不零散覆盖，不恢复与当前显示设备不符的映射。

## 验收边界

本次工作室三屏联调记录了 4 个完成循环、0 重试、0 恢复，累计可见漂移约 45.51 ms。
声音运行约 485.55 秒，`clean=true / reason=requested`；用户确认整体画面与声音正常，
此前同一声音实现的联合试听已确认淡出后无复响。实际物理投影、断网和强制重启验收
仍需另外记录；当前批准不能写成这些项目已通过。自动门禁的实测结果见 #002 归档回执。

---

# 历史：小主机展览保底黄金基线

状态：本机三屏有人值守验收通过；冻结为后续少量效果修改的回退点。

本页记录此前冻结的黄金包。新增登录启动修复候选的身份以其 `deployment-handoff.json` 和
`evidence/source-identities.json` 为准，不能把本页的历史人工验收直接归给新候选。

## Git 身份

- JanVim 展演控制器标签：`exhibition-mini-pc-golden-2026-09-08`
- 《见山》协同标签：`exhibition-mini-pc-golden-2026-09-08`
- JanVim 候选 6 的运行功能提交：`8f1ed4d2fcdd93e0d43d14a4fa92bcfe1c307744`
- 《见山》小主机接收提交：`6d1a4577a9484092fde94308352c80ee710ed18f`

标签由注释记录最终目标提交和部署包身份。JanVim 的黄金部署包从 JanVim 标签指向的提交
构建；《见山》标签记录协同接收点，现场实际运行身份仍以冻结 EXE 的字节数和 SHA-256 为准。

## 已人工确认的运行身份

- 《见山》EXE：9,799,168 bytes，SHA-256
  `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`
- JanVim 固定 core：18,869,248 bytes，SHA-256
  `3fc76259677185c619db2a76e302b9588df0bdd3e58600ed30a5ea08b4194f54`
- 控制器 Electron bundle：549,304 bytes，SHA-256
  `77408bde85dc374ba21d011cecb088278197ae6c7785f205a58bc7130bdc8826`
- Realtek 输出：`Windows WASAPI : Speakers (Realtek High Definition Audio)`，48 kHz，双声道。

人工确认包括：显示和相机正常；实际听见拨弦与风声；正常 Stop 平滑淡出且没有复响；
《见山》在 `SCREEN-3` 无标题栏、无任务栏且无需按 F 即全屏。机器记录包括三个连续
90 秒显示器模拟循环、正常退出、无残留进程/端口/活动指针，以及 1,289/1,289 自动测试通过。

最终黄金 ZIP、manifest、handoff 和标签目标 SHA 记录在外部命名目录：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\golden-baselines\exhibition-mini-pc-2026-09-08
```

使用黄金包前必须以该目录的 `golden-baseline.json` 和 `deployment-handoff.json` 核对
字节数与 SHA-256。不要仅凭文件名判断身份。

PELADN WO4 的 `Start_JanVim_Exhibition` 登录计划任务是主机外部配置，不改变黄金包身份；
其动作、原任务回退 XML 和冒烟测试见 `AUTOSTART-TASK.md` 及接收证据目录。

## 后续效果修改规则

1. 黄金标签和黄金目录保持只读，不在其上继续提交或零散改文件。
2. 效果修改从黄金标签另建分支；一次只做一个小效果，保留关闭开关或直接回退路径。
3. 不改变冻结源诗、媒体、JanVim artifact、《见山》EXE、显示所有权、声音安全边界和
   Stop 终态，除非另开明确验收任务。
4. 每个效果候选重新运行适用测试、构建独立包并使用新目录；不得覆盖黄金包。
5. 效果候选只有在人工复验后才能成为新候选；失败时按操作说明整体切回本黄金包。

## 尚未覆盖

当前黄金结论限于小主机三台显示器的有人值守验收。物理双投影、离线运行、强制恢复、
热插拔自愈、HP 性能及 7×24 小时无人值守没有在本基线中宣称通过。
