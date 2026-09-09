import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrendIndex, sortTrendLeaderboard } from "../src/trend-archive.js";
import { day, repo } from "./helpers.js";

describe("buildTrendIndex", () => {
  it("counts consecutive days across month boundaries as one streak", () => {
    // 1月末到2月初：2026-01-30 → 01-31 → 02-01 自然日连续。
    const index = buildTrendIndex([
      day("2026-01-30", [repo("acme/alpha", { rank: 2 })]),
      day("2026-01-31", [repo("acme/alpha", { rank: 2 })]),
      day("2026-02-01", [repo("acme/alpha", { rank: 1 })]),
    ]);

    const alpha = index.get("acme/alpha");
    assert.deepEqual(alpha.dates, ["2026-01-30", "2026-01-31", "2026-02-01"]);
    assert.equal(alpha.totalDays, 3);
    assert.equal(alpha.bestRank, 1);
    assert.equal(alpha.longestStreak, 3);
    assert.equal(alpha.currentStreak, 3);
    assert.equal(alpha.firstSeen, "2026-01-30");
    assert.equal(alpha.lastSeen, "2026-02-01");
  });

  it("breaks streaks on gap days and keeps single appearances at length 1", () => {
    const index = buildTrendIndex([
      // gap：01-30 与 02-01 之间缺了 01-31，两段各只有 1 天。
      day("2026-01-30", [repo("acme/gap", { rank: 3 })]),
      day("2026-02-01", [repo("acme/gap", { rank: 1 })]),
      // 单次上榜。
      day("2026-01-31", [repo("acme/once", { rank: 7 })]),
    ]);

    const gap = index.get("acme/gap");
    assert.equal(gap.totalDays, 2);
    assert.equal(gap.bestRank, 1);
    assert.equal(gap.longestStreak, 1);
    assert.equal(gap.currentStreak, 1);

    const once = index.get("acme/once");
    assert.equal(once.totalDays, 1);
    assert.equal(once.longestStreak, 1);
    assert.equal(once.currentStreak, 1);
    assert.deepEqual(once.dates, ["2026-01-31"]);
  });

  it("reports the streak ending at lastSeen even after the repo drops off", () => {
    // 01-29 → 01-30 连续两天后掉榜：longest 和 current 都是 2（结束于 lastSeen），
    // 之后 02-01 单独再上榜一段：longest 仍为 2，current 变为 1。
    const index = buildTrendIndex([
      day("2026-01-29", [repo("acme/flash", { rank: 1 })]),
      day("2026-01-30", [repo("acme/flash", { rank: 1 })]),
      day("2026-02-01", [repo("acme/flash", { rank: 5 })]),
    ]);

    const flash = index.get("acme/flash");
    assert.equal(flash.totalDays, 3);
    assert.equal(flash.longestStreak, 2);
    assert.equal(flash.currentStreak, 1);
    assert.equal(flash.lastSeen, "2026-02-01");
  });

  it("handles arbitrary day order, dedupes repeated entries within a day, and keeps latest metadata", () => {
    const index = buildTrendIndex([
      day("2026-03-02", [repo("acme/meta", { rank: 1, description: "new desc", stars: 300 })]),
      day("2026-03-01", [repo("acme/meta", { rank: 4, description: "old desc", stars: 100 })]),
      // 同一天重复出现（脏数据）只计一次上榜，也不改变档案身份。
      day("2026-03-02", [repo("acme/meta", { rank: 1, description: "new desc", stars: 300 })]),
    ]);

    const meta = index.get("acme/meta");
    assert.deepEqual(meta.dates, ["2026-03-01", "2026-03-02"]);
    assert.equal(meta.totalDays, 2);
    assert.equal(meta.longestStreak, 2);
    assert.equal(meta.currentStreak, 2);
    // 展示元数据取最近一次上榜。
    assert.equal(meta.description, "new desc");
    assert.equal(meta.stars, 300);
  });

  it("tolerates mixed v1/v2 snapshots and missing ranks using only date/fullName/rank", () => {
    const index = buildTrendIndex([
      // v1：无富集字段。
      day("2026-09-03", [repo("acme/mixed", { rank: 2 })]),
      // v2：富集字段齐全。
      day("2026-09-04", [
        repo("acme/mixed", { rank: 1, topics: ["ai"], license: "MIT", ownerAvatarUrl: "https://x/y.png" }),
        // 某天缺 rank：不参与峰值计算，也不应崩溃。
        repo("acme/norank", { rank: undefined, stars: 5 }),
      ]),
    ]);

    const mixed = index.get("acme/mixed");
    assert.equal(mixed.totalDays, 2);
    assert.equal(mixed.bestRank, 1);
    assert.equal(mixed.longestStreak, 2);
    // v2 字段只是透传展示，不参与统计。
    assert.equal(mixed.topics, undefined);

    const norank = index.get("acme/norank");
    assert.equal(norank.totalDays, 1);
    assert.equal(norank.bestRank, null);
    assert.equal(norank.longestStreak, 1);
  });

  it("computes streaks and peak on any prefix slice, for per-day badges", () => {
    const days = [
      day("2026-05-01", [repo("acme/riser", { rank: 5 })]),
      day("2026-05-02", [repo("acme/riser", { rank: 3 })]),
      day("2026-05-03", [repo("acme/riser", { rank: 1 })]),
    ];

    // 第一天：刚上榜，无徽标（currentStreak 1，峰值即当日名次）。
    const afterDay1 = buildTrendIndex(days.slice(0, 1)).get("acme/riser");
    assert.equal(afterDay1.currentStreak, 1);
    assert.equal(afterDay1.bestRank, 5);

    // 第二天前缀：连续 2 天，峰值只统计到 #3（#1 还没发生）。
    const afterDay2 = buildTrendIndex(days.slice(0, 2)).get("acme/riser");
    assert.equal(afterDay2.currentStreak, 2);
    assert.equal(afterDay2.bestRank, 3);

    // 第三天前缀：连续 3 天，峰值 #1。
    const afterDay3 = buildTrendIndex(days.slice(0, 3)).get("acme/riser");
    assert.equal(afterDay3.currentStreak, 3);
    assert.equal(afterDay3.bestRank, 1);

    // 前缀计算不污染输入数组。
    assert.equal(days.length, 3);
  });

  it("ignores malformed days and repos without crashing", () => {
    const index = buildTrendIndex([
      null,
      { date: "2026-06-01" },
      day("2026-06-02", [null, {}, repo("acme/ok", { rank: 1 })]),
    ]);

    assert.equal(index.size, 1);
    assert.equal(index.get("acme/ok").totalDays, 1);
  });
});

describe("sortTrendLeaderboard", () => {
  it("ranks by totalDays desc, then bestRank asc, then longestStreak desc", () => {
    const base = { firstSeen: "2026-01-01", lastSeen: "2026-01-05", dates: [] };
    const entries = [
      { ...base, fullName: "a/short", totalDays: 2, bestRank: 1, longestStreak: 2 },
      { ...base, fullName: "b/long", totalDays: 5, bestRank: 3, longestStreak: 1 },
      { ...base, fullName: "c/tie-peak-better", totalDays: 3, bestRank: 1, longestStreak: 1 },
      { ...base, fullName: "d/tie-peak-worse", totalDays: 3, bestRank: 2, longestStreak: 3 },
      { ...base, fullName: "e/tie-streak", totalDays: 3, bestRank: 2, longestStreak: 1 },
    ];

    assert.deepEqual(
      sortTrendLeaderboard(entries).map((entry) => entry.fullName),
      [
        "b/long", // 天数最多
        "c/tie-peak-better", // 同天数，峰值 #1 优于 #2
        "d/tie-peak-worse", // 同峰值，连续更长
        "e/tie-streak", // 全并列时按 fullName 稳定
        "a/short",
      ],
    );
  });

  it("does not mutate the input array and treats a missing peak as worst", () => {
    const entries = [
      { fullName: "a/x", totalDays: 1, bestRank: null, longestStreak: 1 },
      { fullName: "b/y", totalDays: 1, bestRank: 9, longestStreak: 1 },
    ];
    const sorted = sortTrendLeaderboard(entries);

    assert.deepEqual(sorted.map((entry) => entry.fullName), ["b/y", "a/x"]);
    assert.deepEqual(
      entries.map((entry) => entry.fullName),
      ["a/x", "b/y"],
    );
  });
});
