import assert from "node:assert/strict";
import test from "node:test";
import { runMonitor } from "../src/index";

test("persists a successful alert immediately so the next cron run does not repeat it", async () => {
  const postedAt = "2026-09-26T18:17:54Z";
  const tweetId = "2103911959544610829";
  const tweet = { id: tweetId, at: postedAt, text: "Resets all propagated. That will be all.", url: `https://x.com/thsottiaux/status/${tweetId}` };
  let saved = JSON.stringify({
    cursorAt: "2026-09-26T00:07:13Z", cursorId: "2103637477760311522",
    notifiedIds: [], lastPersistedCheck: "2026-09-26T18:17:00Z",
    lastFeedFetchedAt: "2026-09-26T18:17:00Z", feedStale: false, feedError: null,
    lastErrorNoticeAt: null, lastSignal: null, lastAlarmAt: null,
  });
  let writes = 0;
  let barkCalls = 0;
  const env = {
    STATE: {
      get: async () => JSON.parse(saved),
      put: async (_key: string, value: string) => { saved = value; writes++; },
    },
    BARK_DEVICE_KEY: "test-device-key", ADMIN_TOKEN: "test-admin-token",
  } as unknown as Parameters<typeof runMonitor>[0];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === "https://api.day.app/push") {
      barkCalls++;
      return new Response(JSON.stringify({ code: 200 }), { status: 200 });
    }
    return Response.json({ fetched_at: "2026-09-26T18:18:00Z", stale: false, newest_post_at: postedAt, tweets: [tweet] });
  };
  try {
    await runMonitor(env, new Date("2026-09-26T18:18:02Z"));
    await runMonitor(env, new Date("2026-09-26T18:19:02Z"));
  } finally {
    globalThis.fetch = originalFetch;
  }
  const state = JSON.parse(saved);
  assert.equal(barkCalls, 1);
  assert.equal(writes, 1);
  assert.deepEqual(state.notifiedIds, [tweetId]);
  assert.equal(state.recentAlerts[0].tweetId, tweetId);
  assert.equal(state.recentAlerts[0].kind, "completed");
});

test("does not write to KV on every healthy feed refresh", async () => {
  let saved = JSON.stringify({
    cursorAt: "2026-09-26T18:17:54Z", cursorId: "2103911959544610829",
    notifiedIds: [], lastPersistedCheck: "2026-09-26T18:18:00Z",
    lastFeedFetchedAt: "2026-09-26T18:18:00Z", feedStale: false, feedError: null,
    lastErrorNoticeAt: null, lastSignal: null, lastAlarmAt: null,
  });
  let writes = 0;
  const env = {
    STATE: {
      get: async () => JSON.parse(saved),
      put: async (_key: string, value: string) => { saved = value; writes++; },
    },
    BARK_DEVICE_KEY: "test-device-key", ADMIN_TOKEN: "test-admin-token",
  } as unknown as Parameters<typeof runMonitor>[0];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    fetched_at: "2026-09-26T18:19:00Z", stale: false,
    newest_post_at: "2026-09-26T18:17:54Z", tweets: [],
  });
  try {
    await runMonitor(env, new Date("2026-09-26T18:19:02Z"));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(writes, 0);
});

test("records a feed outage and recovery without sending Bark notifications", async () => {
  let saved = JSON.stringify({
    cursorAt: "2026-09-26T18:17:54Z", cursorId: "2103911959544610829",
    notifiedIds: [], lastPersistedCheck: "2026-09-29T02:00:00Z",
    lastFeedFetchedAt: "2026-09-29T02:00:00Z", feedStale: false, feedError: null,
    lastSignal: null, lastAlarmAt: null,
  });
  let barkCalls = 0;
  let failing = true;
  const env = {
    STATE: {
      get: async () => JSON.parse(saved),
      put: async (_key: string, value: string) => { saved = value; },
    },
    BARK_DEVICE_KEY: "test-device-key", ADMIN_TOKEN: "test-admin-token",
  } as unknown as Parameters<typeof runMonitor>[0];
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  globalThis.fetch = async (input) => {
    if (String(input) === "https://api.day.app/push") {
      barkCalls++;
      return Response.json({ code: 200 });
    }
    if (failing) return new Response("temporarily unavailable", { status: 503 });
    return Response.json({
      fetched_at: "2026-09-29T02:04:00Z", stale: false,
      newest_post_at: "2026-09-26T18:17:54Z", tweets: [],
    });
  };
  console.error = () => {};
  try {
    await runMonitor(env, new Date("2026-09-29T02:01:00Z"));
    await runMonitor(env, new Date("2026-09-29T02:02:00Z"));
    assert.equal(JSON.parse(saved).feedError, "Feed HTTP 503");
    assert.equal(barkCalls, 0);
    failing = false;
    await runMonitor(env, new Date("2026-09-29T02:04:05Z"));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
  assert.equal(JSON.parse(saved).feedError, null);
  assert.equal(JSON.parse(saved).feedStale, false);
  assert.equal(barkCalls, 0);
});
