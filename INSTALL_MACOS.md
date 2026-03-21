# macOS 安装指南

## 问题说明

在 macOS 上首次打开 muyu 应用时，可能会看到以下错误信息：

```
"muyu" is damaged and can't be opened. You should move it to the Trash.
```

这是因为应用没有经过 Apple 的公证流程。这**不是**应用损坏，而是 macOS 的安全机制。

## 解决方法

### 方法 1：使用右键菜单打开（推荐）

1. 找到 `muyu.app` 应用
2. **右键点击**应用图标（或按住 Control 键点击）
3. 选择"打开"
4. 在弹出的对话框中点击"打开"按钮

之后就可以正常双击打开应用了。

### 方法 2：使用终端命令

打开终端（Terminal），执行以下命令：

```bash
xattr -cr /Applications/muyu.app
```

如果应用不在 Applications 文件夹，请替换为实际路径。

### 方法 3：系统设置

1. 打开"系统设置"（System Settings）
2. 进入"隐私与安全性"（Privacy & Security）
3. 在"安全性"部分，点击"仍要打开"（Open Anyway）

## 为什么会出现这个问题？

macOS Gatekeeper 要求应用必须：
1. 使用有效的 Apple 开发者证书签名
2. 经过 Apple 的公证（notarization）流程

未经公证的应用会被 macOS 标记为"已损坏"。

## 开发者注意事项

要避免用户遇到这个问题，需要：

1. 注册 Apple 开发者账号（$99/年）
2. 在 GitHub Actions 中配置以下环境变量：
   - `APPLE_ID`: Apple ID 邮箱
   - `APPLE_ID_PASSWORD`: App-specific password
   - `APPLE_TEAM_ID`: 团队 ID

3. 在 GitHub Secrets 中添加这些变量

配置完成后，构建的应用将自动签名和公证，用户可以直接打开。
