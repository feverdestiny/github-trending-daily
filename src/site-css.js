/**
 * 站点样式表（从 generate-site.js 拆出的纯搬运模块）。
 * 零框架设计系统：全部主题色走 CSS 自定义属性，深色变量只在此定义一次，
 * 手动切换（html[data-theme="dark"]）与系统跟随（prefers-color-scheme）两块共用。
 */

/** 深色主题共用的一组自定义属性声明：手动切换与系统跟随必须是同一组值。 */
const DARK_THEME_DECLARATIONS = [
  "--bg: #0e1319;",
  "--card: #151c24;",
  "--ink: #e6ebf1;",
  "--muted: #9da9b7;",
  "--line: #263140;",
  "--line-strong: #35455a;",
  "--link: #82b1f8;",
  "--link-strong: #a8c8fb;",
  "--rank-bg: #1d2836;",
  "--chip-bg: #202b38;",
  "--chip-ink: #c6d1dd;",
  "--delta: #4cc38a;",
  "--delta-bg: rgba(76, 195, 138, 0.13);",
  "--warn-bg: rgba(253, 186, 116, 0.1);",
  "--warn-border: rgba(253, 186, 116, 0.45);",
  "--warn-ink: #f5c08b;",
  "--danger-bg: rgba(253, 164, 175, 0.1);",
  "--danger-border: rgba(253, 164, 175, 0.45);",
  "--shadow: rgba(0, 0, 0, 0.35);",
];

/**
 * @param {string} indent 每行声明前的前缀缩进
 */
function darkVariables(indent) {
  return DARK_THEME_DECLARATIONS.map((line) => `${indent}${line}`).join("\n");
}

/**
 * 主题切换按钮图标的显隐规则：深色下显示太阳、隐藏月亮。
 * @param {string} selector 深色作用域选择器
 * @param {string} [indent]
 */
function themeIconRules(selector, indent = "") {
  return `${indent}${selector} .icon-sun { display: block; }\n${indent}${selector} .icon-moon { display: none; }`;
}

export const SITE_CSS = `/* GitHub 每日热门：零框架设计系统。全部主题色走 CSS 自定义属性，
   默认跟随系统深浅色，可通过 <html data-theme> 手动覆盖；不依赖任何外部字体/资源。 */
:root {
  color-scheme: light;
  --bg: #f5f6f8;
  --card: #ffffff;
  --ink: #1b2530;
  --muted: #5a6572;
  --line: #e4e8ee;
  --line-strong: #c9d3e0;
  --link: #1a53b8;
  --link-strong: #123c8a;
  --rank-bg: #eef2f8;
  --chip-bg: #edf1f6;
  --chip-ink: #43505f;
  --delta: #11603a;
  --delta-bg: #e2f4ea;
  --warn-bg: #fff7ed;
  --warn-border: #fdba74;
  --warn-ink: #7c3a0c;
  --danger-bg: #fff1f2;
  --danger-border: #fda4af;
  --shadow: rgba(15, 23, 42, 0.07);
}
html[data-theme="dark"] { color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) { color-scheme: dark; }
}

/* 深色主题：手动切换与系统跟随使用同一组变量值 */
html[data-theme="dark"] {
${darkVariables("  ")}
}
@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) {
${darkVariables("    ")}
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
html, body { margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.65;
  font-size: 16px;
  min-height: 100vh;
}

a { color: var(--link); text-underline-offset: 2px; }
a:hover { color: var(--link-strong); }
a:focus-visible, button:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: 2px;
  border-radius: 4px;
}

.wrap { width: min(1080px, calc(100% - 32px)); margin: 0 auto; }

.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--card);
  border-bottom: 1px solid var(--line);
  padding: 10px 0;
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.brand {
  color: var(--ink);
  text-decoration: none;
  font-weight: 700;
  font-size: 17px;
  letter-spacing: 0.01em;
}
.header-actions { display: flex; align-items: center; gap: 14px; }
.nav { display: flex; gap: 16px; }
.nav a { color: var(--muted); text-decoration: none; font-size: 15px; }
.nav a[aria-current="page"], .nav a:hover { color: var(--ink); }
.theme-toggle {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.theme-toggle:hover { border-color: var(--line-strong); color: var(--ink); }
.icon-sun { display: none; }
${themeIconRules('html[data-theme="dark"]')}
@media (prefers-color-scheme: dark) {
${themeIconRules('html:not([data-theme="light"])', "  ")}
}

.hero { padding: 34px 0 14px; max-width: 760px; }
.eyebrow {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.hero h1 { margin: 0 0 8px; font-size: clamp(26px, 5vw, 38px); line-height: 1.2; }
.lede, .empty { color: var(--muted); }
.hero-links { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 10px 0 0; font-size: 14px; }
.banner {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  color: var(--warn-ink);
  font-size: 14px;
}
.banner.sample { background: var(--danger-bg); border-color: var(--danger-border); }

/* 卡片网格：移动端单列，宽屏自适应多列 */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr));
  gap: 14px;
  padding: 12px 0 48px;
}
.card {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.card:hover {
  border-color: var(--line-strong);
  box-shadow: 0 4px 16px var(--shadow);
  transform: translateY(-1px);
}
.card-head { display: flex; align-items: center; gap: 10px; }
.rank {
  flex: none;
  display: inline-grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--rank-bg);
  color: var(--link);
  font-weight: 700;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.repo { margin: 0; font-size: 16px; font-weight: 650; min-width: 0; flex: 1; }
.repo a { text-decoration: none; overflow-wrap: anywhere; }
.repo a:hover { text-decoration: underline; }
.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  border: 1px solid var(--line);
}
.desc {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 14px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tldr {
  margin: 10px 0 0;
  padding: 8px 11px;
  border-radius: 8px;
  border-left: 3px solid var(--link);
  background: var(--chip-bg);
  color: var(--ink);
  font-size: 13.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.tldr-tag {
  margin-right: 7px;
  font-size: 12px;
  font-weight: 700;
  color: var(--link);
  white-space: nowrap;
}
.topics {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
}
.topic {
  font-size: 12px;
  line-height: 1.6;
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--chip-bg);
  color: var(--chip-ink);
  overflow-wrap: anywhere;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: 12px;
  margin-bottom: 12px;
  font-size: 13.5px;
  color: var(--muted);
}
.lang { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.lang.muted { color: var(--muted); opacity: 0.8; }
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: hsl(var(--hue, 210) 62% 48%);
}
.delta {
  margin-left: auto;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--delta-bg);
  color: var(--delta);
  font-weight: 700;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.card-foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  font-size: 13px;
  color: var(--muted);
}
.license { overflow-wrap: anywhere; }
.discuss { white-space: nowrap; }
.discuss a { font-weight: 600; }

/* 连续上榜徽标（单日页卡片）与趋势统计行（趋势档案页） */
.streak {
  flex: none;
  padding: 2px 9px;
  border: 1px solid var(--warn-border);
  border-radius: 999px;
  background: var(--warn-bg);
  color: var(--warn-ink);
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.trend-stats { overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }

/* 归档：按月分组 + 分页 */
.month-group { padding-bottom: 6px; }
.month-heading {
  margin: 22px 0 0;
  padding-bottom: 6px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.archive-list { list-style: none; padding: 0; margin: 0; }
.archive-list li { border-bottom: 1px solid var(--line); }
.archive-list a {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  padding: 13px 2px;
  text-decoration: none;
  color: inherit;
}
.archive-list a:hover .date { color: var(--link); }
.date { font-weight: 650; font-variant-numeric: tabular-nums; }
.count { color: var(--muted); font-size: 14px; }

.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 20px 0 48px;
}
.pager-slot { min-width: 84px; }
.pager-slot:last-child { text-align: right; }
.pager a { text-decoration: none; font-weight: 600; }
.pager-status { color: var(--muted); font-size: 14px; }

.day-nav {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0 8px;
}
.day-nav a { text-decoration: none; font-weight: 600; }
.data-line { margin: 0; padding-bottom: 32px; color: var(--muted); font-size: 13px; }
.data-line a { font-variant-numeric: tabular-nums; }

.site-footer {
  border-top: 1px solid var(--line);
  padding: 20px 0 32px;
  color: var(--muted);
  font-size: 13px;
}
.site-footer a { color: inherit; }

@media (max-width: 560px) {
  .wrap { width: calc(100% - 24px); }
  .hero { padding: 24px 0 10px; }
  .brand { font-size: 16px; }
  .nav { gap: 12px; }
  .cards { gap: 10px; }
  .card { padding: 13px; }
  .delta { margin-left: 0; }
}
`;
