# 《见山》× JanVim 鸟群入口 v1 候选交接

> 2026-09-06 值守要求更新：用户接受工作人员人工重启后重新开演，不追加无人值守等级保障。
> [有人值守边界与新目录恢复原则](2026-09-06-attended-exhibition-scope.md) 为当前工程优先级；
> 2026-09-05 的测试计数和失败记录作为历史证据保留；最新局部修复结果见紧接的 2026-09-06 小节。
> 当前只推进隔离候选与受控联调，不解除真实声音/图形/整机重启验收，也不宣称应用全量门禁通过。

## 2026-09-06：有人值守范围的最新修复与验证

本次只改声音服务的局部启动检查：启动时的端口所有权检查等待从 1.5 秒改为 3.0 秒，
清理阶段仍为 1.5 秒，总启动期限仍为 30 秒。身份、端口、Stop、淡出、合成音色和冻结协议未改。
失败时增加有限字段的诊断记录，区分检查程序返回失败与等待超时，不记录 token。
旧偶发失败的历史原因仍不能确定；本次不把它追溯宣称为已定位或永久消除。

最新证据均位于上述候选的外部门禁目录
`D:/VirtualData/JanVim-Exhibition-Rehearsals/flock-v1-gates-20260905-a2d9b87/`：

- 聚焦失败测试 1/4 → 修复后 4/4；启动/生命周期 30/30。
- 完整声音回归 **149/149，exit 0**，无跳过、超时或日志截断。
  回执：`attended-sc-final-sound.result.json`。
- 两次真实 sclang/scsynth 静音启动、统一停止，采用不同的新运行目录，均 `clean:true`。
  回执：`attended-sc-actual-start-stop-1.result.json`、`attended-sc-actual-relaunch-2.result.json`。
- 未改动的租约与声音目录 API 在三个新进程/新目录中验证通过：保留第一次遗留记录，
  不妨碍后两次初始发布、结算清理；旧记录哈希不变。回执：`attended-lease-fresh-process-a.result.json`。
  **这是部件验证，不是整机重启或图形 Show 验收。**

完整声音回归后，新增测试仅补显式 Node 内置模块导入，未改测试断言或生产逻辑；
诊断脚本也仅补导入及注释。最终静态检查见 `attended-final-lint.result.json`。
运行测试时的源码快照与最终导入差异保留在实施回执中，不用新哈希覆盖旧测试证据。
里程碑提交前另行复核最终测试文件：`milestone-startup-check.result.json` 为 4/4、exit 0，
`milestone-lint.result.json` 为完整静态检查 exit 0；均未超时或截断。未重复运行应用全量门禁。

生产变化仅 `sound/service.scd`，SHA-256：
`e7a204b8fe3e16aecc398292e128d4f474d5e2341f57b47b1d70558f346b9168`。
Electron bundle 未重建、仍为 540860 字节，SHA-256：
`2a166eff47428efe3759b07c26cddcc92b615a4b1bf61d440e6674d8baa97f70`。
artifact lock、控制器、内容及两个展览保底标签未改。2026-09-06 用户已授权将当前成果
提交并推送到独立 `feat/sound-flock-ingress-v1` 分支作为候选里程碑；不合并主分支，
不创建发布、不替换保底。具体提交和远程状态以 Git 核对结果为准。

**后续边界：**按有人值守方式进入受控联调；不额外建设无人值守恢复。
独立审查已同意当前限定范围的规格与代码质量，未发现新增严重/重要问题；
原有非阻塞诊断改进继续后置，不为此追加开发。该结论不是合并或发布批准。
应用全量历史结果仍为 **1126/1128、NOT PASS**，原地租约替换问题后置，不伪装为通过。
真实《见山》GPU 生产端、硬件听感、实际图形展演及人工重启后的恢复仍待联合验证；
冻结 v1 的一小时联调上限未解除，不能当作全天声音版本。

## 2026-09-05 历史候选状态（保留原始记录）

2026-09-05。本地候选：`D:/github/JanVim-Exhibition-2026/.worktrees/sound-flock-ingress-v1`，
分支 `feat/sound-flock-ingress-v1`，来自真实光标候选
`93ce7b6f9667c1f32e4faada1d5f45130cbe224c`。
候选源码提交 `ce8c4aec9484f66c0ac321996b0950945162a43e`；Task 4 含测试/交接以及父控制器明确授权的
`run.mjs` 启动祖先遍历边界修复和 `flock-protocol.mjs` 单行 lint 注释（解析语义不变）。
上述生产源码及原测试已本地提交；本轮仅修正集成测试的截止时间 oracle，生产源码不变。
本轮测试/交接修正由父控制器另行提交；新 oracle 的证据单独列出，不替换原始门禁记录。
声音全量 140/140 通过，应用全量仍为 1126/1128；这是未完成整体验收的候选，不是发布版本。
当前不推送、不合并、不替换保底；整分支集成审查等待应用门禁问题处理。

## 当次入口与停止

默认关闭鸟群入口。操作员使用 PowerShell 7 从这个候选启动无声联调：

```powershell
pwsh -NoProfile -File 'D:/github/JanVim-Exhibition-2026/.worktrees/sound-flock-ingress-v1/sound/start-sound.ps1' -Input RealCursor -FlockIngress -Duration 65
```

等价的实际 Node 调用（`run.mjs` 本身运行 supervisor，不带字面量 `supervisor` 子命令）：

```powershell
& 'C:/Users/hxj/AppData/Local/hermes/node/node.exe' 'D:/github/JanVim-Exhibition-2026/.worktrees/sound-flock-ingress-v1/sound/run.mjs' --mode silent --duration 65 --input real-cursor --flock-input enabled
```

只采用这个启动进程输出的 `SOUND_RUN_READY` 中的**当次** `runRoot`。
同目录 `ready.json.runRoot` 应一致。向见山明确传递
`<该 runRoot>/flock-input.json` 的完整本机路径；不要扫描“最新目录”、复用旧运行目录，
或复制其他工作树中硬编码旧根目录的 `.operator/real-cursor-sound.ps1`。
Show 使用同一次 `runRoot` 绑定既有 `-SoundRunRoot` 入口；只有 Show 的有效非 idle 心跳才能授权风声。

私有描述文件字段严格为 `version:1, active:boolean, host:"127.0.0.1", port:int[1,65535],
protocol:"jianshan-flock-ndjson-v1", token:string`。token 是独立的 64 个小写十六进制字符，
不是 Show token；sourceId 是 32 个小写十六进制字符。只读明确指定、active=true 的当次普通文件。
双方共享备忘、日志、截图和回函均不包含 token；这里不生成任何凭证。

成功 ACK：`{"version":1,"ok":true,"input":"jianshan-flock-ndjson-v1"}`。
拒绝 ACK：`{"version":1,"ok":false,"reason":"rejected"}` 后关闭。
每运行一个鸟群 owner，即使断线也不能换 owner；与 Show owner 分开。
结束后描述文件 active=false，历史证据路径不能用于新的连接。

提前停止命令明确指向本候选，粘贴上述当次 READY 的 runRoot：

```powershell
pwsh -NoProfile -File 'D:/github/JanVim-Exhibition-2026/.worktrees/sound-flock-ingress-v1/sound/stop-sound.ps1' -RunRoot (Read-Host 'Paste the CURRENT runRoot from SOUND_RUN_READY')
```

`STOP_REQUESTED` 仅表示接收请求；继续核对 `SOUND_RUN_COMPLETE` 及 `summary.json.clean:true`。
empty、unavailable、原期限到期、鸟群断线仅将 wind gate 关闭，沿用 0.3 秒 release，拨弦继续。
合法新 sample 可以从临时 mute 恢复；断线不能替换 owner。
Show Stop、2 秒 Show 租约失效或其他全局终止条件保留 1.5 秒整体淡出与终止锁；
晚到帧、新 epoch、回调均不能复响。鸟群数据不能续 Show 租约或发 Stop。

## 验证与证据

Task 4 修复后完整声音 **140/140、exit 0**，完整 lint exit 0；全局应用门禁 **NOT PASS**。
先前聚焦 SC 3/4 的独立所有权检查失败仍保留为关切，不声称所有启动问题已消失。
其后 review Important 1 确认测试等待器可能把 350ms 后的结果算作及时 mute；本轮仅修测试。
实际 shared `until` 现在在 await read 后重新检查期限，empty/unavailable 的绝对单调期限
在失效调用前锚定，仍是 350ms，不能用自然 500ms 到期冒充显式 mute。
本轮确定性 RED 1/5（4 个正确暴露的假通过）→GREEN 5/5；唯一完整 chain 文件运行 **7/7**，
两项 synthetic 实际 PCM 加五项确定性边界检查。旧 140/140 是原生产运行记录，不是新 oracle 的全量重跑。
测试入口：`sound/tests/flock-chain.check.mjs`。它使用明确标记的 **synthetic Show/flock producers**，
经过真实 supervisor → TCP listener → 唯一 sender → SC policy/synth → 内部 PCM capture。
没有硬件输出节点。风声、独立 mute 后的新拨弦、mute 后的零 PCM、Stop 前非零和淡出后静音
分别测量；只采用 capture 已记录且早于声部清理的区间，不采用分配缓冲区的尾部补零。
波形窗口以真实 Stop frame 锚定，内部留 150ms 余量吸收 marker/IPC 观察粒度；
不把 Windows 调度下的波形窗口当作 500ms 边界的精密计时证据。

可复核的已完成运行（均已停止，描述文件 active=false，仅作证据，不能复用连接）：

- 本轮严格 oracle 主链成功证据：`D:/VirtualData/JanVim-Exhibition-Rehearsals/sound-20260905T154708492Z-bc3116153913/`。
  实际 READY runRoot 是该路径下的 `run`；完整私有描述文件路径是
  `D:/VirtualData/JanVim-Exhibition-Rehearsals/sound-20260905T154708492Z-bc3116153913/run/flock-input.json`。
- 本轮严格 oracle 断连成功证据：`D:/VirtualData/JanVim-Exhibition-Rehearsals/sound-20260905T154742874Z-dbf23e213d88/`。
  对应 `run/ready.json` 与 `run/flock-input.json` 均由这次实际 supervisor 生成。
- 两处根目录的 `flock-chain-proof.json` 包含每个窗口、实际 node 观察、policy counters、capture/source SHA；
  `run/capture.wav` 是内部录音。主链四种 mute 与断连后的 mute peak/rms 均为 0，
  wind-only/cursor-only 各窗口非零，两次 recorded postStop peak/rms 均为 0。
  两次最大观察到 1 个 wind，T2 flap 检查另外实际覆盖 2 个活跃/释放节点。

新回执：`task4-fix1-oracle-red`、`task4-fix1-oracle-green`、`task4-fix1-chain`、
`task4-fix1-format-green-lint`，均在下述门禁根。主链 empty/unavailable 首次观察 gate=0 距失效
分别 49.1663ms / 49.9463ms；严格 post-await 判据亦须 <350ms。
SC 实际测试源码 SHA `ce205e9caf21057f169618da9053b212c703e46d3bf0be290e500db7d09a5f97`，
留档 `task4-fix1-chain-source.mjs`。随后 lint 仅将提取 regex 的八个字面空格等价改成 ` {8}`；
最终测试 SHA `6ebcb471f76ecec477401b1c7d22012aa1abef2b86ad76fb5787c43f93b07be0`，
确定性 5/5 和修改文件 lint 再过；没有重跑 SC 或改写原 proof。差异与源码审计见 `task4-fix1-audit`。

门禁回执根：`D:/VirtualData/JanVim-Exhibition-Rehearsals/flock-v1-gates-20260905-a2d9b87/`。
历史失败保留：初次断连读取部分 READY JSON（已作有界测试修复）；首轮完整声音 **119/123、4 失败**，
原样串行诊断 2/4；首轮 lint 因严格 JSON 字符串的原始控制字符排除 regex 报错。
三项实际启动失败均为身份检查 `pwsh.exe timed out`，在发布 run READY/创建 sender 前发生；
另一个 forced-cleanup 缺少 COMPLETE，其旧 12s 总守卫可能抢先终止清理，但原始 timeout 标志未留存，
该次因果仍是时间戳/源码推断。详见 `final-sound`、`task4-sound-failed-checks-diagnostic`、`final-lint` 回执。

最新修复状态：父控制器授权后，真实生产生成的 PowerShell 在有界假 CIM 图上先 RED（15/16），
在已知 service host 停止遍历后 GREEN；保留独立新查询、全部准入判据、32 深度及 5000ms 上限。
连同 cleanup oracle 共 17/17；解析器 34/34、修改文件 lint 通过。
forced-cleanup 外层改为 15s 启动+退出守卫，实际 Stop→exit 仍须 <7800ms，必须有 duration/clean:false COMPLETE，
并保留且检查真实 TimedOut/CaptureIncomplete 等结果，不允许被守卫杀死的进程通过。
修复后聚焦 SC **3/4**：T3、实际 Lua、forced-cleanup（7398ms，全部 timeout/capture/truncation 标志 false）通过；
断连在 `sound-20260905T152320072Z-6ffc17af754f/` 的服务启动阶段失败：6.49s `ownershipCheckFailed`，
6.75s `serviceExitBeforeReady`，stderr `ERROR: The process "48032" not found.`。
该次没有 SC READY，未进入修改过的 supervisor 祖先检查，**不同于旧 5000ms pwsh 超时**。
定位为未修改的 SC `inspectEndpoint` / `server-port-owner.ps1` 阶段：1.5s 检查守卫和 helper 异常
都可产生相同拒绝状态；原日志不能进一步区分，未证明驱动/端口外部故障。未降低所有权检查或作额外修复。
随后仅执行一次完整声音 suite；该次原 PCM 记录仍在 Task 4 报告中，本节入口更新为后来严格 oracle 的运行。
该次 `final-sound-postfix` 于 15:34:51 UTC 完成：140/140、exit 0，265824.1586ms，
captureComplete=true、timedOut=false、logLimitHit=false；没有重复全量运行。
最终 forced-cleanup 实测 7455ms，结果保存于
`D:/VirtualData/JanVim-Exhibition-Rehearsals/sound-cleanup-bound-xp3O2W/cleanup-result.json`，
同样完整捕获、无守卫终止且保留所需 COMPLETE。`final-lint-postfix` exit 0。
最终源码/范围/空闲声音端口审计回执：`task4-postfix-final-audit.result.json`；
完整源文件身份：`task4-postfix-identities.stdout.log`。通过的全量运行不抹去前一项间歇启动失败。

父控制器的 npm ci、Electron install、typecheck、build、Lua、verify-runtime 均 exit 0。
首轮完整应用为 1126/1128，通过文件 55/57：显示启动器 5000ms 超时与 run-lease CAS EPERM rename 失败。
同样源码/断言/时限的串行聚焦 34/34 通过；外部文件持有者原因未证实，未声称已修复。
完整应用原选择集的父控制器串行重跑 `final-application-serial` 于 15:22:35 UTC 结束，
exit 1、1126/1128、56/57 文件通过：两个未修改的 run-lease 用例分别为 initial lease
原子替换 5000ms 超时、settled lease 的 EPERM rename（与首轮失败用例不同）。
**全局 application gate 仍为 NOT PASS**；父控制器负责只读诊断及最终应用 blocker，不再跑全量应用。
本任务没有 controller、ACL、文件系统策略修复权限；即使声音 suite 通过也不能解除此 blocker。
应用结束并明确释放 SC 后才开始修复后的声音验证，未与应用全量并行。

三个共同新鲜度用例的具体边界证据保持分层：

| 用例 | 执行路径与判据 |
| --- | --- |
| 收到时已老 490ms，只剩 10ms | T1 实际 `accept/take/admission` 假时钟测试；T3 实际 child sender/localhost UDP，独立进程 timeOrigin，SC expiry 保持原值 11，而不是发送时刻再加 0.5 |
| 排队至 500ms 不转发 | T3 最终 admission 在恰好到期时无 live UDP；T1/SC 假时钟均使用 `>=500` 到期。已有去掉 admission / 续期 mutant 被测试捕获 |
| 已消费目标无新包仍到期 | T1 取走 live 后仍保留到期责任；T2 实际 SC node gate；T3 实际 supervisor/TCP/sender/SC；T4 补 acquired PCM 和持续拨弦证据 |

已有实际 Lua 测试 `sound/tests/real-cursor-chain.check.mjs` 另验 NVIM v0.10.1、
真实 buffer action/Bridge/client、文本哈希/ACK/reset 及声音不可用情况；synthetic PCM 测试不替代它。
修复后完整 suite 的实际 Lua 成功证据在
`D:/VirtualData/JanVim-Exhibition-Rehearsals/sound-chain-production-51831309-768a-4ad9-b23c-4a3dfada9a42/`，
声音不可用对照在 `sound-chain-unavailable-evidence-7d487bb1-7dcd-4bbd-b959-ac40cf2d4f1d/`（同一父目录）。
各 12 ACK/13 actual observations，录得 Stop 前非零、Stop 后 peak/rms=0；不代表应用门禁通过。
冻结的 [v1 生产端协议](2026-09-05-jianshan-sound-ingress-confirmation-v1.md) 未修改。

资源边界：共 8 条连接；1000ms 绝对挂接期限；data 1024 字节、ACK 256 字节（均不含 CR/LF，
只允许多一个待定末尾 CR）；每回调最多 64 帧/64KiB；一个最新状态、每 50ms 最多一次 sample 发布，
一个 sender IPC 请求在途，无历史重放队列。原期限始终为 `R+sampledAtMs+500`，有效年龄 `[0,500)`。
seq/epoch 是正 int32，初始 epoch=1，时间 0..3600000ms；不得倒退、归零或续期。
连续 20 个结构合法但过期帧禁用当次鸟群入口；时钟/计数异常终止入口。
最多 8 个拨弦节点；鸟群模式最多 2 个活跃/释放中的风声节点；传统四参数 SC 模式保留。
运行、capture、日志、清理均保留既有有限上限。

SC stdout 中隔离扩展的 method override 提示及设备枚举是已有启动诊断；它们不表示启声或更改设备。
单独核对 stderr 为空及 clean 结果，不把“通过”写成“所有 stdout 为空”。
T2 flap 测试仅在两个释放节点身份仍占位时断言新 live 被丢弃；每次查询的两节点上限及
每次 mute 后 gate=0 仍无条件检查，产品 0.3 秒 release 没有放宽。

## 身份与尚未验收事项

预期 Electron bundle：540860 字节，SHA-256
`2a166eff47428efe3759b07c26cddcc92b615a4b1bf61d440e6674d8baa97f70`。
JanVim artifact lock 文件 SHA-256：
`9cb5f25c91d8fd7186465de0f90e6ddde8b4a54fadee431d907992a797e54a7c`。
本轮两项实测均匹配。完整最新 source/runtime hash 清单见门禁根 `task4-postfix-identities.stdout.log`
与 Task 4 报告；没有改锁或重钉 bundle。已提交于 `ce8c4ae`、本轮保持不变的生产源码 SHA-256：

- `sound/run.mjs`：`3eab8479b2ead1a722050dd0256533aa7e24818e15e477557a6ae2cef915f10e`
- `sound/flock-protocol.mjs`：`b0bee92e76bff85c453e5b09c956c4184e6aa5d3b182bd4c90fb894cc0f7c5b6`

修复后两项 PCM proof 的实际源码 SHA 与上列一致；最终精确差异审计使用这两个修复后根目录。
修复前证据中的旧 SHA 不能代替上列实际文件身份。

原真实光标 `93ce7b6`、独立声音 `cbde651`、根视觉 `main=95c09d6`，以及
`exhibition-fallback-p0-2026-09-03=ca52571` /
`exhibition-fallback-p0-solid-punctuation-2026-09-03=52dfd25` 保留；后两值是 tag-object ID，非 peeled commit。
没有 JanVim 产品/controller/Lua/内容/profile/显示/设备/HP 变更。

见山实际 CPU/GPU 特征、GPU 回读延迟及 HP 帧耗/长稳由对应团队另验；本报告没有访问或验收其工作树。
人工联合听音、实际双投影连续三轮、离线运行及强制重启恢复仍须现场完成。
联调前操作员手动关闭见山重复风声/内建音频，避免两个声音源叠加；不由本候选自动修改设置。
本轮仅执行无声自动验证，不含 Listen、GUI、HP 部署、推送、合并、发布或保底替换。
