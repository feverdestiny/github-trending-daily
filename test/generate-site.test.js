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

function writeSnapshot(dir, date, repos, extra = {}) {
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

    writeSnapshot(dataDir, "2026-09-03", [sampleRepo]);
    writeSnapshot(dataDir, "2026-09-04", [
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

  it("labels sample snapshots so they are not shown as live data", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-sample-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeSnapshot(dataDir, "2026-01-01", [sampleRepo], { sample: true });

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
    writeSnapshot(dataDir, "2026-09-03", [sampleRepo]); // v1：无 topics/license/ownerAvatarUrl
    writeSnapshot(dataDir, "2026-09-04", [v2Repo, v2RepoEmptyEnrichment]); // v2

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
    writeSnapshot(dataDir, "2026-09-03", [sampleRepo]); // v1
    writeSnapshot(dataDir, "2026-09-04", [v2Repo]); // v2

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

  it("omits the 今日新增 delta for v1 rows without starsToday but keeps +0 for a real zero", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-delta-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    const { starsToday, ...v1NoDelta } = sampleRepo; // v1：无 starsToday 字段
    writeSnapshot(dataDir, "2026-09-03", [v1NoDelta]);
    writeSnapshot(dataDir, "2026-09-04", [{ ...sampleRepo, starsToday: 0 }]);

    generateSite({ dataDir, siteDir });
    const v1Day = readFileSync(join(siteDir, "days/2026-09-03/index.html"), "utf8");
    const zeroDay = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");

    // 字段缺失：整块增速省略，绝不渲染成假的「今日新增 +0」
    assert.doesNotMatch(v1Day, /今日新增/);
    assert.doesNotMatch(v1Day, /class="delta"/);
    // 字段存在且为 0：照常显示 +0
    assert.match(zeroDay, /<span class="delta">今日新增 \+0<\/span>/);
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
      writeSnapshot(dataDir, date, [sampleRepo]);
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

    // 第 2 页：剩余 15 天（全是 7 月），day 链接在 archive/page/2/ 下需上溯三级
    assert.equal((page2.match(/href="\.\.\/\.\.\/\.\.\/days\//g) || []).length, 15);
    assert.match(page2, /2026-07-01/);
    assert.doesNotMatch(page2, /2026-08-14/);
    assert.doesNotMatch(page2, /2026年8月/);
    assert.match(page2, /第 2 \/ 2 页/);
    assert.match(page2, /href="\.\.\/\.\.\/" rel="prev">← 上一页/);
    assert.doesNotMatch(page2, /rel="next"/);
  });

  it("deep archive pagination (archive/page/2/) links back to the site root at depth 3", () => {
    // 回归：archive/page/N/（N≥2）在站点根下三级，所有站内相对链接都必须
    // 上溯三级（../../../），否则 brand/导航/日报/样式全部落在 /archive/ 下。
    const root = mkdtempSync(join(tmpdir(), "trending-page2-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    const startMs = Date.UTC(2026, 6, 1);
    for (let i = 0; i < 45; i += 1) {
      const date = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
      writeSnapshot(dataDir, date, [sampleRepo]);
    }

    generateSite({ dataDir, siteDir });
    const page2 = readFileSync(join(siteDir, "archive/page/2/index.html"), "utf8");

    // 样式表与品牌链接：精确三级上溯
    assert.ok(
      page2.includes('<link rel="stylesheet" href="../../../assets/style.css">'),
      "stylesheet link must climb three levels from archive/page/2/",
    );
    assert.ok(
      page2.includes('<a class="brand" href="../../../">GitHub 每日热门</a>'),
      "brand link must point at the site root",
    );

    // 全部导航入口逐条精确断言（trends 同样三级；archive 高亮当前项）
    for (const navEntry of [
      '<a href="../../../">今日</a>',
      '<a href="../../../weekly/">周榜</a>',
      '<a href="../../../monthly/">月榜</a>',
      '<a href="../../../languages/">语言</a>',
      '<a href="../../../trends/">趋势档案</a>',
      '<a href="../../../archive/" aria-current="page">归档</a>',
    ]) {
      assert.ok(page2.includes(navEntry), `nav entry missing: ${navEntry}`);
    }

    // 日报链接精确指向根下 /days/（三级上溯），不得停留在 /archive/ 下
    assert.ok(
      page2.includes('<a href="../../../days/2026-07-01/">'),
      "day-page link must climb three levels",
    );
    assert.doesNotMatch(page2, /href="\.\.\/\.\.\/days\//);
    assert.doesNotMatch(page2, /href="\.\.\/\.\.\/assets\//);
    assert.doesNotMatch(page2, /href="\.\.\/\.\.\/weekly\//);

    // 分页链接保持页间相对（第 2 页 → 上一页是归档根 ../../，且无下一页）
    assert.ok(
      page2.includes('<a href="../../" rel="prev">← 上一页</a>'),
      "prev pager link must stay archive-relative",
    );
    assert.ok(page2.includes('<span class="pager-status">第 2 / 2 页</span>'));
    assert.doesNotMatch(page2, /rel="next"/);
  });

  it("does not create archive page 2 when there are at most 30 days", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-nopager-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeSnapshot(dataDir, "2026-09-03", [sampleRepo]);
    writeSnapshot(dataDir, "2026-09-04", [sampleRepo]);

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
    writeSnapshot(dataDir, "2026-09-03", [sampleRepo]);
    writeSnapshot(dataDir, "2026-09-04", [v2Repo]);

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
    writeSnapshot(dataDir, "2026-09-04", [evilRepo]);

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
    writeSnapshot(dataDir, "2026-09-04", [sampleRepo]);

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

  it("renders weekly/monthly boards and language sub-boards reachable from the nav", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-boards-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    const fmt = (starsToday) => ({
      ...sampleRepo,
      rank: 1,
      starsToday,
    });
    const jsRepo = (starsToday, rank) => ({
      ...sampleRepo,
      rank,
      owner: "acme",
      name: "js",
      fullName: "acme/js",
      url: "https://github.com/acme/js",
      language: "JavaScript",
      starsToday,
    });
    // 跨月窗口：最新 2026-09-03，7 天窗口 = 2026-08-28..2026-09-03（首日恰在窗口边缘）
    writeSnapshot(dataDir, "2026-08-28", [fmt(100), jsRepo(10, 2)]);
    writeSnapshot(dataDir, "2026-09-03", [
      fmt(100),
      jsRepo(50, 2),
      { ...sampleRepo, rank: 3, owner: "solo", name: "once", fullName: "solo/once", url: "https://github.com/solo/once" },
    ]);

    generateSite({ dataDir, siteDir });

    // 导航在浅层与深层页面都指向正确相对路径
    const home = readFileSync(join(siteDir, "index.html"), "utf8");
    assert.match(home, /href="\.\/weekly\/">周榜</);
    assert.match(home, /href="\.\/monthly\/">月榜</);
    assert.match(home, /href="\.\/languages\/">语言</);
    const day = readFileSync(join(siteDir, "days/2026-09-03/index.html"), "utf8");
    assert.match(day, /href="\.\.\/\.\.\/weekly\/">周榜</);
    assert.match(day, /href="\.\.\/\.\.\/monthly\/">月榜</);
    assert.match(day, /href="\.\.\/\.\.\/languages\/">语言</);

    // 周榜：fmt 两天各 +100 → +200 (7天)、上榜 2 天；单日出现的 solo/once 被排除
    const weeklyHtml = readFileSync(join(siteDir, "weekly/index.html"), "utf8");
    assert.match(weeklyHtml, /<h1>周榜<\/h1>/);
    assert.match(weeklyHtml, /2026-08-28 至 2026-09-03/);
    assert.match(weeklyHtml, /\+200 \(7天\)/);
    assert.match(weeklyHtml, /7 天中上榜 2 天/);
    assert.ok(weeklyHtml.indexOf("fmtlib/fmt") < weeklyHtml.indexOf("acme/js"));
    assert.doesNotMatch(weeklyHtml, /solo\/once/);
    assert.match(weeklyHtml, /href="\.\.\/weekly\/" aria-current="page">周榜</);

    // 月榜：同规则，30 天窗口
    const monthlyHtml = readFileSync(join(siteDir, "monthly/index.html"), "utf8");
    assert.match(monthlyHtml, /<h1>月榜<\/h1>/);
    assert.match(monthlyHtml, /\+200 \(30天\)/);
    assert.doesNotMatch(monthlyHtml, /solo\/once/);

    // 语言索引：按语言名 slug 相对链接
    const langIndex = readFileSync(join(siteDir, "languages/index.html"), "utf8");
    assert.match(langIndex, /href="c-plus-plus\/"><span class="date">C\+\+<\/span>/);
    assert.match(langIndex, /href="javascript\/"><span class="date">JavaScript<\/span>/);

    // 语言子榜：只含该语言最新一天的仓库，且当前导航态正确
    const cpp = readFileSync(join(siteDir, "languages/c-plus-plus/index.html"), "utf8");
    assert.match(cpp, /<h1>C\+\+<\/h1>/);
    assert.match(cpp, /fmtlib\/fmt/);
    assert.doesNotMatch(cpp, /acme\/js/);
    assert.match(cpp, /href="\.\.\/\.\.\/languages\/" aria-current="page">语言</);
    const js = readFileSync(join(siteDir, "languages/javascript/index.html"), "utf8");
    assert.match(js, /acme\/js/);
    assert.doesNotMatch(js, /fmtlib\/fmt/);
  });

  it("renders friendly empty-state period boards with fewer than 2 days of data", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-empty-boards-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeSnapshot(dataDir, "2026-09-03", [sampleRepo]);

    generateSite({ dataDir, siteDir });

    for (const key of ["weekly", "monthly"]) {
      const html = readFileSync(join(siteDir, `${key}/index.html`), "utf8");
      assert.match(html, /数据不足/);
      assert.match(html, /至少需要 2 天快照/);
      assert.doesNotMatch(html, /fmtlib\/fmt/);
      assert.match(html, /<!DOCTYPE html>/);
    }

    // 语言子榜不受影响：单日数据也能按语言分组
    const langIndex = readFileSync(join(siteDir, "languages/index.html"), "utf8");
    assert.match(langIndex, /href="c-plus-plus\/"/);
    const cpp = readFileSync(join(siteDir, "languages/c-plus-plus/index.html"), "utf8");
    assert.match(cpp, /fmtlib\/fmt/);
  });

  it("escapes hostile language names in board paths and content", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-lang-xss-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    writeSnapshot(dataDir, "2026-09-03", [
      { ...sampleRepo, language: "<script>alert(1)</script>" },
      {
        ...sampleRepo,
        rank: 2,
        owner: "acme",
        name: "trav",
        fullName: "acme/trav",
        url: "https://github.com/acme/trav",
        language: "../..",
      },
    ]);

    generateSite({ dataDir, siteDir });

    // 索引只链接到派生 slug，不出现原始语言名
    const langIndex = readFileSync(join(siteDir, "languages/index.html"), "utf8");
    assert.match(langIndex, /href="script-alert-1-script\/"/);
    assert.doesNotMatch(langIndex, /href="<script>/);

    // 子榜页内容转义、路径不含 ../
    const evil = readFileSync(
      join(siteDir, "languages/script-alert-1-script/index.html"),
      "utf8",
    );
    assert.match(evil, /<h1>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
    assert.doesNotMatch(evil, /<script>alert\(1\)/);
    assert.ok(!existsSync(join(siteDir, "etc")));
    assert.ok(existsSync(join(siteDir, "languages/lang/index.html"))); // "../.." → 回退 slug "lang"
  });

  it("builds the trend leaderboard page and per-day streak badges from synthetic history", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-archive-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    const alpha = { ...sampleRepo, fullName: "acme/alpha", url: "https://github.com/acme/alpha" };
    const beta = { ...sampleRepo, fullName: "acme/beta", url: "https://github.com/acme/beta" };
    const gamma = { ...sampleRepo, fullName: "acme/gamma", url: "https://github.com/acme/gamma" };

    // alpha 连续 4 天且名次一路爬升到 #1；beta 中间断一天；gamma 只出现最后一天。
    writeSnapshot(dataDir, "2026-09-01", [{ ...alpha, rank: 5 }]);
    writeSnapshot(dataDir, "2026-09-02", [
      { ...alpha, rank: 3 },
      { ...beta, rank: 1 },
    ]);
    writeSnapshot(dataDir, "2026-09-03", [{ ...alpha, rank: 2 }]);
    writeSnapshot(dataDir, "2026-09-04", [
      { ...alpha, rank: 1 },
      { ...beta, rank: 4 },
      { ...gamma, rank: 9 },
    ]);

    generateSite({ dataDir, siteDir });
    const trends = readFileSync(join(siteDir, "trends/index.html"), "utf8");
    const home = readFileSync(join(siteDir, "index.html"), "utf8");
    const day1 = readFileSync(join(siteDir, "days/2026-09-01/index.html"), "utf8");
    const day3 = readFileSync(join(siteDir, "days/2026-09-03/index.html"), "utf8");
    const day4 = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");

    // 总榜：按累计天数排序（alpha 4 天 > beta 2 天 > gamma 1 天）
    assert.match(trends, /<h1>趋势档案<\/h1>/);
    assert.match(trends, /已收录 4 天快照 · 3 个仓库曾上榜/);
    assert.ok(trends.indexOf("acme/alpha") < trends.indexOf("acme/beta"));
    assert.ok(trends.indexOf("acme/beta") < trends.indexOf("acme/gamma"));
    assert.match(trends, /累计上榜 4 天 · 峰值 #1 · 最长连续 4 天 · 最近上榜 2026-09-04/);
    // beta 中间断一天：累计 2 天、峰值取历史最好名次、连续只有 1 天
    assert.match(trends, /累计上榜 2 天 · 峰值 #1 · 最长连续 1 天 · 最近上榜 2026-09-04/);

    // 导航：首页与趋势页互链，趋势页高亮当前项
    assert.ok(home.includes('<a href="./trends/">趋势档案</a>'), "home nav should link to trends");
    assert.ok(trends.includes('<a href="../">今日</a>'), "trends nav should link home relatively");
    assert.ok(trends.includes('<a href="../archive/">归档</a>'), "trends nav should link archive relatively");
    assert.ok(
      trends.includes('<a href="./" aria-current="page">趋势档案</a>'),
      "trends page should highlight the trends nav entry",
    );

    // 单日徽标按"截至当日"的前缀计算：第一天无徽标，第三天连续 3 天峰值只算到 #2
    assert.doesNotMatch(day1, /连续上榜/);
    assert.match(day3, /连续上榜 3 天 · 峰值 #2</);
    assert.match(day4, /连续上榜 4 天 · 峰值 #1</);
    // 当日首次上榜（gamma）与断天后回归（beta，current=1）都不带徽标
    const day4Gamma = day4.slice(day4.indexOf("acme/gamma"));
    assert.doesNotMatch(day4, /连续上榜 1 天/);
    assert.ok(!day4Gamma.includes("连续上榜"));
  });

  it("shows a friendly empty state on the trends page before two days of history", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-archive-empty-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    writeSnapshot(dataDir, "2026-09-04", [sampleRepo]);

    generateSite({ dataDir, siteDir });
    const trends = readFileSync(join(siteDir, "trends/index.html"), "utf8");

    assert.match(trends, /档案还在积累中/);
    assert.match(trends, /href="\.\.\/archive\/"/);
    assert.doesNotMatch(trends, /class="cards"/);
    assert.doesNotMatch(trends, /累计上榜/);
    assert.doesNotMatch(trends, /undefined/);
  });

  it("escapes untrusted text on the trend leaderboard and streak badges", () => {
    const root = mkdtempSync(join(tmpdir(), "trending-archive-xss-"));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);

    const evil = {
      ...sampleRepo,
      fullName: "acme/<script>alert(1)</script>",
      url: 'https://github.com/acme/x" onclick="alert(1)',
      description: 'evil<span title="x">desc</span>',
    };
    writeSnapshot(dataDir, "2026-09-03", [{ ...evil, rank: 2 }]);
    writeSnapshot(dataDir, "2026-09-04", [{ ...evil, rank: 1 }]);

    generateSite({ dataDir, siteDir });
    const trends = readFileSync(join(siteDir, "trends/index.html"), "utf8");
    const day = readFileSync(join(siteDir, "days/2026-09-04/index.html"), "utf8");

    // 恶意 fullName / description 在总榜页被转义（fullName 还被当作 Map 键精确匹配）
    assert.doesNotMatch(trends, /<script>alert\(1\)<\/script>/);
    assert.match(trends, /acme\/&lt;script&gt;alert\(1\)&lt;\/script&gt;</);
    assert.match(trends, /evil&lt;span title=&quot;x&quot;&gt;desc&lt;\/span&gt;/);
    // 链接属性被转义，无法闭合
    assert.match(
      trends,
      /href="https:\/\/github\.com\/acme\/x&quot; onclick=&quot;alert\(1\)"/,
    );
    // 连续徽标正常出现在单日页，且不注入原始 HTML
    assert.doesNotMatch(day, /<script>alert\(1\)<\/script>/);
    assert.match(day, /连续上榜 2 天 · 峰值 #1</);
  });
});
