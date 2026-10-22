import dns from "node:dns/promises";
import net from "node:net";

// Customer-supplied addresses (AI servers, later webhooks and storage) must not reach
// this machine or its private network, except local AI servers during development.
export function privateEndpointsAllowed() {
  return process.env.ALLOW_PRIVATE_ENDPOINTS === "true";
}

export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  if (net.isIPv4(h)) {
    const [a, b] = h.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (net.isIPv6(h)) {
    const g = ipv6Groups(h);
    if (!g) return true;
    const zeroThrough = (n: number) => g.slice(0, n).every((x) => x === 0);
    if (zeroThrough(7) && g[7] <= 1) return true; // :: and ::1
    // IPv4-mapped (::ffff:), IPv4-compatible (::) and NAT64 (64:ff9b::) addresses carry an IPv4 address inside.
    const carriesIPv4 =
      (zeroThrough(5) && g[5] === 0xffff) || zeroThrough(6) || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0));
    if (carriesIPv4) return isPrivateAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    // Unique local fc00::/7 and link-local fe80::/10.
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80;
  }
  return false;
}

// Expands an IPv6 address to its 8 groups, so a mapped IPv4 address is found however it's written
// (URL parsing turns ::ffff:127.0.0.1 into ::ffff:7f00:1).
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted) {
    if (!net.isIPv4(dotted)) return null;
    const [a, b, c, d] = dotted.split(".").map(Number);
    text = `${text.slice(0, -dotted.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((group) => parseInt(group, 16)) : []);
  const front = parse(halves[0]);
  const back = halves.length === 2 ? parse(halves[1]) : [];
  const missing = halves.length === 2 ? 8 - front.length - back.length : 0;
  if (missing < 0) return null;
  const groups = [...front, ...new Array<number>(missing).fill(0), ...back];
  return groups.length === 8 && groups.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? groups : null;
}

export type EndpointCheck = { ok: true; url: URL } | { ok: false; reason: string };

// allowPrivate overrides the ALLOW_PRIVATE_ENDPOINTS switch, for addresses that must always be public (web pages).
export async function checkEndpoint(raw: string, opts: { allowPrivate?: boolean } = {}): Promise<EndpointCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Enter a full address, like http://localhost:1234/v1." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "The address must start with http:// or https://." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Put the key in the API key field, not in the address." };
  }

  const allowPrivate = opts.allowPrivate ?? privateEndpointsAllowed();
  if (isPrivateAddress(url.hostname)) {
    if (allowPrivate) return { ok: true, url };
    // The .env switch only helps when the caller didn't decide for itself.
    return opts.allowPrivate === undefined
      ? {
          ok: false,
          reason:
            "Addresses on this computer or your local network are blocked. For a local AI server in development, set ALLOW_PRIVATE_ENDPOINTS=true in .env.",
        }
      : { ok: false, reason: "Addresses on this computer or your local network are blocked." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Use https:// for servers outside this computer, so your key is encrypted on the way." };
  }
  if (!allowPrivate) {
    try {
      const addresses = await dns.lookup(url.hostname, { all: true });
      if (addresses.some((a) => isPrivateAddress(a.address))) {
        return { ok: false, reason: "This address points to a private network, which is blocked." };
      }
    } catch {
      return { ok: false, reason: `Couldn't find ${url.hostname}. Check the address.` };
    }
  }
  return { ok: true, url };
}
