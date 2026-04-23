import test from "node:test";
import assert from "node:assert/strict";
import { validateMessage, validateRelayUrl } from "../social/validation.js";

test("validateMessage accepts valid EVM message", () => {
  const result = validateMessage({
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    content: "hello",
    signed_at: new Date().toISOString(),
  });
  assert.equal(result.valid, true);
});

test("validateRelayUrl rejects non-https", () => {
  assert.throws(() => validateRelayUrl("http://example.com"));
});
