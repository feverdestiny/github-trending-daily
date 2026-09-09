import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildTldrMessages,
  enrichWithTldr,
  generateTldrSummaries,
  parseTldrResponse,
  resolveTldrConfig,
} from "../src/tldr.js";
import { runFetch } from "../src/fetch-trending.js";
import { generateSite } from "../src/generate-site.js";
import { captureStderr, tmpDataDir } from "./helpers.js";

/**
 * 调用形态（本票的决定）：整批一次请求——前 N 名的导读在**一次**
 * chat/completions 里一起要，而不是每仓库一次。因此"10 个仓库的一天"
 * 只产生 1 次客户端调用；测试按此断言。
 */

/** 造 n 个仓库的 digest，fullName 形如 acme/repo-1…acme/repo-n。 */
function makeDigest(n, extra = {}) {
  const repos = Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    fullName: `acme/repo-${i + 1}`,
    url: `https://github.com/acme/repo-${i + 1}`,
    description: `Repo number ${i + 1}`,
    language: "Rust",
    stars: 1000 + i,
    starsToday: 100 - i,
  }));
  return { repos, ...extra };
}

/** 注入点：假 LLM 客户端，记录每次收到的批次并按 reply 回放摘要。 */
function fakeTldrClient(reply) {
  const calls = [];
  const client = async (repos) => {
    calls.push(repos.map((repo) => repo.fullName));
    return reply(repos, calls.length);
  };
  return { client, calls };
}

/** 在 TLDR_* 环境变量被清空的状态下跑一次 fn（结束后恢复），保证测试不受本机环境影响。 */
async function withoutTldrEnv(fn) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("TLDR_")) delete process.env[key];
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (key.startsWith("TLDR_")) process.env[key] = saved[key];
    }
  }
}

function okChatResponse(content) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [{ message: { role: "assistant", content } }],
    }),
  };
}

describe("parseTldrResponse", () => {
  it("parses a bare JSON array", () => {
    assert.deepEqual(parseTldrResponse('["甲仓库的导读","乙仓库的导读"]'), [
      "甲仓库的导读",
      "乙仓库的导读",
    ]);
  });

  it("parses arrays wrapped in markdown fences or prose", () => {
    const fenced = '```json\n["第一句", "第二句"]\n```';
    assert.deepEqual(parseTldrResponse(fenced), ["第一句", "第二句"]);

    const prosed = '好的，以下是导读：\n["第一句", "第二句"]\n希望有帮助';
    assert.deepEqual(parseTldrResponse(prosed), ["第一句", "第二句"]);
  });

  it("trims strings and maps non-string items to empty strings", () => {
    assert.deepEqual(parseTldrResponse('["  带空格  ", 42, null]'), [
      "带空格",
      "",
      "",
    ]);
  });

  it("throws a descriptive error when no array can be found", () => {
    assert.throws(() => parseTldrResponse("抱歉，我无法回答"), /JSON array/);
    assert.throws(() => parseTldrResponse('{"a": 1}'), /JSON array/);
    assert.throws(() => parseTldrResponse("[1, 2,]"), /not valid JSON/);
    assert.throws(() => parseTldrResponse(undefined), /JSON array/);
  });
});

describe("resolveTldrConfig", () => {
  it("falls back to documented defaults when nothing is configured", async () => {
    await withoutTldrEnv(async () => {
      const config = resolveTldrConfig();
      assert.equal(config.apiKey, undefined);
      assert.equal(config.baseUrl, "https://api.openai.com/v1");
      assert.equal(config.model, "gpt-4o-mini");
      assert.equal(config.topN, 5);
    });
  });

  it("reads env overrides; empty strings count as unset", async () => {
    await withoutTldrEnv(async () => {
      process.env.TLDR_API_KEY = " env-key ";
      process.env.TLDR_BASE_URL = "https://llm.example.com/v1/";
      process.env.TLDR_MODEL = "glm-4-flash";
      process.env.TLDR_TOP_N = "3";

      const config = resolveTldrConfig();
      assert.equal(config.apiKey, "env-key");
      assert.equal(config.baseUrl, "https://llm.example.com/v1/");
      assert.equal(config.model, "glm-4-flash");
      assert.equal(config.topN, 3);

      process.env.TLDR_BASE_URL = "";
      process.env.TLDR_TOP_N = "not-a-number";
      const fallback = resolveTldrConfig();
      assert.equal(fallback.baseUrl, "https://api.openai.com/v1");
      assert.equal(fallback.topN, 5);
    });
  });
});

describe("generateTldrSummaries (default fetch-based client)", () => {
  const repos = [
    {
      fullName: "acme/rocket",
      description: "Fast builds",
      language: "Rust",
      stars: 12345,
      starsToday: 890,
    },
  ];

  it("posts one OpenAI-compatible batch request and parses the summaries", async () => {
    const requests = [];
    const fetch = async (url, init) => {
      requests.push({ url, init });
      return okChatResponse('["它是一个构建工具，速度极快。"]');
    };

    const summaries = await generateTldrSummaries(repos, {
      apiKey: "tok-1",
      baseUrl: "https://llm.example.com/v1/",
      model: "mini-x",
      fetch,
    });

    assert.deepEqual(summaries, ["它是一个构建工具，速度极快。"]);
    assert.equal(requests.length, 1);
    // 尾斜杠被归一化，路径固定为 /chat/completions
    assert.equal(requests[0].url, "https://llm.example.com/v1/chat/completions");
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[0].init.headers.Authorization, "Bearer tok-1");

    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.model, "mini-x");
    assert.ok(body.temperature <= 0.5, "temperature should be low");
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 400);
    assert.equal(body.messages.length, 2);
    const userMessage = body.messages[1].content;
    for (const fact of [
      "acme/rocket",
      "Fast builds",
      "Rust",
      "12345",
      "890",
    ]) {
      assert.ok(userMessage.includes(fact), `prompt should contain ${fact}`);
    }
    assert.match(userMessage, /JSON/);
  });

  it("throws on non-2xx so enrichWithTldr can warn and move on", async () => {
    await assert.rejects(
      generateTldrSummaries(repos, {
        apiKey: "tok-1",
        fetch: async () => ({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        }),
      }),
      /HTTP 429/,
    );
  });

  it("throws on network errors and missing message content", async () => {
    await assert.rejects(
      generateTldrSummaries(repos, {
        apiKey: "tok-1",
        fetch: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      }),
      /ENOTFOUND/,
    );
    await assert.rejects(
      generateTldrSummaries(repos, {
        apiKey: "tok-1",
        fetch: async () => okChatResponse(""),
      }),
      /no message content/,
    );
  });
});

describe("enrichWithTldr", () => {
  it("generates for the top N only, in one batched call", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(10);
      const { client, calls } = fakeTldrClient(
        (repos) => repos.map((repo) => `${repo.fullName} 的导读`),
      );

      await enrichWithTldr(digest, { client, topN: 5 });

      // 一次批量调用，只包含前 5 名
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], [
        "acme/repo-1",
        "acme/repo-2",
        "acme/repo-3",
        "acme/repo-4",
        "acme/repo-5",
      ]);
      for (let i = 0; i < 5; i += 1) {
        assert.equal(digest.repos[i].tldr, `acme/repo-${i + 1} 的导读`);
      }
      for (let i = 5; i < 10; i += 1) {
        assert.equal("tldr" in digest.repos[i], false);
      }
    });
  });

  it("never regenerates an existing tldr (cache-first, zero calls)", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(3);
      digest.repos.forEach((repo) => {
        repo.tldr = "已缓存的导读";
      });
      const { client, calls } = fakeTldrClient(() => {
        throw new Error("should not be called");
      });

      await enrichWithTldr(digest, { client, topN: 5 });

      assert.equal(calls.length, 0);
      assert.deepEqual(
        digest.repos.map((repo) => repo.tldr),
        ["已缓存的导读", "已缓存的导读", "已缓存的导读"],
      );
    });
  });

  it("seeds cached tldr from the previous same-day snapshot before calling", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(5);
      const previous = makeDigest(5);
      previous.repos[0].tldr = "缓存一";
      previous.repos[2].tldr = "缓存三";
      const { client, calls } = fakeTldrClient(
        (repos) => repos.map((repo) => `${repo.fullName} 新导读`),
      );

      await enrichWithTldr(digest, { client, previous, topN: 5 });

      // 只有缺失的 3 个仓库（repo-2/4/5）进入批量调用
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], [
        "acme/repo-2",
        "acme/repo-4",
        "acme/repo-5",
      ]);
      assert.equal(digest.repos[0].tldr, "缓存一");
      assert.equal(digest.repos[2].tldr, "缓存三");
      assert.equal(digest.repos[1].tldr, "acme/repo-2 新导读");
      assert.equal(digest.repos[3].tldr, "acme/repo-4 新导读");
      assert.equal(digest.repos[4].tldr, "acme/repo-5 新导读");
    });
  });

  it("is fully covered by the previous snapshot → zero calls (second run)", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(5);
      const previous = makeDigest(5);
      previous.repos.forEach((repo) => {
        repo.tldr = `${repo.fullName} 的旧导读`;
      });
      const { client, calls } = fakeTldrClient(() => {
        throw new Error("should not be called");
      });

      await enrichWithTldr(digest, { client, previous, topN: 5 });

      assert.equal(calls.length, 0);
      assert.equal(digest.repos[4].tldr, "acme/repo-5 的旧导读");
    });
  });

  it("returns unchanged with zero network attempts when no key is configured", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(3);
      let fetchCalls = 0;
      const fetch = async () => {
        fetchCalls += 1;
        return okChatResponse('["不应发生"]');
      };

      await enrichWithTldr(digest, { fetch });

      assert.equal(fetchCalls, 0);
      for (const repo of digest.repos) {
        assert.equal("tldr" in repo, false);
      }
    });
  });

  it("honors an injected client even without a key (injector has precedence)", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(1);
      const { client, calls } = fakeTldrClient(() => ["无需 key 的导读"]);

      await enrichWithTldr(digest, { client });

      assert.equal(calls.length, 1);
      assert.equal(digest.repos[0].tldr, "无需 key 的导读");
    });
  });

  it("resolves topN from the TLDR_TOP_N environment variable", async () => {
    await withoutTldrEnv(async () => {
      process.env.TLDR_TOP_N = "2";
      const digest = makeDigest(10);
      const { client, calls } = fakeTldrClient(
        (repos) => repos.map((repo) => `${repo.fullName} 的导读`),
      );

      await enrichWithTldr(digest, { client });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].length, 2);
      assert.equal("tldr" in digest.repos[2], false);
    });
  });

  it("never rejects when the client throws; warns and writes nothing", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(2);
      const { client, calls } = fakeTldrClient(() => {
        throw new Error("LLM endpoint returned HTTP 500 Internal Server Error");
      });

      const lines = await captureStderr(() =>
        enrichWithTldr(digest, { client, topN: 5 }),
      );

      assert.equal(calls.length, 1);
      for (const repo of digest.repos) {
        assert.equal("tldr" in repo, false);
      }
      assert.equal(lines.length, 1);
      assert.match(lines[0], /\[tldr\]/);
      assert.match(lines[0], /HTTP 500/);
    });
  });

  it("contains a client that throws synchronously", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(1);
      const lines = await captureStderr(() =>
        enrichWithTldr(digest, {
          client: () => {
            throw new Error("sync boom");
          },
        }),
      );

      assert.equal("tldr" in digest.repos[0], false);
      assert.match(lines[0], /sync boom/);
    });
  });

  it("warns per repo when the model omits or blanks a summary", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(3);
      const { client } = fakeTldrClient(() => ["只有第一句", "   ", 42]);

      const lines = await captureStderr(() =>
        enrichWithTldr(digest, { client, topN: 5 }),
      );

      assert.equal(digest.repos[0].tldr, "只有第一句");
      assert.equal("tldr" in digest.repos[1], false);
      assert.equal("tldr" in digest.repos[2], false);
      assert.equal(lines.length, 2);
      assert.match(lines[0], /acme\/repo-2/);
      assert.match(lines[1], /acme\/repo-3/);
    });
  });

  it("skips sample snapshots entirely (zero calls)", async () => {
    await withoutTldrEnv(async () => {
      const digest = makeDigest(3, { sample: true });
      const { client, calls } = fakeTldrClient(() => {
        throw new Error("should not be called");
      });

      await enrichWithTldr(digest, { client, topN: 5 });

      assert.equal(calls.length, 0);
      assert.equal("tldr" in digest.repos[0], false);
    });
  });

  it("is a no-op for an empty repo list", async () => {
    await withoutTldrEnv(async () => {
      const digest = { repos: [] };
      const { client, calls } = fakeTldrClient(() => []);

      await enrichWithTldr(digest, { client });

      assert.equal(calls.length, 0);
    });
  });

  it("documents the prompt shape via buildTldrMessages", () => {
    const messages = buildTldrMessages([
      {
        fullName: "acme/rocket",
        description: "Fast builds",
        language: "Rust",
        stars: 100,
        starsToday: 5,
      },
    ]);

    assert.equal(messages[0].role, "system");
    const user = messages[1].content;
    assert.match(user, /它是什么、为什么值得关注/);
    assert.match(user, /1\. acme\/rocket/);
    assert.match(user, /Rust/);
    assert.match(user, /今日 \+5/);
  });
});

describe("runFetch tldr pipeline", () => {
  // 单仓库趋势页（解析出 1 个仓库 acme/rocket）。
  const validHtml = `<!DOCTYPE html><html><body><!-- ${"x".repeat(200)} -->
<article class="Box-row">
  <h2><a href="/acme/rocket">acme / rocket</a></h2>
  <a href="/acme/rocket/stargazers">10</a>
</article>
</body></html>`;
  const now = new Date("2026-09-06T00:00:00Z");

  it("writes generated tldr into the daily snapshot (live fetch only)", async () => {
    await withoutTldrEnv(async () => {
      const { client, calls } = fakeTldrClient(() => ["这是一个很值得关注的仓库。"]);

      const { filePath, digest } = await runFetch({
        html: validHtml,
        enrich: false,
        tldrClient: client,
        dataDir: tmpDataDir(),
        now,
      });

      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], ["acme/rocket"]);
      assert.equal(digest.repos[0].tldr, "这是一个很值得关注的仓库。");

      const stored = JSON.parse(readFileSync(filePath, "utf8"));
      assert.equal(stored.repos[0].tldr, "这是一个很值得关注的仓库。");
    });
  });

  it("second run on the same day hits the snapshot cache with zero calls", async () => {
    await withoutTldrEnv(async () => {
      const dataDir = tmpDataDir();
      const first = fakeTldrClient(() => ["第一次生成的导读。"]);
      await runFetch({
        html: validHtml,
        enrich: false,
        tldrClient: first.client,
        dataDir,
        now,
      });
      assert.equal(first.calls.length, 1);

      const second = fakeTldrClient(() => {
        throw new Error("should not be called");
      });
      const { digest } = await runFetch({
        html: validHtml,
        enrich: false,
        tldrClient: second.client,
        dataDir,
        now,
      });

      assert.equal(second.calls.length, 0);
      assert.equal(digest.repos[0].tldr, "第一次生成的导读。");
    });
  });

  it("never calls the LLM on the explicit sample path", async () => {
    await withoutTldrEnv(async () => {
      const { client, calls } = fakeTldrClient(() => []);

      await runFetch({
        sample: true,
        tldrClient: client,
        dataDir: tmpDataDir(),
        now,
      });

      assert.equal(calls.length, 0);
    });
  });

  it("never calls the LLM when the live fetch degrades to sample data", async () => {
    await withoutTldrEnv(async () => {
      const { client, calls } = fakeTldrClient(() => []);
      const trendingFetch = async () => {
        throw new Error("network down");
      };

      const { digest } = await runFetch({
        fetch: trendingFetch,
        retryBaseMs: 1,
        enrich: false,
        tldrClient: client,
        dataDir: tmpDataDir(),
        now,
      });

      assert.equal(digest.sample, true);
      assert.equal(calls.length, 0);
      assert.equal("tldr" in digest.repos[0], false);
    });
  });

  it("makes zero network attempts for tldr when not explicitly enabled", async () => {
    await withoutTldrEnv(async () => {
      let fetchCalls = 0;
      const fetch = async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, statusText: "OK", text: async () => validHtml };
      };

      await runFetch({
        html: validHtml,
        enrich: false,
        fetch,
        dataDir: tmpDataDir(),
        now,
      });

      // runFetch 自身不读 TLDR_* 环境变量：未显式传 tldrApiKey/tldrClient 时
      // 导读整体关闭（html 直接注入时连趋势页都不会请求）。
      assert.equal(fetchCalls, 0);
    });
  });

  it("ignores an ambient TLDR_API_KEY unless runFetch receives tldrApiKey", async () => {
    // 回归：环境变量里碰巧有 key 时（开发者本地导出过），既有 runFetch 测试
    // 也必须保持零网络——key 只能由 scripts 显式传入。
    const saved = process.env.TLDR_API_KEY;
    process.env.TLDR_API_KEY = "sk-ambient";
    try {
      let fetchCalls = 0;
      const fetch = async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, statusText: "OK", text: async () => validHtml };
      };

      const { digest } = await runFetch({
        html: validHtml,
        enrich: false,
        fetch,
        dataDir: tmpDataDir(),
        now,
      });

      assert.equal(fetchCalls, 0);
      assert.equal("tldr" in digest.repos[0], false);
    } finally {
      if (saved === undefined) delete process.env.TLDR_API_KEY;
      else process.env.TLDR_API_KEY = saved;
    }
  });

  it("skips tldr entirely when tldr: false", async () => {
    await withoutTldrEnv(async () => {
      const { client, calls } = fakeTldrClient(() => []);

      const { digest } = await runFetch({
        html: validHtml,
        enrich: false,
        tldr: false,
        tldrClient: client,
        dataDir: tmpDataDir(),
        now,
      });

      assert.equal(calls.length, 0);
      assert.equal("tldr" in digest.repos[0], false);
    });
  });

  it("still writes the snapshot when the tldr client fails", async () => {
    await withoutTldrEnv(async () => {
      const { client } = fakeTldrClient(() => {
        throw new Error("LLM endpoint returned HTTP 503 Service Unavailable");
      });

      const { filePath, digest } = await runFetch({
        html: validHtml,
        enrich: false,
        tldrClient: client,
        dataDir: tmpDataDir(),
        now,
      });

      assert.equal("tldr" in digest.repos[0], false);
      const stored = JSON.parse(readFileSync(filePath, "utf8"));
      assert.equal(stored.repos[0].fullName, "acme/rocket");
    });
  });
});

describe("generateSite tldr display", () => {
  const repoWithTldr = {
    rank: 1,
    owner: "acme",
    name: "rocket",
    fullName: "acme/rocket",
    url: "https://github.com/acme/rocket",
    description: "Fast builds",
    language: "Rust",
    stars: 12345,
    starsToday: 890,
    tldr: '<img src=x onerror="alert(1)"> 一个构建工具 & "很快"',
  };
  const repoWithoutTldr = {
    rank: 2,
    owner: "acme",
    name: "anvil",
    fullName: "acme/anvil",
    url: "https://github.com/acme/anvil",
    description: "Old reliable",
    language: "Go",
    stars: 42,
    starsToday: 3,
  };

  function writeDigest(dir, date, repos) {
    writeFileSync(
      join(dir, `${date}.json`),
      JSON.stringify({
        date,
        fetchedAt: `${date}T00:00:00.000Z`,
        source: "https://github.com/trending?since=daily",
        repos,
      }),
    );
  }

  it("renders the AI tldr block on home and day cards, escaped against XSS", () => {
    const root = join(mkdtempSync(join(tmpdir(), "trending-tldr-site-")));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeDigest(dataDir, "2026-09-04", [repoWithTldr, repoWithoutTldr]);

    generateSite({ dataDir, siteDir });
    const home = readFileSync(join(siteDir, "index.html"), "utf8");
    const day = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");

    for (const html of [home, day]) {
      // 导读块存在且带「AI 导读」标签
      assert.match(html, /class="tldr"/);
      assert.match(html, /class="tldr-tag">AI 导读</);
      // 恶意内容必须被转义，不能以可执行形式出现
      assert.doesNotMatch(html, /<img src=x/);
      assert.doesNotMatch(html, /onerror="alert\(1\)/);
      assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
      assert.match(html, /一个构建工具 &amp; &quot;很快&quot;/);
      // 没有导读的卡片不渲染该区块
      assert.equal((html.match(/class="tldr"/g) || []).length, 1);
    }
  });
});
