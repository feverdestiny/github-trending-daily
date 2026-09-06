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

    const { filePath, digest } = await runFetch({
      fetch,
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
    const { digest } = await runFetch({
      sample: true,
      dataDir: tmpDataDir(),
      now,
    });

    assert.equal(digest.sample, true);
    assert.equal(digest.repos.length, 2);
  });

  it("does not annotate a successful live fetch", async () => {
    const { fetch, calls } = fakeFetch([okResponse(validHtml)]);

    const { digest } = await runFetch({
      fetch,
      dataDir: tmpDataDir(),
      now,
    });

    assert.equal(calls.count, 1);
    assert.equal("sample" in digest, false);
    assert.equal(digest.repos[0].fullName, "acme/rocket");
  });
});
