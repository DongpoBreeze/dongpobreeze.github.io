(() => {
  const data = window.BLOG || {};
  data.author ||= "博客作者";
  data.name ||= "我的博客";
  data.tagline ||= "记录所思所做。";
  data.description ||= "个人文章与生活记录。";
  data.posts ||= [];

  const app = document.getElementById("app");
  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const formatDate = (date) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00`));
  const dateShort = (date) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00`));
  const allTags = [...new Set(data.posts.flatMap((post) => post.tags || []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const tagCount = (tag) => data.posts.filter((post) => (post.tags || []).includes(tag)).length;
  const tagUrl = (tag) => `/tags/${encodeURIComponent(data.tagRoutes?.[tag] || tag)}/`;
  const postUrl = (post) => `/posts/${encodeURIComponent(post.slug)}/`;
  const tagMarkup = (tags = []) => tags.length ? `<div class="tag-list">${tags.map((tag) => `<a class="tag-pill" href="${tagUrl(tag)}">${escapeHtml(tag)}</a>`).join("")}</div>` : "";
  const metaMarkup = (post) => `<div class="row-meta"><span>${post.reading || 1} 分钟阅读</span>${post.tags?.length ? `<span class="meta-dot" aria-hidden="true"></span><span>${escapeHtml(post.tags[0])}</span>` : ""}</div>`;
  const listMarkup = (posts) => posts.map((post) => `
    <article class="post-row">
      <time class="post-date" datetime="${post.date}">${dateShort(post.date)}</time>
      <div>
        <h2 class="post-title"><a href="${postUrl(post)}">${escapeHtml(post.title)}</a></h2>
        ${post.excerpt ? `<p class="post-description">${escapeHtml(post.excerpt)}</p>` : ""}
        ${metaMarkup(post)}
      </div>
    </article>`).join("");
  const setPageMeta = (title, description) => {
    document.title = title;
    document.querySelector('meta[name="description"]').content = description || data.description;
    document.querySelector('meta[property="og:title"]').content = title;
    document.querySelector('meta[property="og:description"]').content = description || data.description;
    document.querySelector('link[rel="canonical"]').href = `${window.location.origin}${window.location.pathname}`;
  };
  const pageHead = (eyebrow, title, description = "") => {
    setPageMeta(`${title} | ${data.name}`, description);
    return `<header class="page-head"><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ""}</header>`;
  };
  const emptyState = (message) => `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;

  function renderHome() {
    const posts = data.posts;
    const latest = posts[0];
    const copy = latest ? `<article class="feature-card feature-text-only" aria-labelledby="feature-title">
        <div class="feature-copy">
          <span class="feature-label">最新文章</span>
          <h2 id="feature-title"><a href="${postUrl(latest)}">${escapeHtml(latest.title)}</a></h2>
          ${latest.excerpt ? `<p>${escapeHtml(latest.excerpt)}</p>` : ""}
          <div class="feature-meta"><time datetime="${latest.date}">${formatDate(latest.date)}</time><span class="meta-dot" aria-hidden="true"></span><span>${latest.reading || 1} 分钟阅读</span></div>
          ${tagMarkup(latest.tags)}
        </div>
      </article>` : "";
    const remaining = latest ? posts.slice(1, 6) : posts;
    app.innerHTML = `
      <section class="home-intro">
        <p class="eyebrow">${posts.length ? `${posts.length} 篇文章` : "个人博客"}</p>
        <h1>${escapeHtml(data.tagline)}</h1>
        <p>${escapeHtml(data.description)}</p>
      </section>
      ${copy}
      ${latest ? `<div class="section-heading"><h2>近期文章</h2><a href="/archive/">查看完整归档 <span aria-hidden="true">→</span></a></div>` : ""}
      <section class="post-list" aria-label="近期文章列表">${remaining.length ? listMarkup(remaining) : emptyState(latest ? "更多文章，陆续更新。" : "还没有发表文章，新的记录会出现在这里。")}</section>
      ${allTags.length ? `<div class="section-heading"><h2>文章主题</h2><a href="/tags/">浏览全部 <span aria-hidden="true">→</span></a></div><div class="tag-cloud">${allTags.slice(0, 6).map((tag) => `<a class="tag-card" href="${tagUrl(tag)}"><span>${escapeHtml(tag)}</span><span>${tagCount(tag)}</span></a>`).join("")}</div>` : ""}`;
  }

  function renderArchive() {
    if (!data.posts.length) {
      app.innerHTML = `${pageHead("按时间整理", "文章归档", "文章按发布日期整理。")}${emptyState("还没有发表文章。")}`;
      return;
    }
    const groups = data.posts.reduce((accumulator, post) => {
      const year = post.date.slice(0, 4);
      accumulator[year] ||= [];
      accumulator[year].push(post);
      return accumulator;
    }, {});
    const years = Object.keys(groups).sort((a, b) => Number(b) - Number(a));
    app.innerHTML = `${pageHead("按时间整理", "文章归档", `共 ${data.posts.length} 篇文章。`)}<div class="page-content">${years.map((year) => `
      <section aria-labelledby="year-${year}">
        <div class="year-heading"><h2 id="year-${year}">${year}</h2><span>${groups[year].length} 篇</span></div>
        <div class="post-list">${listMarkup(groups[year])}</div>
      </section>`).join("")}</div>`;
  }

  function renderTags() {
    app.innerHTML = `${pageHead("索引", "按主题浏览", "从感兴趣的主题开始阅读。")}
      <section class="page-content">${allTags.length ? `<div class="tag-cloud">${allTags.map((tag) => `<a class="tag-card" href="${tagUrl(tag)}"><span>${escapeHtml(tag)}</span><span>${tagCount(tag)} 篇</span></a>`).join("")}</div>` : emptyState("暂时没有主题。")}</section>`;
  }

  function renderTag(route) {
    const tag = Object.entries(data.tagRoutes || {}).find(([, slug]) => slug === route)?.[0] || route;
    const posts = data.posts.filter((post) => (post.tags || []).includes(tag));
    if (!allTags.includes(tag)) return renderNotFound();
    app.innerHTML = `${pageHead("主题", tag, `${posts.length} 篇相关文章`)}<section class="page-content post-list">${listMarkup(posts)}</section>`;
  }

  function renderSearch() {
    const initial = new URLSearchParams(window.location.search).get("q") || "";
    app.innerHTML = `${pageHead("查找文章", "搜索博客", "通过标题、主题和摘要查找内容。")}
      <section class="page-content">
        <form class="search-form" role="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7"></circle><path d="m16 16 4.5 4.5"></path></svg>
          <input id="search-input" type="search" name="q" value="${escapeHtml(initial)}" placeholder="输入关键词…" autocomplete="off" aria-label="搜索标题、主题和摘要" />
          <button class="icon-button" type="button" id="clear-search" aria-label="清除搜索" title="清除搜索" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button>
        </form>
        <p class="result-count" id="result-count" aria-live="polite"></p>
        <div id="search-results" class="post-list"></div>
      </section>`;
    const input = $("#search-input");
    const results = $("#search-results");
    const count = $("#result-count");
    const clear = $("#clear-search");
    $(".search-form").addEventListener("submit", (event) => event.preventDefault());
    const update = () => {
      const query = input.value.trim().toLocaleLowerCase("zh-CN");
      const matches = data.posts.filter((post) => [post.title, post.excerpt || "", ...(post.tags || [])].join(" ").toLocaleLowerCase("zh-CN").includes(query));
      count.textContent = query ? `找到 ${matches.length} 篇文章` : `共 ${data.posts.length} 篇文章`;
      results.innerHTML = matches.length ? listMarkup(matches) : emptyState(data.posts.length ? "没有找到相关内容，可以换一个关键词。" : "还没有文章可以搜索。");
      clear.hidden = !input.value;
      const url = new URL(window.location.href);
      if (input.value) url.searchParams.set("q", input.value);
      else url.searchParams.delete("q");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    };
    input.addEventListener("input", update);
    clear.addEventListener("click", () => { input.value = ""; input.focus(); update(); });
    if (!initial && data.posts.length) requestAnimationFrame(() => input.focus({ preventScroll: true }));
    update();
  }

  function renderArticle(post) {
    if (!post) return renderNotFound();
    const index = data.posts.indexOf(post);
    const newer = data.posts[index - 1];
    const older = data.posts[index + 1];
    const content = post.html || post.sections?.map((section) => `
      <section><h2>${escapeHtml(section.heading)}</h2>
        ${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        ${section.list ? `<ul>${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        ${section.quote ? `<blockquote>${escapeHtml(section.quote)}</blockquote>` : ""}
      </section>`).join("") || "";
    setPageMeta(`${post.title} | ${data.name}`, post.excerpt || data.description);
    app.innerHTML = `
      <article class="article-page">
        <header class="article-head">
          ${tagMarkup(post.tags)}
          <h1>${escapeHtml(post.title)}</h1>
          ${post.excerpt ? `<p class="article-standfirst">${escapeHtml(post.excerpt)}</p>` : ""}
          <div class="article-byline"><span class="article-avatar" aria-hidden="true">${escapeHtml(data.author[0] || "我")}</span><span>${escapeHtml(data.author)}</span><span class="meta-dot" aria-hidden="true"></span><time datetime="${post.date}">${formatDate(post.date)}</time><span class="meta-dot" aria-hidden="true"></span><span>${post.reading || 1} 分钟阅读</span></div>
        </header>
        <div class="article-body">${content}</div>
        <footer class="article-footer"><span>${escapeHtml(data.author)} · ${escapeHtml(data.name)}</span><button class="copy-button" id="copy-link" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg><span>复制链接</span></button></footer>
        <nav class="article-next" aria-label="相邻文章">
          <a href="${newer ? postUrl(newer) : "/archive/"}"><span>← 更新的文章</span>${escapeHtml(newer ? newer.title : "文章归档")}</a>
          <a href="${older ? postUrl(older) : "/archive/"}" style="text-align:right"><span>更早的文章 →</span>${escapeHtml(older ? older.title : "查看全部文章")}</a>
        </nav>
      </article>`;
    $("#copy-link").addEventListener("click", async (event) => {
      const label = $("span", event.currentTarget);
      try {
        await navigator.clipboard.writeText(window.location.href);
        label.textContent = "链接已复制";
      } catch {
        label.textContent = "复制失败";
      }
      window.setTimeout(() => { label.textContent = "复制链接"; }, 1800);
    });
  }

  function renderAbout() {
    app.innerHTML = `${pageHead("关于这个站点", "关于我", data.description)}
      <article class="page-content about-copy">
        ${data.aboutHtml || "<p>欢迎来到我的个人博客。</p>"}
      </article>`;
  }

  function renderNotFound() {
    app.innerHTML = `${pageHead("页面不存在", "没有找到这篇文章", "它可能已经更名或移动。")}
      <div class="page-content"><a class="text-link" href="/">回到首页 →</a></div>`;
  }

  function route(focusMain = true) {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    document.querySelectorAll("[data-nav]").forEach((link) => link.classList.toggle("active", (link.dataset.nav === "home" && path === "/") || link.dataset.nav === path.slice(1) || path.startsWith(`/${link.dataset.nav}/`)));
    if (path === "/") {
      setPageMeta(`${data.name} | ${data.tagline}`, data.description);
      renderHome();
    } else if (path === "/archive") renderArchive();
    else if (path === "/tags") renderTags();
    else if (path === "/search") renderSearch();
    else if (path === "/about") renderAbout();
    else if (path.startsWith("/tags/")) renderTag(decodeURIComponent(path.slice("/tags/".length)));
    else if (path.startsWith("/posts/")) renderArticle(data.posts.find((post) => post.slug === decodeURIComponent(path.slice("/posts/".length))));
    else renderNotFound();
    if (focusMain) document.getElementById("main").focus({ preventScroll: true });
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || link.target || link.hasAttribute("download") || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.origin !== window.location.origin || link.hash || !/^\/(?:$|archive\/?$|tags(?:\/|$)|about\/?$|search\/?$|posts(?:\/|$))/.test(link.pathname)) return;
    event.preventDefault();
    if (link.href === window.location.href) return;
    window.history.pushState({}, "", link.href);
    route();
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });
  window.addEventListener("popstate", route);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    event.preventDefault();
    window.location.assign("/search/");
  });

  const savedTheme = localStorage.getItem("notes-theme");
  if (savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
  const themeToggle = document.getElementById("theme-toggle");
  const syncThemeControl = () => {
    const label = document.documentElement.classList.contains("dark") ? "切换浅色主题" : "切换深色主题";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  };
  syncThemeControl();
  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    localStorage.setItem("notes-theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
    syncThemeControl();
  });
  document.getElementById("year").textContent = new Date().getFullYear();
  route(false);
})();
