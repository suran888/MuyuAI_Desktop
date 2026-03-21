# 开发者快捷键

## DevTools 切换功能

### 快捷键
- **macOS**: `Cmd + Shift + D`
- **Windows/Linux**: `Ctrl + Shift + D`

### 功能说明
在开发模式下,按下快捷键可以切换当前聚焦窗口的 DevTools:
- 如果 DevTools 已打开,则关闭
- 如果 DevTools 未打开,则以独立窗口模式打开

### 使用场景
1. 调试不同的窗口(header, main, ask, screenshot 等)
2. 避免启动时自动打开过多的 DevTools 面板
3. 按需打开/关闭 DevTools,提高开发效率

### 注意事项
- 此功能仅在开发模式下可用(`!app.isPackaged`)
- 生产环境下按下快捷键不会有任何效果
- 快捷键会作用于当前聚焦的窗口

### 其他开发快捷键
- **Electron 内置**: `Cmd + Option + I` (macOS) / `Ctrl + Shift + I` (Windows/Linux)
  - 打开当前窗口的 DevTools(仅在开发模式下)

## 配置修改

### 自动打开 DevTools
默认情况下,只有 `header` 窗口会在启动时自动打开 DevTools。

如需为其他窗口启用自动打开,可以在 `src/window/windowManager.js` 中取消注释对应的代码:

```javascript
// 例如为 main 窗口启用自动打开 DevTools
if (!app.isPackaged) {
    mainWin.webContents.openDevTools({ mode: 'detach' });
}
```

### 自定义快捷键
可以在快捷键设置界面中修改 `toggleDevTools` 的快捷键绑定。
