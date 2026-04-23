import test from "node:test";
import assert from "node:assert/strict";
import { executeFundingStrategies } from "../survival/funding.js";
import { MockConwayClient, createTestDb, createTestIdentity, createTestConfig } from "./mocks.js";

test("dead-tier cooldown does not suppress low_compute notification", async () => {
  const db = createTestDb();
  const conway = new MockConwayClient();
  conway.creditsCents = 5;
  const identity = createTestIdentity();
  const config = createTestConfig();

  const deadAttempts = await executeFundingStrategies("dead", identity, config, db, conway);
  assert.equal(deadAttempts.length, 1);
  assert.equal(deadAttempts[0]?.strategy, "desperate_plea");

  const lowAttempts = await executeFundingStrategies("low_compute", identity, config, db, conway);
  assert.equal(lowAttempts.length, 1);
  assert.equal(lowAttempts[0]?.strategy, "polite_creator_notification");

  db.close();
});
