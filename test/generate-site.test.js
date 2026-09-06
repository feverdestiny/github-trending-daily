import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { generateSite } from "../src/generate-site.js";

function writeDigest(dir, date, repos, extra = {}) {
  writeFileSync(
    join(dir, `${date}.json`),
    JSON.stringify({
      date,
      fetchedAt: `${date}T00:00:00.000Z`,
      source: "https://github.com/trending?since=daily",
      repos,
      ...extra,
    }),
  );
}

const sampleRepo = {
  rank: 1,
  owner: "fmtlib",
  name: "fmt",
  fullName: "fmtlib/fmt",
  url: "https://github.com/fmtlib/fmt",
  description: "A modern formatting library",
  language: "C++",
  stars: 25151,
  starsToday: 963,
};

describe("generateSite", () => {
  it("writes home, archive and per-day pages with relative links", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-site-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    writeDigest(dataDir, "2026-09-03", [sampleRepo]);
    writeDigest(dataDir, "2026-09-04", [
      { ...sampleRepo, description: "<script>alert(1)</script>" },
    ]);

    const { latestDate, dates } = generateSite({ dataDir, siteDir });

    assert.equal(latestDate, "2026-09-04");
    assert.deepEqual(dates, ["2026-09-04", "2026-09-03"]);

    const home = readFileSync(join(siteDir, "index.html"), "utf8");
    const archive = readFileSync(join(siteDir, "archive/index.html"), "utf8");
    const day = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");

    assert.match(home, /fmtlib\/fmt/);
    assert.match(home, /href="\.\/archive\/"/);
    assert.match(home, /href="\.\/days\/2026-09-04\/"/);
    assert.match(home, /href="\.\/assets\/style\.css"/);
    assert.doesNotMatch(home, /<script>alert\(1\)<\/script>/);
    assert.match(home, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

    assert.match(archive, /2026-09-04/);
    assert.match(archive, /href="\.\.\/days\/2026-09-04\/"/);
    assert.ok(archive.indexOf("2026-09-04") < archive.indexOf("2026-09-03"));

    assert.match(day, /今日新增/);
    assert.match(day, /href="\.\.\/\.\.\/"/);
  });

  it("labels sample digests so they are not shown as live data", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-sample-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeDigest(dataDir, "2026-01-01", [sampleRepo], { sample: true });

    generateSite({ dataDir, siteDir });
    const home = readFileSync(join(siteDir, "index.html"), "utf8");
    assert.match(home, /示例数据/);
  });

  it("renders a mixed v1/v2 history without crashing", () => {
    // v1 旧快照：没有富集字段；v2 快照：字段齐全，含"富集成功但值为空"的形态。
    const v2Repo = {
      ...sampleRepo,
      topics: ["formatting", "text"],
      license: "MIT",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    };
    const v2RepoEmptyEnrichment = {
      ...sampleRepo,
      rank: 2,
      owner: "acme",
      name: "bare",
      fullName: "acme/bare",
      url: "https://github.com/acme/bare",
      topics: [],
      license: null,
      ownerAvatarUrl: null,
    };

    const root = mkdtempSync(join(tmpdir(), "trending-mixed-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeDigest(dataDir, "2026-09-03", [sampleRepo]); // v1：无 topics/license/ownerAvatarUrl
    writeDigest(dataDir, "2026-09-04", [v2Repo, v2RepoEmptyEnrichment]); // v2

    const { latestDate, dates } = generateSite({ dataDir, siteDir });

    assert.equal(latestDate, "2026-09-04");
    assert.deepEqual(dates, ["2026-09-04", "2026-09-03"]);

    for (const relative of [
      "index.html",
      "archive/index.html",
      "days/2026-09-03/index.html",
      "days/2026-09-04/index.html",
      "404.html",
    ]) {
      const html = readFileSync(join(siteDir, relative), "utf8");
      assert.match(html, /<!DOCTYPE html>/);
      assert.match(html, /<\/html>\s*$/);
      assert.doesNotMatch(html, /undefined/);
    }

    const v2Day = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");
    assert.match(v2Day, /fmtlib\/fmt/);
    assert.match(v2Day, /acme\/bare/);
    const v1Day = readFileSync(join(siteDir, "days/2026-09-03/index.html"), "utf8");
    assert.match(v1Day, /fmtlib\/fmt/);
  });
});
