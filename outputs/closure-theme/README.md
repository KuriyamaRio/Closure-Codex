# 可露希尔 · Codex 原生主题

## 导入

1. 打开 Windows 版 Codex 的 **设置 → 外观**。展开 **高级**，打开 **分别设置浅色和深色模式**（Separate light and dark modes），即可同时看到两套模式的设置。
2. 在深色设置里选择 **导入深色主题**（Import Dark theme），粘贴 [closure-dark.txt](closure-dark.txt) 的整行内容，包括开头的 `codex-theme-v1:`。
3. 在浅色设置里选择 **导入浅色主题**（Import Light theme），粘贴 [closure-light.txt](closure-light.txt) 的整行内容。可以在 **模式** 中切换深色、浅色或跟随系统。

如果想保留导入前的自定义值，可以先用各模式的 **复制主题** 保存原来的导入字符串。

## 颜色与字体

| 模式 | 背景 | 正文 | 强调色 |
| --- | --- | --- | --- |
| 深色 | `#0a0b16` | `#eef0ff` | `#ff3ea5` |
| 浅色 | `#f2f2f7` | `#101020` | `#7e0ee4` |

两套主题把界面和聊天正文都设为 DSH 的 Cascadia Mono 和等线回退方案。像素字方案可以安装 [Fusion Pixel 12px](https://github.com/TakWolf/fusion-pixel-font/releases)，然后在 Codex 的字体设置中把界面字体换成简体中文比例版，把代码字体换成简体中文等宽版。

原生主题设定背景色、主文字色、强调色和字体。顶栏使用独立叠层着色。右键桌宠并展开「CRT 显示效果」，可开关「DSH 顶栏与渐变」。新对话的欢迎语、输入框形状和各菜单的独立字色由 Codex 的界面组件定义。

主题色值、字体栈来自 [dsh-closure-skin](https://github.com/fengshiyangrouguan/dsh-closure-skin)。沿用原项目的 [MIT 许可](LICENSE)。主题文件只引用字体名称。
