import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadDigests, generateSite } from "../src/generate-site.js";
import {
  generateAtomFeed,
  normalizeBaseUrl,
  SITE_URL,
  xmlEscape,
} from "../src/rss.js";

/**
 * 极简 XML 良构性校验器（测试专用，零依赖）：
 * 标签配对、属性必须 name="value"（双引号）、文本与属性值里的 & 和 < 必须转义、
 * 声明/注释/CDATA 跳过。不追求完整 XML 规范，只覆盖本仓库 feed 会用到的形态。
 * @param {string} xml
 * @param {string} [label]
 */
function assertWellFormedXml(xml, label = "xml") {
  const entityRe = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
  const nameRe = /^[A-Za-z_][\w.:-]*/;
  const stack = [];
  let i = 0;

  const fail = (msg) =>
    assert.fail(`${label}: ${msg}（偏移 ${i}）：${JSON.stringify(xml.slice(i, i + 40))}`);

  while (i < xml.length) {
    if (xml[i] !== "<") {
      if (xml[i] === "&") {
        const entity = entityRe.exec(xml.slice(i));
        if (!entity) fail("文本中的 & 必须是合法实体");
        i += entity[0].length;
      } else {
        i += 1;
      }
      continue;
    }

    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i);
      if (end === -1) fail("未闭合的注释");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i);
      if (end === -1) fail("未闭合的 CDATA");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?") || xml.startsWith("<!")) {
      const end = xml.indexOf(">", i);
      if (end === -1) fail("未闭合的声明");
      i = end + 1;
      continue;
    }

    const closing = xml[i + 1] === "/";
    let j = i + 1 + (closing ? 1 : 0);
    const name = nameRe.exec(xml.slice(j))?.[0];
    if (!name) fail("标签必须有合法名称");
    j += name.length;

    if (closing) {
      if (!/^\s*>/.test(xml.slice(j))) fail(`闭合标签 </${name}> 格式错误`);
      const open = stack.pop();
      if (open !== name) fail(`</${name}> 与 <${open ?? "无"}> 不配对`);
      i = xml.indexOf(">", j) + 1;
      continue;
    }

    let selfClosed = false;
    for (;;) {
      j += /^\s*/.exec(xml.slice(j))[0].length;
      if (xml[j] === ">") {
        j += 1;
        break;
      }
      if (xml.startsWith("/>", j)) {
        selfClosed = true;
        j += 2;
        break;
      }
      const attr = /^[A-Za-z_][\w.:-]*\s*=\s*"/.exec(xml.slice(j));
      if (!attr) fail(`属性必须是 name="value" 形式`);
      j += attr[0].length;
      const endQuote = xml.indexOf('"', j);
      if (endQuote === -1) fail("属性值未闭合");
      const value = xml.slice(j, endQuote);
      let k = 0;
      while (k < value.length) {
        if (value[k] === "<") fail("属性值中不允许裸 <");
        if (value[k] === "&") {
          const entity = entityRe.exec(value.slice(k));
          if (!entity) fail("属性值中的 & 必须是合法实体");
          k += entity[0].length;
        } else {
          k += 1;
        }
      }
      j = endQuote + 1;
    }
    if (!selfClosed) stack.push(name);
    i = j;
  }

  assert.deepEqual(stack, [], `${label}: 有未闭合的标签 ${JSON.stringify(stack)}`);
}

function entryCount(xml) {
  return (xml.match(/<entry>/g) || []).length;
}

const repo1 = {
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

describe("xmlEscape", () => {
  it("escapes &, <, >, double quote and apostrophe to XML predefined entities", () => {
    assert.equal(
      xmlEscape(`a&b<c>d"e'f`),
      "a&amp;b&lt;c&gt;d&quot;e&apos;f",
    );
    assert.equal(xmlEscape(""), "");
    assert.equal(xmlEscape(null), "");
    assert.equal(xmlEscape(42), "42");
  });

  it("never leaves a raw & or < behind, even on repeated input", () => {
    const out = xmlEscape("&&<><&");
    assert.ok(!/[&<>]/.test(out.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, "")));
  });
});

describe("generateAtomFeed", () => {
  const days = [
    {
      date: "2026-09-06",
      fetchedAt: "2026-09-06T01:36:19.420Z",
      repos: [
        repo1,
        { ...repo1, rank: 2, fullName: "acme/two", url: "https://github.com/acme/two" },
        { ...repo1, rank: 3, fullName: "acme/three", url: "https://github.com/acme/three" },
      ],
    },
    { date: "2026-09-05", fetchedAt: "2026-09-05T01:00:00.000Z", repos: [repo1] },
  ];

  it("generates the feed for the latest snapshot day only", () => {
    const feed = generateAtomFeed({ days, siteUrl: "https://example.com/site/" });

    assertWellFormedXml(feed);
    assert.match(feed, /<title>GitHub 每日热门<\/title>/);
    assert.match(feed, /<id>https:\/\/example\.com\/site\/<\/id>/);
    assert.match(feed, /<link rel="self"[^>]*href="https:\/\/example\.com\/site\/feed\.xml"/);
    assert.match(feed, /<updated>2026-09-06T01:36:19Z<\/updated>/);
    // 只包含最新一天：fmtlib/fmt 在两天都上榜，但 #2026-09-05 的 id 不允许出现
    assert.ok(feed.includes("fmtlib/fmt#2026-09-06"));
    assert.doesNotMatch(feed, /#2026-09-05/);
  });

  it("matches the snapshot: one entry per repo, in rank order, with summary content", () => {
    const feed = generateAtomFeed({ days, siteUrl: "https://example.com/site/" });

    assert.equal(entryCount(feed), 3);
    const titles = ["#1 fmtlib/fmt", "#2 acme/two", "#3 acme/three"];
    const positions = titles.map((title) => feed.indexOf(`<title>${title}</title>`));
    assert.ok(positions.every((p) => p > -1), "每个条目的标题都要存在");
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2], "条目按榜单顺序排列");

    // 条目正文：简介 + 语言 + 总星标 + 当日新增
    assert.match(
      feed,
      /<content type="html">.*A modern formatting library.*★ 25,151.*今日新增 \+963/,
    );
    // 条目 id 稳定：仓库 URL 片段 + 日期
    assert.match(feed, /<id>https:\/\/github\.com\/fmtlib\/fmt#2026-09-06<\/id>/);
  });

  it("double-escapes hostile descriptions under content type=html", () => {
    const hostile = {
      ...repo1,
      description: `A & B <x> "q" 'a'`,
    };
    const feed = generateAtomFeed({
      days: [{ date: "2026-09-06", fetchedAt: "2026-09-06T00:00:00.000Z", repos: [hostile] }],
      siteUrl: "https://example.com/",
    });

    assertWellFormedXml(feed);
    // 第一层 XML 转义后，内层 HTML 实体自身再次被转义（&amp;amp; / &amp;lt;）
    assert.ok(feed.includes("&amp;amp;"), "& 要双重转义");
    assert.ok(feed.includes("&amp;lt;x&amp;gt;"), "< > 要双重转义");
    assert.ok(feed.includes("&amp;quot;") && feed.includes("&amp;apos;"), "引号要双重转义");
    assert.doesNotMatch(feed, /A & B/); // 任何裸 & 都不允许残留
  });

  it("produces a valid feed from a v1 snapshot without enrichment fields", () => {
    // v1：没有 topics/license/ownerAvatarUrl，甚至缺 language/owner
    const v1Repo = {
      rank: 1,
      fullName: "legacy/one",
      url: "https://github.com/legacy/one",
      description: "Old snapshot & no <meta>",
      stars: 10,
      starsToday: 2,
    };
    const feed = generateAtomFeed({
      days: [{ date: "2026-01-01", repos: [v1Repo] }],
      siteUrl: "https://example.com/",
    });

    assertWellFormedXml(feed);
    assert.equal(entryCount(feed), 1);
    // 缺 fetchedAt 退回当天零点；缺 language 显示「未标注语言」；缺 owner 无 <author>
    assert.match(feed, /<updated>2026-01-01T00:00:00Z<\/updated>/);
    assert.match(feed, /未标注语言/);
    assert.doesNotMatch(feed, /<author>/);
    // v2 富集字段即使存在也不会混入 feed 正文（feed 只用简介/语言/星标）
    const v2 = generateAtomFeed({
      days: [
        {
          date: "2026-01-01",
          repos: [{ ...v1Repo, topics: ["a", "b"], license: "MIT", ownerAvatarUrl: "https://x/y.png" }],
        },
      ],
    });
    assert.doesNotMatch(v2, /ownerAvatarUrl|onerror/);
  });

  it("renders a valid feed with zero entries when the latest day has no repos", () => {
    // 约定：最新一天 repos 为空 → 输出合法但无条目的 feed（保持 feed URL 永远可订阅）
    const feed = generateAtomFeed({
      days: [{ date: "2026-09-06", fetchedAt: "2026-09-06T00:00:00.000Z", repos: [] }],
      siteUrl: "https://example.com/",
    });

    assertWellFormedXml(feed);
    assert.equal(entryCount(feed), 0);
    assert.match(feed, /<\/feed>\s*$/);
  });

  it("throws on an empty days list and falls back to the default site URL", () => {
    assert.throws(() => generateAtomFeed({ days: [] }), /at least one daily digest/);

    const feed = generateAtomFeed({ days });
    assert.ok(feed.includes(`<id>${SITE_URL}</id>`));
    assert.equal(normalizeBaseUrl("https://example.com/no-slash"), "https://example.com/no-slash/");
  });
});

describe("generateSite feed integration", () => {
  function setup(name, extra = {}) {
    const root = mkdtempSync(join(tmpdir(), `trending-${name}-`));
    const dataDir = join(root, "data");
    const siteDir = join(root, "site");
    mkdirSync(dataDir);
    const write = (date, repos, more = {}) =>
      writeFileSync(
        join(dataDir, `${date}.json`),
        JSON.stringify({ date, fetchedAt: `${date}T00:00:00.000Z`, repos, ...more }),
      );
    return { dataDir, siteDir, write, ...extra };
  }

  it("writes site/feed.xml from the latest day and links it from every page head", () => {
    const ctx = setup("feed");
    ctx.write("2026-09-05", [repo1]);
    ctx.write("2026-09-06", [repo1, { ...repo1, rank: 2, fullName: "acme/two", url: "https://github.com/acme/two" }]);

    generateSite({ dataDir: ctx.dataDir, siteDir: ctx.siteDir });

    const feed = readFileSync(join(ctx.siteDir, "feed.xml"), "utf8");
    assertWellFormedXml(feed);
    assert.equal(entryCount(feed), 2); // 最新一天的两个仓库，不是三天的
    assert.ok(feed.includes("2026-09-06"));

    // 每一类页面的 <head> 都有订阅发现链接
    for (const relative of [
      "index.html",
      "archive/index.html",
      "days/2026-09-06/index.html",
      "404.html",
    ]) {
      const html = readFileSync(join(ctx.siteDir, relative), "utf8");
      assert.match(
        html,
        new RegExp(
          `<link rel="alternate" type="application/atom\\+xml" title="GitHub 每日热门" href="${SITE_URL.replace(/\//g, "\\/")}feed\\.xml">`,
        ),
        `${relative} 缺少 feed 发现链接`,
      );
    }
  });

  it("honors the siteUrl option (trailing slash normalized) in feed and head links", () => {
    const ctx = setup("feedurl");
    ctx.write("2026-09-06", [repo1]);

    const { siteUrl } = generateSite({
      dataDir: ctx.dataDir,
      siteDir: ctx.siteDir,
      siteUrl: "https://mirror.example/blog", // 故意不带末尾斜杠
    });

    assert.equal(siteUrl, "https://mirror.example/blog/");
    const feed = readFileSync(join(ctx.siteDir, "feed.xml"), "utf8");
    assert.match(feed, /<id>https:\/\/mirror\.example\/blog\/<\/id>/);
    assert.match(feed, /href="https:\/\/mirror\.example\/blog\/feed\.xml"/);
    const home = readFileSync(join(ctx.siteDir, "index.html"), "utf8");
    assert.match(home, /href="https:\/\/mirror\.example\/blog\/feed\.xml"/);
  });
});
