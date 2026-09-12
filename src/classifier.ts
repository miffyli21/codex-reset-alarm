export interface FeedTweet {
  id: string;
  text: string;
  at: string;
  url: string;
  kind?: string;
  tibo_lane?: string;
  explicit_reset_claim?: boolean;
  reset_verification_candidate?: boolean;
  tease_classification?: { teasing?: boolean };
  banked_state?: string;
}

export type AlarmLevel = 0 | 2;

const FUTURE_RESET_PATTERNS = [
  /\breset(?:s)?\s+(?:is\s+)?(?:coming|soon|today|tomorrow|tonight)\b/i,
  /\b(?:full|banked|usage|limit|weekly)?\s*reset\s+(?:later\s+today|today|tomorrow|tonight)\b/i,
  /\b(?:we\s+will|we'll|going\s+to|will\s+do\s+a)\s+reset\b/i,
  /\b(?:a\s+)?reset\s+(?:is\s+)?(?:landing|lands|arriv(?:e|es|ing))\b/i,
  /\b(?:landing|lands)\s+(?:today|tonight|tomorrow|by\s+midnight|end\s+of\s+day|in\s+\d+)\b/i,
  /\breset\s+(?:by|before|at|in)\s+(?:midnight|\d+)/i,
];

const COMPLETED_RESET_PATTERNS = [
  /\breset(?:s)?\s+(?:all\s+)?(?:propagated|completed|complete|done|applied|live)\b/i,
  /\breset(?:s)?\s+(?:is|are)\s+(?:now\s+)?(?:complete|done|applied|live)\b/i,
  /\b(?:have|has|we've|we\s+have)\s+reset\b/i,
  /\b(?:just|already)\s+reset\b/i,
  /\blimits?\s+(?:have\s+been|are)\s+reset\b/i,
];

const ARRIVING_BANKED = new Set(["arriving", "incoming", "landing", "pending", "soon", "scheduled"]);

export function classifyTweet(tweet: FeedTweet): AlarmLevel {
  if (tweet.explicit_reset_claim === true) return 2;
  if (tweet.tibo_lane === "reset_announcement") return 2;
  if (tweet.kind === "banked" && tweet.banked_state && ARRIVING_BANKED.has(tweet.banked_state.toLowerCase())) return 2;
  if (FUTURE_RESET_PATTERNS.some((pattern) => pattern.test(tweet.text))) return 2;
  if (COMPLETED_RESET_PATTERNS.some((pattern) => pattern.test(tweet.text))) return 2;
  return 0;
}

export function isCompletedReset(tweet: FeedTweet): boolean {
  return COMPLETED_RESET_PATTERNS.some((pattern) => pattern.test(tweet.text));
}

export function resetTimingInChina(tweet: FeedTweet): string {
  const publishedAt = new Date(tweet.at);
  if (Number.isNaN(publishedAt.getTime())) return "预计重置时间：原文没有可可靠换算的具体时间。";

  const duration = tweet.text.match(/\b(?:landing|lands|reset(?:ting)?|arriv(?:e|es|ing))\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i);
  if (duration) {
    const amount = Number(duration[1]);
    const unitMs = /^(?:h|hour)/i.test(duration[2]) ? 3_600_000 : 60_000;
    return `预计重置时间（北京时间）：${formatChina(new Date(publishedAt.getTime() + amount * unitMs))}（按原文“in ${amount} ${duration[2]}”换算）`;
  }

  const exactTime = tweet.text.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (exactTime) {
    const authorDate = datePartsInZone(publishedAt, "America/Los_Angeles");
    const isTomorrow = /\btomorrow\b/i.test(tweet.text);
    const targetDate = addCalendarDays(authorDate.year, authorDate.month, authorDate.day, isTomorrow ? 1 : 0);
    let hour = Number(exactTime[1]) % 12;
    if (exactTime[3].toLowerCase() === "pm") hour += 12;
    const target = zonedLocalToUtc(targetDate.year, targetDate.month, targetDate.day, hour, Number(exactTime[2] ?? 0), "America/Los_Angeles");
    return `预计重置时间（北京时间）：${formatChina(target)}（按美国西海岸时间换算）`;
  }

  if (/\b(?:by\s+midnight(?:\s+today)?|lands?\s+(?:by\s+midnight|end\s+of\s+day)|landing\s+by\s+midnight)\b/i.test(tweet.text)) {
    const authorDate = datePartsInZone(publishedAt, "America/Los_Angeles");
    const nextDate = addCalendarDays(authorDate.year, authorDate.month, authorDate.day, 1);
    const target = zonedLocalToUtc(nextDate.year, nextDate.month, nextDate.day, 0, 0, "America/Los_Angeles");
    return `预计重置时间（北京时间）：${formatChina(target)} 前（按美国西海岸“当天午夜前”换算）`;
  }

  if (/\b(?:today|tonight|tomorrow|soon|coming)\b/i.test(tweet.text)) {
    return "预计重置时间：Tibo 原文只给了相对日期或大致时间，没有写具体钟点。";
  }
  return "预计重置时间：Tibo 原文没有写具体钟点。";
}

export function explainTweet(tweet: FeedTweet): string {
  if (tweet.kind === "banked") return "Tibo 表示可保存的重置额度即将到账。";
  return "Tibo 明确预告 Codex 用量即将重置。";
}

function formatChina(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

function datePartsInZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function addCalendarDays(year: number, month: number, day: number, amount: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    guess += desired - represented;
  }
  return new Date(guess);
}
