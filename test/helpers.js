/**
 * 测试共享的小工具：合成数据工厂 + 副作用捕获 + 临时数据目录。
 * 只放真正被多个测试文件复用的实现，避免各文件各自复制一份。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 造一天的快照骨架。
 * @param {string} date YYYY-MM-DD
 * @param {object[]} repos
 */
export function day(date, repos) {
  return { date, repos };
}

/**
 * 造一个标准形态的仓库条目（v1 形态 + 任意字段覆盖）。
 * options 最后整体展开：显式传 undefined 也能抹掉默认值（如 rank: undefined）。
 * @param {string} fullName
 * @param {object} [options]
 */
export function repo(fullName, options = {}) {
  const [owner, name] = fullName.split("/");
  return {
    rank: 1,
    owner,
    name,
    fullName,
    url: `https://github.com/${fullName}`,
    description: `${fullName} desc`,
    language: "TypeScript",
    stars: 1000,
    starsToday: 10,
    ...options,
  };
}

/**
 * 捕获一次 console.error 输出（失败只允许警告，不允许抛出）。
 * @param {() => unknown} fn
 * @returns {Promise<string[]>}
 */
export async function captureStderr(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await fn();
    return lines;
  } finally {
    console.error = original;
  }
}

/**
 * 造一个一次性的 data 目录（mkdtemp 保证唯一；label 用于区分调用方）。
 * @param {string} [label]
 */
export function tmpDataDir(label = "tmp") {
  return join(mkdtempSync(join(tmpdir(), `trending-${label}-`)), "data");
}
