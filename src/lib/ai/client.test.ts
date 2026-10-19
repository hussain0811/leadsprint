import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleText } from "./client";

test("hides a model's thinking from the reply", () => {
  assert.equal(visibleText("<think>plan the answer</think>Hello"), "Hello");
  assert.equal(visibleText("still thinking</think> Hi there"), "Hi there");
  assert.equal(visibleText("Answer <think>unfinished thought"), "Answer");
  assert.equal(visibleText("Plain reply"), "Plain reply");
  assert.equal(visibleText(null), "");
});
