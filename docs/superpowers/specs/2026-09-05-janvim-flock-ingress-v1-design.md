# JanVim 鸟群入口 v1：隔离候选实现设计

2026-09-05。用户已授权双方并行候选编码及自动验证；不含 Listen、HP 部署、推送、合并或替换保底。生产端外部协议以 [已冻结 v1](../../operations/2026-09-05-jianshan-sound-ingress-confirmation-v1.md) 为准，不再重开抽样/GPU/时钟设计。

## 范围与选择

基于 `93ce7b6f9667c1f32e4faada1d5f45130cbe224c`，仅改 `.worktrees/sound-flock-ingress-v1` / `feat/sound-flock-ingress-v1`。复用现有声音 TCP listener、唯一 OSC sender、SC wind SynthDef 的 gate。新增服务/中间件或从见山直连 SC 均不采用。JanVim 产品、controller/Lua、artifact lock、内容、显示映射、设备音量和既有音色不改。

启动器仅增加显式 `-FlockIngress`（Node `--flock-input enabled`），且只接受 `-Input RealCursor`；默认关闭时不创建 flock descriptor 或任何鸟群 owner/计时器。旧模拟输入及旧 OSC flock 路径完全保留。监听仍是 `127.0.0.1` 的现有动态端口；描述文件 `flock-input.json` 字段与冻结稿逐字一致，token 独立，active 结束时失效；不得共享或记录 token。创建描述文件失败仅禁用鸟群，不使光标/画面故障。

## 接收与生命周期

严格 UTF-8、平面 JSON、重复字段拒绝。挂接/数据字段、int32 seq/epoch、初始 epoch=1、sourceId32/token64小写十六进制均严格验证；不把数值归零或夹回合法范围。接纳前不能更改 seq/epoch。握手成功 ACK 入队前记 R，accept→完整合法挂接共1000ms绝对期限，不用滑动 socket inactivity 代替。每运行一位鸟群 owner，断开也不能换人；另一个 Show owner 独立。共8连接、每回调64帧/64KiB、每帧1024字节+可选待定末尾CR；ACK256字节排除CR/LF。越界只关闭相应连接，鸟群 token 不允许 Stop、光标或 Show 心跳。

纯策略保存一个最新合法状态和原 deadline `R+sampledAtMs+500`，500ms 边界使用 `now >= deadline`。未消费状态可以覆盖，非法/旧包不能覆盖更新状态。每50ms最多取用一个 sample，mute可更快。已消费状态仍保存其截止期限，不因 take 清空过期责任；无新包时也必须到期产生 wind-mute。20Hz 是下游发布上限，不按入包逐条播放。所有状态 seq 同步增长；epoch/时间倒退拒绝，新 epoch 清掉旧待发状态。时钟异常、明确计数溢出禁用入口；连续20个结构合法但已过期的帧禁用鸟群（有效帧清零此计数），不放宽500ms。

只有真实 Show owner 已挂接、有合法非 idle 心跳、2秒租约有效且未 Stop 才能发布风声。绑定前的 SC 服务健康心跳不构成 Show 授权。鸟群不续 Show 租约。空、不可用、过期、断连仅关风声；全局 Stop/Show故障仍执行原1.5秒淡出并终止会话，不可被新数据解除。正常reset不终止声音。采样时间0..3600000；声音既有时长/录音上限不变，不自动重连延长一小时。

## sender 与 SC 截止机制

现有 supervisor→sender 单个请求在途 IPC 复用。每次回复最多原heartbeat/cursor加一个鸟群状态及常量大小 watermark；不得建立逐帧IPC队列。保持原monotonic epoch截止到最终UDP admission，再用已有receiverAnchor换算到SC时钟，不能在最终发送时另给500ms。watermark含 epoch/revision；本层接纳新watermark后不得发送旧revision。跨进程/UDP已经发出的字节不可撤回，不承诺在另一线程尚未观察到失效前的瞬时原子撤销；原期限贯穿各层，SC再独立拒绝已过期或旧watermark。

仅增加内部候选 OSC 路径（不改变见山 TCP 冻结格式）：

- `/janvim/sound/v1/flock-live`：`session:s, seq:i, sentAt:d, epoch:i, revision:i, energy:f, centroid:f, expiresAt:d`，SC数组含地址共9项。
- `/janvim/sound/v1/flock-mute`：`session:s, seq:i, sentAt:d, epoch:i, revision:i`，共6项。

这两个路径只在SC启动第五参数为 `flock-v1` 时可用；既有四参数模式/旧路径不变。SC policy factory 可增加第三参数 `flockIngress=false`，原第二参数initialCounters不改。session/global seq/有限值/原收包时间校验仍用原策略；新路径额外要求 epoch/revision正int32不倒退、live的 `now < expiresAt <= sentAt+0.5`，energy/centroid范围0..1。mute不因20Hz限频被丢弃，不更新心跳。SC保存live原期限，已有50ms tick在无包时到期关风声；Windows调度非硬实时，唤醒后先检查期限。

service 对wind-mute只对当前wind设置gate=0，复用原0.3秒release；不是energy=0（仍有底噪）。全局Stop仍由mixer1.5秒执行。为避免gate切换堆积，活跃+释放中的wind节点合计最多2个；达到上限丢新触发，等待后续新鲜数据，不排队复播。onFree按节点身份释放引用，旧节点回调不得清掉新节点。不改 synths.scd 音色/增益；截止监督若服务异常仍沿用既有DSP2秒失联保护。

## 验证与交付

必须实际驱动真实policy、TCP listener和sender admission，证实：490ms老包只有10ms、排队至500ms不发送、已消费目标无新包仍到期。SC假时钟验证同一条原期限；无声SC运行/录音证明独立wind gate释放而plucks继续，Stop不复响。替身不冒充见山真实GPU或人工听音。每一行为先RED后GREEN；完整声音和应用门禁串行一次，保留首次失败，不放宽期限。

候选仅增加声音代码，因此Electron bundle及JanVim锁身份预计不变，必须实测对比。原光标候选、独立声音、视觉保底引用均保持。双方联调前交付明确候选提交、私有描述文件路径取得方式、实际新鲜度/Stop测试证据。先完成双方各自候选，不让一方等待对方才写可独立验证的代码。
