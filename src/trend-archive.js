/**
 * 上榜档案（趋势追踪）纯函数层。
 *
 * 输入是全部日快照的集合（每项形如 { date, repos: [...] }，顺序任意），
 * 输出是以 fullName 为键的上榜档案。只依赖 date / fullName / rank 做统计，
 * 其余字段（v1/v2 富集差异）仅作为展示元数据透传，因此对 v1/v2 混合历史天然兼容。
 *
 * 语义约定：
 * - 连续上榜按自然日计算，跨月/跨年只要日期相差一天即连续；缺一天即中断。
 * - longestStreak 是历史任意一段连续日期的最长长度；
 *   currentStreak 是结束于该仓库最近一次上榜日期（lastSeen）的那段连续长度，
 *   之后断更不会清零 currentStreak，只会让 lastSeen 停留在断更前。
 * - bestRank 是历史最低排名数字（即最高名次）；某天缺 rank 则跳过，
 *   从未有过 rank 则为 null。
 */

const DAY_MS = 86400000;

/**
 * "2026-09-06" → 该自然日的 UTC 毫秒数（避免时区偏移影响“相差一天”的判定）。
 * @param {string} date
 */
function dateToMs(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  return Date.UTC(year || 1970, (month || 1) - 1, day || 1);
}

/**
 * 为全部日快照构建上榜档案：fullName → 档案对象。
 * 纯函数：不修改入参；可传入任意前缀切片（如“截至某日的全部快照”），
 * 因此单日页徽标可以按天做前缀计算。
 *
 * @param {{ date: string, repos: Array<object> }} days 日快照集合，顺序任意
 * @returns {Map<string, object>} fullName → {
 *   fullName, name, owner, url, description, language, stars,
 *   dates: string[]（升序、按天去重）, totalDays, bestRank,
 *   longestStreak, currentStreak, firstSeen, lastSeen }
 */
export function buildTrendIndex(days) {
  // 按日期升序处理：dates 自然有序，身份元数据以最近一次上榜为准。
  const ordered = (days ?? [])
    .filter((day) => day && day.date && Array.isArray(day.repos))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /** @type {Map<string, object>} */
  const index = new Map();

  for (const day of ordered) {
    const date = String(day.date);
    for (const repo of day.repos) {
      const key = repo?.fullName;
      if (key === undefined || key === null || key === "") continue;
      const fullName = String(key);

      let entry = index.get(fullName);
      if (!entry) {
        entry = {
          fullName,
          name: "",
          owner: "",
          url: "",
          description: "",
          language: "",
          stars: null,
          dates: [],
          totalDays: 0,
          bestRank: null,
          longestStreak: 0,
          currentStreak: 0,
          firstSeen: date,
          lastSeen: date,
        };
        index.set(fullName, entry);
      }

      // 按天去重：同一天重复出现只计一次上榜。
      if (entry.dates[entry.dates.length - 1] !== date) {
        entry.dates.push(date);
      }

      // 展示元数据取最新一次上榜的值；缺省字段保留上一次的。
      entry.name = repo.name ?? entry.name;
      entry.owner = repo.owner ?? entry.owner;
      entry.url = repo.url ?? entry.url;
      entry.description = repo.description ?? entry.description;
      entry.language = repo.language ?? entry.language;
      entry.stars = repo.stars ?? entry.stars;

      const rank = Number(repo.rank);
      if (Number.isFinite(rank)) {
        entry.bestRank =
          entry.bestRank === null ? rank : Math.min(entry.bestRank, rank);
      }
    }
  }

  for (const entry of index.values()) {
    entry.totalDays = entry.dates.length;
    entry.firstSeen = entry.dates[0];
    entry.lastSeen = entry.dates[entry.dates.length - 1];

    let run = 0;
    let previousMs = null;
    for (const date of entry.dates) {
      const ms = dateToMs(date);
      run = previousMs !== null && ms - previousMs === DAY_MS ? run + 1 : 1;
      if (run > entry.longestStreak) entry.longestStreak = run;
      previousMs = ms;
    }
    // 结束于 lastSeen 的那段连续长度。
    entry.currentStreak = run;
  }

  return index;
}

/**
 * "历史最热"总榜排序：累计上榜天数多者优先；
 * 并列时历史峰值排名靠前者优先，再并列时最长连续天数多者优先；
 * 最后按 fullName 稳定排序，保证同数据下输出确定。
 *
 * @param {Array<object>} entries buildTrendIndex 的档案值数组
 * @returns {Array<object>} 新的已排序数组（不修改入参）
 */
export function sortTrendLeaderboard(entries) {
  return [...(entries ?? [])].sort(
    (a, b) =>
      b.totalDays - a.totalDays ||
      (a.bestRank ?? Number.POSITIVE_INFINITY) -
        (b.bestRank ?? Number.POSITIVE_INFINITY) ||
      b.longestStreak - a.longestStreak ||
      String(a.fullName).localeCompare(String(b.fullName)),
  );
}
