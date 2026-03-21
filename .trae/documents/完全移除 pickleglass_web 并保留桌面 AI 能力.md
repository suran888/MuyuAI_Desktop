## 目标与结论
- 目标：彻底删除 `pickleglass_web` 及其后端桥接，并保证桌面端独立运行，保留 Listen/Ask/Insight 能力。
- 结论：可行。桌面核心（Electron 主进程/预加载/本地渲染层与 `src/features` 的 AI 能力）不依赖 `pickleglass_web`。需改造主进程启动路径与登录/个性化入口的替代方案。

## 受影响范围
- 构建/打包：
  - `electron-builder.yml:26` 引用 `pickleglass_web/backend_node/**/*`
  - `electron-builder.yml:32` `extraResources` 拷贝 `pickleglass_web/out`
  - `package.json:18-19` `build:web`、`build:all` 与 `setup` 中的 web 构建步骤
  - `firebase.json:23` `public: pickleglass_web/out`
- 运行时：
  - `src/index.js:620` 引入 `../pickleglass_web/backend_node`
  - `src/index.js:625-637` `startWebStack()` 及对 `pickleglass_web/out` 的存在性检查
  - 深链与路由跳转：`src/index.js:487-490`、`src/index.js:574-577`
  - 登录流程：`src/features/common/services/authService.js:130-133`
  - 个性化入口：`src/window/windowManager.js:428-432`
  - Web URL 桥接：`src/bridge/featureBridge.js:65`

## 安全删除步骤
- 删除目录：`pickleglass_web/`（含 `app/`, `backend_node/`, `out/`）。
- 配置清理：
  - 移除 `electron-builder.yml` 中对 `backend_node` 的 `files` 引用与对 `out` 的 `extraResources`。
  - 移除 `package.json` 中 `build:web`、`build:all`，并从 `setup` 脚本删除 web 构建段。
  - 删除或更新 `firebase.json`，去除 `public: pickleglass_web/out`。
- 主进程与运行路径：
  - 在 `src/index.js` 删除 `startWebStack()`、`createBackendApp` 引用、`WEB_PORT/pickleglass_WEB_URL` 环境变量设置、对 `out` 的强制检查；直接进入窗口创建流程。
  - 将深链与个性化跳转改为触发桌面设置视图或仅聚焦窗口，不再 `loadURL(http://localhost:...)`。
- 登录与个性化替代：
  - 方案A（本地模式）：禁用云登录；`authService` 默认使用本地用户，保留 Settings 中的模型与密钥管理。
  - 方案B（保留登录）：继续使用系统浏览器进行 OAuth/Firebase，并通过自定义协议（如 `pickleglass://auth-success?...`）回调主进程；渲染层提供简易登录 UI，完全不依赖 `pickleglass_web` 页面。
- 其他桥接：
  - 移除 `src/bridge/featureBridge.js` 的 `get-web-url` handler，或返回空/本地模式标志。

## 验证清单
- 构建：`npm run build:renderer`、`npm start`、`npm run build`；打包成功且不再引用 `pickleglass_web`。
- 启动：无 `pickleglass_web/out` 仍能正常创建窗口并进入桌面 UI。
- Listen：麦克风/系统音频捕获、转写（Whisper/Doubao）、实时洞察事件流正常。
- Ask：截图与文本流式回答正常，错误路径回退文本-only。
- Settings：模型选择、Ollama/Whisper 安装检测、API Key CRUD 正常。
- 深链：个性化与登录入口触发桌面视图/提示；不出现 `http://localhost/...` 导航。
- 日志：无 `pickleglass_web` 引用相关错误；打包产物运行无异常。

## 风险与替代
- 风险：现有登录与个性化流程依赖 Web 控制台路由；主进程启动路径有硬性检查。
- 替代：采用本地用户模式；或实现桌面内登录 UI + 自定义协议回调。

## 工作量与推进方式
- 工作量：中等（主进程与若干服务/窗口的引用清理 + 构建配置调整）。
- 推进建议：
  - 第1步：移除构建/打包引用并验证开发态启动。
  - 第2步：删除 `startWebStack()` 相关逻辑，改造深链与设置入口。
  - 第3步：选择登录替代方案并实现（A或B）。
  - 第4步：全功能验证与打包测试。

请确认以上方案（尤其登录与个性化的替代选择：A本地模式或B保留登录），我即可开始实施具体改动并提交补丁。