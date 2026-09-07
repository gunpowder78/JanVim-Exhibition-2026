# 给展览 Mini PC Codex CLI 的接管任务

你现在是展览小主机上的展示联调总协调 agent，负责把 JanVim、《见山》和声音开发集中到本机。
用户已授权在本机继续代码、内容与声音表现开发；本步骤先把双仓代码和资源对齐，形成可审阅的接收回执。

## 必先读取

- 两仓 AGENTS.md；每份单独完整读到 EOF，输出截断时按 200 行续读。
- JanVim 的 `docs/operations/2026-09-07-mini-pc-development-handoff.md`。
- 《见山》的 `docs/2026-09-07-exhibition-mini-pc-handoff.md`。
- 再按这两份交接中的顺序读部署/声音/协议文件。

如果你尚未取得新文档，先只读记录现有两仓根、branch、HEAD、origin、upstream、status、worktree list。
然后从已确认的 origin fetch 交付分支，使用 `git show <交付SHA>:<文档路径>` 读取文档，
或在独立新工作树检出该提交。不要为了获得文档而丢弃旧本地改动。

## 必须对齐的事实

- JanVim 仓库：`https://github.com/gunpowder78/JanVim-Exhibition-2026.git`。
- 交付分支：`feat/sound-flock-ingress-v1`。
- 已测试应用基准：`959495d806060f9017f3e8f04bc60c01701909f1`。
- 完整迁移文档 HEAD 由此次总交接回执给出；它在应用基准之后，先核对其差异仅为文档/README。
- 《见山》仓库：`https://github.com/gunpowder78/jianshan02Boid.git`。
- 《见山》v2 交付分支：`feat/site-mix-v2-handoff`；最终 HEAD：`250685ec54011e898267fce7413343fe59b2e4b8`。
- 《见山》源码保全提交：`d2ee805b36effa1c6a01f2f54488803704c09f95`；之后仅为交接文档。旧 `d890caa…` 只是 v1，不能冒充 v2。
- 现有包：`D:\github\JanVim-Exhibition-Deploy`；相关传输包根及所有 SHA 见总交接。
- 该包仍 awaiting-mini-pc-attended-acceptance。音频端点找不到尚未修复。

## 执行顺序

1. 核实两个 origin URL 后 fetch；以实际远端完整 SHA 核对交付版本，不能只凭本地 remote-tracking ref。
2. 若旧检出干净且只落后，从交付点建立/复用 `feat/exhibition-mini-pc-integration`。
   若有未提交改动或本地独有提交，原样保留旧工作树，从交付点另建独立工作树继续。
   不重置、强推、覆盖 clone 或自动合并不明差异。建议路径见总交接。
3. 核验已复制的 ZIP/receipt/manifest 和逐文件包完整性；缺失资源列出精确路径。
   不把 Git clone 当作运行时已齐备；旧会话、descriptor/token、liveConfig、租约不迁移。
4. 恢复新开发工作树需要的锁定 JanVim runtime、Node/npm 22.23.0、Electron、依赖与《见山》开发资源。
   先读总交接的布局说明，再复制必要外部资产到新目标；保持原部署包完整。
5. 记录本机 SuperCollider 实际输出设备名/API/声道/采样率，以及 Windows 测试音状态。
   当前源码把 Senary 写死在 site-defaults、Deployment 模块和 SC service 三处；只改 JSON 不足。
   音频 API 先按实测选择 WASAPI，不预先安装 ASIO，不随意降低身份门禁。
6. 写接收回执（两仓 SHA、资源、工具链、实际硬件、尚缺内容与下一任务），报告
   `MINI_PC_SOURCE_AND_ASSET_HANDOFF_READY`，然后进入具体小主机适配。

## 后续开发规则

- 本机一个总协调 agent；《见山》agent 独占其仓库。协议变动先书面同步，再各自修改；不要双写。
- 先解决真实输出端点。展示/声音/窗口验证分阶段做，开发准备不能冒充听音通过。
- 用户要求：自动 Start、C 屏黑底白鸟/最大化/置顶/鼠标可见可点、A 屏长文/剑客动画/原诗 reset、
  两声路独调保存继承、Ctrl+Shift+S 或 STOP SHOW 正常停止并共同淡出、不复响。
- 用户已认可有人看护与正常重启恢复；本阶段不追加离线/强制故障/HP 性能或无人值守工程。
- 当前每个声音会话最多一小时，全天声音续航是另一个明确待办，不能忽略上限。
- 源码修改在新分支完成；冻结输入或产物变化经对应测试/审阅后生成新包，保留已验包回退。
- GUI/相机/可听声音在现场用户准备好后才开启。不要复用历史 SessionFile 或用 synthetic probe 占人工会话 owner。
- 不重复已无变化的全量测试；小改先验证相关边界，最终新包按仓库要求完成全套。
- 取得一个可用效果里程碑后提交并推送本机开发分支；记录对应源码与包 SHA。

如确实缺少某个外部文件或有并发改动无法安全归类，先完成其他独立工作，再一次性报告具体缺口。
常规只读核查和已授权的开发准备无需逐步等待用户批准。
