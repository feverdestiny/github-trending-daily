/**
 * AI 一句话导读（可选启用）：对当日榜单前 N 名（默认 5）各生成一句中文导读
 * （它是什么、为什么值得关注），写入快照里的 `tldr` 字段永久缓存。
 *
 * 配置全部来自环境变量（任意 OpenAI 兼容端点均可）：
 *   - TLDR_API_KEY   存在即启用整个功能；未设置/为空 → 完全跳过，零调用；
 *   - TLDR_BASE_URL  默认 https://api.openai.com/v1；
 *   - TLDR_MODEL     默认 gpt-4o-mini；
 *   - TLDR_TOP_N     默认 5。
 *
 * 失败语义（对本票至关重要）：
 *   - 已有 `tldr` 的仓库永不重新生成（缓存优先，重跑零调用）；
 *   - 示例快照（`--sample` 或实抓失败降级，`sample: true`）从不生成导读；
 *   - 单仓库缺失/整次调用失败（网络/HTTP/解析）只记一条 stderr 警告，
 *     绝不抛出——导读永远不会阻断当日快照落盘与发布。
 *
 * 调用形态：整批一次请求（一次 chat/completions 同时要前 N 名的导读），
 * 而非每仓库一次——单日固定 1 次 LLM 调用，费用量级更可控。
 */

/** 默认请求的仓库数量（榜单前 N 名）。 */
export const TLDR_TOP_N = 5;

/** 默认的 OpenAI 兼容端点根路径。 */
export const TLDR_BASE_URL = "https://api.openai.com/v1";

/** 默认模型：便宜、够用的一句话生成。 */
export const TLDR_MODEL = "gpt-4o-mini";

/** 低温度：导读要稳定、克制，不要发散。 */
export const TLDR_TEMPERATURE = 0.2;

/** 单个仓库导读允许的 token 预算；整批 max_tokens = 该值 × 仓库数。 */
export const TLDR_MAX_TOKENS_PER_REPO = 80;

/** 单次导读请求的超时毫秒数。 */
export const TLDR_TIMEOUT_MS = 30_000;

/**
 * @typedef {object} TldrRepoFacts
 * @property {string} fullName
 * @property {string} description
 * @property {string} language
 * @property {number} stars
 * @property {number} starsToday
 */

/**
 * @typedef {object} TldrConfig
 * @property {string | undefined} apiKey
 * @property {string} baseUrl
 * @property {string} model
 * @property {number} topN
 */

/**
 * 解析环境变量 → 导读配置（显式传入的 options 优先）。
 * 空字符串按未配置处理（Actions 里未设置的 secret 会展开为空串）。
 * @param {{
 *   apiKey?: string,
 *   baseUrl?: string,
 *   model?: string,
 *   topN?: number
 * }} [options]
 * @returns {TldrConfig}
 */
export function resolveTldrConfig(options = {}) {
  const env = process.env;
  const apiKey = (options.apiKey ?? env.TLDR_API_KEY ?? "").trim() || undefined;
  const baseUrl =
    (options.baseUrl ?? env.TLDR_BASE_URL ?? "").trim() || TLDR_BASE_URL;
  const model = (options.model ?? env.TLDR_MODEL ?? "").trim() || TLDR_MODEL;
  const parsedTopN = Number.parseInt(
    options.topN !== undefined ? String(options.topN) : (env.TLDR_TOP_N ?? ""),
    10,
  );
  const topN =
    Number.isFinite(parsedTopN) && parsedTopN > 0 ? parsedTopN : TLDR_TOP_N;

  return { apiKey, baseUrl, model, topN };
}

/**
 * 从 LLM 返回的 content 里提取摘要字符串数组。
 * 模型即使被要求"只输出 JSON 数组"，也可能裹上 ```json 围栏或说明文字；
 * 这里取首个 `[` 到最后一个 `]` 之间做防御性解析。
 * 独立成纯函数，便于对真实模型输出的各种形态做单元测试。
 * @param {unknown} content
 * @returns {string[]} 数组元素保持原样（非字符串项 → ""），由调用方逐条兜底
 */
export function parseTldrResponse(content) {
  const text = String(content ?? "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("LLM response does not contain a JSON array");
  }

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM response is not valid JSON: ${reason}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("LLM response is not a JSON array");
  }

  return parsed.map((item) => (typeof item === "string" ? item.trim() : ""));
}

/**
 * 构造发给 LLM 的 messages：系统提示定规则，用户消息给结构化仓库清单。
 * @param {TldrRepoFacts[]} repos
 * @returns {Array<{ role: "system" | "user", content: string }>}
 */
export function buildTldrMessages(repos) {
  const list = repos
    .map(
      (repo, index) =>
        `${index + 1}. ${repo.fullName}（语言：${repo.language || "未知"}，★ ${repo.stars}，今日 +${repo.starsToday}）：${repo.description || "暂无简介"}`,
    )
    .join("\n");

  return [
    {
      role: "system",
      content:
        "你是帮助中文开发者快速了解 GitHub Trending 的技术编辑。为每个仓库写一句话中文导读，说明它是什么、为什么值得关注。只依据给出的信息，不要编造功能或数据。",
    },
    {
      role: "user",
      content: `请为下列 GitHub Trending 仓库各写一句中文导读（它是什么、为什么值得关注）。

要求：
- 每个仓库恰好一句话，40 字以内，客观、具体；
- 只依据给出的信息，不要编造；
- 仅输出一个 JSON 字符串数组，按顺序对应每个仓库，不要输出任何其他内容。

仓库列表：
${list}`,
    },
  ];
}

/**
 * 默认的 LLM 客户端：基于内置 fetch 调用 OpenAI 兼容的
 * POST {base}/chat/completions，一次请求整批仓库，返回与输入顺序对齐的
 * 摘要字符串数组。非 2xx、网络/超时错误、响应不可解析一律抛出，
 * 由 enrichWithTldr 兜底成警告。
 *
 * @param {TldrRepoFacts[]} repos
 * @param {{
 *   apiKey?: string,
 *   baseUrl?: string,
 *   model?: string,
 *   timeoutMs?: number,
 *   maxTokens?: number,
 *   fetch?: typeof fetch
 * }} [options]
 * @returns {Promise<string[]>}
 */
export async function generateTldrSummaries(repos, options = {}) {
  const { apiKey, baseUrl, model } = resolveTldrConfig(options);
  if (!apiKey) {
    throw new Error("TLDR_API_KEY is not configured");
  }

  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? TLDR_TIMEOUT_MS;
  const maxTokens =
    options.maxTokens ?? TLDR_MAX_TOKENS_PER_REPO * Math.max(1, repos.length);
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildTldrMessages(repos),
        temperature: TLDR_TEMPERATURE,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM request to ${url} failed: ${reason}`);
  }

  if (!response.ok) {
    throw new Error(
      `LLM endpoint returned HTTP ${response.status} ${response.statusText}`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM response is not valid JSON: ${reason}`);
  }

  const data = /** @type {any} */ (payload ?? {});
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("LLM response has no message content");
  }

  return parseTldrResponse(content);
}

/**
 * 某仓库的 tldr 是否已存在（存在 = 已缓存，永不重新生成）。
 * @param {object} repo
 */
function hasTldr(repo) {
  return typeof repo.tldr === "string" && repo.tldr.trim() !== "";
}

/**
 * 为 digest 的前 N 名仓库就地补齐 `tldr` 字段（缓存优先，缺失才调 LLM）。
 *
 * - `options.client` 注入假客户端便于测试（票 02 注入点模式）；注入时
 *   apiKey/baseUrl/model 等不再生效（以注入者为准，也无需配置 key）。
 *   缺省时使用基于 fetch 的 generateTldrSummaries（需要 TLDR_API_KEY）。
 * - `options.previous` 传入当日已有的旧快照（同一天重跑时 runFetch 会读
 *   data/YYYY-MM-DD.json 传入）：按 fullName 把已缓存的 tldr 先搬回来，
 *   因此重跑同一天对同样的仓库是零调用。
 * - 未配置 key（且未注入 client）、示例快照、空榜单 → 原样返回，零调用。
 * - 任何失败只警告 stderr，函数保证 resolve，绝不抛出。
 *
 * @param {{ sample?: boolean, repos?: Array<object> }} digest
 * @param {{
 *   client?: (repos: TldrRepoFacts[]) => Promise<unknown>,
 *   previous?: { repos?: Array<{ fullName?: string, tldr?: unknown }> } | null,
 *   apiKey?: string,
 *   baseUrl?: string,
 *   model?: string,
 *   topN?: number,
 *   timeoutMs?: number,
 *   fetch?: typeof fetch
 * }} [options]
 * @returns {Promise<typeof digest>} 同一份 digest（就地修改）
 */
export async function enrichWithTldr(digest, options = {}) {
  if (!digest || digest.sample === true) return digest;
  const repos = Array.isArray(digest.repos) ? digest.repos : [];
  if (repos.length === 0) return digest;

  const { apiKey, topN } = resolveTldrConfig(options);
  if (!options.client && !apiKey) return digest; // 功能未启用：零调用

  const targets = repos.slice(0, topN);

  // 缓存第一层：本次 digest 里已有的 tldr 永不重新生成。
  // 第二层：同日旧快照里已生成的 tldr 按 fullName 搬回（重跑零调用）。
  const cached = new Map();
  if (options.previous && Array.isArray(options.previous.repos)) {
    for (const repo of options.previous.repos) {
      if (repo && typeof repo.fullName === "string" && hasTldr(repo)) {
        cached.set(repo.fullName, repo.tldr);
      }
    }
  }

  const missing = targets.filter((repo) => !hasTldr(repo) && !cached.has(repo.fullName));
  for (const repo of targets) {
    const hit = cached.get(repo.fullName);
    if (hit !== undefined) repo.tldr = hit;
  }
  if (missing.length === 0) return digest;

  const client =
    options.client ??
    ((batch) =>
      generateTldrSummaries(batch, {
        apiKey,
        baseUrl: options.baseUrl,
        model: options.model,
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
      }));

  let summaries;
  try {
    // Promise.resolve().then 包一层：注入的 client 同步抛错也按失败兜底。
    summaries = await Promise.resolve().then(() =>
      client(
        missing.map((repo) => ({
          fullName: String(repo.fullName ?? ""),
          description: String(repo.description ?? ""),
          language: String(repo.language ?? ""),
          stars: Number(repo.stars) || 0,
          starsToday: Number(repo.starsToday) || 0,
        })),
      ),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[tldr] summary generation failed, skipping (${reason})`);
    return digest;
  }

  if (!Array.isArray(summaries)) {
    console.error("[tldr] LLM response is not an array, skipping");
    return digest;
  }

  missing.forEach((repo, index) => {
    const summary = typeof summaries[index] === "string" ? summaries[index].trim() : "";
    if (summary === "") {
      console.error(`[tldr] ${repo.fullName}: no summary returned for this repo`);
      return;
    }
    repo.tldr = summary;
  });

  return digest;
}
