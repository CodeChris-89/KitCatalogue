const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { getDb, PHOTOS_DIR } = require('./db');

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Searches the web for images using DuckDuckGo image index.
 * Returns an array of { title, image, thumbnail, width, height, source }
 */
async function searchWebImages(query, limit = 15) {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  try {
    // 1. Get VQD token from search page
    const pageRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&iax=images&ia=images`,
      {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(6000)
      }
    );
    if (!pageRes.ok) return [];

    const pageText = await pageRes.text();
    const vqdMatch =
      pageText.match(/vqd=([\"']?)([\d-]+)\1/i) || pageText.match(/vqd=([\d-]+)/i);
    if (!vqdMatch) return [];

    const vqd = vqdMatch[2] || vqdMatch[1];

    // 2. Query DuckDuckGo image JSON API
    const imgRes = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(cleanQuery)}&vqd=${vqd}&f=,,,&p=1`,
      {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(6000)
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
  } catch (err) {
    console.error('Web image search error:', err.message);
    return [];
  }
}

/**
 * Downloads an image from a URL and attaches it to the specified kit as a stance photo (optionally as cover).
 */
async function attachImageFromUrl(kitId, userId, imageUrl, options = {}) {
  const db = getDb();
  const {
    stanceName = 'Cover / Box Art',
    caption = 'Web image import',
    isCover = true
  } = options;

  const kit = db.prepare('SELECT id FROM kits WHERE id = ? AND user_id = ?').get(kitId, userId);
  if (!kit) {
    throw new Error('Kit not found or access denied');
  }

  // Fetch the remote image
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`Failed to download image from source (${res.status})`);
  }

  const rawContentType = res.headers.get('content-type') || 'image/jpeg';
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
    // Prefer the first result or thumbnail
    const targetUrl = results[0].image || results[0].thumbnail;
    if (!targetUrl) return null;
    return await attachImageFromUrl(kitId, userId, targetUrl, {
      stanceName: 'Box Art / Web Cover',
      caption: `Auto-crawled: ${results[0].title || query}`,
      isCover: true
    });
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
