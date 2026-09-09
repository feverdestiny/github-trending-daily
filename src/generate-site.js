import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 归档分页大小：每页 30 天。 */
export const ARCHIVE_PAGE_SIZE = 30;

/**
 * 转义用户/抓取文本，避免描述里的 HTML 破坏页面。
 * 同时用于普通文本与 HTML 属性值（引号会被转义）。
 * @param {unknown} value
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {number} n
 */
function formatCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}

/**
 * HN / Reddit 讨论搜索外链：纯 URL 模板，零抓取。
 * fullName 经 encodeURIComponent 编码后还需属性转义再进 HTML。
 * @param {string} fullName
 */
function hnSearchUrl(fullName) {
  return `https://news.ycombinator.com/search?query=${encodeURIComponent(String(fullName ?? ""))}`;
}

/**
 * @param {string} fullName
 */
function redditSearchUrl(fullName) {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(String(fullName ?? ""))}`;
}

/**
 * 由语言名派生稳定的色相（0-359），用于语言圆点着色。
 * @param {string} language
 */
function languageHue(language) {
  const text = String(language ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * 读取 data 目录下全部日归档，按日期新到旧排序。
 * @param {string} dataDir
 */
export function loadDigests(dataDir) {
  const files = readdirSync(dataDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();

  return files.map((name) => {
    const digest = JSON.parse(readFileSync(join(dataDir, name), "utf8"));
    return digest;
  });
}

/** 首屏主题引导：在样式表渲染前把 data-theme 写到 <html> 上，避免深色模式闪白。 */
const THEME_BOOTSTRAP = `<script>
  (function () {
    var stored = null;
    try { stored = localStorage.getItem("theme"); } catch (e) {}
    var theme = stored === "light" || stored === "dark" ? stored
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>`;

/** 手动切换按钮：翻转 data-theme 并写入 localStorage。 */
const THEME_TOGGLE_SCRIPT = `<script>
  (function () {
    var button = document.getElementById("theme-toggle");
    if (!button) return;
    button.addEventListener("click", function () {
      var root = document.documentElement;
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  })();
</script>`;

/** 主题切换按钮图标：浅色显示月亮（切到深色），深色显示太阳（切回浅色）。 */
const THEME_ICONS = `<svg class="icon-moon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M20.8 13.1A8.5 8.5 0 0 1 10.9 3.2a8.5 8.5 0 1 0 9.9 9.9z" fill="currentColor"/></svg><svg class="icon-sun" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2.5v2m0 15v2M4.8 4.8l1.4 1.4m11.6 11.6 1.4 1.4M2.5 12h2m15 0h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>`;

/**
 * @param {string} title
 * @param {string} cssHref
 * @param {string} body
 */
function page(title, cssHref, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="GitHub 每日 Trending 归档：卡片式榜单、话题标签、增速与讨论外链">
  ${THEME_BOOTSTRAP}
  <link rel="stylesheet" href="${cssHref}">
</head>
<body>
  ${body}
  ${THEME_TOGGLE_SCRIPT}
</body>
</html>
`;
}

/**
 * @param {{ homeHref: string, archiveHref: string, current: "home" | "archive" | "day" }} nav
 */
function header(nav) {
  return `
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="${nav.homeHref}">GitHub 每日热门</a>
      <div class="header-actions">
        <nav class="nav" aria-label="站点导航">
          <a href="${nav.homeHref}"${nav.current === "home" ? ' aria-current="page"' : ""}>今日</a>
          <a href="${nav.archiveHref}"${nav.current === "archive" ? ' aria-current="page"' : ""}>归档</a>
        </nav>
        <button id="theme-toggle" class="theme-toggle" type="button" aria-label="切换深浅色模式">${THEME_ICONS}</button>
      </div>
    </div>
  </header>`;
}

function footer() {
  return `
  <footer class="site-footer">
    <div class="wrap">
      <p>数据来自非官方抓取 <a href="https://github.com/trending?since=daily" target="_blank" rel="noreferrer">github.com/trending</a>。GitHub 改版页面结构后，抓取可能失败。</p>
    </div>
  </footer>`;
}

/**
 * 单个仓库卡片：排名、全名外链、简介（钳制行数）、语言圆点、总星标、
 * 当日增速、话题标签、许可证、作者头像与 HN/Reddit 讨论外链。
 * v1 旧快照没有 topics/license/ownerAvatarUrl，对应区块直接省略。
 * @param {object} repo
 */
function repoCard(repo) {
  const name = escapeHtml(repo.fullName);
  const description = repo.description ? escapeHtml(repo.description) : "暂无简介";
  const language = repo.language
    ? `<span class="lang"><i class="dot" style="--hue:${languageHue(repo.language)}" aria-hidden="true"></i>${escapeHtml(repo.language)}</span>`
    : `<span class="lang muted">未标注语言</span>`;
  const topics = Array.isArray(repo.topics) && repo.topics.length
    ? `<ul class="topics">${repo.topics
        .map((topic) => `<li class="topic">${escapeHtml(topic)}</li>`)
        .join("")}</ul>`
    : "";
  const license = repo.license
    ? `<span class="license">${escapeHtml(repo.license)} 许可证</span>`
    : "";
  const avatar = repo.ownerAvatarUrl
    ? ` <img class="avatar" src="${escapeHtml(repo.ownerAvatarUrl)}" alt="" width="36" height="36" loading="lazy" decoding="async">`
    : "";

  return `
      <article class="card">
        <div class="card-head">
          <span class="rank" aria-label="排名 ${Number(repo.rank) || ""}">${Number(repo.rank) || ""}</span>
          <h2 class="repo"><a href="${escapeHtml(repo.url)}" target="_blank" rel="noreferrer">${name}</a></h2>${avatar}
        </div>
        <p class="desc">${description}</p>
        ${topics}
        <div class="meta">
          ${language}
          <span class="stars">★ ${formatCount(repo.stars)}</span>
          <span class="delta">今日新增 +${formatCount(repo.starsToday)}</span>
        </div>
        <div class="card-foot">
          ${license}
          <span class="discuss">讨论 <a href="${escapeHtml(hnSearchUrl(repo.fullName))}" target="_blank" rel="noreferrer">HN</a> · <a href="${escapeHtml(redditSearchUrl(repo.fullName))}" target="_blank" rel="noreferrer">Reddit</a></span>
        </div>
      </article>`;
}

/**
 * @param {object} digest
 */
function repoCards(digest) {
  if (!digest.repos?.length) {
    return `<p class="empty">当日暂无数据。</p>`;
  }

  return digest.repos.map((repo) => repoCard(repo)).join("\n");
}

/**
 * @param {object} digest
 * @param {string} heading
 * @param {{ homeHref: string, archiveHref: string, current: "home" | "day" }} nav
 * @param {string} extraBanner
 */
function listPage(digest, heading, nav, extraBanner = "", afterList = "") {
  const sampleBanner = digest.sample
    ? `<p class="banner sample">当前为<strong>示例数据</strong>，不是当天的线上抓取结果。</p>`
    : "";
  const fetched = digest.fetchedAt
    ? new Date(digest.fetchedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")
    : "";

  return `
  ${header(nav)}
  <main class="wrap">
    <section class="hero">
      <p class="eyebrow">GitHub Trending · 全语言 · 按日归档</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">共 ${digest.repos?.length ?? 0} 个仓库${fetched ? ` · 抓取于 ${escapeHtml(fetched)}` : ""}</p>
      ${sampleBanner}
      ${extraBanner}
    </section>
    <section class="cards" aria-label="仓库榜单">
      ${repoCards(digest)}
    </section>
    ${afterList}
  </main>
  ${footer()}`;
}

/**
 * "2026-08" → "2026年8月"
 * @param {string} month
 */
function monthLabel(month) {
  const [year, m] = String(month).split("-");
  return `${year}年${Number(m)}月`;
}

/**
 * 归档页里指向某一分页的相对链接（分页间链接全部相对）。
 * 第 1 页固定是 archive/index.html；第 n(n≥2) 页在 archive/page/n/。
 * @param {number} targetPage
 * @param {number} fromPage
 */
function archivePageHref(targetPage, fromPage) {
  if (targetPage === fromPage) return null;
  if (fromPage === 1) return `page/${targetPage}/`;
  return targetPage === 1 ? `../../` : `../${targetPage}/`;
}

/**
 * @param {object} item
 * @param {number} fromPage
 */
function archiveItem(item, fromPage) {
  const base = fromPage === 1 ? "../days/" : "../../days/";
  return `<li><a href="${base}${escapeHtml(item.date)}/"><span class="date">${escapeHtml(item.date)}${item.sample ? "（示例）" : ""}</span><span class="count">${item.repos?.length ?? 0} 个仓库</span></a></li>`;
}

/**
 * 单个归档分页：按月分组的日期列表 + 上一页/下一页 + 页码指示。
 * @param {object[]} digests 新到旧排序的全部日归档
 * @param {number} pageNum
 * @param {number} pageCount
 */
function archiveBody(digests, pageNum, pageCount) {
  const start = (pageNum - 1) * ARCHIVE_PAGE_SIZE;
  const pageDays = digests.slice(start, start + ARCHIVE_PAGE_SIZE);

  const groups = [];
  for (const item of pageDays) {
    const month = String(item.date).slice(0, 7);
    if (!groups.length || groups[groups.length - 1].month !== month) {
      groups.push({ month, days: [] });
    }
    groups[groups.length - 1].days.push(item);
  }

  const groupHtml = groups
    .map(
      (group) => `
        <section class="month-group">
          <h2 class="month-heading">${escapeHtml(monthLabel(group.month))}</h2>
          <ol class="archive-list">
            ${group.days.map((item) => archiveItem(item, pageNum)).join("\n")}
          </ol>
        </section>`,
    )
    .join("\n");

  const prevHref = pageNum > 1 ? archivePageHref(pageNum - 1, pageNum) : null;
  const nextHref = pageNum < pageCount ? archivePageHref(pageNum + 1, pageNum) : null;
  const pager =
    pageCount > 1
      ? `
        <nav class="pager" aria-label="归档分页">
          <span class="pager-slot">${prevHref ? `<a href="${prevHref}" rel="prev">← 上一页</a>` : ""}</span>
          <span class="pager-status">第 ${pageNum} / ${pageCount} 页</span>
          <span class="pager-slot">${nextHref ? `<a href="${nextHref}" rel="next">下一页 →</a>` : ""}</span>
        </nav>`
      : "";

  return `
      ${header({ homeHref: pageNum === 1 ? "../" : "../../", archiveHref: pageNum === 1 ? "./" : "../../archive/", current: "archive" })}
      <main class="wrap">
        <section class="hero">
          <p class="eyebrow">归档 · 按月分组</p>
          <h1>全部日报</h1>
          <p class="lede">共 ${digests.length} 天，最新在上。</p>
        </section>
        ${groupHtml}
        ${pager}
      </main>
      ${footer()}`;
}

export const SITE_CSS = `/* GitHub 每日热门：零框架设计系统。全部主题色走 CSS 自定义属性，
   默认跟随系统深浅色，可通过 <html data-theme> 手动覆盖；不依赖任何外部字体/资源。 */
:root {
  color-scheme: light;
  --bg: #f5f6f8;
  --card: #ffffff;
  --ink: #1b2530;
  --muted: #5a6572;
  --line: #e4e8ee;
  --line-strong: #c9d3e0;
  --link: #1a53b8;
  --link-strong: #123c8a;
  --rank-bg: #eef2f8;
  --chip-bg: #edf1f6;
  --chip-ink: #43505f;
  --delta: #11603a;
  --delta-bg: #e2f4ea;
  --warn-bg: #fff7ed;
  --warn-border: #fdba74;
  --warn-ink: #7c3a0c;
  --danger-bg: #fff1f2;
  --danger-border: #fda4af;
  --shadow: rgba(15, 23, 42, 0.07);
}
html[data-theme="dark"] { color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) { color-scheme: dark; }
}

/* 深色主题：手动切换与系统跟随使用同一组变量值 */
html[data-theme="dark"] {
  --bg: #0e1319;
  --card: #151c24;
  --ink: #e6ebf1;
  --muted: #9da9b7;
  --line: #263140;
  --line-strong: #35455a;
  --link: #82b1f8;
  --link-strong: #a8c8fb;
  --rank-bg: #1d2836;
  --chip-bg: #202b38;
  --chip-ink: #c6d1dd;
  --delta: #4cc38a;
  --delta-bg: rgba(76, 195, 138, 0.13);
  --warn-bg: rgba(253, 186, 116, 0.1);
  --warn-border: rgba(253, 186, 116, 0.45);
  --warn-ink: #f5c08b;
  --danger-bg: rgba(253, 164, 175, 0.1);
  --danger-border: rgba(253, 164, 175, 0.45);
  --shadow: rgba(0, 0, 0, 0.35);
}
@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) {
    --bg: #0e1319;
    --card: #151c24;
    --ink: #e6ebf1;
    --muted: #9da9b7;
    --line: #263140;
    --line-strong: #35455a;
    --link: #82b1f8;
    --link-strong: #a8c8fb;
    --rank-bg: #1d2836;
    --chip-bg: #202b38;
    --chip-ink: #c6d1dd;
    --delta: #4cc38a;
    --delta-bg: rgba(76, 195, 138, 0.13);
    --warn-bg: rgba(253, 186, 116, 0.1);
    --warn-border: rgba(253, 186, 116, 0.45);
    --warn-ink: #f5c08b;
    --danger-bg: rgba(253, 164, 175, 0.1);
    --danger-border: rgba(253, 164, 175, 0.45);
    --shadow: rgba(0, 0, 0, 0.35);
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
html, body { margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.65;
  font-size: 16px;
  min-height: 100vh;
}

a { color: var(--link); text-underline-offset: 2px; }
a:hover { color: var(--link-strong); }
a:focus-visible, button:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: 2px;
  border-radius: 4px;
}

.wrap { width: min(1080px, calc(100% - 32px)); margin: 0 auto; }

.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--card);
  border-bottom: 1px solid var(--line);
  padding: 10px 0;
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.brand {
  color: var(--ink);
  text-decoration: none;
  font-weight: 700;
  font-size: 17px;
  letter-spacing: 0.01em;
}
.header-actions { display: flex; align-items: center; gap: 14px; }
.nav { display: flex; gap: 16px; }
.nav a { color: var(--muted); text-decoration: none; font-size: 15px; }
.nav a[aria-current="page"], .nav a:hover { color: var(--ink); }
.theme-toggle {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.theme-toggle:hover { border-color: var(--line-strong); color: var(--ink); }
.icon-sun { display: none; }
html[data-theme="dark"] .icon-sun { display: block; }
html[data-theme="dark"] .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) .icon-sun { display: block; }
  html:not([data-theme="light"]) .icon-moon { display: none; }
}

.hero { padding: 34px 0 14px; max-width: 760px; }
.eyebrow {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.hero h1 { margin: 0 0 8px; font-size: clamp(26px, 5vw, 38px); line-height: 1.2; }
.lede, .empty { color: var(--muted); }
.hero-links { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 10px 0 0; font-size: 14px; }
.banner {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  color: var(--warn-ink);
  font-size: 14px;
}
.banner.sample { background: var(--danger-bg); border-color: var(--danger-border); }

/* 卡片网格：移动端单列，宽屏自适应多列 */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr));
  gap: 14px;
  padding: 12px 0 48px;
}
.card {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.card:hover {
  border-color: var(--line-strong);
  box-shadow: 0 4px 16px var(--shadow);
  transform: translateY(-1px);
}
.card-head { display: flex; align-items: center; gap: 10px; }
.rank {
  flex: none;
  display: inline-grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--rank-bg);
  color: var(--link);
  font-weight: 700;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.repo { margin: 0; font-size: 16px; font-weight: 650; min-width: 0; flex: 1; }
.repo a { text-decoration: none; overflow-wrap: anywhere; }
.repo a:hover { text-decoration: underline; }
.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  border: 1px solid var(--line);
}
.desc {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 14px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.topics {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
}
.topic {
  font-size: 12px;
  line-height: 1.6;
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--chip-ink);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: 12px;
  font-size: 13.5px;
  color: var(--muted);
}
.lang { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.lang.muted { color: var(--muted); opacity: 0.8; }
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: hsl(var(--hue, 210) 62% 48%);
}
.delta {
  margin-left: auto;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--delta-bg);
  color: var(--delta);
  font-weight: 700;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.card-foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: auto;
  padding-top: 10px;
  margin-top: 12px;
  border-top: 1px dashed var(--line);
  font-size: 13px;
  color: var(--muted);
}
.license { overflow-wrap: anywhere; }
.discuss { white-space: nowrap; }
.discuss a { font-weight: 600; }

/* 归档：按月分组 + 分页 */
.month-group { padding-bottom: 6px; }
.month-heading {
  margin: 22px 0 0;
  padding-bottom: 6px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.archive-list { list-style: none; padding: 0; margin: 0; }
.archive-list li { border-bottom: 1px solid var(--line); }
.archive-list a {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  padding: 13px 2px;
  text-decoration: none;
  color: inherit;
}
.archive-list a:hover .date { color: var(--link); }
.date { font-weight: 650; font-variant-numeric: tabular-nums; }
.count { color: var(--muted); font-size: 14px; }

.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 20px 0 48px;
}
.pager-slot { min-width: 84px; }
.pager-slot:last-child { text-align: right; }
.pager a { text-decoration: none; font-weight: 600; }
.pager-status { color: var(--muted); font-size: 14px; }

.day-nav {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0 8px;
}
.day-nav a { text-decoration: none; font-weight: 600; }
.data-line { margin: 0; padding-bottom: 32px; color: var(--muted); font-size: 13px; }
.data-line a { font-variant-numeric: tabular-nums; }

.site-footer {
  border-top: 1px solid var(--line);
  padding: 20px 0 32px;
  color: var(--muted);
  font-size: 13px;
}
.site-footer a { color: inherit; }

@media (max-width: 560px) {
  .wrap { width: calc(100% - 24px); }
  .hero { padding: 24px 0 10px; }
  .brand { font-size: 16px; }
  .nav { gap: 12px; }
  .cards { gap: 10px; }
  .card { padding: 13px; }
  .delta { margin-left: 0; }
}
`;

/**
 * 根据 data/*.json 生成静态站点。
 * 链接全部使用相对路径，这样在 GitHub Pages 项目站
 * （https://user.github.io/github-trending-daily/）和本地预览都能工作。
 *
 * @param {{ dataDir?: string, siteDir?: string }} [options]
 */
export function generateSite(options = {}) {
  const dataDir = options.dataDir ?? join(repoRoot, "data");
  const siteDir = options.siteDir ?? join(repoRoot, "site");
  const digests = loadDigests(dataDir);

  if (digests.length === 0) {
    throw new Error(`No daily JSON files found in ${dataDir}`);
  }

  rmSync(siteDir, { recursive: true, force: true });
  mkdirSync(join(siteDir, "assets"), { recursive: true });
  mkdirSync(join(siteDir, "archive"), { recursive: true });
  mkdirSync(join(siteDir, "days"), { recursive: true });

  // 数据直出：每个 data/YYYY-MM-DD.json 原样复制为可直接访问的站点 URL。
  mkdirSync(join(siteDir, "data"), { recursive: true });
  for (const name of readdirSync(dataDir).filter((name) =>
    /^\d{4}-\d{2}-\d{2}\.json$/.test(name),
  )) {
    copyFileSync(join(dataDir, name), join(siteDir, "data", name));
  }

  writeFileSync(join(siteDir, ".nojekyll"), "");
  writeFileSync(join(siteDir, "assets/style.css"), SITE_CSS);

  const latest = digests[0];
  const dates = digests.map((item) => item.date);

  writeFileSync(
    join(siteDir, "index.html"),
    page(
      `${latest.date} · GitHub 每日热门`,
      "./assets/style.css",
      listPage(
        latest,
        `${latest.date} 今日热门`,
        { homeHref: "./", archiveHref: "./archive/", current: "home" },
        `<p class="hero-links"><a href="./days/${latest.date}/">查看当日独立页面</a><a href="./data/${latest.date}.json">本日数据 JSON</a></p>`,
      ),
    ),
  );

  // 归档分页：第 1 页 = archive/index.html（最新），其余在 archive/page/N/。
  const pageCount = Math.max(1, Math.ceil(digests.length / ARCHIVE_PAGE_SIZE));
  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const isRootPage = pageNum === 1;
    const dir = isRootPage
      ? join(siteDir, "archive")
      : join(siteDir, "archive", "page", String(pageNum));
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      join(dir, "index.html"),
      page(
        `归档${isRootPage ? "" : ` · 第 ${pageNum} 页`} · GitHub 每日热门`,
        isRootPage ? "../assets/style.css" : "../../assets/style.css",
        archiveBody(digests, pageNum, pageCount),
      ),
    );
  }

  for (let i = 0; i < digests.length; i += 1) {
    const digest = digests[i];
    const newer = digests[i - 1];
    const older = digests[i + 1];
    const dayDir = join(siteDir, "days", digest.date);
    mkdirSync(dayDir, { recursive: true });

    const navLinks = `
      <nav class="day-nav">
        <span>${newer ? `<a href="../${newer.date}/">← ${escapeHtml(newer.date)}</a>` : ""}</span>
        <span>${older ? `<a href="../${older.date}/">${escapeHtml(older.date)} →</a>` : ""}</span>
      </nav>
      <p class="data-line">本日数据 JSON：<a href="../../data/${escapeHtml(digest.date)}.json">${escapeHtml(digest.date)}.json</a></p>`;

    writeFileSync(
      join(dayDir, "index.html"),
      page(
        `${digest.date} · GitHub 每日热门`,
        "../../assets/style.css",
        listPage(
          digest,
          digest.date,
          {
            homeHref: "../../",
            archiveHref: "../../archive/",
            current: "day",
          },
          "",
          navLinks,
        ),
      ),
    );
  }

  writeFileSync(
    join(siteDir, "404.html"),
    page(
      "未找到 · GitHub 每日热门",
      "./assets/style.css",
      `
      ${header({ homeHref: "./", archiveHref: "./archive/", current: "home" })}
      <main class="wrap">
        <section class="hero">
          <h1>页面不存在</h1>
          <p class="lede"><a href="./">回到今日热门</a> · <a href="./archive/">查看归档</a></p>
        </section>
      </main>
      ${footer()}`,
    ),
  );

  return { latestDate: latest.date, dates, siteDir };
}
