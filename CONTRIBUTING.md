# 贡献指南

感谢你考虑为 NovelAI MCP Server 做出贡献！

## 报告问题

发现 bug 或有功能建议？请在 [Issues](../../issues) 中提交。

提交 Issue 时请包含：
- 清晰的标题和描述
- 复现步骤（如果是 bug）
- 系统环境（Node 版本、操作系统等）

## 提交代码

1. **Fork 并克隆项目**
   ```bash
   git clone https://github.com/SGSxingchen/NovelAI_MCP.git
   cd NovelAI_MCP
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **开发和测试**
   ```bash
   npm install
   npm run build
   npm run start:http  # 测试 HTTP 模式
   ```

4. **提交更改**
   ```bash
   git add .
   git commit -m "feat: 描述你的更改"
   ```

   提交信息格式：
   - `feat:` 添加新功能
   - `fix:` 修复 bug
   - `docs:` 更新文档
   - `refactor:` 重构代码

5. **推送并创建 Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```

## 代码规范

- 使用 TypeScript
- 保持代码简洁
- 添加必要的注释

## 更新文档

如果你的更改影响用户使用，请同步更新：
- README.md
- 相关文档（docs/ 目录）
- CHANGELOG.md

感谢你的贡献！🎉
