---
description: 提交 Git Commit 的标准流程
---

// turbo-all

1. 检查当前的 git 状态，确认有哪些更改

```bash
git status
```

2. 将所有更改添加到暂存区

```bash
git add .
```

3. 自动根据更改内容生成一条简洁、符合规范的提交信息（例如：feat: add interview detail component），并提示用户确认。

4. 执行提交

```bash
git commit -m "[这里替换为生成的提交信息]"
```

5. (可选) 推送到远程仓库

```bash
git push
```
