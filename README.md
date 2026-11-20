# 可露希尔的 Codex

《明日方舟》可露希尔主题的 Codex Windows 外观与联动桌宠，包含原生深浅主题、CRT 覆盖层和带四语配音的 Spine 桌宠。

## 下载与安装

1. 打开 [v0.1.0 版本](https://github.com/OndoP3901/Closure-Codex/releases/tag/v0.1.0)，下载 [Closure-Codex-v0.1.0-win-x64.zip](https://github.com/OndoP3901/Closure-Codex/releases/download/v0.1.0/Closure-Codex-v0.1.0-win-x64.zip)。
2. 完整解压到你想长期保留的位置，然后在解压目录里双击 `Install.cmd`。需要 Windows x64 和 Microsoft Store 版 Codex，运行时已随包提供。
3. 用原来的 Codex 图标打开客户端。已打开时，切回 Codex 即可。桌宠和 CRT 随 Codex 主窗口启动和退出，联动模式下隐藏托盘图标。

双击 `Uninstall.cmd` 停止桌宠与 CRT，并移除 Windows 登录启动项。主题可在 Codex 的外观设置里换回。移动解压目录后，在新位置重新运行 `Install.cmd`。

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

- 左键点击桌宠会播放互动动作并弹出像素气泡。七句游戏台词每轮随机播放，每句出现一次。开场和任务完成也各有配音。按住角色可拖动位置，松开后会吸附。
- 右键可调整大小、镜像、透明度和气泡，开关角色配音，切换普通话、日语、英语或韩语。字幕保持简体中文，配音和 UI 音效各有独立音量。「预览表情」可预览哭脸、庆祝、思考等动画。
- 右键展开「CRT 显示效果」，可分别开关扫描线、暗角和「DSH 顶栏与渐变」，调节 CRT 强度与深浅显示模式。更改即时生效并在重启后保留。
- 扫描线、暗角、DSH 顶栏和紫色渐变由透明覆盖层绘制，鼠标可以穿透。桌宠和 CRT 在 Codex 主窗口位于前台时显示，在最小化、切换应用或打开文件夹选择器时隐藏。窗口过小时也会暂时隐藏。

### 活动与额度

联动桌宠读取本机 Codex 活动记录，呈现处理中、输出、完成、中断和可识别的失败。活动按本机汇总，来源可能是其他聊天。

使用官方 ChatGPT 登录时，显示 Codex 各时间窗口的剩余百分比。已适配的第三方服务使用本机配置查询账号余额，并保留接口返回的单位。有效读数会加入点击气泡轮换，Codex 处于前台且气泡空闲时约每分钟显示一次。官方额度低于或等于 10% 时会有低额度反应，像素贴画显示主时间窗口的剩余比例。查询失败时隐藏读数。

### 手动启动与运行位置

- 可在解除联动后双击 `outputs/Start-Closure.cmd` 手动启动桌宠与 CRT，或运行 `outputs/closure-companion/launch.cmd` 单独启动桌宠。运行同目录的 `launch-with-activity.cmd` 可启用活动与额度联动。手动启动后可从托盘隐藏或退出。
- `launch.cmd --demo` 打开测试窗口，`launch.cmd --canvas` 强制使用 Canvas 2D 渲染。手动启动时可用 `CLOSURE_ELECTRON_EXE` 指定 Electron 45 Windows x64 可执行文件，或用 `CLOSURE_STATE_DIR` 指定数据目录。默认运行数据位于 `work/companion-profile`。
- 模型、视觉和音频从本机加载，桌宠只读访问 Codex 配置与活动记录。另附原生桌宠格式和离线预览，使用前请查看随附说明。 [原生桌宠说明](outputs/closure-pet/说明.txt)

## 从源码构建

下载 [Electron 45.4.1 Windows x64](https://github.com/electron/electron/releases/download/v45.4.1/electron-v45.4.1-win32-x64.zip)，在仓库根目录运行以下命令。构建脚本会校验官方 Electron 压缩包的 SHA-256，并在 `dist` 生成安装包和校验文件。

```powershell
& .\Build-Release.ps1 -ElectronZip 'C:\Downloads\electron-v45.4.1-win32-x64.zip'
```

## 来源与许可

这是一项非官方移植，基于以下两个 DSH 项目。

- 主题沿用原版皮肤的色值和字体方案。 [dsh-closure-skin](https://github.com/fengshiyangrouguan/dsh-closure-skin)
- 桌宠复用原插件的 Spine 3.8 模型、动作、UI 音效和 Ark Pixel 气泡。 [dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet) · [移植所用的上游版本](https://github.com/fengshiyangrouguan/dsh-closure-pet/tree/5b5aa6a2bcb5da68e9b1cab3e6a9948f0ff2266f)

游戏模型、贴图、音效和配音的权利归各自权利人。上游对随附游戏素材另有个人本机自用和二次分发声明。 [主题 MIT 许可](outputs/closure-theme/LICENSE) · [桌宠代码许可](outputs/closure-companion/upstream/LICENSE) · [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md) · [字体 OFL 许可](outputs/closure-companion/upstream/assets/fonts/OFL.txt)
