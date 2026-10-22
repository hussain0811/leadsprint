import { checkEndpoint, type EndpointCheck } from "../net";
import { htmlToText } from "./extract";

const TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; LeadSprint/0.1; knowledge base page reader)",
  accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
  "accept-language": "en,ar;q=0.9",
};

// Thrown with a message that is safe and useful to show the admin.
export class PageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageFetchError";
  }
}

export type WebPage = { title: string | null; text: string; finalUrl: string };

// The server fetches pages itself, so every address it visits, redirects included, must be public.
export async function checkPageUrl(raw: string): Promise<EndpointCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Enter the full page address, like https://example.com/page." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "The address must start with http:// or https://." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the user name and password from the address." };
  }
  // checkEndpoint insists on https because AI keys travel with those requests. A page request
  // carries no key, so only the host goes through it.
  const host = await checkEndpoint(`https://${url.host}/`, { allowPrivate: false });
  return host.ok ? { ok: true, url } : host;
}

export async function fetchWebPage(address: string): Promise<WebPage> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let next = address;

  for (let redirects = 0; ; redirects++) {
    const check = await checkPageUrl(next);
    if (!check.ok) throw new PageFetchError(check.reason);
    const url = check.url;
    const res = await request(url, signal);

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (redirects >= MAX_REDIRECTS) throw new PageFetchError("The page redirected too many times.");
      next = resolveRedirect(location, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new PageFetchError(statusMessage(res.status));
    }

    const contentType = res.headers.get("content-type");
    const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
    // Servers that send no type are almost always serving HTML.
    const isHtml = !type || type === "text/html" || type === "application/xhtml+xml";
    if (!isHtml && type !== "text/plain") {
      await res.body?.cancel();
      throw new PageFetchError(
        `This address returned a ${type} file, not a web page. If it's a document, download it and upload it as a file instead.`,
      );
    }

    const body = decode(await readBody(res, signal), contentType, isHtml);
    const page = isHtml ? htmlToText(body) : { title: null, text: body };
    const text = page.text.trim();
    if (!text) {
      throw new PageFetchError(
        "This page has no readable text. If its content only appears with JavaScript, paste the text in as a text source instead.",
      );
    }
    return { title: page.title?.replace(/\s+/g, " ").trim() || null, text, finalUrl: url.href };
  }
}

async function request(url: URL, signal: AbortSignal) {
  try {
    return await fetch(url, { redirect: "manual", signal, headers: HEADERS });
  } catch (err) {
    throw new PageFetchError(signal.aborted ? timeoutMessage() : networkMessage(url, err));
  }
}

function resolveRedirect(location: string, from: URL) {
  try {
    return new URL(location, from).href;
  } catch {
    throw new PageFetchError("The page redirected to an address that isn't valid.");
  }
}

// Reads at most MAX_PAGE_BYTES, stopping as soon as the page turns out to be bigger.
async function readBody(res: Response, signal: AbortSignal): Promise<Uint8Array> {
  const tooBig = () => new PageFetchError("The page is larger than 3 MB, which is the limit for web pages.");
  if (Number(res.headers.get("content-length")) > MAX_PAGE_BYTES) {
    await res.body?.cancel();
    throw tooBig();
  }
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw tooBig();
      }
      parts.push(value);
    }
  } catch (err) {
    if (err instanceof PageFetchError) throw err;
    throw new PageFetchError(signal.aborted ? timeoutMessage() : "The connection dropped while the page was loading.");
  }
  return Buffer.concat(parts);
}

// Honours the charset from the header or the page's own <meta> tag; many Arabic sites still use windows-1256.
function decode(bytes: Uint8Array, contentType: string | null, isHtml: boolean) {
  const charsetPattern = /charset\s*=\s*["']?([\w.:-]+)/i;
  let charset = charsetPattern.exec(contentType ?? "")?.[1];
  if (!charset && isHtml) {
    const head = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
    charset = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    // Unknown charset name: UTF-8 is the best guess.
    return new TextDecoder().decode(bytes);
  }
}

function timeoutMessage() {
  return `The page didn't finish loading within ${TIMEOUT_MS / 1000} seconds.`;
}

function networkMessage(url: URL, err: unknown) {
  const code = String((err as { cause?: { code?: unknown } })?.cause?.code ?? "");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Couldn't find ${url.hostname}. Check the address.`;
  if (code.includes("CERT") || code.includes("SSL") || code.includes("TLS")) {
    return "The site's security certificate isn't valid, so the page wasn't read.";
  }
  return "Couldn't reach the site. Check the address and try again.";
}

function statusMessage(status: number) {
  if (status === 404 || status === 410) return `The page wasn't found (status ${status}). Check the address.`;
  if (status === 401 || status === 403) {
    return `The site refused access (status ${status}). Only public pages can be added.`;
  }
  return `The site returned an error (status ${status}).`;
}
