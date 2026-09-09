import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  languageBoards,
  languageSlug,
  monthly,
  rollingWindow,
  weekly,
} from "../src/aggregate.js";

function day(date, repos) {
  return { date, repos };
}

function repo(
  fullName,
  {
    starsToday = 10,
    stars = 1000,
    rank = 1,
    language = "TypeScript",
    ...rest
  } = {},
) {
  const [owner, name] = fullName.split("/");
  return {
    rank,
    owner,
    name,
    fullName,
    url: `https://github.com/${fullName}`,
    description: `${fullName} desc`,
    language,
    stars,
    starsToday,
    ...rest,
  };
}

describe("rollingWindow", () => {
  it("ends at the latest snapshot and spans calendar days across a month boundary", () => {
    const window = rollingWindow(
      [
        day("2026-09-03", []),
        day("2026-08-27", []),
        day("2026-08-28", []),
        day("2026-08-30", []),
      ],
      7,
    );
    assert.equal(window.start, "2026-08-28");
    assert.equal(window.end, "2026-09-03");
    assert.deepEqual(window.days.map((d) => d.date), [
      "2026-08-28",
      "2026-08-30",
      "2026-09-03",
    ]);
  });

  it("is independent of input order and handles a 30-day span", () => {
    const days = [
      day("2026-08-04", []),
      day("2026-09-03", []),
      day("2026-08-05", []),
    ];
    const window = rollingWindow(days, 30);
    assert.equal(window.start, "2026-08-05");
    assert.equal(window.end, "2026-09-03");
    // 08-04 距 09-03 恰好 30 天，落在窗口之外
    assert.deepEqual(window.days.map((d) => d.date), [
      "2026-08-05",
      "2026-09-03",
    ]);
  });

  it("returns an empty window for empty input", () => {
    assert.deepEqual(rollingWindow([], 7), { start: "", end: "", days: [] });
  });
});

describe("weekly / monthly aggregation", () => {
  it("aggregates a 7-day window across a month boundary and excludes <2-day repos", () => {
    const days = [
      // 2026-08-27 在窗口（08-28..09-03）之外
      day("2026-08-27", [
        repo("a/out-window", { starsToday: 500 }),
        repo("c/both", { starsToday: 5, rank: 1 }),
      ]),
      day("2026-08-28", [
        repo("b/alpha", { starsToday: 10, stars: 900, rank: 1 }),
        repo("c/both", { starsToday: 5, rank: 3 }),
      ]),
      day("2026-08-30", [repo("b/alpha", { starsToday: 10, rank: 2 })]),
      day("2026-09-01", [
        repo("b/alpha", { starsToday: 10, rank: 1 }),
        repo("d/gamma", { starsToday: 999, stars: 50000 }),
      ]),
      day("2026-09-03", [
        repo("b/alpha", { starsToday: 10, stars: 940, rank: 2 }),
        repo("c/both", { starsToday: 5, rank: 4 }),
      ]),
    ];

    const board = weekly(days);
    // d/gamma 只出现 1 天（单日脉冲）被排除；a/out-window 窗口内 0 天被排除
    assert.deepEqual(board.map((e) => e.fullName), ["b/alpha", "c/both"]);

    const alpha = board[0];
    assert.equal(alpha.totalDelta, 40);
    assert.equal(alpha.appearanceDays, 4);
    assert.equal(alpha.stars, 940); // 窗口内最新一天的星数
    assert.equal(alpha.bestRank, 1);
    assert.equal(alpha.rank, 1);
    assert.equal(alpha.url, "https://github.com/b/alpha");

    const both = board[1];
    assert.equal(both.totalDelta, 10); // 08-27 那次不计入窗口
    assert.equal(both.appearanceDays, 2);
    assert.equal(both.bestRank, 3); // 窗口外的 rank=1 不参与最佳排名
  });

  it("monthly covers exactly 30 calendar days ending at the latest snapshot", () => {
    const days = [
      // 2026-08-04 比 2026-09-03 早 30 天，落在 30 天窗口之外
      day("2026-08-04", [repo("old/repo", { starsToday: 100 })]),
      day("2026-08-05", [
        repo("edge/in", { starsToday: 1, rank: 2 }),
        repo("old/repo", { starsToday: 100, rank: 1 }),
      ]),
      day("2026-08-20", [repo("edge/in", { starsToday: 1, rank: 1 })]),
      day("2026-09-03", [repo("edge/in", { starsToday: 1, rank: 2 })]),
    ];

    const board = monthly(days);
    // old/repo 窗口内只出现 08-05 一天 → 排除
    assert.deepEqual(board.map((e) => e.fullName), ["edge/in"]);
    assert.equal(board[0].appearanceDays, 3);
    assert.equal(board[0].bestRank, 1);
  });

  it("breaks ties by total stars, then best rank", () => {
    const days = [
      day("2026-09-01", [
        repo("t/lowstars", { starsToday: 50, stars: 100, rank: 2 }),
        repo("t/highstars", { starsToday: 50, stars: 200, rank: 5 }),
        repo("t/samerank-later", { starsToday: 30, stars: 150, rank: 4 }),
        repo("t/samerank-earlier", { starsToday: 30, stars: 150, rank: 7 }),
      ]),
      day("2026-09-02", [
        repo("t/lowstars", { starsToday: 50, stars: 100, rank: 1 }),
        repo("t/highstars", { starsToday: 50, stars: 200, rank: 2 }),
        repo("t/samerank-later", { starsToday: 30, stars: 150, rank: 6 }),
        repo("t/samerank-earlier", { starsToday: 30, stars: 150, rank: 3 }),
      ]),
    ];

    const board = weekly(days);
    assert.deepEqual(
      board.map((e) => e.fullName),
      [
        "t/highstars", // 同增量比总星标
        "t/lowstars",
        "t/samerank-earlier", // 同增量同星标比最佳排名（3 < 4）
        "t/samerank-later",
      ],
    );
  });

  it("takes identity fields from the latest in-window appearance", () => {
    const days = [
      day("2026-09-01", [
        repo("f/fmt", { stars: 111, description: "old desc", language: "C" }),
      ]),
      day("2026-09-02", [
        repo("f/fmt", {
          stars: 222,
          description: "new desc",
          language: "C++",
          rank: 2,
        }),
      ]),
    ];

    const [entry] = weekly(days);
    assert.equal(entry.stars, 222);
    assert.equal(entry.description, "new desc");
    assert.equal(entry.language, "C++");
    assert.equal(entry.bestRank, 1); // 09-01 上的 rank=1
  });

  it("returns an empty board for empty input or a single snapshot", () => {
    assert.deepEqual(weekly([]), []);
    assert.deepEqual(monthly([]), []);
    assert.deepEqual(weekly([day("2026-09-03", [repo("solo/repo")])]), []);
    assert.deepEqual(monthly([day("2026-09-03", [repo("solo/repo")])]), []);
  });

  it("is independent of the order of input days", () => {
    const days = [
      day("2026-09-01", [repo("x/one", { starsToday: 20 })]),
      day("2026-09-02", [
        repo("x/one", { starsToday: 20 }),
        repo("x/two", { starsToday: 50 }),
      ]),
      day("2026-09-03", [
        repo("x/one", { starsToday: 20 }),
        repo("x/two", { starsToday: 50 }),
      ]),
    ];
    assert.deepEqual(weekly(days), weekly([...days].reverse()));
  });
});

describe("languageSlug", () => {
  it("derives URL-safe slugs from language names", () => {
    assert.equal(languageSlug("C++"), "c-plus-plus");
    assert.equal(languageSlug("c#"), "c-sharp");
    assert.equal(languageSlug("Objective-C"), "objective-c");
    assert.equal(languageSlug("HTML/CSS"), "html-css");
    assert.equal(languageSlug("Jupyter Notebook"), "jupyter-notebook");
  });

  it("neutralizes hostile or unusable language names", () => {
    assert.equal(
      languageSlug("<script>alert(1)</script>"),
      "script-alert-1-script",
    );
    assert.equal(languageSlug("../../etc/passwd"), "etc-passwd");
    assert.equal(languageSlug("../.."), "lang");
    assert.equal(languageSlug("///"), "lang");
    assert.equal(languageSlug(""), "lang");
    assert.equal(languageSlug(null), "lang");
    assert.equal(languageSlug(undefined), "lang");
  });

  it("always yields [a-z0-9-] only, without leading/trailing hyphens", () => {
    for (const name of [
      "C++", "C#", "Python", "JavaScript", "<img src=x>", "a/b/c", "  Go  ",
    ]) {
      const slug = languageSlug(name);
      assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("languageBoards", () => {
  // 三天合成数据：前 8 名按累计出现次数选出，Ruby 靠“最新一天 ≥3 席位”规则补入，
  // Zig 两者都不满足被排除，未标注语言的仓库不进任何子榜。
  function langDay(date, counts, extraRepos = []) {
    const repos = [];
    let rank = 1;
    for (const [language, count] of Object.entries(counts)) {
      for (let i = 0; i < count; i += 1) {
        const safe = language.toLowerCase().replace(/[^a-z0-9]/g, "");
        repos.push(
          repo(`org/${safe}-${date.slice(8)}-${i}`, {
            language,
            starsToday: 10,
            rank: rank++,
          }),
        );
      }
    }
    return day(date, [...repos, ...extraRepos]);
  }

  const langDays = [
    langDay("2026-09-01", { JavaScript: 2, Python: 2, TypeScript: 2, Shell: 2 }),
    langDay("2026-09-02", {
      JavaScript: 2,
      Python: 2,
      TypeScript: 1,
      Go: 2,
      "C++": 2,
      Java: 2,
      Shell: 2,
    }),
    langDay(
      "2026-09-03",
      {
        JavaScript: 2,
        Python: 1,
        TypeScript: 1,
        Go: 2,
        "C++": 2,
        Java: 2,
        Rust: 4,
        Ruby: 3,
        Zig: 1,
      },
      [repo("org/unknown-1", { language: null }), repo("org/unknown-2", { language: "  " })],
    ),
  ];

  it("picks the top languages by total appearances plus ≥3-slot latest-day languages", () => {
    const boards = languageBoards(langDays);
    // 累计次数：JS 6、Python 5、Rust/C++/Go/Java/Shell/TypeScript 各 4（前 8）；
    // Ruby 仅 3 次，但最新一天占 3 席 → 入选；Zig 被排除。
    assert.deepEqual(
      boards.map((b) => b.language),
      [
        "JavaScript",
        "Python",
        "Rust",
        "C++",
        "Go",
        "Java",
        "TypeScript",
        "Shell",
        "Ruby",
      ],
    );
  });

  it("groups only that language's latest-day repos and re-ranks them 1..n", () => {
    const boards = languageBoards(langDays);
    const ruby = boards.at(-1);
    assert.equal(ruby.slug, "ruby");
    assert.equal(ruby.totalAppearances, 3);
    assert.equal(ruby.latestCount, 3);
    assert.deepEqual(ruby.repos.map((r) => r.rank), [1, 2, 3]);
    assert.ok(ruby.repos.every((r) => r.language === "Ruby"));

    const cpp = boards.find((b) => b.language === "C++");
    assert.equal(cpp.slug, "c-plus-plus");
    assert.equal(cpp.totalAppearances, 4);
    assert.equal(cpp.latestCount, 2);
    assert.equal(cpp.repos.length, 2);
    assert.ok(cpp.repos.every((r) => r.language === "C++"));
  });

  it("excludes unlabeled repos from every board", () => {
    const names = languageBoards(langDays).flatMap((b) =>
      b.repos.map((r) => r.fullName),
    );
    assert.ok(!names.includes("org/unknown-1"));
    assert.ok(!names.includes("org/unknown-2"));
  });

  it("honors a smaller topLanguages while keeping the ≥3-slot rule", () => {
    const boards = languageBoards(langDays, { topLanguages: 1 });
    assert.deepEqual(
      boards.map((b) => b.language),
      ["JavaScript", "Rust", "Ruby"],
    );
  });

  it("is deterministic and handles empty input", () => {
    assert.deepEqual(languageBoards(langDays), languageBoards(langDays));
    assert.deepEqual(languageBoards([]), []);
  });
});
