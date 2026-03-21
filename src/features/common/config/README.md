# Configuration Module

## 文件说明

### `constants.js`
应用全局常量配置文件,统一管理所有硬编码的默认值。

#### 导出的常量:

1. **`PRODUCTION_DEFAULTS`** - 生产环境默认配置
   - `API_DOMAIN`: 生产环境 API 域名
   - `WEB_URL`: 生产环境 Web URL
   - `STT_BACKEND_ENDPOINT`: 生产环境语音转文字服务端点

2. **`DEVELOPMENT_DEFAULTS`** - 开发环境默认配置
   - `API_DOMAIN`: 开发环境 API 域名 (localhost)
   - `WEB_URL`: 开发环境 Web URL (localhost)
   - `STT_BACKEND_ENDPOINT`: 开发环境语音转文字服务端点

3. **`API_PATHS`** - API 端点路径
   - `INTERVIEW_LOGIN`: 面试登录端点
   - `SESSION_START`: 会话开始端点
   - `SESSION_STOP`: 会话停止端点
   - `SESSION_HEARTBEAT`: 会话心跳端点
   - `USER_TIME_SUMMARY`: 用户时长摘要端点
   - `STT_STREAM`: 语音转文字流端点

4. **`APP_DEFAULTS`** - 应用默认配置
   - 超时设置、缓存设置、窗口尺寸等

5. **`USER_DEFAULTS`** - 用户默认配置
   - `ID`: 默认用户 ID
   - `EMAIL`: 默认用户邮箱
   - `DISPLAY_NAME`: 默认用户显示名称

#### 工具函数:

- **`getEnvironmentDefaults(env)`**: 根据环境名称获取对应的默认配置
- **`applyEnvironmentDefaults(env)`**: 将环境默认值应用到 `process.env`

### `config.js`
配置管理类,负责加载和管理应用配置。

### 使用示例

```javascript
// 引入常量
const { 
    PRODUCTION_DEFAULTS, 
    API_PATHS, 
    USER_DEFAULTS,
    applyEnvironmentDefaults 
} = require('./constants');

// 使用 API 路径
const loginEndpoint = `${apiDomain}${API_PATHS.INTERVIEW_LOGIN}`;

// 使用用户默认值
const userId = USER_DEFAULTS.ID;

// 应用环境默认值
applyEnvironmentDefaults('production');
```

## 环境变量加载逻辑

1. 根据 `NODE_ENV` 确定要加载的 `.env` 文件
2. 尝试从多个路径加载 `.env` 文件:
   - 开发环境: `process.cwd()/.env`
   - 打包后: `process.resourcesPath/.env.production`
3. 如果找不到 `.env` 文件,使用 `constants.js` 中定义的默认值

## 修改配置

所有硬编码的默认值都应该在 `constants.js` 中定义,其他文件通过引入常量来使用,避免在多处重复定义相同的值。

### 添加新的常量:

1. 在 `constants.js` 中添加新的常量定义
2. 在 `module.exports` 中导出
3. 在需要使用的文件中引入并使用

### 修改现有常量:

直接在 `constants.js` 中修改,所有引用该常量的地方会自动更新。
