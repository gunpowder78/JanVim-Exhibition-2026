# 声音最小闭环（模拟输入、隔离候选）

状态：N1 退出淡出缺口已补定向回归和最小修正；基本试听已获用户确认，尚待提前 Stop 人工试听。
现有可展览视觉版本不依赖此目录。

N1 修正：语言进程在 READY 后消失、但没有发送 `SOUND_COMPLETE` 时，无论退出码是否为 0，
均保留 DSP 租约与淡出的宽限，再回收本次声音子进程；正常 COMPLETE 不增加等待。
缺失 COMPLETE 仍是失败，不会因为语言退出码为 0 就报告正常结束。
用户已确认录音与实时短演示声音正常且一致；这不替代提前停止的主观淡出检查。
本候选仍保持隔离，不自动合入展演。详细验证与历史 30 分钟运行的源码范围见交接记录。

## 当前范围

模拟光标特征 → 五声音阶拨弦；模拟鸟群特征 → 风声；共同停止淡出。
真实 OSC、真实 SuperCollider 合成，但目前没有真实 JanVim / 《见山》输入。
鲸鸣、经典电子音色、宇宙洪荒声场和热噪等方向只做备忘，不在此次实现中。

无需打开 SuperCollider IDE，也不需要新增依赖、ASIO 驱动、全局插件或 GUI。
不要使用旧测试脚本代替本候选。本候选不启动 JanVim 或副屏界面。

## 运行与停止

使用 PowerShell 7。下面的指令不要求先切换目录，也不依赖预载变量。
以下指令由操作员主动执行；不依赖 SuperCollider IDE 或前一次终端会话。

默认无声运行（45 秒模拟输入，随后清理）：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-2026\.worktrees\sound-minimal-loop\sound\start-sound.ps1'
```

仅在人工试听时使用下面的明确启声选项。先确认有线耳机已连接，并由人把耳机音量调低：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-2026\.worktrees\sound-minimal-loop\sound\start-sound.ps1' -Listen
```

三段模拟输入分别为拨弦、风声、混合；默认每段约 15 秒。启动和退出时间另计。
每次自动创建一个 `sound-*` 运行目录，控制台的 `SOUND_RUN_READY` 给出 `runRoot`。
如需提前停止，在声音仍播放时，从另一个 PowerShell 7 窗口执行下面的命令。
出现输入提示后，粘贴**本次** `SOUND_RUN_READY` 中的完整 `runRoot`（不带 JSON 引号），
不要使用已结束运行的路径。命令中不再提供可被误执行的占位目录：

```powershell
pwsh -NoProfile -File 'D:\github\JanVim-Exhibition-2026\.worktrees\sound-minimal-loop\sound\stop-sound.ps1' -RunRoot (Read-Host 'Paste the CURRENT runRoot from SOUND_RUN_READY')
```

`STOP_REQUESTED` 只表示请求被接收；应继续确认 A 窗口出现 `SOUND_RUN_COMPLETE`，
对应 `summary.json` 的 `clean` 为 `true`。停止后不自动重新启声。
`Ctrl+C` 是备用停止方式。出现突发过响先摘下耳机，再停止候选。

目录不复用、不覆盖；声音证据位于仓库外，不是展演源媒体。
如遇端口占用、设备不匹配或启动失败，保留当前回执并停止排查；不要批量杀进程、
改默认输出设备或提高音量来强行获得声音。已确认可听的官方示例仅作单独排障参考。

## 安全边界

- 默认无声；只有明确的 Listen 选项才允许可听输出。
- 无声模式不创建硬件输出节点，测试记录的是内部合成声道，不是麦克风。
- 试听仅使用 `Windows WASAPI : Headphones (Senary Audio)`；48 kHz、双声道、零输入。
  不会自动切换扬声器，不改系统音量。试听前由人把耳机音量调低。
- 总输出限幅为 0.2 线性样本幅度。这不是耳机声压安全认证，不能替代人的音量控制。
- 最多 8 个拨弦声部、1 个风声声部；每个拨弦声部有限时长；统一淡出 1.5 秒。
- 合法心跳丢失 2 秒后停止，停止会话不能被旧消息重新开启。
  混音器另有独立于语言进程的 DSP 心跳淡出保护。
- 使用独立 SC 类库配置屏蔽用户启动文件及扩展启动钩子；不修改用户的 SC 设置。
- 固定本机端口 57140 / 57141，每次检查占用；不杀其他进程、不接管已有声音服务。
- 只清理本次启动并确认身份的子进程；停止操作不根据磁盘里一个 PID 直接杀进程。
- 服务子进程在创建时进入本次专属 Windows Job；启动早期失败也会回收其后代，
  不按端口或进程名称终止其他会话。不支持这一创建方式时拒绝启动。

## 协议

发送到 `127.0.0.1:57140`，每条消息以前缀
`session:string, seq:int32, sentAt:float64` 开始。
`session` 是每次新进程的随机身份；`sentAt` 使用接收端 READY 提供的单调时钟锚点。

| OSC 路径 | 前缀后的参数 | 作用 |
| --- | --- | --- |
| `/janvim/sound/v1/start` | 无 | 仅允许首次开始 |
| `/janvim/sound/v1/heartbeat` | 无 | 维持运行租约，不发声 |
| `/janvim/sound/v1/cursor` | x、y、motion，float32 | 拨弦，至多 8 Hz |
| `/janvim/sound/v1/flock` | energy、centroidX，float32 | 风声变化，至多 20 Hz |
| `/janvim/sound/v1/stop` | 无 | 终止会话并共同淡出 |

特征必须有限，随后限制在 `[0,1]`；拒绝错误字段、过时/超前消息、旧序号或错误会话。
限频直接丢弃，不积压补播。只有合法 start / heartbeat 续租。

SC 会把收到的 OSC `s` 解码为 Symbol；接收边界将会话 Symbol 归一为 String 后再交给策略，
不会把其他错误参数类型强制转成合法会话。参见 [SC OSC 类型说明](https://doc.sccode.org/Guides/OSC_communication.html)。

发送器只编码不超过 512 字节的普通消息。SC 的 OSCdef 接收的是已解码字段，不是原始
UDP 报文防火墙；本原型不面向任意外部发送者或恶意本机进程。

## 验证的含义

- 包编码与策略测试：确定性消息/状态行为；10 小时测试使用假时钟。
- NRT 渲染：不打开音频硬件，分析实际 WAV 的非零信号、峰值、左右声道和淡出后静音。
- 实时无声测试：实际 UDP → SC 策略 → 合成 → 内部录音；另做有界资源运行和中断测试。
- 实时停止检查仅测量已录制、且早于声部释放的区间；另用故意不发送混音器停止的
  对照证明检测确实会失败，不把预分配缓冲区的尾部填零当作淡出证据。
- 人工试听：音色、层次、主观音量和停止感受，必须由人确认。

以上不能相互替代，更不代表已通过现场投影或真实光标/鸟群联动验收。

详细实施证据与后续真实输入边界见
[交接记录](../docs/operations/2026-09-05-sound-minimal-loop-handoff.md)。
