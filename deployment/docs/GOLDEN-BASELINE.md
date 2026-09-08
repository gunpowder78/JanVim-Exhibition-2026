# 小主机展览保底黄金基线

状态：本机三屏有人值守验收通过；冻结为后续少量效果修改的回退点。

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

