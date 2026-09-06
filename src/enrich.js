/**
 * 快照 Schema v2 的元数据富集：通过 GitHub REST API 为每个仓库补充
 * `topics`（话题标签）、`license`（SPDX id）与 `ownerAvatarUrl`（作者头像）。
 *
 * 失败语义（对本票至关重要）：
 *   - 单仓库富集失败（404 / 403 限流 / 网络错误 / 响应异常）只记一条 stderr 警告，
 *     该仓库不写入这三个字段（字段缺省 = 富集不可用，与 v1 快照同构），绝不抛出；
 *   - 因此富集永远不会阻断当日快照落盘。
 */

/** GitHub REST API 的仓库端点前缀。 */
export const GITHUB_API_BASE = "https://api.github.com/repos";

/** 单个仓库元数据请求的超时毫秒数。 */
export const ENRICH_TIMEOUT_MS = 10_000;

/** GitHub API 要求携带 User-Agent；标明来源便于 GitHub 侧联系/排查。 */
const USER_AGENT = "github-trending-daily";

/**
 * @typedef {object} RepoMetadata
 * @property {string[]} topics
 * @property {string | null} license  SPDX id（如 "MIT"）；无许可证或 GitHub 返回
 *   "NOASSERTION"（如自定义文件）时为 null。
 * @property {string | null} ownerAvatarUrl
 */

/**
 * 从 GitHub REST API 的仓库响应里提取 v2 富集字段。
 * 独立成纯函数，便于对 "NOASSERTION"、缺字段等真实 API 形态做单元测试。
 * @param {unknown} payload
 * @returns {RepoMetadata}
 */
export function extractRepoMetadata(payload) {
  const data = /** @type {any} */ (payload ?? {});
  const spdxId = data.license?.spdx_id;
  const topics = Array.isArray(data.topics)
    ? data.topics.map((topic) => String(topic)).filter((topic) => topic !== "")
    : [];

  return {
    topics,
    license:
      typeof spdxId === "string" && spdxId !== "" && spdxId !== "NOASSERTION"
        ? spdxId
        : null,
    ownerAvatarUrl:
      typeof data.owner?.avatar_url === "string" && data.owner.avatar_url !== ""
        ? data.owner.avatar_url
        : null,
  };
}

/**
 * 默认的 GitHub API 客户端：基于内置 fetch 的真实实现。
 * 设置了 token 时带 `Authorization: Bearer …`（Actions 里用内置 GITHUB_TOKEN），
 * 否则匿名请求。非 2xx 或网络/超时错误一律抛出，由 enrichRepos 兜底。
 *
 * @param {string} fullName 形如 "owner/name"
 * @param {{
 *   token?: string,
 *   timeoutMs?: number,
 *   fetch?: typeof fetch
 * }} [options]
 * @returns {Promise<RepoMetadata>}
 */
export async function fetchRepoMetadata(fullName, options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  // 显式传入的 token 优先；否则回落到环境变量（本地/CI 通行做法）。
  const envToken = (process.env.GITHUB_TOKEN || "").trim();
  const token = options.token ?? (envToken || undefined);
  const timeoutMs = options.timeoutMs ?? ENRICH_TIMEOUT_MS;
  const url = `${GITHUB_API_BASE}/${fullName}`;

  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let response;
  try {
    response = await fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub API request for ${fullName} failed: ${reason}`);
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API returned HTTP ${response.status} ${response.statusText} for ${fullName}`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub API response for ${fullName} is not valid JSON: ${reason}`);
  }

  return extractRepoMetadata(payload);
}

/**
 * 为解析出的仓库列表就地补齐 v2 字段（topics/license/ownerAvatarUrl）。
 * 全部仓库并发请求（Promise.allSettled，量级 ~20，简单并发即可）；
 * 任何单仓库失败只警告不抛出，函数本身保证 resolve。
 *
 * @param {Array<{ fullName: string, topics?: string[], license?: string | null, ownerAvatarUrl?: string | null }>} repos
 * @param {{
 *   client?: (fullName: string) => Promise<RepoMetadata>,
 *   token?: string,
 *   timeoutMs?: number,
 *   fetch?: typeof fetch
 * }} [options] `client` 注入假客户端便于测试；缺省时使用 fetchRepoMetadata。
 *   注入 client 时 token/timeoutMs/fetch 不再生效（以注入者为准）。
 * @returns {Promise<typeof repos>} 同一份仓库数组（就地修改）
 */
export async function enrichRepos(repos, options = {}) {
  if (!Array.isArray(repos) || repos.length === 0) return repos;

  const client =
    options.client ??
    ((fullName) =>
      fetchRepoMetadata(fullName, {
        token: options.token,
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
      }));

  // Promise.resolve().then 包一层：即便注入的 client 同步抛错也按单仓库失败处理。
  const settled = await Promise.allSettled(
    repos.map((repo) => Promise.resolve().then(() => client(repo.fullName))),
  );

  settled.forEach((result, index) => {
    const repo = repos[index];
    if (result.status === "fulfilled") {
      repo.topics = result.value.topics;
      repo.license = result.value.license;
      repo.ownerAvatarUrl = result.value.ownerAvatarUrl;
      return;
    }
    const reason =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`[enrich] ${repo.fullName}: metadata unavailable (${reason})`);
  });

  return repos;
}
