# Splat Viewer

一个基于 Vue 3 和 Three.js 的 3D Splat 文件查看器。

## 功能特性

- 🎨 支持加载和查看 PLY 格式的 Splat 文件
- 🖱️ 鼠标/触摸拖动旋转模型
- 📱 响应式设计，自适应窗口大小
- ⚡ 基于 Vite 的快速开发体验

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview
```

## GitHub Pages 部署

项目已配置 GitHub Actions workflow，推送到 `main` 或 `master` 分支后会自动部署到 GitHub Pages。

### 首次设置

1. 在 GitHub 仓库设置中启用 GitHub Pages
2. 选择 "GitHub Actions" 作为部署源
3. 推送代码到 `main` 或 `master` 分支
4. Workflow 会自动构建并部署

### Base Path 配置

- 如果仓库名是 `username.github.io` 或 `organization.github.io`，base path 会自动设置为 `/`
- 否则会自动设置为 `/repository-name/`

如果需要手动修改 base path，可以在 `vite.config.ts` 中修改 `base` 配置。

## 技术栈

- Vue 3
- TypeScript
- Three.js
- @sparkjsdev/spark
- Vite
