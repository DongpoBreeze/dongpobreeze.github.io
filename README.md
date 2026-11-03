# 深度笔记

一个使用原生 HTML、CSS 和 JavaScript 的中文技术博客，发布到 [GitHub Pages](https://dongpobreeze.github.io/)。站点无需应用服务器或数据库。

## 本地预览

在项目目录启动静态文件服务器：

```powershell
python -m http.server 4173
```

打开 `http://localhost:4173/`。

## 发布

文章更新推送到 `main` 分支后，GitHub Actions 会构建静态页面并自动发布到个人站点域名 `dongpobreeze.github.io`。本地生成结果位于 `dist/`。

```bash
node scripts/build-site.mjs
```

工作流只发布构建后的站点文件，不会公开项目说明、部署脚本或容器配置。

## 新增文章

在 `posts.js` 的 `posts` 数组中新增一项。`sections` 支持标题、段落、列表和引用；`date` 使用 `YYYY-MM-DD`，`tags` 用于主题索引。

首页配图来自 [Unsplash](https://unsplash.com/photos/silver-and-black-motherboard-qwtCeJ5cLYs)，并已下载到站点资源目录。
