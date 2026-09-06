# Site Mix v2 双仓信息同步报告

**日期：** 2026-09-06（Asia/Shanghai）
**接收方：** JanVim-Exhibition-2026 接手 agent
**状态：** 源码、静音自动验证与本地 v2 试听候选已完成；具身验收待操作员执行

## 1. 本报告的用途

本报告同步《见山》、JanVim 展演控制器与 SuperCollider 声音服务之间的 Site Mix v2 工作，
让接手 agent 能在不读取会话密钥、不覆盖既有保底、不误用旧产物的前提下继续制作候选、核验身份，
最后把必须由现场人员完成的三屏、相机、真实鸟群画面和声音验收交还给操作员。

这里的“完成”仅指源码、非具身验证与本机候选身份。本地 v2 Electron bundle 已静态复核并精确钉住，
新的《见山》EXE 也已放入唯一隔离候选根。以下事项仍未完成，不能在交接时写成已通过：

- 三块物理屏幕上的层级与全屏显示；
- 真实相机、真实鸟群和两条声部的现场试听；
- 第二个全新会话中的跨会话音量继承；
- 现场离线、强制恢复以及连续三轮物理验收。

## 2. 双仓身份与工作区

### JianShan02

- 路径：`D:\github\JianShan02`
- 分支：`feat/flock-ingress-v1`
- HEAD：`d890caa5e9a3077bf1538d83f3695cdb32019d9a`
- 上游：`origin/feat/flock-ingress-v1`
- 远端：`https://github.com/gunpowder78/jianshan02Boid.git`
- 当前 v2 改动尚未提交；因此 HEAD 只表示分支锚点，不表示这些工作树内容已经进入提交。

当前 Site Mix v2 相关改动：

- `jianshan-rust/src/flock_input/protocol.rs`
- `jianshan-rust/src/flock_input/transport.rs`
- `jianshan-rust/src/render/mod.rs`
- `docs/FLOCK_SITE_MIX_V2.md`
- `docs/USER_MANUAL.md`
- `docs/superpowers/specs/2026-09-06-site-sound-mix-design.md`
- `docs/superpowers/plans/2026-09-06-site-sound-mix.md`

冻结的 `docs/FLOCK_INGRESS_V1.md` 与原始 `jianshan-rust/jianshan.toml` 未改。

### JanVim-Exhibition-2026

- 路径：`D:\github\JanVim-Exhibition-2026\.worktrees\sound-flock-ingress-v1`
- 类型：linked worktree，不是 submodule
- 分支：`feat/sound-flock-ingress-v1`
- HEAD：`3293c4ee917e51285687c2aecbf73d25d1407e59`
- 上游：`origin/feat/sound-flock-ingress-v1`
- 关系：本地相对上游 ahead 2
- 远端：`https://github.com/gunpowder78/JanVim-Exhibition-2026.git`
- 当前 v2 改动尚未提交；HEAD 同样不是完整 v2 源码身份。

JanVim 侧变更集中在以下边界：

- 站点混音持久化：`sound/site-mix.mjs`
- 鸟群 v2 协议、supervisor 与 OSC：`sound/flock-protocol.mjs`、`sound/run.mjs`、
  `sound/osc.mjs`
- SuperCollider 独立声部增益：`sound/policy.scd`、`sound/service.scd`、`sound/synths.scd`
- 展演控制器与现有操作条：`apps/controller/src/`
- 副屏操作控件：`apps/secondary-screen/src/`
- 严格 IPC schema：`packages/show-schema/src/`
- 对应的 Node、Vitest、PowerShell 与 SuperCollider 测试
- 本地受审 bundle pin：`scripts/start-show.ps1` 与 `tests/electron-build-smoke.test.ts`
- 操作说明：`sound/README.md` 与
  `docs/operations/2026-09-06-joint-rehearsal-quickstart.md`

以下三个既有未提交文件属于操作员或前序工作，必须原样保护，不能回退、重写或顺手格式化：

- `content/fixture/show.manifest.json`（当前选中的长文内容）
- `sound/real-input.mjs`
- `sound/tests/real-input.check.mjs`

## 3. 已获确认的产品决策

Site Mix v2 是有人值守的现场调音，不是自动调度功能：

- 《见山》Debug 模式中，单次 `ArrowUp` / `ArrowDown` 只调整外部鸟群风声，每次 `1 dB`。
- JanVim 复用现有操作条，提供 `WIND` 与 `INSTRUMENT` 两个独立的减、数值、加控件。
- 调节后立即试听并自动保存，没有 Save 按钮。
- 两个整数增益均限制在 `-24..+6 dB`，到达边界后继续调整是幂等确认。
- 配置对这台展览机上的全部节目和以后所有声音会话统一生效。
- 《见山》只请求风声调整，不写自己的 TOML，也不写站点配置。
- JanVim 是站点配置的唯一写入者。
- 不改变 Windows 系统音量、不改变《见山》内置风声、不改变 HP 保底、安全模板、冻结内容或展演调度。
- 不增加无人值守、全局快捷键、自动屏幕接管或新 GUI 窗口。

权威配置文件固定为：

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config\sound-mix-v1.json
```

精确 schema 示例：

```json
{"schema":1,"windGainDb":0,"instrumentGainDb":0}
```

文件上限为 4096 bytes，UTF-8 且只有一个结尾 LF。它不含 descriptor、token、会话、进程或内容身份。
缺失时本轮从两个 `0 dB` 开始，第一次成功调节才创建；非法文件或非法目录不被覆盖，调节失败关闭，
声音与界面都保留最后确认值。

## 4. 接口与运行语义

### 《见山》到声音服务

FLOCK_INGRESS_V1 遥测字节保持不变。v2 descriptor 使用
`jianshan-flock-ndjson-v2`，在原有认证挂接与鸟群 telemetry 之外增加一个双向控制请求：

```json
{"version":2,"command":"adjust-wind-gain","sourceId":"<32 lowercase hex>","requestId":1,"deltaDb":1}
```

响应为确认后的 dB 值，或严格的 `save-failed`。同一时刻只允许一个调整在途；保存等待期间鸟群 telemetry
继续运行。保存失败只更新 Debug 中的持久化状态，不断开鸟群入口。《见山》显示
`SAVED`、`PENDING`、`SAVE ERR` 或 `CONTROL OFF`。

### JanVim 操作条到声音服务

既有认证 real-cursor 连接增加严格的 `get-site-mix` 与 `adjust-site-mix` 请求。它们不续展 Show heartbeat。
响应总是包含两个已确认增益，使操作条与《见山》共享同一个真值来源。旧客户端不请求混音状态时，
仍只收到旧 attach ACK，不收到额外 unsolicited frame。

### supervisor、OSC 与 SuperCollider

成功持久化的完整值对被合并到最新状态，再交给既有唯一 OSC sender。它发送经过会话认证的
`/janvim/sound/v1/site-mix`；该消息只在 Start 后、Stop 前被接受，且不算 heartbeat。
风声与拨弦使用独立线性增益和短控制平滑，公共 limiter、1.5 秒 Stop fade、录音 tap、节点上限和
硬件输出门禁仍位于其下游且不变。

## 5. 已完成的非具身验证

所有下列验证均未启动 GUI、相机或可听硬件输出：

- 站点配置加载、严格解析、原子保存、跨会话重新打开与失败关闭：Node `7/7`。
- Site Mix 与 v2 transport 聚焦 Node 组合：`9/9`。
- v1/v2 codec 精确兼容测试：`1/1`。
- SuperCollider policy：`11` 项断言通过。
- 两条独立声部的静音 SC 测试：`1/1`。
- NRT 渲染：`1/1`，`-12 dB` 与恢复比例有效且无削波。
- Controller/schema/secondary-screen 聚焦 Vitest：`7` 通过，`196` 跳过。
- `npm run typecheck`：通过。
- Rust `cargo test --locked flock_input`：`67/67`，另有 `109` 项按过滤器跳过；只有 4 条既有 dead-code warning。
- Rust `cargo test --locked external_wind_gain`：`8/8`。
- 三个变更 Rust 文件的定向 rustfmt check：通过。
- 双仓 `git diff --check`：通过，只有 Git 的 LF/CRLF 提示。
- 一次真实但静音的 supervisor→TCP→sender→SC 链：`1/1`；证据目录
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\sound-20260906T115202023Z-ed0dbcfaa6ee`。
- 最终清理核对：相关进程数 `0`、占用端口数 `0`、站点混音文件不存在。

仓库级 `cargo fmt --check` 仍失败：基线缺少 `src/tests.rs`，并会报告大量与本功能无关的既有格式差异。
没有运行 formatter，也没有借此修改无关文件；定向检查才是本次变更的有效证据。

## 6. 已发现并修复的两个边界问题

1. 站点配置 store 首次实现会在读盘前创建待发送状态，导致下一会话虽然读到了文件，却向 SC 发送
   默认 `0 dB`。增加跨会话 reopen 测试后复现，并把 pending 初始化移到 load/catch 之后；现已通过。
2. JanVim coordinator 在声音端拒绝调整时未重放已确认状态，UI 可能一直停在本地 pending。
   增加拒绝分支测试后复现，并在 ignored/rejected 返回前发送确认状态；现已通过。

## 7. 候选产物与安全边界

上一轮 v1《见山》候选仍是：

- 路径：`D:\VirtualData\JanVim-Exhibition-Rehearsals\jianshan-flock-candidate-20260906T050050385Z-fde7b0c71412`
- `jianshan.exe`：9,840,128 bytes
- SHA-256：`d9cae3bcd850fc55d180c5d1bc9ab16fc4fc91b39dfd5c771a9caad96c030417`
- 安全模板 SHA-256：`510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae`

旧 JanVim 受审 bundle 是 540,860 bytes、SHA-256
`2a166eff47428efe3759b07c26cddcc92b615a4b1bf61d440e6674d8baa97f70`。它与上面的旧 EXE
都不包含 Site Mix v2，不能用来验收新快捷键、操作条、独立声部或跨会话保存。

本次新建的本地 v2 试听候选是：

- 候选根：
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c`
- 《见山》`runtime/jianshan-rust/jianshan.exe`：9,799,168 bytes，SHA-256
  `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`
- 《见山》runtime：11 个 allow-listed 文件；没有历史 liveConfig、descriptor、日志或 token。
- JanVim `apps/controller/dist/main/electron-main.js`：547,650 bytes，SHA-256
  `bb63c48dcf63756392e730224b2cbe929b00feafa1c2738ea608f5b9764f4b90`。
- JanVim runtime imports 与旧受审 allow-list 完全相同；main dist 仍只有 `electron-main.js`。
- `scripts/start-show.ps1` 只更新了新 bundle 的 bytes/hash，路径、imports、allow-list 和启动逻辑未变。
- Electron 身份测试 `24/24`、typecheck、构建与重复 module-graph verifier 均通过。
- 候选回执：
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c\candidate-receipt.json`
  （5,511 bytes，SHA-256 `b53925491ed9a611038c755dd9cc6880130c1168cbce0f44416888387f545d57`）。

双仓均有未提交工作树，所以这是一对 local audition candidate，不是 release、提交身份或 HP 保底。
不得原地替换旧 EXE、旧 runtime 或安全模板，也不得把静态构建门禁描述为物理验收。

## 8. 下一阶段的安全执行顺序

以下候选制作步骤已经完成：

- 只读重验双仓身份并记录三项受保护文件哈希；
- 完成不启动应用的 JanVim build 与 Rust release build；
- 对 JanVim 新 bundle 做静态 module-graph 复核和新旧词汇边界核对；
- 以先 RED、再 GREEN 的聚焦测试更新精确 bundle 身份，没有放宽启动器；
- 把《见山》产物复制到全新外部候选根，并逐文件复核 11 项 allow-list；
- 重验旧 v1 候选未变、相关进程和固定端口均为 0、站点混音文件仍不存在。

后续必须由操作员参与：

1. 不修改安全模板；现场每轮仅从模板创建唯一 liveConfig，并只改
   `[flock_input].enabled` 与 `descriptor_path`。
2. 使用已人工确认的 display map 创建全新的 30 分钟 SessionFile；历史 descriptor/token 永不复用。
3. GUI、相机、硬件声音和三屏操作均由操作员明确开始；agent 停在启动命令之前。
4. 物理验收记录最终两个 dB、Stop 淡出、第二个新会话继承、显示映射、窗口层级、分辨率和操作员听感。

## 9. 接手限制

- 不 fetch、commit、push、merge 或改 tag。
- 不运行全量测试；只运行与候选构建、身份和变更边界直接相关的门禁。
- 不自行启动 JanVim GUI、《见山》GUI、相机或可听声音。
- 不读取、打印或复制 descriptor JSON/token。
- 不复用任何已结束声音会话的 descriptor。
- 不改源诗、原媒体、冻结 manifest、安全模板、HP 保底、Windows 系统音量或显示所有权。
- 不批量杀进程，不以删除租约或改权限方式恢复会话。
- 不把自动测试或 synthetic probe 写成物理验收通过。

## 10. 权威文档入口

- 《见山》设计：`D:\github\JianShan02\docs\superpowers\specs\2026-09-06-site-sound-mix-design.md`
- 《见山》执行记录：`D:\github\JianShan02\docs\superpowers\plans\2026-09-06-site-sound-mix.md`
- v2 协议与操作边界：`D:\github\JianShan02\docs\FLOCK_SITE_MIX_V2.md`
- 联合试听操作卡：`docs/operations/2026-09-06-joint-rehearsal-quickstart.md`
- JanVim 声音说明：`sound/README.md`

接手 agent 应以设计文档和本报告共同作为约束；如果源码、构建产物或身份值与本报告不一致，
先停止候选制作并调查差异，不以更新文档或放宽校验掩盖问题。
