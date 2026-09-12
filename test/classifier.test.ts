import assert from "node:assert/strict";
import test from "node:test";
import { classifyTweet, isCompletedReset, resetTimingInChina, type FeedTweet } from "../src/classifier";

const tweet = (overrides: Partial<FeedTweet> = {}): FeedTweet => ({
  id: "1", text: "hello", at: "2026-09-12T00:00:00Z", url: "https://x.com/thsottiaux/status/1", ...overrides,
});

test("ignores unrelated posts", () => assert.equal(classifyTweet(tweet()), 0));
test("ignores general reset discussion in strict mode", () => assert.equal(classifyTweet(tweet({ text: "the occasional reset" })), 0));
test("ignores a vague feed teaser in strict mode", () => assert.equal(classifyTweet(tweet({ tease_classification: { teasing: true } })), 0));
test("wakes for explicit future reset", () => assert.equal(classifyTweet(tweet({ text: "a reset is landing by midnight today" })), 2));
test("wakes for completed reset", () => assert.equal(classifyTweet(tweet({ text: "Reset all propagated. Sweet dreams." })), 2));
test("ignores an old banked reset problem", () => assert.equal(classifyTweet(tweet({ kind: "banked", banked_state: "unknown", text: "banked resets did not apply" })), 0));
test("wakes for arriving banked reset", () => assert.equal(classifyTweet(tweet({ kind: "banked", banked_state: "arriving" })), 2));
test("recognizes a completed reset", () => assert.equal(isCompletedReset(tweet({ text: "Reset all propagated. Sweet dreams." })), true));
test("does not call an upcoming reset completed", () => assert.equal(isCompletedReset(tweet({ text: "a reset is landing by midnight today" })), false));
test("converts Pacific midnight to China time", () => {
  const result = resetTimingInChina(tweet({ at: "2026-09-12T03:20:36Z", text: "a reset is landing by midnight today" }));
  assert.match(result, /9月12日 15:00/);
});
test("converts a duration from the post timestamp", () => {
  const result = resetTimingInChina(tweet({ at: "2026-09-12T03:20:36Z", text: "reset landing in 2 hours" }));
  assert.match(result, /9月12日 13:20/);
});
