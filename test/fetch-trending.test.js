import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRENDING_URL, fetchTrendingHtml } from "../src/fetch-trending.js";

function htmlResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => body,
  };
}

const goodHtml = "<!DOCTYPE html>".padEnd(240, "x");

describe("fetchTrendingHtml", () => {
  it("retries transient failures then returns HTML", async () => {
    let attempts = 0;
    const html = await fetchTrendingHtml({
      retries: 3,
      sleep: async () => {},
      fetch: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("network down");
        }
        return htmlResponse(200, goodHtml);
      },
    });
    assert.equal(html, goodHtml);
    assert.equal(attempts, 3);
  });

  it("surfaces HTTP errors after retries are exhausted", async () => {
    await assert.rejects(
      () =>
        fetchTrendingHtml({
          retries: 2,
          sleep: async () => {},
          fetch: async () => htmlResponse(403, "blocked"),
        }),
      /HTTP 403/,
    );
  });

  it("requests the daily trending URL", async () => {
    let requested;
    await fetchTrendingHtml({
      fetch: async (url) => {
        requested = url;
        return htmlResponse(200, goodHtml);
      },
    });
    assert.equal(requested, TRENDING_URL);
  });
});
