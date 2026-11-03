import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { stringify as yaml } from "yaml";
import { buildSite } from "../scripts/build-site.mjs";

const template = '<!doctype html><html><head><title>{{SITE_TITLE}}</title><meta name="description" content="{{SITE_DESCRIPTION}}"><link rel="canonical" href="{{SITE_URL}}"></head><body><a class="brand">{{SITE_NAME}}</a><span>{{SITE_AUTHOR}}</span><p>{{SITE_TAGLINE}}</p><main id="app"></main></body></html>';
const defaultConfig = { name: "个人博客", author: "作者", tagline: "认真记录", description: "自己的文章", baseUrl: "https://example.test" };

async function fixture(t, config = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "markdown-blog-test-"));
  t.after(async () => { await rm(rootDir, { recursive: true, force: true }); });
  await mkdir(join(rootDir, "content", "posts"), { recursive: true });
  await writeFile(join(rootDir, "blog.config.json"), JSON.stringify({ ...defaultConfig, ...config }));
  await writeFile(join(rootDir, "index.html"), template);
  for (const name of ["app.js", "styles.css", "favicon.svg"]) await writeFile(join(rootDir, name), "/* fixture */");
  return rootDir;
}

async function post(rootDir, filename, fields, content = "正文") {
  const path = join(rootDir, "content", "posts", filename);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "---\n" + yaml(fields) + "---\n\n" + content);
}

async function exists(path) {
  try { await access(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function published(rootDir) {
  const context = { window: {} };
  runInNewContext(await readFile(join(rootDir, "dist", "blog.js"), "utf8"), context);
  return JSON.parse(JSON.stringify(context.window.BLOG));
}

async function allOutput(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await allOutput(path));
    else result.push(await readFile(path, "utf8"));
  }
  return result.join("\n");
}

test("zero posts rebuild removes old articles and publishes only generated site files", async (t) => {
  const rootDir = await fixture(t);
  await mkdir(join(rootDir, "dist", "posts", "deleted-sample"), { recursive: true });
  await mkdir(join(rootDir, "dist", "tags", "deleted-topic"), { recursive: true });
  await writeFile(join(rootDir, "dist", "posts", "deleted-sample", "index.html"), "OLD_SAMPLE_SENTINEL");
  await writeFile(join(rootDir, "dist", "tags", "deleted-topic", "index.html"), "OLD_SAMPLE_SENTINEL");
  await mkdir(join(rootDir, "content", "templates"), { recursive: true });
  await writeFile(join(rootDir, "README.md"), "README_SENTINEL");
  await writeFile(join(rootDir, "content", "posts", "README.md"), "POSTS_README_SENTINEL");
  await writeFile(join(rootDir, "content", "templates", "sample.md"), "TEMPLATE_SENTINEL");
  await post(rootDir, ".hidden/sample.md", { draft: true }, "HIDDEN_SENTINEL");
  await mkdir(join(rootDir, "assets"), { recursive: true });
  await writeFile(join(rootDir, "assets", "note.md"), "ASSET_SOURCE_SENTINEL");
  await writeFile(join(rootDir, "assets", ".gitkeep"), "");
  const site = await buildSite({ rootDir });
  assert.equal(site.posts.length, 0);
  assert.deepEqual((await published(rootDir)).posts, []);
  assert.equal(await exists(join(rootDir, "dist", "posts")), false);
  assert.equal(await exists(join(rootDir, "dist", "tags", "deleted-topic")), false);
  for (const route of ["archive", "tags", "search", "about"]) assert.equal(await exists(join(rootDir, "dist", route, "index.html")), true);
  for (const filename of ["404.html", "robots.txt", "sitemap.xml", "feed.xml", ".nojekyll"]) assert.equal(await exists(join(rootDir, "dist", filename)), true);
  assert.doesNotMatch(await readFile(join(rootDir, "dist", "feed.xml"), "utf8"), /<item>/);
  assert.equal((await readFile(join(rootDir, "dist", "sitemap.xml"), "utf8")).match(/<url>/g).length, 5);
  assert.doesNotMatch(await allOutput(join(rootDir, "dist")), /SENTINEL|\{\{SITE_/);
  assert.equal(await exists(join(rootDir, "dist", "assets", "note.md")), false);
  assert.equal(await exists(join(rootDir, "dist", "assets", ".gitkeep")), false);
});

test("standard Markdown, quoted metadata, Unicode routes, config, about, and assets publish correctly", async (t) => {
  const rootDir = await fixture(t, { name: '博客 & "名字" <站点>', author: "某位作者", description: 'description "quoted" & <tag>', about: "content/profile.md" });
  await writeFile(join(rootDir, "content", "profile.md"), "# 关于我\n\n这是 **简介**。\n\n<script>alert(1)</script>\n");
  await mkdir(join(rootDir, "assets"), { recursive: true });
  await writeFile(join(rootDir, "assets", "picture.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const title = 'Quoted "title" & <special>';
  const tags = ["中文主题", "C/C++", '"引号"&<标签>', "__proto__"];
  const body = [
    "# 一级标题", "", "## 二级标题", "", "普通 **加粗** 与 *斜体* 和行内代码。", "",
    "- 项目一", "- 项目二", "", "1. 第一项", "2. 第二项", "",
    "> 引用文字", "", "| 名称 | 数值 |", "| --- | ---: |", "| 甲 | 42 |", "",
    "![图片说明](/assets/picture.svg)", "",
    '[外部链接](https://example.org/?a=1&b=2 "说明") [内部链接](/archive/)', "",
    "[危险链接](javascript:alert(1))", "", "<script>UNSAFE_SCRIPT_SENTINEL</script>"
  ].join("\n") + "\n\n" + String.fromCharCode(96).repeat(3) + "js\nconst x = '<unsafe>';\n" + String.fromCharCode(96).repeat(3) + "\n";
  await post(rootDir, "published.md", { title, date: "2024-02-29", slug: "我的-文章", description: 'summary "quoted" & <value>', tags }, body);
  const site = await buildSite({ rootDir });
  assert.equal(site.name, '博客 & "名字" <站点>');
  assert.equal(site.author, "某位作者");
  assert.equal(site.posts.length, 1);
  const article = site.posts[0];
  assert.equal(article.title, title);
  assert.equal(article.date, "2024-02-29");
  assert.equal(article.source, "content/posts/published.md");
  assert.deepEqual(article.tags, tags);
  assert.match(article.html, /<h1>一级标题<\/h1>/);
  assert.match(article.html, /<ul>/);
  assert.match(article.html, /<ol>/);
  assert.match(article.html, /<blockquote>/);
  assert.match(article.html, /<table>/);
  assert.match(article.html, /<td style="text-align:right">42<\/td>/);
  assert.match(article.html, /<img src="\/assets\/picture\.svg" alt="图片说明">/);
  assert.match(article.html, /<pre><code class="language-js">const x = '&lt;unsafe&gt;';/);
  assert.match(article.html, /href="https:\/\/example\.org\/\?a=1&amp;b=2" title="说明" target="_blank" rel="noopener noreferrer"/);
  assert.match(article.html, /href="\/archive\/"/);
  assert.doesNotMatch(article.html, /href="javascript:/);
  assert.doesNotMatch(article.html, /<script>/);
  assert.match(site.aboutHtml, /<h1>关于我<\/h1>/);
  assert.match(site.aboutHtml, /<strong>简介<\/strong>/);
  assert.doesNotMatch(site.aboutHtml, /<script>/);
  assert.deepEqual(await published(rootDir), JSON.parse(JSON.stringify(site)));
  assert.equal(await exists(join(rootDir, "dist", "posts", "我的-文章", "index.html")), true);
  assert.equal(await exists(join(rootDir, "dist", "assets", "picture.svg")), true);
  for (const tag of tags) {
    assert.match(site.tagRoutes[tag], /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u);
    assert.equal(await exists(join(rootDir, "dist", "tags", site.tagRoutes[tag], "index.html")), true);
  }
  const html = await readFile(join(rootDir, "dist", "posts", "我的-文章", "index.html"), "utf8");
  assert.match(html, /Quoted &quot;title&quot; &amp; &lt;special&gt;/);
  assert.match(html, /summary &quot;quoted&quot; &amp; &lt;value&gt;/);
  assert.match(html, new RegExp("https://example.test/posts/" + encodeURIComponent("我的-文章") + "/"));
  assert.doesNotMatch(html, /\{\{SITE_|<special>|<value>/);
  const feed = await readFile(join(rootDir, "dist", "feed.xml"), "utf8");
  assert.match(feed, /Quoted &quot;title&quot; &amp; &lt;special&gt;/);
  assert.match(feed, /&quot;引号&quot;&amp;&lt;标签&gt;/);
  assert.match(feed, /Thu, 29 Feb 2024 00:00:00 GMT/);
  assert.match(await readFile(join(rootDir, "dist", "sitemap.xml"), "utf8"), new RegExp(encodeURIComponent("我的-文章")));
  assert.match(await readFile(join(rootDir, "dist", "robots.txt"), "utf8"), /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
});

test("drafts are skipped before incomplete metadata can enter any public artifact", async (t) => {
  const rootDir = await fixture(t);
  await post(rootDir, "unfinished.md", { draft: true, slug: "../invalid", date: "2026-02-30" }, "DRAFT_PRIVATE_SENTINEL");
  await post(rootDir, "ready.md", { title: "正式文章", date: "2026-11-03", slug: "published" }, "公开正文");
  const site = await buildSite({ rootDir });
  assert.equal(site.posts.length, 1);
  assert.equal(site.posts[0].slug, "published");
  assert.doesNotMatch(await allOutput(join(rootDir, "dist")), /DRAFT_PRIVATE_SENTINEL|unfinished\.md/);
  assert.equal(await exists(join(rootDir, "dist", "posts", "unfinished")), false);
});

test("real calendar dates and strict YYYY-MM-DD are required", async (t) => {
  for (const date of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-01-00", "0000-01-01", "2026-11-03T08:00:00Z", 20261103]) {
    await t.test(String(date), async (t) => {
      const rootDir = await fixture(t);
      await post(rootDir, "bad.md", { title: "日期错误", date });
      await assert.rejects(buildSite({ rootDir }), /needs a valid date/);
    });
  }
});

test("missing titles, unsafe slugs, invalid draft flags and duplicate slugs fail before output replacement", async (t) => {
  const cases = [
    [{ date: "2026-11-03" }, /needs a title/],
    [{ title: "  ", date: "2026-11-03" }, /needs a title/],
    ...["../escape", "..", "a/b", "a\\b", "%2E%2E%2Fescape", "a:b", "CON", "trailing.", "bad slug", ""].map((slug) => [{ title: "错误路径", date: "2026-11-03", slug }, /invalid slug/]),
    [{ title: "布尔值", date: "2026-11-03", draft: "false" }, /draft must be a YAML boolean/]
  ];
  for (const [fields, error] of cases) {
    await t.test(JSON.stringify(fields), async (t) => {
      const rootDir = await fixture(t);
      await mkdir(join(rootDir, "dist"), { recursive: true });
      await writeFile(join(rootDir, "dist", "keep.txt"), "LAST_GOOD_OUTPUT");
      await post(rootDir, "bad.md", fields);
      await assert.rejects(buildSite({ rootDir }), error);
      assert.equal(await readFile(join(rootDir, "dist", "keep.txt"), "utf8"), "LAST_GOOD_OUTPUT");
    });
  }
  await t.test("duplicate slugs are case insensitive", async (t) => {
    const rootDir = await fixture(t);
    await post(rootDir, "one.md", { title: "一", date: "2026-11-03", slug: "Same" });
    await post(rootDir, "two.md", { title: "二", date: "2026-11-02", slug: "same" });
    await assert.rejects(buildSite({ rootDir }), /same slug/);
  });
});

test("default about, generated slugs, optional assets and explicit alternate output directories work", async (t) => {
  const rootDir = await fixture(t);
  await writeFile(join(rootDir, "content", "about.md"), "## 默认简介\n\n自己的介绍。");
  await post(rootDir, "notes/每日 记录.md", { title: "日常", date: "2026-11-03", tags: ["C++", "C#", "JS", "js"] }, "正文");
  const outputDir = join(rootDir, "public");
  const site = await buildSite({ rootDir, outputDir });
  assert.equal(site.posts[0].slug, "notes-每日-记录");
  assert.match(site.aboutHtml, /<h2>默认简介<\/h2>/);
  assert.equal(new Set(Object.values(site.tagRoutes)).size, 4);
  assert.equal(await exists(join(outputDir, "posts", "notes-每日-记录", "index.html")), true);
  assert.equal(await exists(join(rootDir, "dist")), false);
  assert.equal(await exists(join(outputDir, "assets")), false);
});

test("configuration and destructive output paths are validated", async (t) => {
  const rootDir = await fixture(t, { about: "../outside.md" });
  await assert.rejects(buildSite({ rootDir }), /about path must be a Markdown file inside/);
  for (const outputDir of [rootDir, join(rootDir, "content"), join(rootDir, "content", "posts"), join(rootDir, "assets")]) {
    await assert.rejects(buildSite({ rootDir, outputDir }), /Refusing to replace a source directory/);
  }
  await writeFile(join(rootDir, "blog.config.json"), JSON.stringify({ ...defaultConfig, baseUrl: "javascript:alert(1)" }));
  await assert.rejects(buildSite({ rootDir }), /HTTP\(S\) site origin/);
});
