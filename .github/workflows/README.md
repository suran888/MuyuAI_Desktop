# GitHub Actions 工作流说明

## 📦 build.yml - 构建和发布

### 主要改进

✅ **不再上传 Artifacts** - 避免占用存储配额  
✅ **直接上传到 Releases** - 更适合应用分发  
✅ **自动版本管理** - 支持 tag 和自动构建号  

### 触发条件

- 推送到 `main` 分支
- 推送 `v*` 标签 (如 `v1.0.0`)
- 手动触发

### 发布规则

| 触发方式 | Tag 格式 | Release 类型 |
|---------|---------|-------------|
| 推送到 main | `v0.0.{run_number}` | Pre-release |
| 推送 tag (v*) | 使用实际 tag | 正式 Release |

### 构建平台

- **macOS Intel** - `.dmg` 文件
- **macOS Apple Silicon** - `.dmg` 文件  
- **Windows** - `.exe` 安装程序
- **Linux** - `.AppImage` 文件

### 使用方法

#### 自动构建 (开发版本)
```bash
git push origin main
```
会创建 `v0.0.{构建号}` 的 pre-release

#### 正式发布
```bash
git tag v1.0.0
git push origin v1.0.0
```
会创建 `v1.0.0` 的正式 release

---

## 🧹 cleanup-artifacts.yml - 自动清理

### 功能

1. **清理所有 Artifacts** - 因为现在不再使用 artifacts
2. **清理旧的 Workflow Runs** - 保留最近 30 天的记录

### 运行时间

- 每天凌晨 2:00 自动运行
- 也可以手动触发

### 手动运行

1. 进入仓库的 **Actions** 页面
2. 选择 **Cleanup Old Artifacts** 工作流
3. 点击 **Run workflow**

---

## 💡 最佳实践

### 版本号管理

建议使用语义化版本号:
- `v1.0.0` - 主版本.次版本.修订号
- `v1.0.0-beta.1` - 测试版本
- `v1.0.0-rc.1` - 候选版本

### 发布流程

1. **开发阶段**: 推送到 main 分支,自动生成 pre-release
2. **测试完成**: 打 tag 发布正式版本
3. **用户下载**: 从 Releases 页面下载对应平台的安装包

### 存储优化

- ✅ 不使用 Artifacts (避免配额限制)
- ✅ Release 文件永久保存
- ✅ 自动清理旧的 workflow 记录
- ✅ 可以手动删除旧的 Releases

---

## 🔧 故障排查

### 如果构建失败

1. 检查 Actions 日志
2. 确认环境变量配置正确
3. 验证 `electron-builder.yml` 配置

### 如果上传失败

1. 确认仓库有 `contents: write` 权限
2. 检查是否在 main 分支或 tag 上运行
3. 验证构建产物路径正确

### 清理现有 Artifacts

运行一次 `cleanup-artifacts.yml` 工作流即可清理所有历史 artifacts。
