/**
 * 展示层共享的数字格式化（站点与 feed 共用，保证两处渲染一致）。
 */

/**
 * 千分位计数：1e6 → "1,000,000"；空值/NaN 按 0 处理 → "0"。
 * @param {number} n
 */
export function formatCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}
