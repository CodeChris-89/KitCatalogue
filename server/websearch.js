const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { getDb, PHOTOS_DIR } = require('./db');

// Transparent, honest User-Agent identifying the self-hosted application
const USER_AGENT =
  'KitCatalogue/1.0 (+https://github.com/CodeChris-89/KitCatalogue; Collector Assistant; Open-Source)';

/**
 * Validates that a URL does not target loopback, private networks, or metadata services (SSRF protection).
 */
function isSafeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return false;
    }
    // Block IPv4 loopback & private ranges
    // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const p1 = Number(ipv4Match[1]);
      const p2 = Number(ipv4Match[2]);
      if (p1 === 127 || p1 === 10 || p1 === 0) return false;
      if (p1 === 172 && p2 >= 16 && p2 <= 31) return false;
      if (p1 === 192 && p2 === 168) return false;
      if (p1 === 169 && p2 === 254) return false;
    }
    // Block IPv6 loopback
    if (hostname === '[::1]' || hostname === '::1') return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * In-memory cache for robots.txt rules to avoid hammering servers.
 * Implements machine-readable opt-out compliance (§ 44b Abs. 3 UrhG / DSM-RL).
 */
const robotsCache = new Map();

function parseRobotsTxt(text) {
  const disallowed = [];
  const lines = text.split(/\r?\n/);
  let relevantUserAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (key === 'user-agent') {
      const targetAgent = val.toLowerCase();
      relevantUserAgent = targetAgent === '*' || targetAgent.includes('kitcatalogue');
    } else if (relevantUserAgent && key === 'disallow') {
      if (val) disallowed.push(val);
    }
  }
  return { disallowed };
}

async function isAllowedByRobots(targetUrl, userAgent = USER_AGENT) {
  if (!isSafeUrl(targetUrl)) return false;
  try {
    const parsed = new URL(targetUrl);
    const hostKey = parsed.host.toLowerCase();
    let rules = robotsCache.get(hostKey);

    if (!rules) {
      const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
      try {
        const res = await fetch(robotsUrl, {
          headers: { 'User-Agent': userAgent },
          signal: AbortSignal.timeout(3500)
        });
        if (res.ok) {
          const text = await res.text();
          rules = parseRobotsTxt(text);
        } else {
          rules = { disallowed: [] };
        }
      } catch (_) {
        rules = { disallowed: [] };
      }
      robotsCache.set(hostKey, rules);
    }

    const pathname = parsed.pathname || '/';
    for (const dis of rules.disallowed) {
      if (dis === '/' || pathname.startsWith(dis)) {
        return false;
      }
    }
    return true;
  } catch (_) {
    return true;
  }
}

/**
 * Primary Provider: Wikimedia Commons Public Domain / Creative Commons Open Media API
 * 100% legal, royalty-free, authorized reuse under CC licenses.
 */
async function searchWikimediaCommons(cleanQuery, limit = 20) {
  try {
    const endpoint = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size|extmetadata&format=json`;
    const res = await fetch(endpoint, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return [];

    const results = [];
    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info || !info.url) continue;
      const meta = info.extmetadata || {};
      const license = meta.LicenseShortName?.value || 'Creative Commons';
      const author = meta.Artist?.value ? String(meta.Artist.value).replace(/<[^>]+>/g, '').trim() : '';

      results.push({
        title: page.title ? page.title.replace(/^File:/i, '') : cleanQuery,
        image: info.url,
        thumbnail: info.thumburl || info.url,
        width: info.width || 0,
        height: info.height || 0,
        source: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        license: license,
        author: author,
        provider: 'Wikimedia Commons'
      });
    }
    return results;
  } catch (_) {
    return [];
  }
}

/**
 * Secondary Provider: DuckDuckGo Image Search
 */
async function searchDuckDuckGoImages(cleanQuery, limit = 20) {
  const allowed = await isAllowedByRobots('https://duckduckgo.com/');
  if (!allowed) return [];

  const pageRes = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&iax=images&ia=images`,
    {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(8000)
    }
  );
  if (!pageRes.ok) return [];

  const pageText = await pageRes.text();
  const vqdMatch =
    pageText.match(/vqd=([\"']?)([\d-]+)\1/i) || pageText.match(/vqd=([\d-]+)/i);
  if (!vqdMatch) return [];

  const vqd = vqdMatch[2] || vqdMatch[1];

  const imgRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(cleanQuery)}&vqd=${vqd}&f=,,,&p=1`,
    {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://duckduckgo.com/'
      },
      signal: AbortSignal.timeout(8000)
    }
  );
  if (!imgRes.ok) return [];

  const data = await imgRes.json();
  if (!data || !Array.isArray(data.results)) return [];

  return data.results.slice(0, limit).map((r) => ({
    title: r.title || cleanQuery,
    image: r.image,
    thumbnail: r.thumbnail || r.image,
    width: r.width,
    height: r.height,
    source: r.source || '',
    license: 'Web Reference',
    provider: 'DuckDuckGo Web'
  }));
}

/**
 * Secondary Provider: Bing Images Search
 */
async function searchBingImages(cleanQuery, limit = 20) {
  const allowed = await isAllowedByRobots('https://www.bing.com/');
  if (!allowed) return [];

  const res = await fetch(
    `https://www.bing.com/images/search?q=${encodeURIComponent(cleanQuery)}&form=HDRSC2&first=1`,
    {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(8000)
    }
  );
  if (!res.ok) return [];

  const html = await res.text();
  const results = [];
  const regex = /m="(\{[^"]*murl[^"]*\})"/g;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < limit) {
    try {
      const jsonStr = match[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'");
      const meta = JSON.parse(jsonStr);
      if (meta.murl) {
        results.push({
          title: meta.t || meta.desc || cleanQuery,
          image: meta.murl,
          thumbnail: meta.turl || meta.murl,
          width: 0,
          height: 0,
          source: meta.purl || '',
          license: 'Web Reference',
          provider: 'Bing Web'
        });
      }
    } catch (_) {
      // ignore malformed match
    }
  }
  return results;
}

/**
 * Searches for images using Wikimedia Commons (free/open media) first,
 * with optional fallback to web index search.
 * Returns an array of { title, image, thumbnail, width, height, source, license, provider }
 */
async function searchWebImages(query, limit = 20) {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  // 1. Try Wikimedia Commons first (Open-Licensed Creative Commons / Public Domain)
  try {
    const wikiResults = await searchWikimediaCommons(cleanQuery, limit);
    if (wikiResults && wikiResults.length > 0) {
      return wikiResults;
    }
  } catch (err) {
    console.error('Wikimedia Commons search error:', err.message);
  }

  // 2. Secondary fallback: DuckDuckGo
  try {
    const ddgResults = await searchDuckDuckGoImages(cleanQuery, limit);
    if (ddgResults && ddgResults.length > 0) {
      return ddgResults;
    }
  } catch (err) {
    console.error('DuckDuckGo image search error:', err.message);
  }

  // 3. Tertiary fallback: Bing
  try {
    const bingResults = await searchBingImages(cleanQuery, limit);
    if (bingResults && bingResults.length > 0) {
      return bingResults;
    }
  } catch (err) {
    console.error('Bing image search error:', err.message);
  }

  return [];
}

/**
 * Downloads an image from a URL and attaches it to the specified kit as a stance photo (optionally as cover).
 * Supports fallbackUrl (e.g. thumbnail) if the primary high-res origin blocks hotlinking.
 * Flags image as web-imported and records source origin for copyright audit.
 */
async function attachImageFromUrl(kitId, userId, imageUrl, options = {}) {
  const db = getDb();
  const {
    fallbackUrl = '',
    stanceName = 'Cover / Box Art',
    caption = 'Web image import',
    isCover = true,
    sourceUrl = ''
  } = options;

  const kit = db.prepare('SELECT id FROM kits WHERE id = ? AND user_id = ?').get(kitId, userId);
  if (!kit) {
    throw new Error('Kit not found or access denied');
  }

  if (!isSafeUrl(imageUrl)) {
    throw new Error('Invalid or restricted URL target (SSRF protection)');
  }
  if (fallbackUrl && !isSafeUrl(fallbackUrl)) {
    fallbackUrl = '';
  }

  const allowed = await isAllowedByRobots(imageUrl);
  if (!allowed) {
    throw new Error('Image download disallowed by source domain robots.txt policy (§ 44b UrhG opt-out).');
  }

  let res = null;
  try {
    res = await fetch(imageUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    res = null;
  }

  // If primary URL failed or returned non-image, try the fallback thumbnail URL
  if (
    (!res || !res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) &&
    fallbackUrl &&
    fallbackUrl !== imageUrl
  ) {
    res = await fetch(fallbackUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });
  }

  if (!res || !res.ok) {
    throw new Error(
      `Failed to download image from source (${res ? res.status : 'network error'})`
    );
  }

  const rawContentType = res.headers.get('content-type') || '';
  if (!rawContentType.toLowerCase().startsWith('image/')) {
    throw new Error('Downloaded file is not a valid image');
  }
  const mimeType = rawContentType.split(';')[0].trim().toLowerCase();
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let ext = '.jpg';
  if (mimeType.includes('png')) ext = '.png';
  else if (mimeType.includes('webp')) ext = '.webp';
  else if (mimeType.includes('gif')) ext = '.gif';
  else if (mimeType.includes('avif')) ext = '.avif';

  const uniqueName = `kit_${kitId}_web_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, uniqueName), buffer);

  if (isCover) {
    db.prepare('UPDATE kit_photos SET is_cover = 0 WHERE kit_id = ?').run(kitId);
  }

  const inserted = db
    .prepare(
      `INSERT INTO kit_photos (
        kit_id, user_id, filename, original_name, mime_type, file_size, stance_name, caption, is_cover, is_web_import, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      kitId,
      userId,
      uniqueName,
      `web_image_${Date.now()}${ext}`,
      mimeType,
      buffer.length,
      stanceName,
      caption,
      isCover ? 1 : 0,
      sourceUrl || imageUrl
    );

  db.prepare("UPDATE kits SET updated_at = datetime('now') WHERE id = ?").run(kitId);

  return {
    id: Number(inserted.lastInsertRowid),
    filename: uniqueName,
    url: `/api/files/photos/${uniqueName}`,
    isWebImport: true,
    sourceUrl: sourceUrl || imageUrl
  };
}

/**
 * Opt-in cover crawl helper.
 * Only invoked when explicitly requested by user.
 */
async function autoCrawlCoverImage(kitId, userId, query) {
  try {
    const results = await searchWebImages(query, 5);
    if (!results.length) return null;
    for (const candidate of results) {
      try {
        const targetUrl = candidate.image || candidate.thumbnail;
        if (!targetUrl) continue;
        return await attachImageFromUrl(kitId, userId, targetUrl, {
          fallbackUrl: candidate.thumbnail || '',
          stanceName: candidate.license ? `Cover [${candidate.license}]` : 'Cover / Box Art',
          caption: `Web import: ${candidate.title || query}${candidate.license ? ` (${candidate.license})` : ''}`,
          isCover: true,
          sourceUrl: candidate.source || targetUrl
        });
      } catch (_) {
        // try next candidate
      }
    }
    return null;
  } catch (err) {
    console.error('Cover crawl failed for kit', kitId, ':', err.message);
    return null;
  }
}

module.exports = {
  isSafeUrl,
  isAllowedByRobots,
  USER_AGENT,
  searchWikimediaCommons,
  searchDuckDuckGoImages,
  searchBingImages,
  searchWebImages,
  attachImageFromUrl,
  autoCrawlCoverImage
};
