# 个人博客

公开博客：[dongpobreeze.github.io](https://dongpobreeze.github.io/)。所有人都能直接阅读首页、文章、归档、主题和关于页，无需登录。

写作室使用独立地址：[dongpobreeze.github.io/admin/](https://dongpobreeze.github.io/admin/)。请自行保存此地址，所有公开阅读页面都不显示创作或作者验证入口。

首次访问写作室会前往独立的 [作者验证页](https://dongpobreeze.github.io/author/)，验证通过后即可可视化写作和管理博客。

## 在可视化编辑器里管理博客

- **写文章**：输入标题，在正文里直接排版；工具栏可添加标题、加粗、列表、引用、代码、表格和图片。
- **保存草稿**：草稿先存到当前浏览器，写作时自动保存。保存草稿不会更新网站；浏览器数据被清除后草稿也会丢失，重要内容请导出备份。
- **发布文章**：连接 GitHub 后点击发布；文章和配图写入仓库，GitHub Pages 随后自动更新。提交完成和网站部署完成是两个步骤，可通过编辑器里的发布记录链接检查。
- **修改或撤下文章**：从文章列表打开文章继续编辑，或确认撤下。撤下后，历史版本仍保留在 Git 历史中。
- **修改个人资料**：在博客设置里修改博客名称、首页介绍和作者，在“关于我”里编辑个人介绍。

编辑器可在电脑和手机浏览器使用。草稿保留在写作的这台设备；已经发布的文章保存在 GitHub，可换设备继续编辑。

编辑区、草稿列表和站点设置只在作者验证通过后显示。当前仅允许 `DongpoBreeze` 账号进入；GitHub 仍会对每次发布检查仓库写入权限。未登录直接打开写作室，会前往独立的作者验证页；退出后也回到此页。

## 首次连接 GitHub

GitHub Pages 提供静态托管，发布时需要你授权编辑器写入博客仓库。独立的作者验证页提供设置指引：

1. 登录 `DongpoBreeze`，按页面链接创建 **fine-grained personal access token**。
2. 在 **Only select repositories** 中只选择 `dongpobreeze.github.io`，权限使用 **Contents → Read and write**。
3. 把生成的令牌粘贴到作者验证框，点击验证。令牌不要写进文章或发送给他人；只会发往 GitHub API，不会提交到博客仓库。

验证后即可直接在可视化页面发布，无需手动编辑仓库文件。令牌仅在当前浏览器会话保存，断开后需要重新验证；令牌过期或撤销后，重新创建即可。网站读者不需要登录。

## 直接编辑 Markdown（可选）

文章仍以 Markdown 保存在 GitHub。如果你想使用原有方式：

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

然后打开 `http://localhost:4173/`。部署工作流只发布 `dist/` 里的博客、作者入口、配图、RSS 和站点地图，不包含本说明、模板或构建脚本。
