import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret } from "./crypto";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

test("a sealed secret opens to the original value", () => {
  const sealed = encryptSecret("sk-test-123");
  assert.ok(!sealed.includes("sk-test-123"));
  assert.equal(decryptSecret(sealed), "sk-test-123");
});

test("the same secret seals differently each time", () => {
  assert.notEqual(encryptSecret("same"), encryptSecret("same"));
});

test("a tampered secret is rejected", () => {
  const parts = encryptSecret("sk-test-123").split(":");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(parts.join(":")));
});
