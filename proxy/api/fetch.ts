// CORS Proxy — HTML to Figma Plugin
// Deploy: cd proxy && vercel --prod
// Then paste the deployment URL into PROXY_URL in ui.html

import type { VercelRequest, VercelResponse } from '@vercel/node';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function setCors(res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { url } = (req.body ?? {}) as { url?: string };
  if (!url || !isValidUrl(url)) {
    res.status(400).json({ error: 'Invalid or missing URL — must be http:// or https://' });
    return;
  }

  try {
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
      redirect: 'follow',
    });

    if (!pageRes.ok) {
      res.status(502).json({ error: `Target site returned ${pageRes.status} ${pageRes.statusText}` });
      return;
    }

    const ct = pageRes.headers.get('content-type') ?? '';
    if (!ct.includes('html') && !ct.includes('text/')) {
      res.status(415).json({ error: `URL returned "${ct}" — not an HTML page` });
      return;
    }

    let html = await pageRes.text();
    const finalUrl = pageRes.url;
    const base = new URL(finalUrl);

    // Strip CSP meta tags so inlined scripts aren't blocked in the iframe
    html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

    html = await inlineStylesheets(html, base);
    html = await inlineFontFaces(html);
    html = await inlineScripts(html, base);
    html = makeUrlsAbsolute(html, base);

    res.status(200).json({ html, finalUrl });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch { return false; }
}

async function safeFetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? r.text() : null;
  } catch { return null; }
}

function makeCssUrlsAbsolute(css: string, base: URL): string {
  return css.replace(/url\(\s*["']?(?!data:|https?:|\/\/)(\.?\.?\/[^"')]+|[^"');]+)["']?\s*\)/gi, (match, path) => {
    try { return `url("${new URL(path.trim(), base)}")`; }
    catch { return match; }
  });
}

async function resolveCssImports(css: string, base: URL, depth = 0): Promise<string> {
  if (depth > 3) return css;
  const importRe = /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])[^;]*;/gi;
  const imports: { full: string; href: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(css)) !== null) imports.push({ full: m[0], href: m[1] || m[2] });
  for (const { full, href } of imports) {
    try {
      const absUrl = new URL(href, base).toString();
      let imported = await safeFetchText(absUrl);
      if (imported) {
        imported = await resolveCssImports(imported, new URL(absUrl), depth + 1);
        imported = makeCssUrlsAbsolute(imported, new URL(absUrl));
        css = css.replace(full, imported);
      }
    } catch { /* leave as-is */ }
  }
  return css;
}

async function inlineStylesheets(html: string, base: URL): Promise<string> {
  const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi;
  const matches: { tag: string; href: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) matches.push({ tag: m[0], href: m[1] });

  await Promise.all(matches.map(async ({ tag, href }) => {
    try {
      const cssUrl = new URL(href, base).toString();
      let css = await safeFetchText(cssUrl);
      if (css) {
        css = await resolveCssImports(css, new URL(cssUrl));
        css = makeCssUrlsAbsolute(css, new URL(cssUrl));
        html = html.replace(tag, `<style>\n${css}\n</style>`);
      }
    } catch { /* leave original */ }
  }));

  return html;
}

async function inlineFontFaces(html: string): Promise<string> {
  // Collect all external font URLs inside @font-face src declarations
  const fontUrls = new Set<string>();
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(html)) !== null) {
    const css = sm[1];
    const ffRe = /@font-face\s*\{([^}]+)\}/gi;
    let fm: RegExpExecArray | null;
    while ((fm = ffRe.exec(css)) !== null) {
      const srcRe = /url\(["']?(https?:\/\/[^"')\s]+)["']?\)/gi;
      let um: RegExpExecArray | null;
      while ((um = srcRe.exec(fm[1])) !== null) fontUrls.add(um[1]);
    }
  }
  if (fontUrls.size === 0) return html;

  const fontMap = new Map<string, string>();
  const FONT_MIMES: Record<string, string> = {
    woff2: 'font/woff2', woff: 'font/woff',
    ttf: 'font/ttf', otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
  };

  await Promise.all([...fontUrls].slice(0, 50).map(async (fontUrl) => {
    try {
      const r = await fetch(fontUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fonts.googleapis.com/' },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return;
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 900 * 1024) return; // skip single fonts > 900 KB
      const ext = fontUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'woff2';
      const mime = FONT_MIMES[ext] ?? 'font/woff2';
      fontMap.set(fontUrl, `data:${mime};base64,${Buffer.from(buf).toString('base64')}`);
    } catch { /* skip unavailable fonts */ }
  }));

  fontMap.forEach((dataUrl, original) => {
    // Use split/join to avoid regex escaping issues with URLs
    html = html.split(original).join(dataUrl);
  });
  return html;
}

async function inlineScripts(html: string, base: URL): Promise<string> {
  const scriptRe = /<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi;
  const matches: { full: string; pre: string; src: string; post: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    matches.push({ full: m[0], pre: m[1], src: m[2], post: m[3] });
  }
  await Promise.all(matches.map(async ({ full, pre, src, post }) => {
    // Skip tracking/analytics and known third-party widgets
    if (/google-analytics|googletagmanager|gtag|fbevents|facebook\.net|twitter\.com|hotjar|segment|intercom|hubspot|linkedin|doubleclick|adsbygoogle/i.test(src)) return;
    try {
      const jsUrl = new URL(src, base).toString();
      const js = await safeFetchText(jsUrl);
      if (js) {
        // Strip type="module" so the script runs as classic script in the iframe
        const attrs = (pre + post).replace(/\s*type=["']module["']/gi, '');
        html = html.replace(full, `<script${attrs}>\n${js}\n<\/script>`);
      }
    } catch { /* leave original */ }
  }));
  return html;
}

function makeUrlsAbsolute(html: string, base: URL): string {
  return html.replace(
    /((?:src|href|action)=["'])(?!https?:|\/\/|data:|#|mailto:|tel:)(\/?)([^"'>\s]+)(["'])/gi,
    (_, attr, slash, path, quote) => {
      try { return `${attr}${new URL((slash ? '/' : '') + path, base)}${quote}`; }
      catch { return _; }
    },
  );
}
