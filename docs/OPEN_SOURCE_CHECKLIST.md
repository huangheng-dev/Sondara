# 开源发布安全清单

## 绝对不能公开的内容

- `.env`、API Key、SMTP/IMAP 密码、OAuth Token、Webhook 密钥和 `data/.master-key`
- `data/` 下的数据库、WAL/SHM、备份、消息同步状态和导出文件
- 真实公司资料、客户名单、联系人、邮件正文、销售金额、跟进记录和内部知识库
- 浏览器 Cookie、Playwright storage state、日志、错误转储、审计截图和上传文件

即使数据库中的第三方密钥已经加密，数据库和主密钥也都不能公开。客户数据本身通常不是加密存储，泄漏数据库就等于泄漏业务数据。

## 首次提交前

```bash
npm run qa:public-repo
npm run qa:all
git init
git add .
git status --short
git diff --cached --name-only
```

确认暂存区没有 `data/`、`.env`、数据库、备份、导出、日志、截图或登录状态文件，再创建提交。公开种子数据必须使用 `server/db/seed-dev.ts` 中明确标记的虚构公司和保留示例域名。

## GitHub 设置

- 开启 Secret scanning、Push protection、Dependabot alerts 和私密漏洞报告。
- 生产密钥放在 GitHub Actions Secrets、部署平台 Secret 或服务器环境变量中，不写入 workflow。
- 用最小权限的部署令牌，并为生产与测试使用不同凭证。

## 如果敏感内容曾经提交

1. 立即吊销并轮换所有相关密钥、密码和 Token。
2. 删除公开附件、Release artifact、Actions artifact 和缓存中的副本。
3. 使用 `git filter-repo` 从所有分支和标签清理文件或字符串；仅删除最新提交无效。
4. 强制推送清理后的历史，并要求协作者删除旧克隆后重新克隆。
5. 根据适用的合同和隐私法规评估客户通知与事件报告义务。

不要把“仓库已转为私有”当作轮换密钥或清理历史的替代措施。
