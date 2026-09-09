/**
 * Atom feed（订阅）：把最新一期榜单生成为一条标准 Atom XML。
 *
 * 约定（与实现保持一致，改动需同步测试）：
 * - `days` 为按日期新到旧排序的快照数组（即 `loadDigests` 的返回值），
 *   只取 `days[0]`（最新一期）生成条目。
 * - 最新一天 `repos` 为空数组时：输出一条合法但没有任何 `<entry>` 的 feed
 *   （保持 feed URL 永远可订阅，而不是跳过生成留下旧文件）。
 * - `days` 为空时抛出错误（与 `generateSite` 的"无数据不构建"一致）。
 * - 条目 `id` 用 `仓库URL#日期`（同一仓库每一天稳定不同，重复构建不变）。
 * - `content type="html"`：条目正文是一段 HTML（简介 + 语言 + 总星 + 当日新增），
 *   HTML 内文本与整段 HTML 嵌入 XML 前各做一次转义（双重转义是 type="html" 的要求）。
 */

/** 站点绝对地址默认值。Fork 后请在 generateSite({ siteUrl }) 里覆盖成自己的 Pages 地址。 */
export const SITE_URL = "https://feverdestiny.github.io/github-trending-daily/";

/** feed 相对站点根的路径（生成与 <head> 订阅发现链接共用）。 */
export const FEED_PATH = "feed.xml";

/**
 * XML 转义：& < > " ' → 预定义实体。描述、标题、属性值共用。
 * 与 generate-site 的 escapeHtml 区别仅在引号实体（XML 用 &quot;/&apos;），
 * 两者对文本安全等价，但 XML 文档统一走这里，避免两套转义混用。
 * @param {unknown} value
 */
export function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * 归一化站点 base URL：补全末尾斜杠，方便直接拼接相对路径。
 * @param {string} siteUrl
 */
export function normalizeBaseUrl(siteUrl) {
  const trimmed = String(siteUrl ?? "").trim();
  const base = trimmed || SITE_URL;
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * @param {number} n
 */
function formatCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}

/**
 * feed / 条目共用的更新时间：优先用抓取时刻 fetchedAt，
 * 缺失或不可解析时退回当天 UTC 零点（date 为 YYYY-MM-DD）。
 * @param {object} latest
 */
function atomTimestamp(latest) {
  const fetchedMs = Date.parse(latest.fetchedAt ?? "");
  const iso = Number.isFinite(fetchedMs)
    ? new Date(fetchedMs).toISOString()
    : `${latest.date}T00:00:00Z`;
  // 去掉毫秒，输出更常规的 RFC 3339 形式
  return iso.replace(/\.\d{3}Z$/, "Z");
}

/**
 * 单个仓库的条目正文（HTML 文本），调用方负责整体 XML 转义后放入 content。
 * v1 旧快照没有语言字段时显示「未标注语言」，与站点卡片一致。
 * @param {object} repo
 */
function entryHtml(repo) {
  const description = repo.description
    ? xmlEscape(repo.description)
    : "暂无简介";
  const language = repo.language ? xmlEscape(repo.language) : "未标注语言";
  const meta = `语言：${language} · ★ ${formatCount(repo.stars)} · 今日新增 +${formatCount(repo.starsToday)}`;
  return `<p>${description}</p><p>${meta}</p>`;
}

/**
 * 生成最新一期榜单的 Atom feed XML。
 *
 * @param {{
 *   days: object[],
 *   siteUrl?: string,
 * }} options
 *   - days: 快照数组，新到旧排序（loadDigests 的返回值），只读 days[0]
 *   - siteUrl: 站点绝对地址（feed id / 链接 / 条目 id 的 base），默认 SITE_URL
 * @returns {string} Atom XML 文本
 */
export function generateAtomFeed({ days, siteUrl } = {}) {
  if (!Array.isArray(days) || days.length === 0 || !days[0]) {
    throw new Error("generateAtomFeed requires at least one daily digest in days");
  }

  const base = normalizeBaseUrl(siteUrl);
  const latest = days[0];
  const updated = atomTimestamp(latest);
  const feedId = base;
  const feedXml = `${base}${FEED_PATH}`;
  const repos = Array.isArray(latest.repos) ? latest.repos : [];

  const entries = repos
    .map((repo) => {
      const url = String(repo.url ?? "");
      const rank = Number(repo.rank);
      const title = Number.isFinite(rank) && rank > 0
        ? `#${rank} ${repo.fullName}`
        : String(repo.fullName ?? "");
      return `  <entry>
    <title>${xmlEscape(title)}</title>
    <id>${xmlEscape(`${url}#${latest.date}`)}</id>
    <link rel="alternate" type="text/html" href="${xmlEscape(url)}"/>
    <updated>${updated}</updated>
    ${repo.owner ? `<author><name>${xmlEscape(repo.owner)}</name></author>` : ""}
    <content type="html">${xmlEscape(entryHtml(repo))}</content>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>GitHub 每日热门</title>
  <subtitle>GitHub Trending 每日榜单归档 · 最新一期（${xmlEscape(latest.date)}）</subtitle>
  <id>${xmlEscape(feedId)}</id>
  <link rel="self" type="application/atom+xml" href="${xmlEscape(feedXml)}"/>
  <link rel="alternate" type="text/html" href="${xmlEscape(base)}"/>
  <updated>${updated}</updated>
${entries}${entries ? "\n" : ""}</feed>
`;
}
