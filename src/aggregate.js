/**
 * 多维榜单聚合：周/月滚动窗口聚合与语言子榜。
 *
 * 全部为纯函数：输入解析后的日快照数组（{date, repos:[...]}，顺序不限、可稀疏），
 * 输出普通对象数组，不做任何 IO、不依赖 DOM/时间等外部状态。
 */

const DAY_MS = 86400000;

/**
 * "YYYY-MM-DD" → UTC 毫秒（只按日历日比较，不受时区影响）。
 * @param {string} date
 */
function toUtcMs(date) {
  const [y, m, d] = String(date).slice(0, 10).split("-").map(Number);
  return Date.UTC(y || 0, (m || 1) - 1, d || 1);
}

/**
 * UTC 毫秒 → "YYYY-MM-DD"。
 * @param {number} ms
 */
function toIsoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 滚动窗口：以快照中的最新日期为终点，往前取 windowDays 个日历日（含终点）。
 * 窗口按日历日划分，与快照是否连续无关——缺天的日子直接缺席，跨月/跨年由日期运算处理。
 * @param {Array<{date: string, repos?: object[]}>} days 顺序不限
 * @param {number} windowDays
 * @returns {{ start: string, end: string, days: object[] }}
 *   start/end 为窗口的日历首末日（YYYY-MM-DD），days 为窗口内快照按日期升序排列。
 */
export function rollingWindow(days, windowDays) {
  const span = Math.max(1, Math.floor(Number(windowDays) || 1));
  const sorted = [...(days ?? [])].sort((a, b) =>
    String(a?.date).localeCompare(String(b?.date)),
  );
  if (sorted.length === 0) {
    return { start: "", end: "", days: [] };
  }
  const end = String(sorted[sorted.length - 1].date);
  const startMs = toUtcMs(end) - (span - 1) * DAY_MS;
  const endMs = toUtcMs(end);
  const inWindow = sorted.filter((day) => {
    const ms = toUtcMs(day?.date);
    return ms >= startMs && ms <= endMs;
  });
  return { start: toIsoDate(startMs), end, days: inWindow };
}

/**
 * 滚动窗口聚合榜（weekly / monthly 的共用实现）。规则：
 * - 窗口为以最新快照为终点的 windowDays 个日历日（见 rollingWindow）；
 * - 收集窗口内出现过的每个仓库，按 fullName 合并；
 * - totalDelta = 各日 starsToday 之和；appearanceDays = 窗口内出现天数；
 * - 排除窗口内出现 <2 天的仓库（过滤单日脉冲）；
 * - 排序：totalDelta 降序 → 总星标（stars）降序 → 最佳排名（bestRank，数值小者靠前）→
 *   fullName 字典序兜底，保证结果完全确定；
 * - 身份字段（name/owner/url/description/language/stars）取该仓库在窗口内最新一次出现的值；
 * - bestRank 为窗口内的最小排名，快照缺失排名时为 null。
 *
 * @param {Array<{date: string, repos?: object[]}>} days 顺序不限
 * @param {{ windowDays: number }} options
 * @returns {Array<{fullName, name, owner, url, description, language, stars,
 *   totalDelta, appearanceDays, bestRank, rank}>} rank 为榜内 1 起排名
 */
function aggregateWindow(days, { windowDays }) {
  const window = rollingWindow(days, windowDays);
  const byName = new Map();

  for (const day of window.days) {
    for (const repo of day?.repos ?? []) {
      if (!repo?.fullName) continue;
      const rank = Number(repo.rank);
      const entryRank = Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;

      let entry = byName.get(repo.fullName);
      if (!entry) {
        const [owner = repo.fullName, name = repo.fullName] = String(
          repo.fullName,
        ).split("/");
        entry = {
          fullName: repo.fullName,
          name: repo.name ?? name,
          owner: repo.owner ?? owner,
          url: repo.url ?? `https://github.com/${repo.fullName}`,
          description: repo.description ?? "",
          language: repo.language ?? "",
          stars: Number(repo.stars) || 0,
          totalDelta: 0,
          appearanceDays: 0,
          bestRank: entryRank,
        };
        byName.set(repo.fullName, entry);
      } else {
        entry.bestRank = Math.min(entry.bestRank, entryRank);
      }

      // 快照按日期升序遍历，后写的覆盖先写的 → 身份字段收敛到最新一次出现。
      entry.totalDelta += Number(repo.starsToday) || 0;
      entry.appearanceDays += 1;
      for (const key of ["name", "owner", "url", "description", "language"]) {
        if (repo[key] !== undefined && repo[key] !== null) entry[key] = repo[key];
      }
      if (Number(repo.stars)) entry.stars = Number(repo.stars);
    }
  }

  return [...byName.values()]
    .filter((entry) => entry.appearanceDays >= 2)
    .sort(
      (a, b) =>
        b.totalDelta - a.totalDelta ||
        b.stars - a.stars ||
        a.bestRank - b.bestRank ||
        a.fullName.localeCompare(b.fullName),
    )
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
      bestRank: Number.isFinite(entry.bestRank) ? entry.bestRank : null,
    }));
}

/**
 * 周榜：滚动 7 天窗口聚合。
 * @param {Array<{date: string, repos?: object[]}>} days
 * @param {{ windowDays?: number }} [options]
 */
export function weekly(days, options = {}) {
  return aggregateWindow(days, { windowDays: options.windowDays ?? 7 });
}

/**
 * 月榜：滚动 30 天窗口聚合。
 * @param {Array<{date: string, repos?: object[]}>} days
 * @param {{ windowDays?: number }} [options]
 */
export function monthly(days, options = {}) {
  return aggregateWindow(days, { windowDays: options.windowDays ?? 30 });
}

/**
 * 语言名 → URL 安全 slug：小写；"+"→"plus"、"#"→"sharp"（C++→c-plus-plus、C#→c-sharp）；
 * 其余非字母数字序列各折叠为一个 "-"；去除首尾 "-"。
 * 结果仅含 [a-z0-9-]；若结果为空（语言名全是符号等），回退为 "lang"。
 * @param {unknown} language
 */
export function languageSlug(language) {
  const slug = String(language ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("+", "-plus-")
    .replaceAll("#", "-sharp-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "lang";
}

/**
 * 语言子榜：挑选“值得单独成页”的语言并给出各自最新一天的仓库。选择规则
 * （与 README「周榜、月榜与语言子榜」一节同步记录）：
 * 1. 语言按其在全部快照中的累计出现次数排名（每天每个榜单席位计一次），取前
 *    topLanguages（默认 8）名；
 * 2. 除此之外，在最新一天快照中占有 ≥ minReposPerDay（默认 3）个席位的语言也入选，
 *    让刚爆发的新语言不被历史次数埋没；
 * 3. 未标注语言（缺失/空/纯空白）的仓库不进入任何子榜；
 * 4. 子榜按累计出现次数降序 → 最新一天席位数降序 → 语言名字典序排列，保证确定性；
 * 5. 每个子榜的 repos 为最新一天该语言的仓库，按当日排名升序并把 rank 重排为 1..n；
 * 6. 不同语言名派生出相同 slug 时保留排名靠前者，避免路径互相覆盖。
 *
 * @param {Array<{date: string, repos?: object[]}>} days 顺序不限
 * @param {{ topLanguages?: number, minReposPerDay?: number }} [options]
 * @returns {Array<{language, slug, totalAppearances, latestCount, repos}>}
 */
export function languageBoards(days, options = {}) {
  const topLanguages = Math.max(0, Math.floor(options.topLanguages ?? 8));
  const minReposPerDay = options.minReposPerDay ?? 3;

  const sorted = [...(days ?? [])].sort((a, b) =>
    String(a?.date).localeCompare(String(b?.date)),
  );
  const latestDate = sorted.length ? String(sorted[sorted.length - 1].date) : null;

  /** @type {Map<string, number>} 语言 → 全部快照中的累计出现次数 */
  const totals = new Map();
  /** @type {Map<string, number>} 语言 → 最新一天的席位数 */
  const latestCount = new Map();
  /** @type {Map<string, object[]>} 语言 → 最新一天的仓库 */
  const latestRepos = new Map();

  for (const day of sorted) {
    const isLatest = latestDate !== null && String(day?.date) === latestDate;
    for (const repo of day?.repos ?? []) {
      const language =
        typeof repo?.language === "string" ? repo.language.trim() : "";
      if (!language) continue;
      totals.set(language, (totals.get(language) ?? 0) + 1);
      if (isLatest) {
        latestCount.set(language, (latestCount.get(language) ?? 0) + 1);
        if (!latestRepos.has(language)) latestRepos.set(language, []);
        latestRepos.get(language).push(repo);
      }
    }
  }

  const ranked = [...totals.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      (latestCount.get(b[0]) ?? 0) - (latestCount.get(a[0]) ?? 0) ||
      a[0].localeCompare(b[0]),
  );

  const selected = new Set(
    ranked.slice(0, topLanguages).map(([language]) => language),
  );
  for (const [language] of ranked) {
    if ((latestCount.get(language) ?? 0) >= minReposPerDay) selected.add(language);
  }

  const rankOf = (repo) => {
    const n = Number(repo?.rank);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };

  const boards = [];
  const usedSlugs = new Set();
  for (const [language, totalAppearances] of ranked) {
    if (!selected.has(language)) continue;
    const slug = languageSlug(language);
    if (usedSlugs.has(slug)) continue;
    usedSlugs.add(slug);
    const repos = (latestRepos.get(language) ?? [])
      .slice()
      .sort((a, b) => rankOf(a) - rankOf(b))
      .map((repo, index) => ({ ...repo, rank: index + 1 }));
    boards.push({
      language,
      slug,
      totalAppearances,
      latestCount: latestCount.get(language) ?? 0,
      repos,
    });
  }
  return boards;
}
