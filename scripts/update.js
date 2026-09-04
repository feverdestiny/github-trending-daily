#!/usr/bin/env node
/**
 * 先抓取当日趋势，再重新生成整站（含历史归档）。
 */
import { runFetch } from "../src/fetch-trending.js";
import { generateSite } from "../src/generate-site.js";

try {
  const sample = process.argv.includes("--sample") || process.env.SAMPLE === "1";
  const { filePath, digest } = await runFetch({ sample });
  const tag = digest.sample ? " sample" : "";
  console.log(`Wrote ${filePath} (${digest.repos.length} repos${tag})`);
  const { latestDate, dates, siteDir } = generateSite();
  console.log(`Generated ${siteDir} (${dates.length} days, latest ${latestDate})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
