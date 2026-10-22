import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEndpoint, isPrivateAddress } from "./net";

test("recognises addresses on this computer and private networks", () => {
  const privateHosts = [
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.20",
    "172.16.0.1",
    "169.254.169.254",
    "::1",
    "[::1]",
    "::",
    "fd12::1",
    "fc00::1",
    "fe80::1",
    "printer.local",
    // IPv4 addresses wrapped in IPv6, in the spellings URL parsing produces.
    "::ffff:127.0.0.1",
    "[::ffff:7f00:1]",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
  ];
  for (const host of privateHosts) assert.equal(isPrivateAddress(host), true, host);

  const publicHosts = ["8.8.8.8", "api.openai.com", "172.32.0.1", "2001:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"];
  for (const host of publicHosts) assert.equal(isPrivateAddress(host), false, host);
});

test("local AI servers need the development switch", async () => {
  delete process.env.ALLOW_PRIVATE_ENDPOINTS;
  assert.equal((await checkEndpoint("http://localhost:1234/v1")).ok, false);
  process.env.ALLOW_PRIVATE_ENDPOINTS = "true";
  assert.equal((await checkEndpoint("http://localhost:1234/v1")).ok, true);
});

test("remote servers need https and no credentials in the address", async () => {
  process.env.ALLOW_PRIVATE_ENDPOINTS = "true";
  assert.equal((await checkEndpoint("http://api.openai.com/v1")).ok, false);
  assert.equal((await checkEndpoint("https://user:pass@api.openai.com/v1")).ok, false);
  assert.equal((await checkEndpoint("ftp://example.com/v1")).ok, false);
  assert.equal((await checkEndpoint("not an address")).ok, false);
  assert.equal((await checkEndpoint("https://api.openai.com/v1")).ok, true);
});
