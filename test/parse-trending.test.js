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
        <span class="d-inline-block float-sm-right">7 stars today</span>
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
        <span class="d-inline-block float-sm-right">12 stars today</span>
      </article>
    `;
    const [repo] = parseTrendingHtml(html);
    assert.equal(repo.fullName, "acme/widget");
    assert.equal(repo.language, "Rust");
    assert.equal(repo.stars, 1000);
    assert.equal(repo.starsToday, 12);
  });
});

describe("parseTrendingHtml hardening", () => {
  const variantsHtml = readFileSync(
    join(fixtureDir, "fixtures/trending-variants.html"),
    "utf8",
  );

  it("never text-matches the English delta copy anywhere in the parser source", () => {
    const source = readFileSync(
      join(fixtureDir, "..", "src", "parse-trending.js"),
      "utf8",
    );
    assert.doesNotMatch(source, /stars today/i);
  });

  it("parses localized delta copy by extracting the number only", () => {
    const [repo] = parseTrendingHtml(variantsHtml);
    assert.equal(repo.fullName, "vuejs/core");
    assert.equal(repo.description, "渐进式 JavaScript 框架");
    assert.equal(repo.language, "TypeScript");
    assert.equal(repo.stars, 49380);
    assert.equal(repo.starsToday, 1024);
  });

  it("returns starsToday 0 for a row with no delta element at all", () => {
    const [, repo] = parseTrendingHtml(variantsHtml);
    assert.equal(repo.fullName, "denoland/deno");
    assert.equal(repo.stars, 102417);
    assert.equal(repo.starsToday, 0);
  });

  it("parses a delta link with different classes but the same /stargazers href pattern", () => {
    const [, , repo] = parseTrendingHtml(variantsHtml);
    assert.equal(repo.fullName, "tokio-rs/tokio");
    assert.equal(repo.stars, 28913);
    assert.equal(repo.starsToday, 77);
  });
});
