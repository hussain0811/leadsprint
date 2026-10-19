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
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("::ffff:")) return isPrivateAddress(h.slice("::ffff:".length));
    return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  }
  return false;
}

export type EndpointCheck = { ok: true; url: URL } | { ok: false; reason: string };

export async function checkEndpoint(raw: string): Promise<EndpointCheck> {
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

  const allowPrivate = privateEndpointsAllowed();
  if (isPrivateAddress(url.hostname)) {
    return allowPrivate
      ? { ok: true, url }
      : {
          ok: false,
          reason:
            "Addresses on this computer or your local network are blocked. For a local AI server in development, set ALLOW_PRIVATE_ENDPOINTS=true in .env.",
        };
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
