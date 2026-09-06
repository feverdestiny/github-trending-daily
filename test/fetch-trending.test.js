import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fetchTrendingHtml, runFetch } from "../src/fetch-trending.js";

/** 造一个 >=200 字符的合法趋势页（响应体过短会被视为失败）。 */
const validHtml = `<!DOCTYPE html><html><body><!-- ${"x".repeat(200)} -->
<article class="Box-row">
  <h2><a href="/acme/rocket">acme / rocket</a></h2>
  <a href="/acme/rocket/stargazers">10</a>
</article>
</body></html>`;

function okResponse(html) {
  return { ok: true, status: 200, statusText: "OK", text: async () => html };
}

function errorResponse(status, statusText, body = "") {
  return { ok: false, status, statusText, text: async () => body };
}

/** 依序回放预设响应/错误的假 fetch，并记录调用次数（耗尽后重复最后一项）。 */
function fakeFetch(script) {
  const calls = { count: 0 };
  const fetch = async () => {
    const step = script[Math.min(calls.count, script.length - 1)];
    calls.count += 1;
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetch, calls };
}

function tmpDataDir() {
  return join(mkdtempSync(join(tmpdir(), "trending-fetch-")), "data");
}

/** 假 GitHub API 客户端（注入点）：记录调用并回放固定元数据或错误。 */
function fakeGithubClient(metadata = { topics: [], license: null, ownerAvatarUrl: null }) {
  const calls = [];
  const githubClient = async (fullName) => {
    calls.push(fullName);
    if (metadata instanceof Error) throw metadata;
    return metadata;
  };
  return { githubClient, calls };
}

describe("fetchTrendingHtml", () => {
  it("retries after a network failure and succeeds", async () => {
    const { fetch, calls } = fakeFetch([
      new Error("ECONNRESET"),
      okResponse(validHtml),
    ]);

    const html = await fetchTrendingHtml({ fetch, retryBaseMs: 1 });

    assert.equal(html, validHtml);
    assert.equal(calls.count, 2);
  });

  it("retries on non-200 and short bodies, then succeeds", async () => {
    const { fetch, calls } = fakeFetch([
      errorResponse(500, "Internal Server Error"),
      okResponse("too short"),
      okResponse(validHtml),
    ]);

    const html = await fetchTrendingHtml({ fetch, retryBaseMs: 1 });

    assert.equal(html, validHtml);
    assert.equal(calls.count, 3);
  });

  it("throws the last error after exhausting the default 3 attempts", async () => {
    const { fetch, calls } = fakeFetch([errorResponse(503, "Service Unavailable")]);

    await assert.rejects(
      fetchTrendingHtml({ fetch, retryBaseMs: 1 }),
      /HTTP 503/,
    );
    assert.equal(calls.count, 3);
  });

  it("honors a custom maxAttempts", async () => {
    const { fetch, calls } = fakeFetch([new Error("network down")]);

    await assert.rejects(
      fetchTrendingHtml({ fetch, retryBaseMs: 1, maxAttempts: 4 }),
      /network down/,
    );
    assert.equal(calls.count, 4);
  });
});

describe("runFetch fallback", () => {
  const now = new Date("2026-09-06T00:00:00Z");

  it("falls back to sample data, explicitly annotated, once retries are exhausted", async () => {
    const { fetch, calls } = fakeFetch([new Error("network down")]);
    const github = fakeGithubClient();

    const { filePath, digest } = await runFetch({
      fetch,
      githubClient: github.githubClient,
      dataDir: tmpDataDir(),
      now,
      retryBaseMs: 1,
    });

    assert.equal(calls.count, 3);
    assert.equal(digest.sample, true);
    assert.equal(digest.repos.length, 2);
    assert.equal(digest.repos[0].fullName, "fmtlib/fmt");
    assert.match(readFileSync(filePath, "utf8"), /"sample": true/);
  });

  it("keeps the explicit sample path annotated as before", async () => {
    const github = fakeGithubClient();

    const { digest } = await runFetch({
      sample: true,
      githubClient: github.githubClient,
      dataDir: tmpDataDir(),
      now,
    });

    assert.equal(digest.sample, true);
    assert.equal(digest.repos.length, 2);
    // 示例路径不做富集：保持完全离线（降级正发生在网络不可用时）。
    assert.equal(github.calls.length, 0);
  });

  it("does not annotate a successful live fetch", async () => {
    const { fetch, calls } = fakeFetch([okResponse(validHtml)]);
    const github = fakeGithubClient();

    const { digest } = await runFetch({
      fetch,
      githubClient: github.githubClient,
      dataDir: tmpDataDir(),
      now,
    });

    assert.equal(calls.count, 1);
    assert.equal("sample" in digest, false);
    assert.equal(digest.repos[0].fullName, "acme/rocket");
  });
});

describe("runFetch enrichment (schema v2)", () => {
  const now = new Date("2026-09-06T00:00:00Z");

  it("populates topics/license/ownerAvatarUrl and writes them into the snapshot", async () => {
    const { fetch } = fakeFetch([okResponse(validHtml)]);
    const github = fakeGithubClient({
      topics: ["space", "cli"],
      license: "MIT",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    });

    const { filePath, digest } = await runFetch({
      fetch,
      githubClient: github.githubClient,
      dataDir: tmpDataDir(),
      now,
    });

    assert.deepEqual(github.calls, ["acme/rocket"]);
    assert.deepEqual(digest.repos[0].topics, ["space", "cli"]);
    assert.equal(digest.repos[0].license, "MIT");
    assert.equal(
      digest.repos[0].ownerAvatarUrl,
      "https://avatars.githubusercontent.com/u/1?v=4",
    );

    const stored = JSON.parse(readFileSync(filePath, "utf8"));
    assert.deepEqual(stored.repos[0].topics, ["space", "cli"]);
    assert.equal(stored.repos[0].license, "MIT");
    assert.equal(
      stored.repos[0].ownerAvatarUrl,
      "https://avatars.githubusercontent.com/u/1?v=4",
    );
  });

  it("leaves a 404 repo unenriched but still writes the snapshot", async () => {
    const { fetch } = fakeFetch([okResponse(validHtml)]);
    const github = {
      calls: [],
      githubClient: async (fullName) => {
        github.calls.push(fullName);
        throw new Error("GitHub API returned HTTP 404 Not Found for acme/rocket");
      },
    };

    const { filePath, digest } = await runFetch({
      fetch,
      githubClient: github.githubClient,
      dataDir: tmpDataDir(),
      now,
    });

    assert.equal(github.calls.length, 1);
    assert.equal("topics" in digest.repos[0], false);
    assert.equal("license" in digest.repos[0], false);
    assert.equal("ownerAvatarUrl" in digest.repos[0], false);
    assert.equal(digest.repos[0].stars, 10);

    const stored = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(stored.repos.length, 1);
    assert.equal("topics" in stored.repos[0], false);
  });

  it("survives a fully rate-limited (403) client and still writes the snapshot", async () => {
    const { fetch } = fakeFetch([okResponse(validHtml)]);
    const github = fakeGithubClient(
      new Error("GitHub API returned HTTP 403 Forbidden for acme/rocket"),
    );

    const { filePath, digest } = await runFetch({
      fetch,
      githubClient: github.githubClient,
      dataDir: tmpDataDir(),
      now,
    });

    assert.equal("topics" in digest.repos[0], false);
    const stored = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(stored.repos[0].fullName, "acme/rocket");
  });

  it("skips enrichment entirely when enrich: false", async () => {
    const { fetch } = fakeFetch([okResponse(validHtml)]);
    const github = fakeGithubClient();

    const { digest } = await runFetch({
      fetch,
      githubClient: github.githubClient,
      enrich: false,
      dataDir: tmpDataDir(),
      now,
    });

    assert.equal(github.calls.length, 0);
    assert.equal("topics" in digest.repos[0], false);
  });
});
