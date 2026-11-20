# 可露希尔的 Codex

《明日方舟》可露希尔主题的 Codex Windows 外观与联动桌宠，包含原生深浅主题、CRT 覆盖层和支持语音队列的 Spine 桌宠。

本指南对应 `v0.3.0`。各版本的新增功能和修复见 [更新日志](CHANGELOG.md)。

## 下载与安装

1. 确认电脑使用 Windows x64，并已安装 Microsoft Store 版 Codex。
2. 从发布页的 Assets 下载 `Closure-Codex-v0.3.0-win-x64.zip`。包内已附带 Electron 运行时。 [v0.3.0 发布页](https://github.com/OndoP3901/Closure-Codex/releases/tag/v0.3.0) · [直接下载安装包](https://github.com/OndoP3901/Closure-Codex/releases/download/v0.3.0/Closure-Codex-v0.3.0-win-x64.zip)
3. 完整解压到你想长期保留的位置，然后双击解压目录里的 `Install.cmd`。
4. 用原来的 Codex 图标打开客户端。已打开时，切回 Codex 即可。桌宠和 CRT 随 Codex 主窗口启动和退出，联动模式下隐藏托盘图标。需要更换 Codex 配色时，继续执行下方的主题导入步骤。

### 升级与卸载

- 升级时将新版解压到新目录，再从新目录运行 `Install.cmd`，启动项会切换到新版。要沿用桌宠和 CRT 设置，可在安装前把旧目录里的 `work/companion-profile` 和 `work/crt-settings.ini` 复制到新版对应位置。
- 卸载时在当前启用的安装目录双击 `Uninstall.cmd`，停止桌宠与 CRT 并移除 Windows 登录启动项。已导入的主题可在 Codex 的外观设置里换回。移动安装目录后，从新位置重新运行 `Install.cmd`。

## 导入主题

1. 打开 Codex 的「设置 → 外观 → 高级」。如需分别导入两套主题，打开「分别设置浅色和深色模式」。可以先用「复制主题」保存原来的外观。
2. 双击 `Copy-Dark-Theme.cmd` 或 `Copy-Light-Theme.cmd`，把复制的内容粘贴到对应的主题导入框。也可以手动复制主题文件的整行文字，包括开头的 `codex-theme-v1:`。 [深色主题](outputs/closure-theme/closure-dark.txt) · [浅色主题](outputs/closure-theme/closure-light.txt)
3. 在「模式」中选择深色、浅色或跟随系统。

| 模式 | 背景 | 正文 | 强调色 |
| --- | --- | --- | --- |
| 深色 | `#0a0b16` | `#eef0ff` | `#ff3ea5` |
| 浅色 | `#f2f2f7` | `#101020` | `#7e0ee4` |

主题优先使用 Cascadia Mono，中文回退到等线等系统字体。想使用像素字体，可安装 Fusion Pixel 12px，并在 Codex 的外观设置中把界面字体设为简体中文比例版、代码字体设为简体中文等宽版。 [Fusion Pixel 12px](https://github.com/TakWolf/fusion-pixel-font/releases)

## 桌宠与 CRT

左键点桌宠会播放互动动作，与「任务中」共用语音队列和播放进度。按住角色拖动，松开后会吸附到窗口边缘。

右键点击角色打开设置面板。

| 设置项 | 用法 |
| --- | --- |
| 镜像、大小、透明度、气泡 | 按需调整显示效果。点「重置位置」可恢复桌宠的默认位置。 |
| 配音语言、配音音量、音效 | 切换普通话、日语、英语或韩语，字幕保持简体中文。角色配音和 UI 音效可以分别开关和调节音量。 |
| 语音队列 | 查看各场景的默认队列，或切换到个人队列试听和编辑。 |
| 预览表情 | 预览哭脸、庆祝、思考等动画。 |
| CRT 显示效果 | 分别开关扫描线、暗角和「DSH 顶栏与渐变」。强度可调为 0% 至 150%，深浅模式可选跟随系统、深色或浅色。更改即时生效并在重启后保留。 |
| 提醒与播报 | 自动额度提醒可设为关闭、每分钟或每五分钟，也可以单独关闭工具失败提示。 |

扫描线、暗角、DSH 顶栏和紫色渐变由透明覆盖层绘制，鼠标可以穿透。桌宠和 CRT 在 Codex 主窗口位于前台时显示，最小化、切换应用、打开文件夹选择器或窗口过小时会暂时隐藏。

### 设置语音队列

1. 右键点击桌宠并展开「语音队列」。首次使用时选中「默认队列」，各场景按下表播报。
2. 要自定义语音，切换到「个人队列」，选择要编辑的场景。个人队列初始为空。
3. 在待选区按来源筛选，点击「试听」或「加入」。待选区共 57 条，包含 38 条干员语音和 19 条卫戍协议语音。同一句可加入多个场景。
4. 用「上移」「下移」「移除」调整当前队列。设置会自动保存。切回「默认队列」即可使用预设，个人队列仍会保留。

| 场景 | 触发条件 | 默认条数 |
| --- | --- | ---: |
| 任务开始 | Codex 开始处理新一轮任务时。 | 5 |
| 任务中 | 同一轮任务持续约 15 秒后自动播报一次。左键互动也会从此队列接着轮换。 | 20 |
| 任务完成 | 一轮任务成功结束时。 | 14 |
| 启动 Codex | 联动桌宠启动并显示后。 | 1 |
| 空闲五分钟 | 连续五分钟没有任务时播报一次。新任务会重置空闲计时。 | 2 |
| 工具调用错误 | 随工具失败提示播报。气泡同时显示可识别的错误原因和台词。 | 2 |
| Codex 提问 | Codex 发出带表单的结构化提问时。 | 1 |
| 用户提交回答 | 提交结构化提问的表单答案后。 | 4 |

每次触发按队列顺序播放一句，播完一轮后从头开始。个人队列留空即可关闭该场景的台词。工具失败文字提示可在「提醒与播报」里单独开关。卫戍协议语音提供普通话和日语，选择英语或韩语时使用普通话配音。

### 活动与额度

联动桌宠读取本机 Codex 活动记录，呈现处理中、输出、完成、中断和可识别的失败。活动按本机汇总，提示可能来自后台聊天。

额度、故障和设置提示采用可露希尔口吻。报错气泡会显示可识别的原因和状态码。常见公开工具会显示工具名，自定义工具使用通用称呼。同一轮已提示的错误在任务结束时会去重。

使用官方 ChatGPT 登录时，显示各时间窗口的剩余百分比，以及接口返回的 ChatGPT 积分。已适配的第三方服务使用本机配置查询余额，气泡显示「账户余额」、金额和可识别的标准货币单位。账号数据约每分钟查询一次，有有效读数时才会显示。官方额度低于或等于 10% 时会有低额度反馈。

额度气泡同时显示最近活跃对话的本轮与累计 Token。多个对话并行时，优先显示最近上报工作事件的运行中对话。统计随本机会话记录更新，后台子任务的记录不会抢占显示。

额度、余额和 Token 用量只在自动提醒气泡中显示。在「提醒与播报」中可设为关闭、每分钟或每五分钟，默认每分钟一次。Codex 位于前台且气泡空闲时，提醒会自动弹出并收起。

### 手动启动与运行位置

- 可在解除联动后双击 `outputs/Start-Closure.cmd` 手动启动桌宠与 CRT，或运行 `outputs/closure-companion/launch.cmd` 单独启动桌宠。运行同目录的 `launch-with-activity.cmd` 可启用活动与额度联动。手动启动后可从托盘隐藏或退出。
- `launch.cmd --demo` 打开测试窗口，`launch.cmd --canvas` 强制使用 Canvas 2D 渲染。手动启动时可用 `CLOSURE_ELECTRON_EXE` 指定 Electron 45 Windows x64 可执行文件，或用 `CLOSURE_STATE_DIR` 指定数据目录。默认运行数据位于 `work/companion-profile`。
- 模型、视觉和音频从本机加载，桌宠只读访问 Codex 配置与活动记录。另附原生桌宠格式和离线预览，使用前请查看随附说明。 [原生桌宠说明](outputs/closure-pet/说明.txt)
- 联动模式下，助手意外退出会独立重试。桌宠或 CRT 未出现时，可先切回 Codex 主窗口并检查 `work/lifecycle.log`。重试耗尽后，关闭所有 Codex 主窗口再重新打开。

## 从源码构建

下载 [Electron 45.4.1 Windows x64](https://github.com/electron/electron/releases/download/v45.4.1/electron-v45.4.1-win32-x64.zip)，在仓库根目录运行以下命令。构建脚本会校验官方 Electron 压缩包的 SHA-256，并在 `dist` 生成安装包和校验文件。

```powershell
& .\Build-Release.ps1 -Version 0.3.0 -ElectronZip 'C:\Downloads\electron-v45.4.1-win32-x64.zip'
```

上述命令生成 `dist/Closure-Codex-v0.3.0-win-x64.zip` 和 `dist/SHA256SUMS.txt`，安装包内附本指南和更新日志。

## 来源与许可

这是一项非官方移植，基于以下两个 DSH 项目。

- 主题沿用原版皮肤的色值和字体方案。 [dsh-closure-skin](https://github.com/fengshiyangrouguan/dsh-closure-skin)
- 桌宠复用原插件的 Spine 3.8 模型、动作、UI 音效和 Ark Pixel 气泡。 [dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet) · [移植所用的上游版本](https://github.com/fengshiyangrouguan/dsh-closure-pet/tree/5b5aa6a2bcb5da68e9b1cab3e6a9948f0ff2266f)

游戏模型、贴图、音效和配音的权利归各自权利人。上游对随附游戏素材另有个人本机自用和二次分发声明。 [主题 MIT 许可](outputs/closure-theme/LICENSE) · [桌宠代码许可](outputs/closure-companion/upstream/LICENSE) · [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md) · [字体 OFL 许可](outputs/closure-companion/upstream/assets/fonts/OFL.txt)
