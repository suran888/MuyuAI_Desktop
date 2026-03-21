# AI 面试提词产品设计文档

## 1. 产品概述
- **产品愿景**：为求职者在远程或线下面试中提供实时、隐蔽且智能的提词辅助，帮助其更好地展示自身能力，并收集使用数据支持持续优化。
- **产品构成**：
  - Web 端（SaaS）：账号体系、身份认证、套餐购买、简历上传、面试口令生成、使用记录查询、客服 & 反馈。
  - 桌面端（Mac & Windows）：口令登录、远程授权校验、智能提词面板、内容控制、使用时长统计、日志回传。
- **目标用户**：面试者（C 端）、企业内训/高校职业指导（B 端）和运营人员（内部）。
- **核心能力**：内容生成（基于简历的面试问答）、实时推送与同步、计费与套餐、账号安全、跨平台桌面体验。

## 2. 产品架构

### 2.1 架构概览
![产品架构概览](drawio/product_architecture.drawio)

### 2.2 角色权限矩阵
![角色权限矩阵](drawio/role_permission_matrix.drawio)

## 3. 技术架构

### 3.1 技术栈架构图
![技术栈架构](drawio/tech_stack.drawio)

### 3.2 技术选型说明
- **前端 Web**：Next.js/React、TypeScript、TailwindCSS、SSR/SSG 结合，集成支付 SDK（Stripe/国内支付渠道）。
- **桌面端**：Electron + React 或 Tauri（Rust）以满足跨平台需求；集成本地加密存储（Keychain/Credential Manager）、虚拟桌面浮层能力。
- **后端服务**：
  - API：Node.js (NestJS) 或 Go (Fiber)；GraphQL + REST 混合。
  - AI 服务：Python (FastAPI) + LangChain/自研服务，接入 OpenAI、Claude 或自训模型。
  - 消息队列：RabbitMQ/Redis Streams 处理实时推送和计费异步任务。
  - 数据库：PostgreSQL（主数据）、Redis（缓存/会话）、S3 兼容存储（简历、音视频）。
  - 认证：Auth0/Cognito 或自建 OAuth2 + Magic Link + TOTP。
  - DevOps：Docker、Kubernetes、Helm、GitHub Actions/ GitLab CI。

### 3.2 逻辑分层
![逻辑分层架构](drawio/logical_layers.drawio)

### 3.3 桌面端结构
![桌面端结构](drawio/desktop_structure.drawio)

## 4. 产品流程

### 4.1 注册 & 套餐购买
![用户流程](drawio/user_flows.drawio)

### 4.2 简历上传与面试口令生成
![用户流程](drawio/user_flows.drawio)

### 4.3 桌面端提词使用流程
![用户流程](drawio/user_flows.drawio)

## 5. 数据流程
![数据流程](drawio/data_flow.drawio)

## 6. 数据库设计

### 6.1 关系型数据库（PostgreSQL）

#### 数据库关系图（ER图）
![数据库ER图](drawio/database_er.drawio)

#### 数据表详细说明
| 表名 | 描述 | 关键字段 |
| --- | --- | --- |
| `users` | 用户基础信息 | `id`, `email`, `phone`, `password_hash`, `auth_provider`, `kyc_status`, `role`, `created_at`
| `user_profiles` | 扩展资料与认证 | `user_id`, `full_name`, `avatar_url`, `career_level`, `company`, `title`, `verified_at`
| `plans` | 套餐定义 | `id`, `name`, `description`, `price`, `currency`, `quota_minutes`, `valid_days`, `status`
| `subscriptions` | 用户套餐订阅 | `id`, `user_id`, `plan_id`, `status`, `start_at`, `end_at`, `remaining_minutes`, `auto_renew`
| `payments` | 支付记录 | `id`, `user_id`, `subscription_id`, `provider`, `amount`, `currency`, `status`, `transaction_id`
| `resumes` | 简历存档 | `id`, `user_id`, `source_type`, `file_path`, `parsed_json`, `hash`, `created_at`
| `interview_configs` | 面试场景配置 | `id`, `user_id`, `resume_id`, `job_role`, `language`, `difficulty`, `token`, `expires_at`
| `prompt_sessions` | 提词会话 | `id`, `user_id`, `config_id`, `desktop_device_id`, `started_at`, `ended_at`, `duration`, `status`
| `prompt_entries` | 提词条目 | `id`, `session_id`, `question`, `suggested_answer`, `follow_up`, `confidence_score`
| `usage_logs` | 细粒度使用 | `id`, `session_id`, `event_type`, `payload`, `created_at`
| `devices` | 绑定设备 | `id`, `user_id`, `device_uuid`, `device_type`, `last_seen`, `status`
| `audit_logs` | 审计日志 | `id`, `actor_id`, `action`, `target_type`, `target_id`, `ip`, `ua`, `created_at`

### 6.2 非结构化存储
- 简历原文件、导出脚本存储在对象存储（S3/OSS），访问通过临时签名。
- 提词历史快照、AI 中间结果以 JSON 存储在 Data Lake，供日后模型训练与 BI 分析。

### 6.3 缓存 & 队列
- Redis：面试口令一次性缓存、限流、桌面端短连会话、实时提词内容缓存。
- 消息队列：提词生成任务、使用计费任务、通知推送、日志清洗。

## 7. API & 集成设计

### 7.1 API 架构图
![API架构](drawio/api_architecture.drawio)

### 7.2 核心 API 端点
- `POST /auth/login`：账号密码 / OTP 登录。
- `POST /auth/token`：Magic Link / OAuth 回调。
- `GET /plans`：获取套餐列表。
- `POST /subscriptions`：购买套餐。
- `POST /resumes`：上传简历，返回解析结果。
- `POST /interview-configs`：生成口令与场景设置。
- `POST /prompt-sessions`：桌面端启动会话。
- `GET /prompt-sessions/{id}/entries`：拉取提词条目。
- `POST /prompt-sessions/{id}/events`：上传使用事件。
- `POST /billing/settlements`：结算使用时长。

### 7.2 外部集成
- 身份验证：Email OTP、短信、三方 OAuth（GitHub/LinkedIn/微信）。
- 支付：Stripe、Apple Pay、微信/支付宝。
- AI 模型：OpenAI/Claude API，自建模型作为降级路径。
- 日志 & 监控：Sentry、Datadog/ELK、Prometheus + Grafana。

## 8. 安全与合规

### 8.1 安全架构图
![安全架构](drawio/security_architecture.drawio)

### 8.2 安全措施详细说明
- **数据传输**：全链路 HTTPS + WSS，桌面端使用证书固定（certificate pinning）。
- **存储安全**：重要字段（token、口令、简历）加密存储；采用行级访问控制。
- **合规**：遵循 GDPR/CCPA；敏感信息脱敏；用户可请求数据删除。
- **反作弊**：桌面端设备指纹、并发会话限制、口令一次性使用、异常使用告警。
- **日志审计**：关键操作记录审计日志，支持回溯。

## 9. 运营与分析
- 仪表盘：活跃用户、转化漏斗、使用时长、套餐消耗、模型质量。
- A/B 测试：面试场景模板、提词展现方式。
- 用户反馈闭环：桌面端快捷反馈、NPS 调研、客服工单系统。

## 10. 部署与交付

### 10.1 部署架构图
![部署架构](drawio/deployment_architecture.drawio)

### 10.2 部署策略详细说明
- **环境划分**：Dev / Staging / Prod，多区域部署以降低延迟。
- **CI/CD**：
  - Web：自动化测试 + Lint + 构建 + 静态部署 (Vercel/Netlify/CDN)。
  - 后端：单元 & 集成测试、容器扫描、K8s 滚动更新。
  - 桌面端：CI 构建 DMG/EXE，签名与公证（Apple notarization），增量更新。
- **可观测性**：指标、日志、追踪三位一体；为提词延迟、成功率设定 SLO。

## 11. 未来拓展
- 多语言支持、行业特定模板扩展。
- 与视频会议软件（Zoom/Teams）集成的浮层插件。
- 与企业 ATS/HRIS 对接，实现面试题库共用。
- 引入语音识别实时捕捉面试官问题，动态调整提词内容。
