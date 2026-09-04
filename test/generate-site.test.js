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
});
