import assert from "node:assert/strict";
import test from "node:test";
import { isWakeWindowInChina } from "../src/schedule";

test("wake window starts at 23:00 China time", () => {
  assert.equal(isWakeWindowInChina(new Date("2026-09-12T15:00:00Z")), true);
});

test("wake window includes the following afternoon before 16:00", () => {
  assert.equal(isWakeWindowInChina(new Date("2026-09-12T07:59:00Z")), true);
});

test("quiet window starts at 16:00 China time", () => {
  assert.equal(isWakeWindowInChina(new Date("2026-09-12T08:00:00Z")), false);
});

test("quiet window continues until 23:00 China time", () => {
  assert.equal(isWakeWindowInChina(new Date("2026-09-12T14:59:00Z")), false);
});
