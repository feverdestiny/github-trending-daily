#!/usr/bin/env node
/**
 * 读取 data/*.json，生成 site/ 静态页面。
 */
import { generateSite } from "../src/generate-site.js";

try {
  const { latestDate, dates, siteDir } = generateSite();
  console.log(`Generated ${siteDir} (${dates.length} days, latest ${latestDate})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
