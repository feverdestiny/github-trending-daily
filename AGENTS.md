# AGENTS.md

GitHub 每日热门(github-trending-daily):每日抓取 GitHub Trending,快照存为 JSON 归档,生成静态站点发布到 GitHub Pages。领域词汇:快照(snapshot,`data/YYYY-MM-DD.json`)、生成器(由全部历史快照重建整个站点)、榜单(单日/周/月聚合)、上榜档案(仓库跨日趋势统计)。

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` + `docs/adr/` (created lazily). See `docs/agents/domain.md`.
