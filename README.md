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
