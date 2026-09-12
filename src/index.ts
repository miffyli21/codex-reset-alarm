import { classifyTweet, explainTweet, isCompletedReset, resetTimingInChina, type FeedTweet } from "./classifier";
import { isWakeWindowInChina } from "./schedule";

interface Env {
  STATE: KVNamespace;
  BARK_DEVICE_KEY: string;
  ADMIN_TOKEN: string;
}

interface Feed {
  fetched_at: string;
  stale: boolean;
  newest_post_at: string;
  signal?: { summary?: string; at?: string; url?: string };
  tweets: FeedTweet[];
}

interface State {
  cursorAt: string;
  cursorId: string;
  notifiedIds: string[];
  lastPersistedCheck: string;
  lastFeedFetchedAt: string;
  feedStale: boolean;
  feedError: string | null;
  lastErrorNoticeAt: string | null;
  lastSignal: string | null;
  lastAlarmAt: string | null;
}

const FEED_URL = "https://codex-reset.com/api/feed";
const BARK_ICON_URL = "https://raw.githubusercontent.com/miffyli21/codex-reset-alarm/main/assets/codex-reset-alarm.png";
const STATE_KEY = "monitor-state-v1";
const MAX_NOTIFIED_IDS = 200;

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runMonitor(env, new Date(event.scheduledTime)));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/action/test" && request.method === "POST") return handleTest(request, env);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return renderDashboard(await readState(env), url);
  },
};

export async function runMonitor(env: Env, now: Date): Promise<void> {
  const oldState = await readState(env);
  let state = oldState;
  try {
    const response = await fetch(FEED_URL, { headers: { Accept: "application/json", "User-Agent": "codex-reset-alarm/1.0" } });
    if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const feed = validateFeed(raw);
    const feedAgeMs = now.getTime() - Date.parse(feed.fetched_at);
    const stale = feed.stale || !Number.isFinite(feedAgeMs) || feedAgeMs > 30 * 60_000;

    if (!state) {
      const newest = newestTweet(feed.tweets);
      state = {
        cursorAt: newest?.at ?? feed.newest_post_at,
        cursorId: newest?.id ?? "",
        notifiedIds: [],
        lastPersistedCheck: now.toISOString(), lastFeedFetchedAt: feed.fetched_at,
        feedStale: stale, feedError: stale ? "Feed 数据过期" : null,
        lastErrorNoticeAt: null, lastSignal: feed.signal?.summary ?? null, lastAlarmAt: null,
      };
      await env.STATE.put(STATE_KEY, JSON.stringify(state));
      return;
    }

    const newTweets = feed.tweets.filter((tweet) => isAfterCursor(tweet, state!))
      .sort((a, b) => compareTweet(a, b));
    for (const tweet of newTweets) {
      if (state.notifiedIds.includes(tweet.id)) continue;
      const level = classifyTweet(tweet);
      if (level === 2) {
        if (isCompletedReset(tweet)) {
          await sendBark(env, "✅ CODEX 已经重置", barkBody(tweet, "Codex 已经重置，可以继续使用。"), tweet.url, true, "silent");
        } else {
          const explanation = `${explainTweet(tweet)}\n${resetTimingInChina(tweet)}`;
          await sendBark(env, "🚨 CODEX 即将重置", barkBody(tweet, explanation), tweet.url, true);
        }
        state.lastAlarmAt = now.toISOString();
      }
      if (level > 0) state.notifiedIds = [...state.notifiedIds, tweet.id].slice(-MAX_NOTIFIED_IDS);
      state.cursorAt = tweet.at;
      state.cursorId = tweet.id;
    }

    const newest = newestTweet(feed.tweets);
    if (newest && compareTweetToCursor(newest, state) > 0) {
      state.cursorAt = newest.at;
      state.cursorId = newest.id;
    }

    state.lastFeedFetchedAt = feed.fetched_at;
    state.feedStale = stale;
    state.feedError = stale ? "Feed 数据过期超过 30 分钟" : null;
    state.lastSignal = feed.signal?.summary ?? state.lastSignal;
    if (stale) await maybeNotifyError(env, state, now, state.feedError ?? "Feed 数据过期");

    const checkpointDue = now.getTime() - Date.parse(state.lastPersistedCheck) >= 15 * 60_000;
    const changed = JSON.stringify(withoutCheck(oldState)) !== JSON.stringify(withoutCheck(state));
    if (changed || checkpointDue) {
      state.lastPersistedCheck = now.toISOString();
      await env.STATE.put(STATE_KEY, JSON.stringify(state));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 Feed 错误";
    if (!state) {
      state = {
        cursorAt: "", cursorId: "", notifiedIds: [],
        lastPersistedCheck: now.toISOString(), lastFeedFetchedAt: "", feedStale: true,
        feedError: message, lastErrorNoticeAt: null, lastSignal: null, lastAlarmAt: null,
      };
    }
    state.feedStale = true;
    state.feedError = message;
    try {
      await maybeNotifyError(env, state, now, message);
    } catch (noticeError) {
      console.error("Bark error notice failed", { message: noticeError instanceof Error ? noticeError.message : "unknown" });
    }
    const checkpointDue = now.getTime() - Date.parse(state.lastPersistedCheck) >= 15 * 60_000;
    const changed = JSON.stringify(withoutCheck(oldState)) !== JSON.stringify(withoutCheck(state));
    if (changed || checkpointDue) {
      state.lastPersistedCheck = now.toISOString();
      await env.STATE.put(STATE_KEY, JSON.stringify(state));
    }
    console.error("Reset feed check failed", { message });
  }
}

function validateFeed(value: unknown): Feed {
  if (!value || typeof value !== "object") throw new Error("Feed JSON 不是对象");
  const feed = value as Partial<Feed>;
  if (typeof feed.fetched_at !== "string" || typeof feed.newest_post_at !== "string" || typeof feed.stale !== "boolean" || !Array.isArray(feed.tweets)) {
    throw new Error("Feed JSON 缺少必要字段");
  }
  for (const tweet of feed.tweets) {
    if (!tweet || typeof tweet.id !== "string" || typeof tweet.text !== "string" || typeof tweet.at !== "string" || typeof tweet.url !== "string") {
      throw new Error("Feed tweet 格式异常");
    }
  }
  return feed as Feed;
}

type AlertMode = "auto" | "wake" | "silent";

async function sendBark(env: Env, title: string, body: string, target: string, critical: boolean, mode: AlertMode = "auto"): Promise<void> {
  const payload: Record<string, unknown> = {
    device_key: env.BARK_DEVICE_KEY, title, body, group: "codex-reset-alarm", url: target, icon: BARK_ICON_URL,
  };
  if (critical) {
    if (mode === "wake" || (mode === "auto" && isWakeWindowInChina(new Date()))) {
      Object.assign(payload, { level: "critical", call: "1", sound: "alarm", volume: "2" });
    } else {
      Object.assign(payload, { level: "critical", volume: "0" });
    }
  }
  const response = await fetch("https://api.day.app/push", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Bark HTTP ${response.status}`);
}

function barkBody(tweet: FeedTweet, explanation: string): string {
  return `${tweet.text}\n\n${explanation}\n发布时间：${formatTime(tweet.at)}\n原始链接：${tweet.url}`;
}

async function maybeNotifyError(env: Env, state: State, now: Date, message: string): Promise<void> {
  if (state.lastErrorNoticeAt && now.getTime() - Date.parse(state.lastErrorNoticeAt) < 60 * 60_000) return;
  await sendBark(env, "⚠️ Reset Monitor 数据源异常", `${message}\n监控会继续自动重试。`, "", false);
  state.lastErrorNoticeAt = now.toISOString();
}

async function handleTest(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  if (!safeEqual(String(form.get("token") ?? ""), env.ADMIN_TOKEN)) return html("管理令牌错误", 403);
  const base = new URL(request.url).origin;
  const forceWake = form.get("mode") === "wake";
  await sendBark(env, "🚨 RESET ALARM TEST", "这是一条 Codex Reset Alarm 真实测试通知。只推送一次。", base, true, forceWake ? "wake" : "auto");
  return redirectWithMessage(base, "测试报警已发送，请检查 iPhone。", env.ADMIN_TOKEN);
}

function renderDashboard(state: State | null, url: URL): Response {
  const message = url.searchParams.get("message") ?? "";
  const feedStatus = !state ? "等待首次检查" : state.feedError ? `异常：${escapeHtml(state.feedError)}` : "正常";
  return html(`<main>
    <h1>CODEX RESET ALARM</h1><div class="monitor"><span></span> MONITORING</div>
    ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
    <dl>
      <dt>Last check</dt><dd>${formatTime(state?.lastPersistedCheck)}</dd>
      <dt>Feed status</dt><dd>${feedStatus}</dd>
      <dt>Feed stale</dt><dd>${state ? String(state.feedStale) : "—"}</dd>
      <dt>Latest Tibo post</dt><dd>${formatTime(state?.cursorAt)}</dd>
      <dt>Last reset signal</dt><dd>${escapeHtml(state?.lastSignal ?? "—")}</dd>
      <dt>Last alarm</dt><dd>${formatTime(state?.lastAlarmAt)}</dd>
    </dl>
    <form method="post" action="/action/test"><input type="password" name="token" placeholder="ADMIN TOKEN" required><button>TEST ALARM</button></form>
  </main>`);
}

function html(content: string, status = 200): Response {
  const full = `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex Reset Alarm</title><style>
  :root{color-scheme:dark}body{margin:0;background:#0a0d0b;color:#e9f0eb;font:16px system-ui,sans-serif}main{max-width:680px;margin:8vh auto;padding:28px}h1{letter-spacing:.08em}.monitor{color:#75ef9b;font-weight:700;margin:24px 0}.monitor span{display:inline-block;width:10px;height:10px;border-radius:50%;background:#51df7c;box-shadow:0 0 12px #51df7c}dl{display:grid;grid-template-columns:minmax(130px,1fr) 2fr;gap:12px;padding:20px;background:#121814;border:1px solid #263329;border-radius:12px}dt{color:#8fa096}dd{margin:0;overflow-wrap:anywhere}form{display:flex;gap:10px;margin-top:14px}input,button{padding:13px;border-radius:8px;border:1px solid #35443a;background:#172019;color:#fff}input{flex:1}button{cursor:pointer;font-weight:700}.notice{color:#75ef9b}</style>${content}</html>`;
  return new Response(full, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function readState(env: Env): Promise<State | null> { return env.STATE.get<State>(STATE_KEY, "json"); }
function newestTweet(tweets: FeedTweet[]): FeedTweet | undefined { return [...tweets].sort(compareTweet).at(-1); }
function compareTweet(a: FeedTweet, b: FeedTweet): number { return Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id); }
function compareTweetToCursor(tweet: FeedTweet, state: State): number { return Date.parse(tweet.at) - Date.parse(state.cursorAt) || tweet.id.localeCompare(state.cursorId); }
function isAfterCursor(tweet: FeedTweet, state: State): boolean { return compareTweetToCursor(tweet, state) > 0; }
function withoutCheck(state: State | null): unknown { if (!state) return null; const { lastPersistedCheck: _, ...rest } = state; return rest; }
function formatTime(value?: string | null): string { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function safeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function redirectWithMessage(base: string, message: string, _token: string): Response { return Response.redirect(`${base}/?message=${encodeURIComponent(message)}`, 303); }
