import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist");
const siteUrl = "https://dongpobreeze.github.io";
const contentFiles = ["index.html", "styles.css", "app.js", "posts.js", "favicon.svg"];
const noteContext = { window: {} };
runInNewContext(await readFile(join(root, "posts.js"), "utf8"), noteContext);
const notes = noteContext.window.NOTES;

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of contentFiles) await cp(join(root, name), join(output, name));
await cp(join(root, "assets"), join(output, "assets"), { recursive: true });

const routeDirectories = ["archive", "tags", "search", "about"];
for (const post of notes.posts) routeDirectories.push(`posts/${post.slug}`);
for (const tag of new Set(notes.posts.flatMap((post) => post.tags))) routeDirectories.push(`tags/${tag}`);
for (const route of routeDirectories) {
  const directory = join(output, route);
  await mkdir(directory, { recursive: true });
  await cp(join(root, "index.html"), join(directory, "index.html"));
}
await cp(join(root, "index.html"), join(output, "404.html"));
await writeFile(join(output, ".nojekyll"), "", "utf8");
await writeFile(join(output, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`, "utf8");

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;"
})[char]);
const entries = notes.posts.map((post) => {
  const url = `${siteUrl}/posts/${post.slug}/`;
  const categories = post.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join("\n      ");
  return `    <item>\n      <title>${escapeXml(post.title)}</title>\n      <link>${url}</link>\n      <guid isPermaLink="true">${url}</guid>\n      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>\n      <description>${escapeXml(post.excerpt)}</description>\n      ${categories}\n    </item>`;
}).join("\n");
const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escapeXml(notes.name)}</title>\n    <link>${siteUrl}/</link>\n    <description>${escapeXml(notes.description)}</description>\n    <language>zh-cn</language>\n${entries}\n  </channel>\n</rss>\n`;
await writeFile(join(output, "feed.xml"), feed, "utf8");

const urls = ["/", "/archive/", "/tags/", "/search/", "/about/"];
for (const post of notes.posts) urls.push(`/posts/${post.slug}/`);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${siteUrl}${url}</loc></url>`).join("\n")}\n</urlset>\n`;
await writeFile(join(output, "sitemap.xml"), sitemap, "utf8");
console.log(`Built ${notes.posts.length} articles, ${new Set(notes.posts.flatMap((post) => post.tags)).size} topics, and ${routeDirectories.length + 1} direct routes.`);
