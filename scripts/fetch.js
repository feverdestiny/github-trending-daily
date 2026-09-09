#!/usr/bin/env node
/**
 * 抓取 github.com/trending?since=daily，写入 data/YYYY-MM-DD.json。
 */
import { runFetch } from "../src/fetch-trending.js";

try {
  const sample = process.argv.includes("--sample") || process.env.SAMPLE === "1";
  const { filePath, digest } = await runFetch({
    sample,
    // 可选的 AI 一句话导读：设置了 TLDR_API_KEY（任意 OpenAI 兼容端点）即启用。
    tldrApiKey: process.env.TLDR_API_KEY,
  });
  const tag = digest.sample ? " sample" : "";
  console.log(`Wrote ${filePath} (${digest.repos.length} repos${tag})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
