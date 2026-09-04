import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 转义用户/抓取文本，避免描述里的 HTML 破坏页面。
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
  <meta name="description" content="GitHub 每日 Trending 归档">
  <link rel="stylesheet" href="${cssHref}">
</head>
<body>
  ${body}
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
      <nav class="nav">
        <a href="${nav.homeHref}"${nav.current === "home" ? ' aria-current="page"' : ""}>今日</a>
        <a href="${nav.archiveHref}"${nav.current === "archive" ? ' aria-current="page"' : ""}>归档</a>
      </nav>
    </div>
  </header>`;
}

function footer() {
  return `
  <footer class="site-footer">
    <div class="wrap">
      <p>数据来自非官方抓取 <a href="https://github.com/trending?since=daily" rel="noreferrer">github.com/trending</a>。GitHub 改版页面结构后，抓取可能失败。</p>
    </div>
  </footer>`;
}

/**
 * @param {object} digest
 * @param {{ homeHref: string, archiveHref: string }} links
 */
function repoCards(digest) {
  if (!digest.repos?.length) {
    return `<p class="empty">当日暂无数据。</p>`;
  }

  return digest.repos
    .map((repo) => {
      const language = repo.language
        ? `<span class="pill">${escapeHtml(repo.language)}</span>`
        : `<span class="pill muted">未标注语言</span>`;
      const description = repo.description
        ? escapeHtml(repo.description)
        : "暂无简介";

      return `
      <article class="card">
        <div class="rank" aria-label="排名 ${repo.rank}">${repo.rank}</div>
        <div class="card-body">
          <h2 class="repo">
            <a href="${escapeHtml(repo.url)}" rel="noreferrer">${escapeHtml(repo.fullName)}</a>
          </h2>
          <p class="desc">${description}</p>
          <div class="meta">
            ${language}
            <span class="stat">★ ${formatCount(repo.stars)} 星标</span>
            <span class="stat today">今日新增 ${formatCount(repo.starsToday)}</span>
          </div>
        </div>
      </article>`;
    })
    .join("\n");
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
    <section class="list">
      ${repoCards(digest)}
    </section>
    ${afterList}
  </main>
  ${footer()}`;
}

export const SITE_CSS = `/* GitHub 每日热门：偏纸张底色的阅读页，不依赖外部字体 */
:root {
  --bg: #f3efe6;
  --ink: #1f1a14;
  --muted: #6b6258;
  --card: #fffdf8;
  --line: #e4dccf;
  --accent: #9a3412;
  --link: #7c2d12;
  --today: #c2410c;
  --header: #1c1917;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.6;
  min-height: 100vh;
}

a { color: var(--link); text-underline-offset: 2px; }
a:hover { color: var(--accent); }

.wrap {
  width: min(880px, calc(100% - 32px));
  margin: 0 auto;
}

.site-header {
  background: var(--header);
  color: #f5f0e8;
  padding: 14px 0;
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.brand {
  color: #fff;
  text-decoration: none;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.nav { display: flex; gap: 16px; }
.nav a { color: #e7e0d5; text-decoration: none; }
.nav a[aria-current="page"],
.nav a:hover { color: #fff; }

.hero { padding: 36px 0 12px; }
.eyebrow {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.hero h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 40px); line-height: 1.2; }
.lede, .empty { color: var(--muted); }
.banner {
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff7ed;
  border: 1px solid #fdba74;
}
.banner.sample { background: #fff1f2; border-color: #fda4af; }

.list { display: grid; gap: 12px; padding: 12px 0 48px; }
.card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 16px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px 18px;
}
.rank {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 22px;
  color: var(--accent);
  min-width: 2ch;
}
.repo { margin: 0 0 6px; font-size: 18px; }
.repo a { text-decoration: none; }
.repo a:hover { text-decoration: underline; }
.desc { margin: 0 0 10px; color: #3f3a33; }
.meta { display: flex; flex-wrap: wrap; gap: 10px 14px; font-size: 14px; color: var(--muted); }
.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f4e9d8;
  color: #44403c;
}
.pill.muted { background: #eeeae2; }
.stat.today { color: var(--today); font-weight: 650; }

.archive-list { list-style: none; padding: 8px 0 48px; margin: 0; }
.archive-list li { border-bottom: 1px solid var(--line); }
.archive-list a {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  text-decoration: none;
  color: inherit;
}
.archive-list a:hover .date { color: var(--accent); }
.date { font-weight: 650; }
.count { color: var(--muted); }

.day-nav {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 28px;
}
.day-nav a { text-decoration: none; }

.site-footer {
  border-top: 1px solid var(--line);
  padding: 20px 0 32px;
  color: var(--muted);
  font-size: 13px;
}
.site-footer a { color: inherit; }

@media (max-width: 560px) {
  .card { grid-template-columns: 1fr; gap: 8px; }
  .rank { font-size: 16px; }
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
        `<p class="lede"><a href="./days/${latest.date}/">查看当日独立页面</a></p>`,
      ),
    ),
  );

  const archiveItems = digests
    .map(
      (item) => `
      <li>
        <a href="../days/${item.date}/">
          <span class="date">${item.date}${item.sample ? "（示例）" : ""}</span>
          <span class="count">${item.repos?.length ?? 0} 个仓库</span>
        </a>
      </li>`,
    )
    .join("\n");

  writeFileSync(
    join(siteDir, "archive/index.html"),
    page(
      "归档 · GitHub 每日热门",
      "../assets/style.css",
      `
      ${header({ homeHref: "../", archiveHref: "./", current: "archive" })}
      <main class="wrap">
        <section class="hero">
          <p class="eyebrow">Archives</p>
          <h1>全部日报</h1>
          <p class="lede">共 ${digests.length} 天，最新在上。</p>
        </section>
        <ol class="archive-list">
          ${archiveItems}
        </ol>
      </main>
      ${footer()}`,
    ),
  );

  for (let i = 0; i < digests.length; i += 1) {
    const digest = digests[i];
    const newer = digests[i - 1];
    const older = digests[i + 1];
    const dayDir = join(siteDir, "days", digest.date);
    mkdirSync(dayDir, { recursive: true });

    const navLinks = `
      <nav class="day-nav">
        <span>${newer ? `<a href="../${newer.date}/">← ${newer.date}</a>` : ""}</span>
        <span>${older ? `<a href="../${older.date}/">${older.date} →</a>` : ""}</span>
      </nav>`;

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
