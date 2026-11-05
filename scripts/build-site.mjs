import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { parse as parseYaml } from "yaml";
import { buildAdmin } from "./build-admin.mjs";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBaseUrl = "https://dongpobreeze.github.io";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const escapeXml = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const toPosix = (value) => value.split(sep).join("/");
const slugKey = (slug) => slug.normalize("NFC").toLocaleLowerCase("en-US");
const basicSlug = (value) => value.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLocaleLowerCase("en-US");
const postUrl = (post) => "/posts/" + encodeURIComponent(post.slug) + "/";
const tagUrl = (slug) => "/tags/" + encodeURIComponent(slug) + "/";
const inside = (parent, child) => { const path = relative(parent, child); return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep)); };
const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function createMarkdown() {
  const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const renderLink = markdown.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet("href") || "";
    if (/^(?:https?:)?\/\//i.test(href)) {
      tokens[index].attrSet("target", "_blank");
      tokens[index].attrSet("rel", "noopener noreferrer");
    }
    return renderLink(tokens, index, options, env, self);
  };
  return markdown;
}

async function listMarkdown(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || /^readme\.md$/i.test(entry.name)) continue;
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listMarkdown(filePath));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(filePath);
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function splitFrontMatter(source, label, required = true) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+(?=---\n)/, "");
  if (!normalized.startsWith("---\n")) {
    if (required) throw new Error(label + " must start with YAML front matter.");
    return { data: {}, content: normalized };
  }
  const closing = /^---[ \t]*$/gm;
  closing.lastIndex = 4;
  const end = closing.exec(normalized);
  if (!end) throw new Error(label + " is missing the closing --- for its YAML front matter.");
  let data;
  try { data = parseYaml(normalized.slice(4, end.index), { uniqueKeys: true, maxAliasCount: 50 }); }
  catch (error) { throw new Error(label + " has invalid YAML front matter: " + error.message); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(label + " front matter must be a YAML mapping.");
  return { data, content: normalized.slice(end.index + end[0].length).replace(/^\n/, "") };
}

function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function plainText(tokens) {
  const pieces = [];
  for (const token of tokens || []) {
    if (token.type === "inline") pieces.push(plainText(token.children));
    else if (token.type === "text" || token.type === "code_inline" || token.type === "fence" || token.type === "code_block") pieces.push(token.content);
    else if (token.type === "image") pieces.push(token.content);
    else if (token.type === "softbreak" || token.type === "hardbreak") pieces.push(" ");
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

function parsePost(source, filePath, rootDir, postsRoot, markdown) {
  const label = toPosix(relative(rootDir, filePath));
  const { data, content } = splitFrontMatter(source, label);
  if (data.draft !== undefined && typeof data.draft !== "boolean") throw new Error(label + " draft must be a YAML boolean (true or false).");
  if (data.draft === true) return null;
  if (typeof data.title !== "string" || !data.title.trim()) throw new Error(label + " needs a title in its front matter.");
  if (data.slug !== undefined && typeof data.slug !== "string") throw new Error(label + " has an invalid slug.");
  const slug = (data.slug ?? basicSlug(toPosix(relative(postsRoot, filePath)).replace(/\.md$/i, ""))).trim().normalize("NFC");
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(slug) || windowsReserved.test(slug) || Buffer.byteLength(slug, "utf8") > 200) throw new Error(label + " has an invalid slug. Use letters, numbers, hyphens, or underscores (up to 200 UTF-8 bytes).");
  if (!isRealDate(data.date)) throw new Error(label + " needs a valid date: YYYY-MM-DD.");
  if (data.description !== undefined && typeof data.description !== "string") throw new Error(label + " description must be text.");
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string" || !tag.trim()))) throw new Error(label + " tags must be a YAML list of nonempty text values.");
  const tags = [...new Set((data.tags || []).map((tag) => tag.trim().normalize("NFC")))];
  const tokens = markdown.parse(content, {});
  const text = plainText(tokens);
  const cjkCharacters = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const otherWords = (text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ").match(/[\p{L}\p{N}]+/gu) || []).length;
  return {
    slug, title: data.title.trim(), date: data.date, tags,
    excerpt: (data.description?.trim() || text).slice(0, 220),
    reading: Math.max(1, Math.ceil(cjkCharacters / 400 + otherWords / 260)),
    html: markdown.renderer.render(tokens, markdown.options, {}),
    source: label
  };
}

function readConfig(raw) {
  const config = JSON.parse(raw);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("blog.config.json must contain an object.");
  const defaults = { name: "我的博客", author: "博客作者", tagline: "记录所思所做。", description: "个人文章与生活记录。" };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (config[key] !== undefined && typeof config[key] !== "string") throw new Error("blog.config.json " + key + " must be text.");
    config[key] = config[key]?.trim() || fallback;
  }
  let base;
  try { base = new URL(config.baseUrl || config.url || defaultBaseUrl); }
  catch { throw new Error("blog.config.json baseUrl must be an absolute HTTP(S) URL."); }
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || (base.pathname !== "/" && base.pathname !== "")) throw new Error("blog.config.json baseUrl must be an HTTP(S) site origin, without a path, credentials, query, or hash.");
  config.baseUrl = base.origin;
  return config;
}

function tagRoutesFor(tags) {
  // The digest keeps routes stable even for punctuation-only labels or labels differing only by case.
  return Object.fromEntries(tags.map((tag) => {
    let base = Array.from(basicSlug(tag)).slice(0, 60).join("") || "topic";
    if (windowsReserved.test(base)) base = "topic-" + base;
    return [tag, base + "-" + createHash("sha256").update(tag).digest("hex").slice(0, 10)];
  }));
}

function pageFromTemplate(template, site, { title = site.name, description = site.description, path = "/" } = {}) {
  const values = {
    SITE_NAME: site.name, SITE_AUTHOR: site.author, SITE_TAGLINE: site.tagline,
    SITE_DESCRIPTION: description, SITE_URL: site.baseUrl + path, SITE_TITLE: title
  };
  return template.replace(/\{\{(SITE_[A-Z_]+)\}\}/g, (token, key) => Object.hasOwn(values, key) ? escapeHtml(values[key]) : token);
}

function makeFeed(site) {
  const items = site.posts.map((post) => {
    const url = escapeXml(site.baseUrl + postUrl(post));
    return [
      "    <item>", "      <title>" + escapeXml(post.title) + "</title>",
      "      <link>" + url + "</link>", '      <guid isPermaLink="true">' + url + "</guid>",
      "      <pubDate>" + new Date(post.date + "T00:00:00Z").toUTCString() + "</pubDate>",
      "      <description>" + escapeXml(post.excerpt) + "</description>",
      ...post.tags.map((tag) => "      <category>" + escapeXml(tag) + "</category>"),
      "    </item>"
    ].join("\n");
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0"><channel>',
    "<title>" + escapeXml(site.name) + "</title>", "<link>" + escapeXml(site.baseUrl) + "/</link>",
    "<description>" + escapeXml(site.description) + "</description>", "<language>zh-cn</language>",
    ...items, "</channel></rss>", ""].join("\n");
}

export async function buildSite({ rootDir = projectDirectory, outputDir = join(rootDir, "dist") } = {}) {
  rootDir = resolve(rootDir);
  outputDir = resolve(outputDir);
  if (inside(outputDir, rootDir) || ["content", "assets", "admin", "scripts", ".git", ".github", "node_modules"].some((name) => inside(join(rootDir, name), outputDir) || inside(outputDir, join(rootDir, name)))) {
    throw new Error("Refusing to replace a source directory with generated output.");
  }
  const config = readConfig(await readFile(join(rootDir, "blog.config.json"), "utf8"));
  const markdown = createMarkdown();
  const postsRoot = join(rootDir, "content", "posts");
  const posts = [];
  const seen = new Set();
  for (const filePath of await listMarkdown(postsRoot)) {
    const post = parsePost(await readFile(filePath, "utf8"), filePath, rootDir, postsRoot, markdown);
    if (!post) continue;
    const key = slugKey(post.slug);
    if (seen.has(key)) throw new Error("Two Markdown files use the same slug: " + post.slug + ".");
    seen.add(key);
    posts.push(post);
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "zh-CN"));
  let aboutHtml = "";
  const explicitAboutPath = config.about ?? config.aboutPath;
  const aboutPath = explicitAboutPath ?? "content/about.md";
  {
    if (typeof aboutPath !== "string") throw new Error("Configured about path must be text.");
    const filePath = resolve(rootDir, aboutPath);
    if (!inside(rootDir, filePath) || extname(filePath).toLowerCase() !== ".md") throw new Error("Configured about path must be a Markdown file inside the project.");
    try {
      aboutHtml = markdown.render(splitFrontMatter(await readFile(filePath, "utf8"), aboutPath, false).content);
    } catch (error) {
      if (error.code !== "ENOENT" || explicitAboutPath !== undefined) throw error;
    }
  }
  const tags = [...new Set(posts.flatMap((post) => post.tags))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const site = { ...config, posts, aboutHtml, tagRoutes: tagRoutesFor(tags) };
  const template = await readFile(join(rootDir, "index.html"), "utf8");
  const pages = [
    { path: "/", directory: "", title: site.name + " | " + site.tagline },
    { path: "/archive/", directory: "archive", title: "文章归档 | " + site.name },
    { path: "/tags/", directory: "tags", title: "按主题浏览 | " + site.name },
    { path: "/search/", directory: "search", title: "搜索博客 | " + site.name },
    { path: "/about/", directory: "about", title: "关于 | " + site.name },
    ...posts.map((post) => ({ path: postUrl(post), directory: join("posts", post.slug), title: post.title + " | " + site.name, description: post.excerpt })),
    ...tags.map((tag) => ({ path: tagUrl(site.tagRoutes[tag]), directory: join("tags", site.tagRoutes[tag]), title: tag + " | " + site.name }))
  ];
  // Validate all input before removing the last generated site.
  for (const name of ["app.js", "styles.css", "favicon.svg"]) await stat(join(rootDir, name));
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const name of ["app.js", "styles.css", "favicon.svg"]) await cp(join(rootDir, name), join(outputDir, name));
  try {
    if ((await stat(join(rootDir, "assets"))).isDirectory()) await cp(join(rootDir, "assets"), join(outputDir, "assets"), { recursive: true, filter: (source) => !basename(source).startsWith(".") && !/\.md$/i.test(source) });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const page of pages) {
    const directory = join(outputDir, page.directory);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), pageFromTemplate(template, site, page), "utf8");
  }
  await writeFile(join(outputDir, "404.html"), pageFromTemplate(template, site, { title: "页面不存在 | " + site.name, path: "/404.html" }), "utf8");
  // JSON.parse preserves labels such as "__proto__" as ordinary own properties.
  const dataJson = JSON.stringify(site);
  await writeFile(join(outputDir, "blog.js"), "window.BLOG=JSON.parse(" + JSON.stringify(dataJson).replace(/</g, "\\u003c") + ");\n", "utf8");
  await writeFile(join(outputDir, "feed.xml"), makeFeed(site), "utf8");
  await writeFile(join(outputDir, "sitemap.xml"), ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...pages.map((page) => "  <url><loc>" + escapeXml(site.baseUrl + page.path) + "</loc></url>"), "</urlset>", ""].join("\n"), "utf8");
  await writeFile(join(outputDir, "robots.txt"), "User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /author/\nSitemap: " + site.baseUrl + "/sitemap.xml\n", "utf8");
  await writeFile(join(outputDir, ".nojekyll"), "", "utf8");
  let hasAdmin = false;
  try { hasAdmin = (await stat(join(rootDir, "admin", "index.html"))).isFile(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (hasAdmin) await buildAdmin({ rootDir, outputDir });
  return site;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const site = await buildSite();
  console.log("Built site for " + site.author + ": " + site.posts.length + " posts, " + Object.keys(site.tagRoutes).length + " topics.");
}
