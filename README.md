# 可露希尔的 Codex

《明日方舟》可露希尔主题的 Codex Windows 外观与联动桌宠。

## 下载与安装

1. 打开 [v0.1.0 版本](https://github.com/OndoP3901/Closure-Codex/releases/tag/v0.1.0)，下载 [Closure-Codex-v0.1.0-win-x64.zip](https://github.com/OndoP3901/Closure-Codex/releases/download/v0.1.0/Closure-Codex-v0.1.0-win-x64.zip)。
2. 完整解压到你想长期保留的位置，然后在解压目录里双击 `Install.cmd`。需要 Windows x64 和 Microsoft Store 版 Codex，运行时已随包提供。
3. 用原来的 Codex 图标打开客户端。已打开时，切回 Codex 即可。桌宠和 CRT 随 Codex 主窗口启动和退出，切到其他应用时隐藏。
4. 双击 `Copy-Dark-Theme.cmd` 或 `Copy-Light-Theme.cmd`，在 Codex 的「设置 → 外观 → 高级」中粘贴到对应的主题导入框。要同时使用深浅两套，可打开「分别设置浅色和深色模式」。可以在导入前用「复制主题」保存原来的外观。

双击 `Uninstall.cmd` 停止桌宠与 CRT，并移除 Windows 登录启动项。主题可在 Codex 的外观设置里换回。移动解压目录后，在新位置重新运行 `Install.cmd`。

## 使用

- 左键点击桌宠，随机播放七句游戏台词。开场和任务完成也各有配音。
- 右键打开设置，切换普通话、日语、英语或韩语配音，分别调整配音和 UI 音效音量，以及开关扫描线、暗角、DSH 顶栏和渐变。
- 带活动联动时，桌宠从本机 Codex 活动记录判断工作状态。可显示官方 ChatGPT 登录的 Codex 剩余额度或合聚账号余额。有有效额度时，气泡空闲且 Codex 处于前台约每分钟显示一次。
- `outputs/closure-pet` 内附原生桌宠格式和离线预览。建议日常使用安装包默认启动的本地联动桌宠，它提供完整 Spine 动画、气泡和配音。原生桌宠格式的使用条件见该目录说明。

## 从源码构建

下载 [Electron 45.4.1 Windows x64](https://github.com/electron/electron/releases/download/v45.4.1/electron-v45.4.1-win32-x64.zip)，在仓库根目录运行以下命令。构建脚本会校验官方 Electron 压缩包的 SHA-256，并在 `dist` 生成安装包和校验文件。

```powershell
& .\Build-Release.ps1 -ElectronZip 'C:\Downloads\electron-v45.4.1-win32-x64.zip'
```

## 来源与许可

主题和桌宠代码分别基于 [dsh-closure-skin](https://github.com/fengshiyangrouguan/dsh-closure-skin) 与 [dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet)。游戏模型、贴图、音效和配音的权利归各自权利人。上游对随附游戏素材另有个人本机自用和二次分发声明，见 [素材与第三方许可](outputs/closure-companion/upstream/NOTICE.md)。这是一项非官方移植。
