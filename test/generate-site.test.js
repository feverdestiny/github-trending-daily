import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
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

const v2Repo = {
  ...sampleRepo,
  topics: ["formatting", "text"],
  license: "MIT",
  ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
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

  it("renders v2 fields and HN/Reddit search links on cards, omitting them for v1", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-v2-fields-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeDigest(dataDir, "2026-09-03", [sampleRepo]); // v1
    writeDigest(dataDir, "2026-09-04", [v2Repo]); // v2

    generateSite({ dataDir, siteDir });
    const home = readFileSync(join(siteDir, "index.html"), "utf8");
    const v2Day = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");
    const v1Day = readFileSync(join(siteDir, "days/2026-09-03/index.html"), "utf8");

    // 话题标签 pills
    assert.match(home, /class="topic">formatting</);
    assert.match(home, /class="topic">text</);
    assert.match(v2Day, /class="topic">formatting</);
    // 许可证（弱化文本）
    assert.match(home, /<span class="license">MIT 许可证<\/span>/);
    // 当日增速（突出的 +N）
    assert.match(home, /今日新增 \+963</);
    // 作者头像作为属性出现
    assert.match(
      home,
      /src="https:\/\/avatars\.githubusercontent\.com\/u\/1\?v=4"/,
    );
    // HN/Reddit：纯 URL 模板，fullName 经 URL 编码
    assert.match(
      home,
      /href="https:\/\/news\.ycombinator\.com\/search\?query=fmtlib%2Ffmt"[^>]*>HN</,
    );
    assert.match(
      home,
      /href="https:\/\/www\.reddit\.com\/search\/\?q=fmtlib%2Ffmt"[^>]*>Reddit</,
    );
    assert.match(
      v2Day,
      /href="https:\/\/news\.ycombinator\.com\/search\?query=fmtlib%2Ffmt"/,
    );

    // v1 旧快照：没有话题 pills / 许可证 / 头像，但讨论外链仍然渲染
    assert.doesNotMatch(v1Day, /class="topic"/);
    assert.doesNotMatch(v1Day, /许可证/);
    assert.doesNotMatch(v1Day, /class="avatar"/);
    assert.match(
      v1Day,
      /href="https:\/\/news\.ycombinator\.com\/search\?query=fmtlib%2Ffmt"/,
    );
    assert.match(v1Day, /href="https:\/\/www\.reddit\.com\/search\/\?q=fmtlib%2Ffmt"/);
  });

  it("paginates the archive at 30 days per page with month groups and correct pager links", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-pager-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    // 45 天：2026-07-01 .. 2026-08-14，跨两个月
    const startMs = Date.UTC(2026, 6, 1);
    for (let i = 0; i < 45; i += 1) {
      const date = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
      writeDigest(dataDir, date, [sampleRepo]);
    }

    generateSite({ dataDir, siteDir });

    // 第 1 页固定是 archive/index.html，不存在 archive/page/1/
    assert.ok(!existsSync(join(siteDir, "archive/page/1")));
    const page1 = readFileSync(join(siteDir, "archive/index.html"), "utf8");
    const page2 = readFileSync(join(siteDir, "archive/page/2/index.html"), "utf8");

    // 第 1 页：最新 30 天，8 月在前、7 月在后（按月分组标题）
    assert.equal((page1.match(/href="\.\.\/days\//g) || []).length, 30);
    assert.match(page1, /2026-08-14/);
    assert.doesNotMatch(page1, /2026-07-01/);
    assert.match(page1, /2026年8月/);
    assert.match(page1, /2026年7月/);
    assert.ok(page1.indexOf("2026年8月") < page1.indexOf("2026年7月"));
    assert.match(page1, /第 1 \/ 2 页/);
    assert.match(page1, /href="page\/2\/" rel="next">下一页/);
    assert.doesNotMatch(page1, /rel="prev"/);

    // 第 2 页：剩余 15 天（全是 7 月），prev 指回归档根，无 next
    assert.equal((page2.match(/href="\.\.\/\.\.\/days\//g) || []).length, 15);
    assert.match(page2, /2026-07-01/);
    assert.doesNotMatch(page2, /2026-08-14/);
    assert.doesNotMatch(page2, /2026年8月/);
    assert.match(page2, /第 2 \/ 2 页/);
    assert.match(page2, /href="\.\.\/\.\.\/" rel="prev">← 上一页/);
    assert.doesNotMatch(page2, /rel="next"/);
  });

  it("does not create archive page 2 when there are at most 30 days", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-nopager-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeDigest(dataDir, "2026-09-03", [sampleRepo]);
    writeDigest(dataDir, "2026-09-04", [sampleRepo]);

    generateSite({ dataDir, siteDir });

    assert.ok(!existsSync(join(siteDir, "archive/page")));
    const archive = readFileSync(join(siteDir, "archive/index.html"), "utf8");
    assert.doesNotMatch(archive, /page\/2\//);
    assert.doesNotMatch(archive, /class="pager"/);
    assert.match(archive, /class="month-heading">2026年9月</);
  });

  it("publishes every daily JSON as a directly accessible site URL", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-json-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeDigest(dataDir, "2026-09-03", [sampleRepo]);
    writeDigest(dataDir, "2026-09-04", [v2Repo]);

    generateSite({ dataDir, siteDir });

    for (const date of ["2026-09-03", "2026-09-04"]) {
      const published = readFileSync(join(siteDir, `data/${date}.json`), "utf8");
      assert.equal(published, readFileSync(join(dataDir, `${date}.json`), "utf8"));
    }

    const day = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");
    assert.match(day, /本日数据 JSON/);
    assert.match(day, /href="\.\.\/\.\.\/data\/2026-09-04\.json"/);
  });

  it("escapes and URL-encodes the new fields against XSS", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-xss-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    const evilRepo = {
      ...sampleRepo,
      fullName: "acme/<script>alert(1)</script>",
      url: 'https://github.com/acme/x" onclick="alert(1)',
      topics: ['<img src=x onerror="alert(1)">', "a&b"],
      license: 'MIT"><script>',
      ownerAvatarUrl: 'https://evil.example/a.png" onerror="alert(1)',
    };
    writeDigest(dataDir, "2026-09-04", [evilRepo]);

    generateSite({ dataDir, siteDir });
    const day = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");

    // 任何事件处理器属性都不能以未转义形式出现
    assert.doesNotMatch(day, /onerror="alert\(1\)/);
    assert.doesNotMatch(day, /onclick="alert\(1\)/);
    // 话题与许可证按文本转义
    assert.match(day, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(day, /a&amp;b/);
    assert.match(day, /MIT&quot;&gt;&lt;script&gt; 许可证/);
    // 头像 URL 在属性里被转义，无法闭合属性
    assert.match(
      day,
      /src="https:\/\/evil\.example\/a\.png&quot; onerror=&quot;alert\(1\)"/,
    );
    // 仓库链接属性同样转义
    assert.match(
      day,
      /href="https:\/\/github\.com\/acme\/x&quot; onclick=&quot;alert\(1\)"/,
    );
    // HN/Reddit 查询参数先 encodeURIComponent 再进属性
    const encoded = encodeURIComponent(evilRepo.fullName);
    assert.ok(day.includes(`query=${encoded}`), "HN query should be URL-encoded");
    assert.ok(day.includes(`q=${encoded}`), "Reddit query should be URL-encoded");
  });

  it("resolves the theme inline before styles paint and ships an accessible toggle", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-theme-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeDigest(dataDir, "2026-09-04", [sampleRepo]);

    generateSite({ dataDir, siteDir });
    const home = readFileSync(join(siteDir, "index.html"), "utf8");

    // 无闪烁：data-theme 引导脚本必须出现在样式表之前
    const bootstrapAt = home.indexOf(
      'document.documentElement.setAttribute("data-theme"',
    );
    const cssAt = home.indexOf('rel="stylesheet"');
    assert.ok(bootstrapAt > -1, "theme bootstrap script should exist");
    assert.ok(bootstrapAt < cssAt, "theme bootstrap must run before styles paint");
    // 跟随系统 + localStorage 手动持久化
    assert.match(home, /prefers-color-scheme: dark/);
    assert.match(home, /localStorage\.setItem\("theme"/);
    // 可访问的切换按钮
    assert.match(home, /<html lang="zh-CN">/);
    assert.match(home, /aria-label="切换深浅色模式"/);
    assert.match(home, /id="theme-toggle"/);
  });
});
