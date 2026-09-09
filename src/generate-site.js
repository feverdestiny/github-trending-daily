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
import {
  languageBoards,
  monthly,
  rollingWindow,
  weekly,
} from "./aggregate.js";
import { buildTrendIndex, sortTrendLeaderboard } from "./trend-archive.js";
import { formatCount } from "./format.js";
import { SITE_CSS } from "./site-css.js";
import {
  FEED_PATH,
  generateAtomFeed,
  normalizeBaseUrl,
  SITE_URL,
} from "./rss.js";

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
 * 语言圆点 chip：有语言时按稳定色相着色，缺失时显示「未标注语言」。
 * repoCard / aggregateCard / trendCard 三处共用，保证渲染逐字节一致。
 * @param {object} entry 携带 language 字段的仓库/榜单条目
 */
function languageChip(entry) {
  return entry.language
    ? `<span class="lang"><i class="dot" style="--hue:${languageHue(entry.language)}" aria-hidden="true"></i>${escapeHtml(entry.language)}</span>`
    : `<span class="lang muted">未标注语言</span>`;
}

/**
 * 读取 data 目录下全部日归档，按日期新到旧排序。
 * @param {string} dataDir
 */
export function loadSnapshots(dataDir) {
  const files = readdirSync(dataDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();

  return files.map((name) => {
    const snapshot = JSON.parse(readFileSync(join(dataDir, name), "utf8"));
    return snapshot;
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
 * @param {string} feedHref 站点 feed 的绝对地址，作为每页 <head> 里的订阅发现链接。
 */
function page(title, cssHref, body, feedHref) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="GitHub 每日 Trending 归档：卡片式榜单、话题标签、增速与讨论外链">
  ${THEME_BOOTSTRAP}
  <link rel="stylesheet" href="${cssHref}">
  <link rel="alternate" type="application/atom+xml" title="GitHub 每日热门" href="${escapeHtml(feedHref)}">
</head>
<body>
  ${body}
  ${THEME_TOGGLE_SCRIPT}
</body>
</html>
`;
}

/**
 * 站点页头。homeHref 恒为带尾斜杠的站点根相对路径（"./"、"../"、"../../"），
 * 周/月/语言/归档入口由它直接派生；趋势档案入口优先用 nav.trendsHref（归档深分页
 * 等目录层级更深的位置需显式传相对路径），未传时同样从 homeHref 派生。
 * 新增导航只需维护下面这一份 entries 清单。
 * @param {{ homeHref: string, trendsHref?: string, current: "home" | "archive" | "day" | "weekly" | "monthly" | "languages" | "trends" }} nav
 */
function header(nav) {
  const rootHref = nav.homeHref.endsWith("/") ? nav.homeHref : `${nav.homeHref}/`;
  const entries = [
    { key: "home", href: nav.homeHref, label: "今日" },
    { key: "weekly", href: `${rootHref}weekly/`, label: "周榜" },
    { key: "monthly", href: `${rootHref}monthly/`, label: "月榜" },
    { key: "languages", href: `${rootHref}languages/`, label: "语言" },
    { key: "trends", href: nav.trendsHref ?? `${rootHref}trends/`, label: "趋势档案" },
    { key: "archive", href: `${rootHref}archive/`, label: "归档" },
  ];

  return `
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="${nav.homeHref}">GitHub 每日热门</a>
      <div class="header-actions">
        <nav class="nav" aria-label="站点导航">
          ${entries
            .map(
              (entry) =>
                `<a href="${entry.href}"${nav.current === entry.key ? ' aria-current="page"' : ""}>${entry.label}</a>`,
            )
            .join("\n          ")}
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
 * 当日增速、连续上榜徽标、话题标签、许可证、作者头像与 HN/Reddit 讨论外链。
 * v1 旧快照没有 topics/license/ownerAvatarUrl，对应区块直接省略。
 * @param {object} repo
 * @param {object|null} [trend] 该仓库截至当日的上榜档案（来自 buildTrendIndex 前缀计算）；
 *   currentStreak ≥ 2 时展示「连续上榜 N 天 · 峰值 #M」徽标
 */
function repoCard(repo, trend = null) {
  const name = escapeHtml(repo.fullName);
  const description = repo.description ? escapeHtml(repo.description) : "暂无简介";
  const language = languageChip(repo);
  const streak =
    trend && trend.currentStreak >= 2
      ? `<span class="streak">连续上榜 ${escapeHtml(trend.currentStreak)} 天 · 峰值 #${trend.bestRank == null ? "?" : escapeHtml(trend.bestRank)}</span>`
      : "";
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
  // AI 一句话导读：仅前 N 名且快照里已有 tldr 时显示；旧快照/未启用则整块省略。
  const tldr = repo.tldr
    ? `<p class="tldr"><span class="tldr-tag">AI 导读</span>${escapeHtml(repo.tldr)}</p>`
    : "";
  // v1 旧快照没有 starsToday：不渲染「今日新增 +0」的假增速；字段为 0 时仍显示 +0。
  const delta = repo.starsToday == null
    ? ""
    : `<span class="delta">今日新增 +${formatCount(repo.starsToday)}</span>`;

  return `
      <article class="card">
        <div class="card-head">
          <span class="rank" aria-label="排名 ${Number(repo.rank) || ""}">${Number(repo.rank) || ""}</span>
          <h2 class="repo"><a href="${escapeHtml(repo.url)}" target="_blank" rel="noreferrer">${name}</a></h2>${streak}${avatar}
        </div>
        <p class="desc">${description}</p>
        ${tldr}
        ${topics}
        <div class="meta">
          ${language}
          <span class="stars">★ ${formatCount(repo.stars)}</span>
          ${delta}
        </div>
        <div class="card-foot">
          ${license}
          <span class="discuss">讨论 <a href="${escapeHtml(hnSearchUrl(repo.fullName))}" target="_blank" rel="noreferrer">HN</a> · <a href="${escapeHtml(redditSearchUrl(repo.fullName))}" target="_blank" rel="noreferrer">Reddit</a></span>
        </div>
      </article>`;
}

/**
 * @param {object} snapshot
 * @param {Map<string, object>|null} [trends] fullName → 截至当日的上榜档案
 */
function repoCards(snapshot, trends = null) {
  if (!snapshot.repos?.length) {
    return `<p class="empty">当日暂无数据。</p>`;
  }

  return snapshot.repos
    .map((repo) => repoCard(repo, trends ? trends.get(repo.fullName) ?? null : null))
    .join("\n");
}

/**
 * @param {object} snapshot
 * @param {string} heading
 * @param {{ homeHref: string, trendsHref: string, current: "home" | "day" }} nav
 * @param {string} extraBanner
 * @param {string} afterList
 * @param {Map<string, object>|null} [trends] 传入时为 currentStreak ≥ 2 的仓库渲染连续上榜徽标
 */
function listPage(snapshot, heading, nav, extraBanner = "", afterList = "", trends = null) {
  const sampleBanner = snapshot.sample
    ? `<p class="banner sample">当前为<strong>示例数据</strong>，不是当天的线上抓取结果。</p>`
    : "";
  const fetched = snapshot.fetchedAt
    ? new Date(snapshot.fetchedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")
    : "";

  return `
  ${header(nav)}
  <main class="wrap">
    <section class="hero">
      <p class="eyebrow">GitHub Trending · 全语言 · 按日归档</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">共 ${snapshot.repos?.length ?? 0} 个仓库${fetched ? ` · 抓取于 ${escapeHtml(fetched)}` : ""}</p>
      ${sampleBanner}
      ${extraBanner}
    </section>
    <section class="cards" aria-label="仓库榜单">
      ${repoCards(snapshot, trends)}
    </section>
    ${afterList}
  </main>
  ${footer()}`;
}

/**
 * 周/月聚合榜卡片：与日榜卡片同构，但增速为区间累计（+N (7天) / +N (30天)），
 * 卡片脚注展示窗口内上榜天数。
 * @param {object} entry src/aggregate.js 聚合榜条目
 * @param {number} windowDays
 */
function aggregateCard(entry, windowDays) {
  const name = escapeHtml(entry.fullName);
  const description = entry.description ? escapeHtml(entry.description) : "暂无简介";
  const language = languageChip(entry);

  return `
      <article class="card">
        <div class="card-head">
          <span class="rank" aria-label="排名 ${Number(entry.rank) || ""}">${Number(entry.rank) || ""}</span>
          <h2 class="repo"><a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${name}</a></h2>
        </div>
        <p class="desc">${description}</p>
        <div class="meta">
          ${language}
          <span class="stars">★ ${formatCount(entry.stars)}</span>
          <span class="delta">+${formatCount(entry.totalDelta)} (${windowDays}天)</span>
        </div>
        <div class="card-foot">
          <span class="appear">${windowDays} 天中上榜 ${Number(entry.appearanceDays) || 0} 天</span>
          <span class="discuss">讨论 <a href="${escapeHtml(hnSearchUrl(entry.fullName))}" target="_blank" rel="noreferrer">HN</a> · <a href="${escapeHtml(redditSearchUrl(entry.fullName))}" target="_blank" rel="noreferrer">Reddit</a></span>
        </div>
      </article>`;
}

/**
 * 周/月聚合榜页。窗口内快照不足 2 天、或没有仓库上榜 ≥2 天时渲染友好空状态。
 * @param {{ heading: string, eyebrow: string, entries: object[], windowDays: number,
 *    start: string, end: string, nav: object, emptyMessage: string, sample?: boolean }} options
 */
function aggregatePage({
  heading,
  eyebrow,
  entries,
  windowDays,
  start,
  end,
  nav,
  emptyMessage,
  sample = false,
}) {
  const cards = entries.length
    ? `
    <section class="cards" aria-label="聚合榜单">
      ${entries.map((entry) => aggregateCard(entry, windowDays)).join("\n")}
    </section>`
    : `
    <p class="empty">${escapeHtml(emptyMessage)}</p>`;

  return `
  ${header(nav)}
  <main class="wrap">
    <section class="hero">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">${escapeHtml(start)} 至 ${escapeHtml(end)}（${windowDays} 天）· 按区间星标增量排序，仅收录出现 ≥2 天的仓库</p>
      ${sample ? `<p class="banner sample">聚合窗口内包含<strong>示例数据</strong>，不是完整的线上抓取结果。</p>` : ""}
    </section>
    ${cards}
  </main>
  ${footer()}`;
}

/**
 * 语言子榜索引：列出全部入选语言，相对链接到各自子榜页。
 * @param {object[]} boards src/aggregate.js languageBoards 的输出
 * @param {object} nav
 * @param {string} latestDate
 */
function languagesIndexPage(boards, nav, latestDate) {
  const list = boards.length
    ? `
        <ol class="archive-list">
          ${boards
            .map(
              (board) =>
                `<li><a href="${escapeHtml(board.slug)}/"><span class="date">${escapeHtml(board.language)}</span><span class="count">最新一天 ${board.repos.length} 个仓库</span></a></li>`,
            )
            .join("\n")}
        </ol>`
    : `<p class="empty">暂无可分组的语言数据。</p>`;

  return `
  ${header(nav)}
  <main class="wrap">
    <section class="hero">
      <p class="eyebrow">语言 · 子榜索引</p>
      <h1>语言子榜</h1>
      <p class="lede">共 ${boards.length} 个语言${latestDate ? ` · 数据截至 ${escapeHtml(latestDate)}` : ""}。</p>
    </section>
    <section class="month-group">
      ${list}
    </section>
  </main>
  ${footer()}`;
}

/**
 * 单个语言子榜页：最新一天该语言的仓库，按当日排名复用日榜卡片。
 * @param {object} board src/aggregate.js languageBoards 的输出项
 * @param {object} nav
 * @param {string} latestDate
 */
function languageBoardPage(board, nav, latestDate) {
  const cards = board.repos.length
    ? `
    <section class="cards" aria-label="语言子榜">
      ${board.repos.map((repo) => repoCard(repo)).join("\n")}
    </section>`
    : `
    <p class="empty">最新一天（${escapeHtml(latestDate)}）没有 ${escapeHtml(board.language)} 仓库上榜。</p>`;

  return `
  ${header(nav)}
  <main class="wrap">
    <section class="hero">
      <p class="eyebrow">语言子榜 · 最新一天</p>
      <h1>${escapeHtml(board.language)}</h1>
      <p class="lede">${escapeHtml(latestDate)} 共 ${board.repos.length} 个仓库上榜</p>
    </section>
    ${cards}
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
  // 第 1 页在 site/archive/ 下（两级），第 n(n≥2) 页在 site/archive/page/n/ 下（三级）。
  const base = fromPage === 1 ? "../days/" : "../../../days/";
  return `<li><a href="${base}${escapeHtml(item.date)}/"><span class="date">${escapeHtml(item.date)}${item.sample ? "（示例）" : ""}</span><span class="count">${item.repos?.length ?? 0} 个仓库</span></a></li>`;
}

/**
 * 单个归档分页：按月分组的日期列表 + 上一页/下一页 + 页码指示。
 * @param {object[]} snapshots 新到旧排序的全部日归档
 * @param {number} pageNum
 * @param {number} pageCount
 */
function archiveBody(snapshots, pageNum, pageCount) {
  const start = (pageNum - 1) * ARCHIVE_PAGE_SIZE;
  const pageDays = snapshots.slice(start, start + ARCHIVE_PAGE_SIZE);

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
      ${header({ homeHref: pageNum === 1 ? "../" : "../../../", trendsHref: pageNum === 1 ? "../trends/" : "../../../trends/", current: "archive" })}
      <main class="wrap">
        <section class="hero">
          <p class="eyebrow">归档 · 按月分组</p>
          <h1>全部日报</h1>
          <p class="lede">共 ${snapshots.length} 天，最新在上。</p>
        </section>
        ${groupHtml}
        ${pager}
      </main>
      ${footer()}`;
}

/**
 * "历史最热"总榜单个卡片：榜单名次 + 仓库身份 + 跨日趋势统计行。
 * 复用日榜卡片的视觉结构（rank/repo/desc/meta/card-foot）。
 * @param {object} entry buildTrendIndex 产出的上榜档案
 * @param {number} position 榜单位次（0 起）
 */
function trendCard(entry, position) {
  const peak =
    entry.bestRank == null ? "峰值未知" : `峰值 #${escapeHtml(entry.bestRank)}`;
  const stats = `累计上榜 ${escapeHtml(entry.totalDays)} 天 · ${peak} · 最长连续 ${escapeHtml(entry.longestStreak)} 天 · 最近上榜 ${escapeHtml(entry.lastSeen)}`;
  const language = languageChip(entry);

  return `
      <article class="card">
        <div class="card-head">
          <span class="rank" aria-label="历史最热第 ${position + 1} 名">${position + 1}</span>
          <h2 class="repo"><a href="${escapeHtml(entry.url || `https://github.com/${entry.fullName}`)}" target="_blank" rel="noreferrer">${escapeHtml(entry.fullName)}</a></h2>
        </div>
        <p class="desc">${entry.description ? escapeHtml(entry.description) : "暂无简介"}</p>
        <div class="meta">
          ${language}
          <span class="stars">★ ${formatCount(entry.stars)}</span>
        </div>
        <div class="card-foot">
          <span class="trend-stats">${stats}</span>
        </div>
      </article>`;
}

/**
 * 趋势档案页（/trends/）：全部历史快照聚合出的"历史最热"总榜。
 * 历史不足 2 天时给出友好的积累中提示（一天的快照算不出趋势）。
 * @param {Map<string, object>} trendIndex buildTrendIndex 的全部历史档案
 * @param {number} historyDays 已收录的历史天数
 */
function trendsBody(trendIndex, historyDays) {
  const entries = sortTrendLeaderboard([...trendIndex.values()]);
  const lede =
    historyDays < 2
      ? `已收录 ${historyDays} 天快照。`
      : `已收录 ${historyDays} 天快照 · ${entries.length} 个仓库曾上榜，按累计上榜天数排序。`;
  const leaderboard =
    historyDays < 2
      ? `<p class="empty">档案还在积累中：趋势统计至少需要两天的历史快照。可以先到 <a href="../archive/">归档</a> 看看已收录的日报。</p>`
      : `<section class="cards" aria-label="历史最热榜单">
          ${entries.map((entry, position) => trendCard(entry, position)).join("\n")}
        </section>`;

  return `
  ${header({ homeHref: "../", trendsHref: "./", current: "trends" })}
  <main class="wrap">
    <section class="hero">
      <p class="eyebrow">上榜档案 · 历史最热</p>
      <h1>趋势档案</h1>
      <p class="lede">${lede}</p>
    </section>
    ${leaderboard}
  </main>
  ${footer()}`;
}

/**
 * 根据 data/*.json 生成静态站点。
 * 站内链接全部使用相对路径，这样在 GitHub Pages 项目站
 * （https://user.github.io/github-trending-daily/）和本地预览都能工作。
 * 唯一例外是 feed：Atom 需要绝对地址，来自 siteUrl 选项（默认 SITE_URL，
 * fork 后覆盖成自己的 Pages 地址），feed 同时写入 site/feed.xml 并以
 * <link rel="alternate"> 出现在每一页的 <head> 里。
 *
 * @param {{ dataDir?: string, siteDir?: string, siteUrl?: string }} [options]
 */
export function generateSite(options = {}) {
  const dataDir = options.dataDir ?? join(repoRoot, "data");
  const siteDir = options.siteDir ?? join(repoRoot, "site");
  const siteUrl = normalizeBaseUrl(options.siteUrl ?? SITE_URL);
  const feedHref = `${siteUrl}${FEED_PATH}`;
  const snapshots = loadSnapshots(dataDir);

  if (snapshots.length === 0) {
    throw new Error(`No daily JSON files found in ${dataDir}`);
  }

  rmSync(siteDir, { recursive: true, force: true });
  mkdirSync(join(siteDir, "assets"), { recursive: true });
  mkdirSync(join(siteDir, "archive"), { recursive: true });
  mkdirSync(join(siteDir, "days"), { recursive: true });
  mkdirSync(join(siteDir, "trends"), { recursive: true });

  // 数据直出：每个 data/YYYY-MM-DD.json 原样复制为可直接访问的站点 URL。
  mkdirSync(join(siteDir, "data"), { recursive: true });
  for (const name of readdirSync(dataDir).filter((name) =>
    /^\d{4}-\d{2}-\d{2}\.json$/.test(name),
  )) {
    copyFileSync(join(dataDir, name), join(siteDir, "data", name));
  }

  writeFileSync(join(siteDir, ".nojekyll"), "");
  writeFileSync(join(siteDir, "assets/style.css"), SITE_CSS);
  writeFileSync(
    join(siteDir, FEED_PATH),
    generateAtomFeed({ days: snapshots, siteUrl }),
  );

  const latest = snapshots[0];
  const dates = snapshots.map((item) => item.date);

  // 上榜档案：全部历史快照聚合（供总榜页与首页徽标使用）。
  const trendIndex = buildTrendIndex(snapshots);

  writeFileSync(
    join(siteDir, "index.html"),
    page(
      `${latest.date} · GitHub 每日热门`,
      "./assets/style.css",
      listPage(
        latest,
        `${latest.date} 今日热门`,
        { homeHref: "./", trendsHref: "./trends/", current: "home" },
        `<p class="hero-links"><a href="./days/${latest.date}/">查看当日独立页面</a><a href="./data/${latest.date}.json">本日数据 JSON</a></p>`,
        "",
        trendIndex,
      ),
      feedHref,
    ),
  );

  // 趋势档案："历史最热"总榜页。
  writeFileSync(
    join(siteDir, "trends/index.html"),
    page(
      "趋势档案 · GitHub 每日热门",
      "./assets/style.css",
      trendsBody(trendIndex, snapshots.length),
      feedHref,
    ),
  );

  // 归档分页：第 1 页 = archive/index.html（最新），其余在 archive/page/N/。
  const pageCount = Math.max(1, Math.ceil(snapshots.length / ARCHIVE_PAGE_SIZE));
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
        isRootPage ? "../assets/style.css" : "../../../assets/style.css",
        archiveBody(snapshots, pageNum, pageCount),
        feedHref,
      ),
    );
  }

  for (let i = 0; i < snapshots.length; i += 1) {
    const snapshot = snapshots[i];
    const newer = snapshots[i - 1];
    const older = snapshots[i + 1];
    const dayDir = join(siteDir, "days", snapshot.date);
    mkdirSync(dayDir, { recursive: true });

    const navLinks = `
      <nav class="day-nav">
        <span>${newer ? `<a href="../${newer.date}/">← ${escapeHtml(newer.date)}</a>` : ""}</span>
        <span>${older ? `<a href="../${older.date}/">${escapeHtml(older.date)} →</a>` : ""}</span>
      </nav>
      <p class="data-line">本日数据 JSON：<a href="../../data/${escapeHtml(snapshot.date)}.json">${escapeHtml(snapshot.date)}.json</a></p>`;

    // 单日页徽标用"截至当日"的前缀档案：snapshots 新到旧排序，slice(i) 即当日及更早的全部快照。
    const prefixTrends = buildTrendIndex(snapshots.slice(i));

    writeFileSync(
      join(dayDir, "index.html"),
      page(
        `${snapshot.date} · GitHub 每日热门`,
        "../../assets/style.css",
        listPage(
          snapshot,
          snapshot.date,
          {
            homeHref: "../../",
            trendsHref: "../../trends/",
            current: "day",
          },
          "",
          navLinks,
          prefixTrends,
        ),
        feedHref,
      ),
    );
  }

  // 多维榜单：周/月滚动聚合与语言子榜（聚合逻辑在 src/aggregate.js，纯函数）。
  const periodBoards = [
    { key: "weekly", heading: "周榜", windowDays: 7, entries: weekly(snapshots), window: rollingWindow(snapshots, 7) },
    { key: "monthly", heading: "月榜", windowDays: 30, entries: monthly(snapshots), window: rollingWindow(snapshots, 30) },
  ];
  for (const { key, heading, windowDays, entries, window } of periodBoards) {
    const emptyMessage =
      window.days.length < 2
        ? `数据不足：${heading}至少需要 2 天快照，当前窗口内只有 ${window.days.length} 天。`
        : "窗口内没有仓库连续上榜 ≥2 天，暂时无法生成榜单。";
    mkdirSync(join(siteDir, key), { recursive: true });
    writeFileSync(
      join(siteDir, key, "index.html"),
      page(
        `${heading} · GitHub 每日热门`,
        "../assets/style.css",
        aggregatePage({
          heading,
          eyebrow: `GitHub Trending · ${windowDays} 天滚动聚合`,
          entries,
          windowDays,
          start: window.start,
          end: window.end,
          nav: { homeHref: "../", current: key },
          emptyMessage,
          sample: window.days.some((day) => day?.sample),
        }),
        feedHref,
      ),
    );
  }

  // 语言子榜：索引页 + 每个入选语言一页（/languages/<slug>/）。
  const boards = languageBoards(snapshots);
  mkdirSync(join(siteDir, "languages"), { recursive: true });
  writeFileSync(
    join(siteDir, "languages/index.html"),
    page(
      "语言子榜 · GitHub 每日热门",
      "../assets/style.css",
      languagesIndexPage(
        boards,
        { homeHref: "../", current: "languages" },
        latest.date,
      ),
      feedHref,
    ),
  );
  for (const board of boards) {
    const boardDir = join(siteDir, "languages", board.slug);
    mkdirSync(boardDir, { recursive: true });
    writeFileSync(
      join(boardDir, "index.html"),
      page(
        `${board.language} · 语言子榜 · GitHub 每日热门`,
        "../../assets/style.css",
        languageBoardPage(
          board,
          { homeHref: "../../", current: "languages" },
          latest.date,
        ),
        feedHref,
      ),
    );
  }

  writeFileSync(
    join(siteDir, "404.html"),
    page(
      "未找到 · GitHub 每日热门",
      "./assets/style.css",
      `
      ${header({ homeHref: "./", trendsHref: "./trends/", current: "home" })}
      <main class="wrap">
        <section class="hero">
          <h1>页面不存在</h1>
          <p class="lede"><a href="./">回到今日热门</a> · <a href="./archive/">查看归档</a> · <a href="./trends/">趋势档案</a></p>
        </section>
      </main>
      ${footer()}`,
      feedHref,
    ),
  );

  return { latestDate: latest.date, dates, siteDir, siteUrl };
}
