import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichRepos } from "./enrich.js";
import { ParseError, parseTrendingHtml } from "./parse-trending.js";
import { enrichWithTldr } from "./tldr.js";

export const TRENDING_URL = "https://github.com/trending?since=daily";

/** 模拟常见桌面浏览器，降低被当成脚本直接拒绝的概率。 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** 单次抓取最多尝试的次数（含首次）。 */
export const FETCH_MAX_ATTEMPTS = 3;

/** 首次重试前的基础等待毫秒数，之后按指数退避（base、base*2、base*4…）。 */
export const FETCH_RETRY_BASE_MS = 500;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sampleFixturePath = join(repoRoot, "test/fixtures/trending-sample.html");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 读取当日已有的旧快照（若存在），作为 AI 导读的同日缓存来源。
 * 文件不存在/损坏一律返回 null，绝不影响主流程。
 * @param {string} dataDir
 * @param {string} date
 */
function readSameDayDigest(dataDir, date) {
  try {
    return JSON.parse(readFileSync(join(dataDir, `${date}.json`), "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {Date} [now]
 * @returns {string} UTC 日历日，YYYY-MM-DD
 */
export function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * 拉取趋势页 HTML。网络错误（含超时）、非 200、响应体过短都会触发重试；
 * 有限次尝试（默认 3 次，短指数退避）耗尽后抛出最后一次错误。
 * 通过 options.fetch 注入便于测试。
 * @param {{
 *   fetch?: typeof fetch,
 *   timeoutMs?: number,
 *   maxAttempts?: number,
 *   retryBaseMs?: number
 * }} [options]
 * @returns {Promise<string>}
 */
export async function fetchTrendingHtml(options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? FETCH_MAX_ATTEMPTS);
  const retryBaseMs = options.retryBaseMs ?? FETCH_RETRY_BASE_MS;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(retryBaseMs * 2 ** (attempt - 2));
    }

    try {
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
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError;
}

/**
 * 抓取并写入 data/YYYY-MM-DD.json。
 * 实抓失败（重试耗尽）时降级为仓库内置的示例数据，并在快照中显式标注
 * `sample: true`（站点据此显示「示例数据」，不会当成真实榜单发布）。
 *
 * 快照 Schema v2：解析完成后通过 GitHub REST API 为每个仓库就地补齐可选字段
 * `topics: string[]`、`license: string | null`（SPDX id）、`ownerAvatarUrl: string | null`。
 * 单仓库富集失败（404/限流/网络）只警告不抛出，该仓库不写入这三个字段——
 * 字段缺省即「富集不可用」，因此 v1 旧快照（无这些字段）与 v2 永远兼容。
 * 示例数据路径（显式 `--sample` 或实抓失败降级）不做富集：样本并非真实榜单，
 * 且降级恰恰发生在网络不可用时，保持该路径完全离线。
 *
 * AI 一句话导读（可选）：配置了 TLDR_API_KEY（任意 OpenAI 兼容端点）时，
 * 在富集之后对前 N 名（默认 5）生成一句中文导读，就地写入 `tldr` 字段并随
 * 快照永久缓存。同日重跑会先按 fullName 从旧快照搬回已缓存的 tldr，因此
 * 重跑不重复调用；未配置 key、示例路径、调用失败都静默跳过，绝不阻断发布。
 *
 * @param {{
 *   dataDir?: string,
 *   now?: Date,
 *   fetch?: typeof fetch,
 *   html?: string,
 *   sample?: boolean,
 *   timeoutMs?: number,
 *   maxAttempts?: number,
 *   retryBaseMs?: number,
 *   enrich?: boolean,
 *   githubClient?: (fullName: string) => Promise<import("./enrich.js").RepoMetadata>,
 *   token?: string,
 *   enrichTimeoutMs?: number,
 *   tldr?: boolean,
 *   tldrClient?: (repos: import("./tldr.js").TldrRepoFacts[]) => Promise<unknown>,
 *   tldrApiKey?: string
 * }} [options] `githubClient` 注入 GitHub API 假客户端便于测试（票 02 的
 *   注入点模式）；缺省时使用基于 fetch 的真实实现，鉴权取 `token` 或环境变量
 *   GITHUB_TOKEN。`enrich: false` 可整体跳过富集。`tldrClient` 注入 LLM 假
 *   客户端（票 08 注入点模式）；导读的启用以显式传参为准——`tldrApiKey`
 *   由调用方传入（scripts/fetch.js、scripts/update.js 从 TLDR_API_KEY 环境变量
 *   读取后传入），runFetch 自身不读该环境变量，保证测试在任何环境下零 LLM
 *   网络。`tldr: false` 可整体跳过导读。
 */
export async function runFetch(options = {}) {
  const dataDir = options.dataDir ?? join(repoRoot, "data");
  const now = options.now ?? new Date();
  const date = utcDate(now);
  const explicitSample = options.sample === true;

  let html;
  let useSample = explicitSample;
  if (options.html !== undefined) {
    html = options.html;
  } else if (explicitSample) {
    html = readFileSync(sampleFixturePath, "utf8");
  } else {
    try {
      html = await fetchTrendingHtml({
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        retryBaseMs: options.retryBaseMs,
      });
    } catch {
      // 重试耗尽：降级到示例数据，快照沿用既有 `sample: true` 标注机制。
      useSample = true;
      html = readFileSync(sampleFixturePath, "utf8");
    }
  }
  const repos = parseTrendingHtml(html);

  const digest = {
    date,
    fetchedAt: now.toISOString(),
    source: TRENDING_URL,
    repos,
    ...(useSample ? { sample: true } : {}),
  };

  if (!useSample) {
    if (options.enrich !== false) {
      await enrichRepos(repos, {
        client: options.githubClient,
        token: options.token,
        timeoutMs: options.enrichTimeoutMs,
        fetch: options.fetch,
      });
    }

    if (options.tldr !== false) {
      // 仅实抓路径生成导读；同日旧快照作为永久缓存传入（缓存优先，零重复调用）。
      // apiKey 显式传 "" 封住 tldr.js 里的环境变量回落：是否启用只取决于
      // 调用方（scripts 从 TLDR_API_KEY 读入后传 tldrApiKey）或注入的 tldrClient，
      // 因此任何环境下跑 runFetch 的测试都不会发起 LLM 请求。
      await enrichWithTldr(digest, {
        client: options.tldrClient,
        apiKey: options.tldrApiKey ?? "",
        previous: readSameDayDigest(dataDir, date),
        fetch: options.fetch,
      });
    }
  }

  mkdirSync(dataDir, { recursive: true });
  const filePath = join(dataDir, `${date}.json`);
  writeFileSync(filePath, `${JSON.stringify(digest, null, 2)}\n`);
  return { filePath, digest };
}
