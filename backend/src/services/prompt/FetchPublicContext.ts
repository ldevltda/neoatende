import axios from "axios";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function normalizeUrl(u?: string | null): string | null {
  if (!u) return null;
  const hasProtocol = /^https?:\/\//i.test(u);
  return hasProtocol ? u : `https://${u}`;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      maxContentLength: 1024 * 1024 * 3, // 3MB
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const ctype = String(resp.headers["content-type"] || "");
    if (!ctype.includes("text/html")) return null;
    return String(resp.data || "");
  } catch {
    return null;
  }
}

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const meta: string[] = [];
  const title = $("title").first().text().trim();
  if (title) meta.push(`TÍTULO: ${title}`);

  const desc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  if (desc) meta.push(`DESCRIÇÃO: ${desc.trim()}`);

  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  if (ogTitle) meta.push(`OG:TÍTULO: ${ogTitle.trim()}`);

  const heads: string[] = [];
  $("h1, h2, h3")
    .slice(0, 12)
    .each((_, el) => {
      const tag = (el.tagName || "h").toUpperCase();
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t) heads.push(`${tag}: ${t}`);
    });

  const paras: string[] = [];
  $("p")
    .slice(0, 80)
    .each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t && t.length > 40) paras.push(t);
    });

  const joined = [...meta, ...heads, ...paras].join("\n");
  // limita pra não virar um romance
  return joined.slice(0, 12000);
}

export async function fetchPublicContext(siteUrl?: string | null, socialUrls: string[] = []) {
  const targets = new Set<string>();
  const s = normalizeUrl(siteUrl);
  if (s) targets.add(s);

  for (const raw of socialUrls) {
    const url = normalizeUrl(raw);
    if (url) targets.add(url);
  }

  const chunks: string[] = [];
  for (const url of targets) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const text = extractTextFromHtml(html);
    if (text) {
      chunks.push(`\n[ORIGEM] ${url}\n${text}\n`);
    }
  }

  return chunks.join("\n").slice(0, 20000);
}
//teste