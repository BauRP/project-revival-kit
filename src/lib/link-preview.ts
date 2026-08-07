import { dbGet, dbPut } from "@/lib/storage";

/**
 * Phase 2 §3 — OpenGraph link preview.
 *
 * The web client uses a public CORS-enabled microservice (allorigins) to
 * fetch the raw HTML and parse OG tags client-side. The native Android
 * shell will swap this out for a server-side parser (see V2_NATIVE_TODO.md).
 */

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  fetchedAt: number;
}

const URL_RE = /https?:\/\/[^\s<>()"']+/i;

export const extractFirstUrl = (text: string): string | null => {
  const m = text.match(URL_RE);
  return m ? m[0] : null;
};

const cacheKey = (url: string) => `link-preview-${url}`;

const parseOg = (html: string, url: string): LinkPreview => {
  const get = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
    const m = html.match(re);
    if (m) return m[1];
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
    const m2 = html.match(re2);
    return m2 ? m2[1] : undefined;
  };
  const titleTag = (() => {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim() : undefined;
  })();
  return {
    url,
    title: get("og:title") || titleTag,
    description: get("og:description") || get("description"),
    image: get("og:image") || get("twitter:image"),
    siteName: get("og:site_name"),
    fetchedAt: Date.now(),
  };
};

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const cached = await dbGet<LinkPreview>("settings", cacheKey(url));
    if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return cached;
  } catch {
    /* ignore cache miss */
  }
  try {
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const html = await res.text();
    const preview = parseOg(html, url);
    if (!preview.title && !preview.image && !preview.description) return null;
    try { await dbPut("settings", cacheKey(url), preview); } catch { /* non-fatal */ }
    return preview;
  } catch (e) {
    console.warn("[link-preview] fetch failed", e);
    return null;
  }
}
