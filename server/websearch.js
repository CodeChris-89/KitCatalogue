const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { getDb, PHOTOS_DIR } = require('./db');

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
 * Primary Provider: DuckDuckGo Image Search JSON API
 */
async function searchDuckDuckGoImages(cleanQuery, limit = 20) {
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
    source: r.source || ''
  }));
}

/**
 * Secondary Provider: Bing Images HTML Scraper fallback
 */
async function searchBingImages(cleanQuery, limit = 20) {
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
          source: meta.purl || ''
        });
      }
    } catch (_) {
      // ignore malformed match
    }
  }
  return results;
}

/**
 * Searches the web for images using DuckDuckGo with automatic fallback to Bing Images.
 * Returns an array of { title, image, thumbnail, width, height, source }
 */
async function searchWebImages(query, limit = 20) {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  try {
    const ddgResults = await searchDuckDuckGoImages(cleanQuery, limit);
    if (ddgResults && ddgResults.length > 0) {
      return ddgResults;
    }
  } catch (err) {
    console.error('DuckDuckGo image search error:', err.message);
  }

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
 */
async function attachImageFromUrl(kitId, userId, imageUrl, options = {}) {
  const db = getDb();
  const {
    fallbackUrl = '',
    stanceName = 'Cover / Box Art',
    caption = 'Web image import',
    isCover = true
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
        kit_id, user_id, filename, original_name, mime_type, file_size, stance_name, caption, is_cover
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      isCover ? 1 : 0
    );

  db.prepare("UPDATE kits SET updated_at = datetime('now') WHERE id = ?").run(kitId);

  return {
    id: Number(inserted.lastInsertRowid),
    filename: uniqueName,
    url: `/api/files/photos/${uniqueName}`
  };
}

/**
 * Automatically crawls and attaches a cover image for a newly created kit.
 * Non-blocking: failures won't break kit creation.
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
          stanceName: 'Box Art / Web Cover',
          caption: `Auto-crawled: ${candidate.title || query}`,
          isCover: true
        });
      } catch (_) {
        // try next candidate
      }
    }
    return null;
  } catch (err) {
    console.error('Auto cover crawl failed for kit', kitId, ':', err.message);
    return null;
  }
}

module.exports = {
  searchWebImages,
  attachImageFromUrl,
  autoCrawlCoverImage
};
