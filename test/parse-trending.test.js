import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ParseError, parseTrendingHtml } from "../src/parse-trending.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const sampleHtml = readFileSync(
  join(fixtureDir, "fixtures/trending-sample.html"),
  "utf8",
);

describe("parseTrendingHtml", () => {
  it("parses rank, identity, description, language and star counts", () => {
    const repos = parseTrendingHtml(sampleHtml);

    assert.equal(repos.length, 2);
    assert.deepEqual(repos[0], {
      rank: 1,
      owner: "fmtlib",
      name: "fmt",
      fullName: "fmtlib/fmt",
      url: "https://github.com/fmtlib/fmt",
      description: "A modern formatting library",
      language: "C++",
      stars: 25151,
      starsToday: 963,
    });
    assert.equal(repos[1].fullName, "vercel/next.js");
    assert.equal(repos[1].stars, 132004);
    assert.equal(repos[1].starsToday, 1204);
    assert.equal(repos[1].rank, 2);
  });

  it("throws a clear error when HTML is empty", () => {
    assert.throws(() => parseTrendingHtml(""), {
      name: "ParseError",
      message: /empty/i,
    });
    assert.throws(() => parseTrendingHtml("   "), ParseError);
  });

  it("throws a clear error when no repo cards can be found", () => {
    assert.throws(
      () => parseTrendingHtml("<html><body><p>Sign in to GitHub</p></body></html>"),
      /no trending repo cards/i,
    );
  });

  it("allows missing description and language", () => {
    const html = `
      <article class="Box-row">
        <h2><a href="/owner/bare-repo">owner / bare-repo</a></h2>
        <a href="/owner/bare-repo/stargazers">42</a>
        <span>7 stars today</span>
      </article>
    `;
    const [repo] = parseTrendingHtml(html);
    assert.equal(repo.fullName, "owner/bare-repo");
    assert.equal(repo.description, "");
    assert.equal(repo.language, "");
    assert.equal(repo.stars, 42);
    assert.equal(repo.starsToday, 7);
  });

  it("falls back when Box-row class is missing but articles remain", () => {
    const html = `
      <article>
        <h3><a href="/acme/widget">acme / widget</a></h3>
        <p>A fallback card</p>
        <span itemprop="programmingLanguage">Rust</span>
        <a href="/acme/widget/stargazers">1,000</a>
        <span>12 stars today</span>
      </article>
    `;
    const [repo] = parseTrendingHtml(html);
    assert.equal(repo.fullName, "acme/widget");
    assert.equal(repo.language, "Rust");
    assert.equal(repo.stars, 1000);
  });
});
