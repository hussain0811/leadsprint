import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { test, type TestContext } from "node:test";
import { checkPageUrl, fetchWebPage, PageFetchError } from "./fetch-page";

test("pages must be public, whatever the private-address switch says", async () => {
  process.env.ALLOW_PRIVATE_ENDPOINTS = "true";
  const blocked = [
    "http://localhost:3020/api/knowledge",
    "http://127.0.0.1/",
    "http://192.168.1.10/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "ftp://example.com/file.txt",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "not an address",
  ];
  for (const address of blocked) {
    const check = await checkPageUrl(address);
    assert.equal(check.ok, false, address);
    if (!check.ok) assert.ok(!check.reason.includes("ALLOW_PRIVATE_ENDPOINTS"), address);
  }
});

// Fake DNS and HTTP, so the redirect and size rules can be checked without the internet.
function fakeWeb(t: TestContext, pages: Record<string, () => Response>) {
  t.mock.method(dns, "lookup", async (host: string) => [
    { address: host === "intranet.example.com" ? "10.0.0.5" : "93.184.216.34", family: 4 },
  ]);
  return t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const page = pages[String(input)];
    return page ? page() : new Response("missing", { status: 404 });
  });
}

const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });
const text = (body: BodyInit, type = "text/plain") => () => new Response(body, { headers: { "content-type": type } });

test("follows redirects to the final page", async (t) => {
  fakeWeb(t, {
    "http://example.com/": redirect("https://example.com/"),
    "https://example.com/": redirect("/about"),
    "https://example.com/about": text("Demo Realty sells homes in Dubai."),
  });
  const page = await fetchWebPage("http://example.com/");
  assert.deepEqual(page, { title: null, text: "Demo Realty sells homes in Dubai.", finalUrl: "https://example.com/about" });
});

test("checks every redirect against private addresses", async (t) => {
  const fetch = fakeWeb(t, {
    "https://example.com/a": redirect("http://127.0.0.1:3020/api/knowledge"),
    "https://example.com/b": redirect("https://intranet.example.com/secret"),
  });
  await assert.rejects(fetchWebPage("https://example.com/a"), PageFetchError);
  await assert.rejects(fetchWebPage("https://example.com/b"), PageFetchError);
  assert.equal(fetch.mock.callCount(), 2);
});

test("gives up after five redirects", async (t) => {
  const pages: Record<string, () => Response> = {};
  for (let i = 0; i < 10; i++) pages[`https://example.com/${i}`] = redirect(`/${i + 1}`);
  const fetch = fakeWeb(t, pages);
  await assert.rejects(fetchWebPage("https://example.com/0"), /too many times/);
  assert.equal(fetch.mock.callCount(), 6);
});

test("reads only web pages up to 3 MB", async (t) => {
  const endless = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(512 * 1024));
    },
  });
  fakeWeb(t, {
    "https://example.com/brochure.pdf": text("%PDF-1.7", "application/pdf"),
    "https://example.com/endless": text(endless),
  });
  await assert.rejects(fetchWebPage("https://example.com/brochure.pdf"), /upload it as a file/);
  await assert.rejects(fetchWebPage("https://example.com/endless"), /larger than 3 MB/);
});

test("decodes pages in their declared character set", async (t) => {
  fakeWeb(t, {
    // "مرحبا" in windows-1256, still common on Arabic sites.
    "https://example.com/ar": text(Uint8Array.from([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]), "text/plain; charset=windows-1256"),
  });
  assert.equal((await fetchWebPage("https://example.com/ar")).text, "مرحبا");
});
