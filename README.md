# GitHub 每日热门

[![Update trending and deploy Pages](https://github.com/feverdestiny/github-trending-daily/actions/workflows/update-and-deploy.yml/badge.svg)](https://github.com/feverdestiny/github-trending-daily/actions/workflows/update-and-deploy.yml)

每天抓取一次 [GitHub Trending](https://github.com/trending?since=daily)（全语言、按日），把结果存成 JSON 归档，并生成静态网站发布到 GitHub Pages。

**在线地址：<https://feverdestiny.github.io/github-trending-daily/>**

## 页面

- 首页：当天（或最新一天）的热门仓库卡片列表
- [归档](https://feverdestiny.github.io/github-trending-daily/archive/)：所有已保存的日报，按月分组、每页 30 天分页，最新在上
- 每日页：`/days/YYYY-MM-DD/`，保留前/后日导航

每条卡片包含排名、仓库全名（外链到 GitHub）、简介、话题标签、许可证、主语言、总星标、当日新增星标，以及 Hacker News / Reddit 的讨论搜索外链（纯 URL 模板，零抓取）。站点深浅色跟随系统并可手动切换，移动端优先适配。

## 数据直出

每天的 JSON 快照随站点发布，可直接访问：

```
https://feverdestiny.github.io/github-trending-daily/data/YYYY-MM-DD.json
```

每个日报页底部也有对应的「本日数据 JSON」链接。

## 启用 GitHub Pages

仓库默认不会自动上线，需要先打开 Pages，并允许 Actions 部署：

1. 打开仓库 **Settings → Pages**
2. **Build and deployment → Source** 选 **GitHub Actions**
3. 合并本项目后，到 **Actions** 里手动运行工作流 `Update trending and deploy Pages`（`workflow_dispatch`）
4. 第一次部署成功后，站点会出现在上面的 Pages 地址

工作流会在每天 **UTC 00:00**（约北京时间 08:00）自动跑一次，也会在你手动触发时跑。它会：

1. 抓取趋势页并写入 `data/YYYY-MM-DD.json`（日期按 UTC）
2. 用全部历史 JSON 重新生成 `site/`
3. 如有变更，用 bot 账号提交 `data/` 快照（`chore: update trending YYYY-MM-DD`）；生成的 `site/` 不再入库，仅作为 Pages 部署产物上传
4. 用 `actions/upload-pages-artifact` + `actions/deploy-pages` 发布

## 本地运行

需要 Node.js 20+。

```bash
npm ci
npm test
npm run update    # 等价于 fetch + generate
```

单独命令：

```bash
npm run fetch     # 只抓取，写入 data/YYYY-MM-DD.json
npm run generate  # 或 npm run build，根据 data/ 生成 site/
npm run preview   # 生成后在 http://localhost:4173 预览
```

## 数据格式

`data/YYYY-MM-DD.json` 结构固定：

```json
{
  "date": "2026-09-04",
  "fetchedAt": "2026-09-04T00:12:00.000Z",
  "source": "https://github.com/trending?since=daily",
  "repos": [
    {
      "rank": 1,
      "owner": "fmtlib",
      "name": "fmt",
      "fullName": "fmtlib/fmt",
      "url": "https://github.com/fmtlib/fmt",
      "description": "A modern formatting library",
      "language": "C++",
      "stars": 25151,
      "starsToday": 963
    }
  ]
}
```

若某次抓取失败、只能用夹具数据，JSON 会带 `"sample": true`，页面上也会标明「示例数据」。不要把示例当成当天真实榜单。

Schema v2 起每条仓库记录还可能带可选富集字段：`topics`（话题字符串数组）、`license`（SPDX id，如 `"MIT"`，无许可证为 `null`）、`ownerAvatarUrl`（作者头像，或 `null`）。旧 v1 快照没有这些字段，站点对两者都能正常渲染（缺省区块直接省略）。

## 注意

这是对 GitHub **非官方 HTML** 的解析（cheerio），不是公开 API。页面结构一变，选择器就可能失效。解析器做了多层回退，并会在空页面 / 残缺 HTML 上抛出明确错误；若每日任务突然失败，优先对照 `https://github.com/trending?since=daily` 的 markup 更新 `src/parse-trending.js`。

## 周榜、月榜与语言子榜

站点在每日榜单之外，还会在生成时从全部快照即时聚合出三类页面（聚合逻辑在 `src/aggregate.js`，全部为纯函数）：

- **周榜** `/weekly/`：以最新一天为终点的滚动 7 天窗口（按日历日计算，快照缺天不影响归属），把窗口内每个仓库的每日新增星标求和得到区间增量（`+N (7天)`）并降序排名；只收录窗口内出现 ≥2 天的仓库，过滤单日脉冲。同增量依次比总星标、最佳排名。
- **月榜** `/monthly/`：同规则，窗口 30 天（`+N (30天)`）。
- **语言子榜** `/languages/` 与 `/languages/<slug>/`：按语言分组的子榜，每页展示最新一天该语言的全部上榜仓库（按当日排名）。语言选择规则：按「全部快照中的累计出现次数」取前 8 名；在此之外，最新一天占有 ≥3 个席位的语言也会入选（让刚爆发的语言不被历史次数埋没）。未标注语言的仓库不进入任何子榜。路径 slug 由语言名派生（小写，`+`→`plus`、`#`→`sharp`，其余非字母数字折叠为 `-`，如 `C++`→`c-plus-plus`），保证 URL 安全。

窗口内快照不足 2 天时，周榜/月榜渲染友好的空状态页面而不是报错。顶部导航提供全部新页面的入口。

## 趋势档案

基于全部历史快照即时计算（纯函数在 `src/trend-archive.js`，无数据库），提供两类视角：

- [趋势档案总榜](https://feverdestiny.github.io/github-trending-daily/trends/)（`/trends/`）："历史最热"排行榜，按**累计上榜天数**排序（并列时依次比较历史峰值排名、最长连续天数）。每个仓库展示：累计上榜 N 天 · 峰值 #M · 最长连续 K 天 · 最近上榜日期。历史不足两天时显示积累中提示。
- 单日页连续上榜徽标：连续上榜 ≥2 天的仓库会显示「连续上榜 N 天 · 峰值 #M」。N 和峰值都按"截至当天"的历史计算，回看历史页面时反映的是当时的状态。

统计语义：连续上榜按自然日计算，跨月连续同样有效，缺一天即中断；峰值排名取历史上最好的名次；`currentStreak` 指结束于该仓库最近一次上榜日期的连续段，之后断更不会清零它，只会让"最近上榜"日期停在断更前。统计只用 `date` / `fullName` / `rank` 三个字段，因此对 v1/v2 混合快照天然兼容。

## 订阅（Atom feed）

站点提供一条 Atom feed，内容始终是最新一期榜单，每个条目包含排名、仓库全名、链接、简介、语言、总星标与当日新增星标：

```
https://feverdestiny.github.io/github-trending-daily/feed.xml
```

把上面的地址粘贴进任意 RSS/Atom 阅读器（如 Feedly、Inoreader、NetNewsWire、Folo）即可订阅，每天榜单更新后自动收到最新一期。也可以在浏览器里直接打开站点首页，`<head>` 中带有 `<link rel="alternate" type="application/atom+xml">`，多数阅读器扩展能自动发现。

Fork 自部署时，feed 里的绝对链接来自生成器的 `siteUrl` 选项（默认是本仓库的 Pages 地址）：在调用 `generateSite({ siteUrl })` 时传入你自己的站点地址即可。
## 可选：AI 一句话导读

站点可以为每日榜单**前 5 名**各生成一句中文导读（它是什么、为什么值得关注），显示在卡片上并随当日快照永久缓存。该功能**默认关闭**——不配置时零调用、零成本，站点照常生成。

**启用方式**：在仓库 **Settings → Secrets and variables → Actions** 配置 repository secrets：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `TLDR_API_KEY` | 是 | 存在即启用；未设置/留空则功能整体关闭 |
| `TLDR_BASE_URL` | 否 | OpenAI 兼容端点根路径，默认 `https://api.openai.com/v1` |
| `TLDR_MODEL` | 否 | 模型名，默认 `gpt-4o-mini` |

**服务商兼容性**：任何 OpenAI 兼容的 `/chat/completions` 端点都可以（OpenAI、DeepSeek、Moonshot、GLM、硅基流动、本地 Ollama/vLLM 等），只需把 `TLDR_BASE_URL` 指向对应服务并配好模型名。

**费用量级**：每天只对前 5 名发 **1 次批量请求**（每条导读限 ~80 token、低温生成），生成结果写入 `data/YYYY-MM-DD.json` 的 `tldr` 字段永久缓存，任何重跑不会重复调用。按默认模型估算每月 **远低于 $1**，费用由你自己的 key 承担。

调用失败、未配置、或当日走示例数据降级时都会静默跳过，不影响当日发布；某仓库没有导读字段时卡片上不显示该区块。

