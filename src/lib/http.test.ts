import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { crossSiteError, parseBody } from "./http";

const post = (headers: Record<string, string>, body = "{}") =>
  new Request("http://127.0.0.1:3020/api/knowledge/texts", { method: "POST", headers: { host: "127.0.0.1:3020", ...headers }, body });

test("requests from this app's own pages and from tools are let through", () => {
  assert.equal(crossSiteError(post({ origin: "http://127.0.0.1:3020", "sec-fetch-site": "same-origin" })), null);
  assert.equal(crossSiteError(post({})), null);
});

test("requests a browser sends from another site are refused", () => {
  const attempts: Record<string, string>[] = [
    { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { origin: "http://localhost:3021" },
    { origin: "null" },
  ];
  for (const headers of attempts) {
    assert.equal(crossSiteError(post(headers))?.status, 403, JSON.stringify(headers));
  }
});

test("JSON bodies must say they are JSON", async () => {
  const schema = z.object({ a: z.number() });
  const plain = await parseBody(post({ "content-type": "text/plain" }, '{"a":1}'), schema);
  assert.equal(plain.ok ? 0 : plain.response.status, 415);
  const json = await parseBody(post({ "content-type": "application/json; charset=utf-8" }, '{"a":1}'), schema);
  assert.deepEqual(json.ok && json.data, { a: 1 });
});
