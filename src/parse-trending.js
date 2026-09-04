import { load } from "cheerio";

/**
 * GitHub 趋势页 HTML 解析失败。
 * 用于把「空页面 / 结构变更 / 登录墙」等和网络错误区分开。
 */
export class ParseError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * 把 "25,151" / "963 stars today" 这类文案里的第一个整数解析出来。
 * @param {string} text
 * @returns {number}
 */
export function parseCount(text) {
  const match = String(text ?? "")
    .replace(/,/g, "")
    .match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * 从仓库相对路径解析 owner/name。忽略登录、话题等非仓库链接。
 * @param {string | undefined} href
 * @returns {{ owner: string, name: string, fullName: string, url: string } | null}
 */
function parseRepoHref(href) {
  if (!href) return null;
  const path = href.split("?")[0].replace(/\/$/, "");
  const match = path.match(/^\/([^/]+)\/([^/]+)$/);
  if (!match) return null;

  const [, owner, name] = match;
  const reserved = new Set([
    "login",
    "signup",
    "topics",
    "trending",
    "explore",
    "settings",
    "orgs",
    "features",
    "enterprise",
    "pricing",
    "marketplace",
    "sponsors",
    "about",
    "site",
  ]);
  if (reserved.has(owner.toLowerCase())) return null;
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

/**
 * 在单张卡片里找仓库主链接。
 * 脆弱点：GitHub 历史上用过 h2 / h3，类名也会变；因此同时试标题链接和「看起来像 owner/repo」的 href。
 * @param {import("cheerio").CheerioAPI} $
 * @param {import("cheerio").Element} article
 */
function findRepoIdentity($, article) {
  const $article = $(article);
  const candidates = $article
    .find("h2 a[href], h3 a[href], a[href]")
    .toArray();

  for (const el of candidates) {
    const identity = parseRepoHref($(el).attr("href"));
    if (identity) return identity;
  }
  return null;
}

/**
 * 选择趋势卡片节点。优先官方长期使用的 article.Box-row，再逐级回退。
 * 这些选择器会随 GitHub 改版失效，修改时请对照真实 HTML。
 * @param {import("cheerio").CheerioAPI} $
 */
function selectRepoCards($) {
  const selectors = [
    "article.Box-row",
    'article[class*="Box-row"]',
    "article",
  ];

  for (const selector of selectors) {
    const nodes = $(selector).toArray();
    if (nodes.length > 0) return nodes;
  }
  return [];
}

/**
 * 解析 github.com/trending 的 HTML，返回稳定 schema 的仓库列表。
 * 残缺卡片会被跳过；若整页都解析不出有效仓库则抛出 ParseError。
 *
 * @param {string} html
 * @returns {Array<{
 *   rank: number,
 *   owner: string,
 *   name: string,
 *   fullName: string,
 *   url: string,
 *   description: string,
 *   language: string,
 *   stars: number,
 *   starsToday: number
 * }>}
 */
export function parseTrendingHtml(html) {
  if (typeof html !== "string" || html.trim() === "") {
    throw new ParseError(
      "Trending HTML is empty. The request may have been blocked or returned no body.",
    );
  }

  const $ = load(html);
  const cards = selectRepoCards($);

  if (cards.length === 0) {
    const snippet = html.replace(/\s+/g, " ").slice(0, 180);
    throw new ParseError(
      `No trending repo cards found (tried article.Box-row and article fallbacks). GitHub markup may have changed. Snippet: ${snippet}`,
    );
  }

  const repos = [];
  for (const card of cards) {
    const identity = findRepoIdentity($, card);
    if (!identity) continue;

    const $card = $(card);
    const description = $card.find("p").first().text().replace(/\s+/g, " ").trim();
    const language = $card.find('[itemprop="programmingLanguage"]').first().text().trim();

    // 总星标通常在指向 /stargazers 的链接里。
    const starsText = $card.find('a[href*="/stargazers"]').first().text();
    const stars = parseCount(starsText);

    // 「N stars today」文案位置不固定，按文本匹配比死绑 float-sm-right 更稳。
    const todayMatch = $card.text().match(/([\d,]+)\s*stars today/i);
    const starsToday = todayMatch ? parseCount(todayMatch[1]) : 0;

    repos.push({
      rank: repos.length + 1,
      owner: identity.owner,
      name: identity.name,
      fullName: identity.fullName,
      url: identity.url,
      description,
      language,
      stars,
      starsToday,
    });
  }

  if (repos.length === 0) {
    throw new ParseError(
      `Found ${cards.length} card(s) but none contained a valid owner/repo link. GitHub markup may have changed.`,
    );
  }

  // 卡片很多但有效仓库很少，多半是广告块或结构已变，避免把残页当成完整榜单。
  if (cards.length >= 3 && repos.length / cards.length < 0.5) {
    throw new ParseError(
      `High drop rate: parsed ${repos.length} repo(s) from ${cards.length} card(s). GitHub markup may have changed.`,
    );
  }

  if (repos.every((repo) => repo.stars === 0 && repo.starsToday === 0)) {
    throw new ParseError(
      "Parsed repos but every star count is 0. Star selectors may have broken after a GitHub markup change.",
    );
  }

  return repos;
}
