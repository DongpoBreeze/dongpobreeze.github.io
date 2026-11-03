# 个人博客

你可以直接用 GitHub 网页写文章。Markdown 是纯文本格式，写作不需要安装博客软件；提交文章后，GitHub Actions 会自动构建并发布。

## 最简单的写作方法

1. 打开文章目录：[content/posts](https://github.com/DongpoBreeze/dongpobreeze.github.io/tree/main/content/posts)。
2. 点击 **Add file → Create new file**。
3. 文件名使用日期和英文短名，例如 `2026-11-03-first-post.md`。
4. 粘贴以下内容，再换成你自己的标题、摘要、主题和正文。
5. 点击 **Commit changes**，等待 Actions 页面显示部署成功；网站通常在几分钟内更新。

```markdown
---
title: 我的第一篇文章
date: 2026-11-03
description: 用一两句话概括文章，摘要会显示在首页。
tags:
  - 日常
  - 随笔
---

从这里开始写。

## 小标题

支持 **粗体**、*斜体*、[链接](https://example.com)、列表、引用、图片和代码块。

- 第一条
- 第二条
```

Markdown 格式模板：[post-template.md](content/templates/post-template.md)。文章会按 front matter 的 `date` 排序；在 `tags` 中填写主题后，主题索引会自动更新。

## 修改、撤下和保存草稿

打开对应的 `.md` 文件，点击铅笔按钮编辑，再点 **Commit changes** 保存；删除文件并提交后，文章会从网站和订阅里撤下。文件名决定文章地址，发布后尽量保持不变；也可以在文件开头设置 `slug: my-first-post` 固定地址。

如需暂时不发布，在文件开头加入 `draft: true`；写完改为 `draft: false` 并提交。注意：这个仓库是公开仓库，草稿只是不在博客展示，文件仍可被其他人看到。私密草稿应保留在本机。

## 上传图片

打开 [assets/uploads](https://github.com/DongpoBreeze/dongpobreeze.github.io/tree/main/assets/uploads)，点击 **Add file → Upload files** 上传并提交。然后在正文中插入：

```markdown
![图片说明](/assets/uploads/photo.jpg)
```

将 `photo.jpg` 换成实际文件名。图片尽量先压缩，文件名使用英文、数字和连字符。

## 管理自己的博客信息

- 网站名字、首页介绍和署名：修改 [blog.config.json](blog.config.json) 中的 `name`、`tagline`、`description`、`author`。
- 关于我：编辑 [content/about.md](content/about.md)。
- 文章：每个 `content/posts/*.md` 文件对应一篇文章。
- 删除文章：删除对应 Markdown 文件并提交。已删除文章仍可从 Git 历史中恢复。
- 首页、归档、主题、搜索、RSS 和站点地图会随文章内容自动生成，无需手动维护。

你也可以把草稿、要点和希望显示的署名发给我，我可以编辑文章并帮你发布。

每次提交后，可在 [Actions](https://github.com/DongpoBreeze/dongpobreeze.github.io/actions) 检查发布结果。绿色勾表示成功；红色叉表示本次发布失败，线上仍保留上一次成功的版本。

## 本地预览

先在项目目录生成网站，再预览实际的 Markdown 内容：

```powershell
npm ci
npm run build
python -m http.server 4173 --directory dist
```

然后打开 `http://localhost:4173/`。部署工作流只发布 `dist/` 里的网页、文章、配图、RSS 和站点地图，不包含本说明、模板或写作脚本。
