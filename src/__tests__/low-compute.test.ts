import test from "node:test";
import assert from "node:assert/strict";
import {
  canRunInference,
  getModelForTier,
  applyTierRestrictions,
} from "../survival/low-compute.js";
import { createInferenceClient } from "../conway/inference.js";
import { createTestDb } from "./mocks.js";

test("canRunInference denies dead tier", () => {
  assert.equal(canRunInference("dead"), false);
});

test("getModelForTier uses mini model for critical tier", () => {
  assert.equal(getModelForTier("critical", "gpt-5.2"), "gpt-5-mini");
});

test("applyTierRestrictions sets low compute mode", () => {
  const db = createTestDb();
  const client = createInferenceClient({
    apiUrl: "https://api.conway.tech",
    apiKey: "test-key",
    defaultModel: "gpt-5.2",
    lowComputeModel: "gpt-5-mini",
    maxTokens: 4096,
  });
  applyTierRestrictions("critical", client, db);
  assert.equal(client.getDefaultModel(), "gpt-5-mini");
  db.close();
});
