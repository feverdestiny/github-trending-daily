import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ParseError, parseTrendingHtml } from "./parse-trending.js";

export const TRENDING_URL = "https://github.com/trending?since=daily";

/** 模拟常见桌面浏览器，降低被当成脚本直接拒绝的概率。 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {Date} [now]
 * @returns {string} UTC 日历日，YYYY-MM-DD
 */
export function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * 拉取趋势页 HTML。通过 options.fetch 注入便于测试。
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
export async function fetchTrendingHtml(options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  let response;
  try {
    response = await fetchFn(TRENDING_URL, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to request ${TRENDING_URL}: ${reason}`);
  }

  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub trending returned HTTP ${response.status} ${response.statusText}. Body snippet: ${html.slice(0, 180)}`,
    );
  }
  if (html.trim().length < 200) {
    throw new ParseError(
      `Trending HTML is unexpectedly short (${html.length} bytes). The response may be partial or blocked.`,
    );
  }
  return html;
}

/**
 * 抓取并写入 data/YYYY-MM-DD.json。
 * @param {{
 *   dataDir?: string,
 *   now?: Date,
 *   fetch?: typeof fetch,
 *   html?: string
 * }} [options]
 */
export async function runFetch(options = {}) {
  const dataDir = options.dataDir ?? join(repoRoot, "data");
  const now = options.now ?? new Date();
  const date = utcDate(now);
  const useSample = options.sample === true;
  const html =
    options.html ??
    (useSample
      ? readFileSync(join(repoRoot, "test/fixtures/trending-sample.html"), "utf8")
      : await fetchTrendingHtml({ fetch: options.fetch }));
  const repos = parseTrendingHtml(html);

  const digest = {
    date,
    fetchedAt: now.toISOString(),
    source: TRENDING_URL,
    repos,
    ...(useSample ? { sample: true } : {}),
  };

  mkdirSync(dataDir, { recursive: true });
  const filePath = join(dataDir, `${date}.json`);
  writeFileSync(filePath, `${JSON.stringify(digest, null, 2)}\n`);
  return { filePath, digest };
}
