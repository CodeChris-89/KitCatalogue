const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDb, PHOTOS_DIR, MANUALS_DIR } = require('./db');
const {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  getAuthenticatedUser,
  getUserCount,
  isRegistrationAllowed,
  setRegistrationAllowed
} = require('./auth');
const { parseMultipart } = require('./multipart');
const { searchWebImages, attachImageFromUrl, autoCrawlCoverImage } = require('./websearch');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

const VALID_COLLECTION_TYPES = ['owned', 'wishlist'];
const VALID_STATUSES = [
  'backlog',
  'building',
  'panel_lining',
  'painting',
  'finished',
  'on_hold',
  'wishlist'
];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(str ? JSON.parse(str) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
  });
}

function hydrateKit(kitRow, db, showcaseToken = '') {
  if (!kitRow) return null;
  const suffix = showcaseToken ? `?showcase=${encodeURIComponent(showcaseToken)}` : '';
  const photos = db
    .prepare(
      `SELECT id, kit_id, filename, original_name, mime_type, file_size, stance_name, caption, is_cover, sort_order, created_at
       FROM kit_photos
       WHERE kit_id = ?
       ORDER BY is_cover DESC, sort_order ASC, id ASC`
    )
    .all(kitRow.id)
    .map((p) => ({
      ...p,
      url: `/api/files/photos/${p.filename}${suffix}`
    }));

  const manuals = db
    .prepare(
      `SELECT id, kit_id, title, filename, original_name, mime_type, file_size, external_url, notes, created_at
       FROM kit_manuals
       WHERE kit_id = ?
       ORDER BY id ASC`
    )
    .all(kitRow.id)
    .map((m) => ({
      ...m,
      url: m.filename ? `/api/files/manuals/${m.filename}${suffix}` : m.external_url
    }));

  const coverPhoto = photos.find((p) => p.is_cover) || photos[0] || null;

  return {
    ...kitRow,
    cover_url: coverPhoto ? coverPhoto.url : null,
    photo_count: photos.length,
    manual_count: manuals.length,
    photos,
    manuals
  };
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {
    // ignore cleanup errors
  }
}

async function handleApi(req, res, urlObj) {
  const db = getDb();
  const pathname = urlObj.pathname;
  const method = req.method;

  // Healthcheck
  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  // PUBLIC SHOWCASE ENDPOINT (Read-only gallery link)
  const showcaseMatch = pathname.match(/^\/api\/showcase\/([a-zA-Z0-9_-]+)$/);
  if (showcaseMatch && method === 'GET') {
    const token = showcaseMatch[1];
    const owner = db
      .prepare(
        'SELECT id, username, display_name FROM users WHERE showcase_token = ? AND showcase_enabled = 1 AND disabled = 0'
      )
      .get(token);

    if (!owner) {
      return sendJson(res, 404, { error: 'Public showcase not found or disabled.' });
    }

    const rows = db
      .prepare('SELECT * FROM kits WHERE user_id = ? ORDER BY updated_at DESC, id DESC')
      .all(owner.id);
    const kits = rows.map((r) => hydrateKit(r, db, token));

    return sendJson(res, 200, {
      owner: {
        username: owner.username,
        displayName: owner.display_name
      },
      kits
    });
  }

  // Serve files when accessed either by authenticated user OR valid showcase token
  if (pathname.startsWith('/api/files/photos/') && method === 'GET') {
    const filename = path.basename(decodeURIComponent(pathname.replace('/api/files/photos/', '')));
    const photoRow = db
      .prepare('SELECT filename, mime_type, user_id FROM kit_photos WHERE filename = ?')
      .get(filename);
    if (!photoRow) {
      return sendJson(res, 404, { error: 'Photo not found.' });
    }

    const currentUser = getAuthenticatedUser(req);
    const showcaseToken = urlObj.searchParams.get('showcase') || '';
    let authorized =
      currentUser && (photoRow.user_id === currentUser.id || currentUser.role === 'admin');

    if (!authorized && showcaseToken) {
      const showcaseOwner = db
        .prepare(
          'SELECT id FROM users WHERE id = ? AND showcase_token = ? AND showcase_enabled = 1 AND disabled = 0'
        )
        .get(photoRow.user_id, showcaseToken);
      if (showcaseOwner) authorized = true;
    }

    if (!authorized) {
      return sendJson(res, 404, { error: 'Photo not found.' });
    }

    const filePath = path.join(PHOTOS_DIR, photoRow.filename);
    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: 'Photo file missing on disk.' });
    }
    const ext = path.extname(photoRow.filename).toLowerCase();
    res.writeHead(200, {
      'Content-Type': photoRow.mime_type || MIME_TYPES[ext] || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (pathname.startsWith('/api/files/manuals/') && method === 'GET') {
    const filename = path.basename(
      decodeURIComponent(pathname.replace('/api/files/manuals/', ''))
    );
    const manualRow = db
      .prepare(
        'SELECT filename, original_name, mime_type, user_id FROM kit_manuals WHERE filename = ?'
      )
      .get(filename);
    if (!manualRow) {
      return sendJson(res, 404, { error: 'Manual not found.' });
    }

    const currentUser = getAuthenticatedUser(req);
    const showcaseToken = urlObj.searchParams.get('showcase') || '';
    let authorized =
      currentUser && (manualRow.user_id === currentUser.id || currentUser.role === 'admin');

    if (!authorized && showcaseToken) {
      const showcaseOwner = db
        .prepare(
          'SELECT id FROM users WHERE id = ? AND showcase_token = ? AND showcase_enabled = 1 AND disabled = 0'
        )
        .get(manualRow.user_id, showcaseToken);
      if (showcaseOwner) authorized = true;
    }

    if (!authorized) {
      return sendJson(res, 404, { error: 'Manual not found.' });
    }

    const filePath = path.join(MANUALS_DIR, manualRow.filename);
    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: 'Manual file missing on disk.' });
    }
    const ext = path.extname(manualRow.filename).toLowerCase();
    const safeName = manualRow.original_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.writeHead(200, {
      'Content-Type': manualRow.mime_type || MIME_TYPES[ext] || 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Auth status
  if (pathname === '/api/auth/status' && method === 'GET') {
    const userCount = getUserCount();
    const user = getAuthenticatedUser(req);
    return sendJson(res, 200, {
      needsSetup: userCount === 0,
      allowRegistration: isRegistrationAllowed(),
      user: user
        ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            showcaseEnabled: user.showcaseEnabled,
            showcaseToken: user.showcaseToken,
            createdAt: user.createdAt
          }
        : null
    });
  }

  // Register User (First user automatically becomes admin!)
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || username).trim();
    const password = String(body.password || '');

    if (!username || username.length < 2 || username.length > 40) {
      return sendJson(res, 400, { error: 'Username must be between 2 and 40 characters.' });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return sendJson(res, 400, {
        error: 'Username may only contain letters, numbers, dots, hyphens, and underscores.'
      });
    }
    if (!password || password.length < 6) {
      return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
    }

    const existingCount = getUserCount();
    if (existingCount > 0 && !isRegistrationAllowed()) {
      return sendJson(res, 403, {
        error: 'Public registration is currently disabled by the administrator.'
      });
    }

    const duplicate = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (duplicate) {
      return sendJson(res, 409, { error: 'Username is already taken.' });
    }

    // First user is automatically promoted to admin
    const role = existingCount === 0 ? 'admin' : 'user';
    const passwordHash = hashPassword(password);
    const showcaseToken = crypto.randomBytes(12).toString('hex');

    const result = db
      .prepare(
        'INSERT INTO users (username, display_name, password_hash, role, showcase_token) VALUES (?, ?, ?, ?, ?)'
      )
      .run(username, displayName || username, passwordHash, role, showcaseToken);

    const userId = Number(result.lastInsertRowid);
    const session = createSession(userId);

    const cookie = `kc_session=${session.token}; HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`;
    return sendJson(
      res,
      201,
      {
        user: {
          id: userId,
          username,
          displayName: displayName || username,
          role,
          showcaseEnabled: false,
          showcaseToken
        },
        isFirstAdmin: existingCount === 0
      },
      { 'Set-Cookie': cookie }
    );
  }

  // Login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    const userRow = db
      .prepare(
        'SELECT id, username, display_name, password_hash, role, disabled, showcase_enabled, showcase_token FROM users WHERE username = ?'
      )
      .get(username);

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      return sendJson(res, 401, { error: 'Invalid username or password.' });
    }
    if (userRow.disabled) {
      return sendJson(res, 403, { error: 'Your account has been disabled by an administrator.' });
    }

    const session = createSession(userRow.id);
    const cookie = `kc_session=${session.token}; HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`;

    return sendJson(
      res,
      200,
      {
        user: {
          id: userRow.id,
          username: userRow.username,
          displayName: userRow.display_name,
          role: userRow.role,
          showcaseEnabled: Boolean(userRow.showcase_enabled),
          showcaseToken: userRow.showcase_token || ''
        }
      },
      { 'Set-Cookie': cookie }
    );
  }

  // Logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const user = getAuthenticatedUser(req);
    if (user && user.token) {
      deleteSession(user.token);
    }
    const cookie = 'kc_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  // Protected routes below require authentication
  const currentUser = getAuthenticatedUser(req);
  if (!currentUser) {
    return sendJson(res, 401, { error: 'Authentication required.' });
  }

  // Update own password / profile
  if (pathname === '/api/auth/profile' && method === 'PUT') {
    const body = await readJsonBody(req);
    if (body.displayName) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(
        String(body.displayName).trim(),
        currentUser.id
      );
    }
    if (body.newPassword) {
      if (String(body.newPassword).length < 6) {
        return sendJson(res, 400, { error: 'New password must be at least 6 characters.' });
      }
      const newHash = hashPassword(String(body.newPassword));
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, currentUser.id);
    }
    return sendJson(res, 200, { ok: true });
  }

  // Showcase Settings (Enable/Disable or Regenerate Public Showcase Link)
  if (pathname === '/api/showcase/settings' && method === 'PUT') {
    const body = await readJsonBody(req);
    let token = currentUser.showcaseToken;
    if (!token || body.regenerateToken) {
      token = crypto.randomBytes(12).toString('hex');
    }
    const enabled =
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : currentUser.showcaseEnabled ? 1 : 0;

    db.prepare('UPDATE users SET showcase_enabled = ?, showcase_token = ? WHERE id = ?').run(
      enabled,
      token,
      currentUser.id
    );

    return sendJson(res, 200, {
      showcaseEnabled: Boolean(enabled),
      showcaseToken: token
    });
  }

  // BACKUP & RESTORE (Idea 6: Full Backup with Base64-encoded Stance Photos & Manuals, or CSV/JSON Import)
  if (pathname === '/api/backup/export' && method === 'GET') {
    const includeMedia = urlObj.searchParams.get('media') !== 'false';
    const kits = db
      .prepare('SELECT * FROM kits WHERE user_id = ? ORDER BY id ASC')
      .all(currentUser.id);

    const exportedKits = kits.map((k) => {
      const photos = db
        .prepare('SELECT * FROM kit_photos WHERE kit_id = ? ORDER BY id ASC')
        .all(k.id)
        .map((p) => {
          let dataBase64 = null;
          if (includeMedia && p.filename) {
            const fp = path.join(PHOTOS_DIR, p.filename);
            if (fs.existsSync(fp)) {
              dataBase64 = fs.readFileSync(fp).toString('base64');
            }
          }
          return {
            original_name: p.original_name,
            mime_type: p.mime_type,
            stance_name: p.stance_name,
            caption: p.caption,
            is_cover: p.is_cover,
            data_base64: dataBase64
          };
        });

      const manuals = db
        .prepare('SELECT * FROM kit_manuals WHERE kit_id = ? ORDER BY id ASC')
        .all(k.id)
        .map((m) => {
          let dataBase64 = null;
          if (includeMedia && m.filename) {
            const mp = path.join(MANUALS_DIR, m.filename);
            if (fs.existsSync(mp)) {
              dataBase64 = fs.readFileSync(mp).toString('base64');
            }
          }
          return {
            title: m.title,
            original_name: m.original_name,
            mime_type: m.mime_type,
            external_url: m.external_url,
            notes: m.notes,
            data_base64: dataBase64
          };
        });

      const { id, user_id, cover_photo_id, ...kitFields } = k;
      return {
        ...kitFields,
        photos,
        manuals
      };
    });

    return sendJson(res, 200, {
      version: '1.1',
      exported_at: new Date().toISOString(),
      user: currentUser.username,
      kit_count: exportedKits.length,
      kits: exportedKits
    });
  }

  if (pathname === '/api/backup/import' && method === 'POST') {
    const body = await readJsonBody(req, 150 * 1024 * 1024);
    const items = Array.isArray(body.kits) ? body.kits : [];
    if (!items.length) {
      return sendJson(res, 400, { error: 'No kits found in import payload.' });
    }

    let importedCount = 0;
    let photosRestored = 0;
    let manualsRestored = 0;

    for (const item of items) {
      const name = String(item.name || '').trim();
      if (!name) continue;

      const collectionType = VALID_COLLECTION_TYPES.includes(item.collection_type)
        ? item.collection_type
        : 'owned';
      const status = VALID_STATUSES.includes(item.status)
        ? item.status
        : collectionType === 'wishlist'
          ? 'wishlist'
          : 'backlog';
      const priority = VALID_PRIORITIES.includes(item.priority) ? item.priority : 'medium';
      const price =
        item.price !== undefined && item.price !== '' && item.price !== null
          ? Number(item.price)
          : null;
      const retailPrice =
        item.retail_price !== undefined && item.retail_price !== '' && item.retail_price !== null
          ? Number(item.retail_price)
          : null;
      const rating =
        item.rating !== undefined && item.rating !== '' && item.rating !== null
          ? Math.min(5, Math.max(1, Number(item.rating)))
          : null;

      const resKit = db
        .prepare(
          `INSERT INTO kits (
            user_id, name, category, brand, series, grade_scale, model_number,
            collection_type, status, priority, price, retail_price, currency,
            purchase_date, release_date, started_date, completed_date, store_url,
            display_location, storage_box, rating, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          currentUser.id,
          name,
          String(item.category || 'Gundam / Gunpla').trim(),
          String(item.brand || '').trim(),
          String(item.series || '').trim(),
          String(item.grade_scale || '').trim(),
          String(item.model_number || '').trim(),
          collectionType,
          status,
          priority,
          Number.isFinite(price) ? price : null,
          Number.isFinite(retailPrice) ? retailPrice : null,
          String(item.currency || 'USD').trim(),
          String(item.purchase_date || '').trim(),
          String(item.release_date || '').trim(),
          String(item.started_date || '').trim(),
          String(item.completed_date || '').trim(),
          String(item.store_url || '').trim(),
          String(item.display_location || '').trim(),
          String(item.storage_box || '').trim(),
          Number.isFinite(rating) ? rating : null,
          String(item.notes || '').trim()
        );

      const newKitId = Number(resKit.lastInsertRowid);
      importedCount++;

      if (Array.isArray(item.photos)) {
        for (const p of item.photos) {
          if (!p.data_base64) continue;
          const buf = Buffer.from(p.data_base64, 'base64');
          const ext = path.extname(p.original_name || '.jpg').toLowerCase() || '.jpg';
          const uniqueName = `kit_${newKitId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
          fs.writeFileSync(path.join(PHOTOS_DIR, uniqueName), buf);
          db.prepare(
            `INSERT INTO kit_photos (
              kit_id, user_id, filename, original_name, mime_type, file_size, stance_name, caption, is_cover
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            newKitId,
            currentUser.id,
            uniqueName,
            String(p.original_name || 'photo.jpg'),
            String(p.mime_type || 'image/jpeg'),
            buf.length,
            String(p.stance_name || 'Action Pose'),
            String(p.caption || ''),
            p.is_cover ? 1 : 0
          );
          photosRestored++;
        }
      }

      if (Array.isArray(item.manuals)) {
        for (const m of item.manuals) {
          let uniqueName = '';
          let fileSize = 0;
          if (m.data_base64) {
            const buf = Buffer.from(m.data_base64, 'base64');
            const ext = path.extname(m.original_name || '.pdf').toLowerCase() || '.pdf';
            uniqueName = `manual_${newKitId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
            fs.writeFileSync(path.join(MANUALS_DIR, uniqueName), buf);
            fileSize = buf.length;
          }
          if (!uniqueName && !m.external_url) continue;
          db.prepare(
            `INSERT INTO kit_manuals (
              kit_id, user_id, title, filename, original_name, mime_type, file_size, external_url, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            newKitId,
            currentUser.id,
            String(m.title || 'Building Manual'),
            uniqueName,
            String(m.original_name || ''),
            String(m.mime_type || 'application/pdf'),
            fileSize,
            String(m.external_url || ''),
            String(m.notes || '')
          );
          manualsRestored++;
        }
      }
    }

    return sendJson(res, 201, {
      importedCount,
      photosRestored,
      manualsRestored
    });
  }

  // KIT CRUD
  // GET /api/kits - List all kits for current user + summary stats
  if (pathname === '/api/kits' && method === 'GET') {
    const rows = db
      .prepare('SELECT * FROM kits WHERE user_id = ? ORDER BY updated_at DESC, id DESC')
      .all(currentUser.id);
    const kits = rows.map((r) => hydrateKit(r, db));
    return sendJson(res, 200, { kits });
  }

  // POST /api/kits - Create a new kit
  if (pathname === '/api/kits' && method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) {
      return sendJson(res, 400, { error: 'Kit name is required.' });
    }

    const collectionType = VALID_COLLECTION_TYPES.includes(body.collection_type)
      ? body.collection_type
      : 'owned';
    let status = VALID_STATUSES.includes(body.status) ? body.status : 'backlog';
    if (collectionType === 'wishlist' && !body.status) {
      status = 'wishlist';
    } else if (collectionType === 'owned' && status === 'wishlist') {
      status = 'backlog';
    }
    const priority = VALID_PRIORITIES.includes(body.priority) ? body.priority : 'medium';
    const price =
      body.price !== undefined && body.price !== '' && body.price !== null
        ? Number(body.price)
        : null;
    const retailPrice =
      body.retail_price !== undefined && body.retail_price !== '' && body.retail_price !== null
        ? Number(body.retail_price)
        : null;
    const rating =
      body.rating !== undefined && body.rating !== '' && body.rating !== null
        ? Math.min(5, Math.max(1, Number(body.rating)))
        : null;

    const result = db
      .prepare(
        `INSERT INTO kits (
          user_id, name, category, brand, series, grade_scale, model_number,
          collection_type, status, priority, price, retail_price, currency,
          purchase_date, release_date, started_date, completed_date, store_url,
          display_location, storage_box, rating, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        currentUser.id,
        name,
        String(body.category || 'Gundam / Gunpla').trim(),
        String(body.brand || '').trim(),
        String(body.series || '').trim(),
        String(body.grade_scale || '').trim(),
        String(body.model_number || '').trim(),
        collectionType,
        status,
        priority,
        Number.isFinite(price) ? price : null,
        Number.isFinite(retailPrice) ? retailPrice : null,
        String(body.currency || 'USD').trim(),
        String(body.purchase_date || '').trim(),
        String(body.release_date || '').trim(),
        String(body.started_date || '').trim(),
        String(body.completed_date || '').trim(),
        String(body.store_url || '').trim(),
        String(body.display_location || '').trim(),
        String(body.storage_box || '').trim(),
        Number.isFinite(rating) ? rating : null,
        String(body.notes || '').trim()
      );

    const newId = Number(result.lastInsertRowid);

    // Auto-crawl title / box art image from the web if enabled (default: true) and no cover was uploaded yet
    const autoCrawl = body.auto_crawl_image !== false && body.auto_crawl_image !== 'false';
    if (autoCrawl) {
      const searchTerms = [body.brand, body.grade_scale, name, body.model_number]
        .filter(Boolean)
        .join(' ')
        .trim();
      // Run crawl and attach as cover
      await autoCrawlCoverImage(newId, currentUser.id, searchTerms || name);
    }

    const kitRow = db.prepare('SELECT * FROM kits WHERE id = ?').get(newId);
    return sendJson(res, 201, { kit: hydrateKit(kitRow, db) });
  }

  // Match /api/kits/:id
  const kitMatch = pathname.match(/^\/api\/kits\/(\d+)$/);
  if (kitMatch) {
    const kitId = Number(kitMatch[1]);
    const existing = db
      .prepare('SELECT * FROM kits WHERE id = ? AND user_id = ?')
      .get(kitId, currentUser.id);
    if (!existing) {
      return sendJson(res, 404, { error: 'Kit not found.' });
    }

    if (method === 'GET') {
      return sendJson(res, 200, { kit: hydrateKit(existing, db) });
    }

    if (method === 'PUT') {
      const body = await readJsonBody(req);
      const name = body.name !== undefined ? String(body.name).trim() : existing.name;
      if (!name) {
        return sendJson(res, 400, { error: 'Kit name cannot be empty.' });
      }

      const collectionType = VALID_COLLECTION_TYPES.includes(body.collection_type)
        ? body.collection_type
        : existing.collection_type;
      let status = VALID_STATUSES.includes(body.status) ? body.status : existing.status;

      // Auto-adjust status when moving between wishlist and owned if status wasn't explicitly changed
      if (
        collectionType === 'owned' &&
        existing.collection_type === 'wishlist' &&
        status === 'wishlist'
      ) {
        status = 'backlog';
      } else if (
        collectionType === 'wishlist' &&
        existing.collection_type === 'owned' &&
        body.status === undefined
      ) {
        status = 'wishlist';
      }

      const priority = VALID_PRIORITIES.includes(body.priority)
        ? body.priority
        : existing.priority;
      const price =
        body.price !== undefined
          ? body.price === '' || body.price === null
            ? null
            : Number(body.price)
          : existing.price;
      const retailPrice =
        body.retail_price !== undefined
          ? body.retail_price === '' || body.retail_price === null
            ? null
            : Number(body.retail_price)
          : existing.retail_price;
      const rating =
        body.rating !== undefined
          ? body.rating === '' || body.rating === null
            ? null
            : Math.min(5, Math.max(1, Number(body.rating)))
          : existing.rating;

      db.prepare(
        `UPDATE kits SET
          name = ?, category = ?, brand = ?, series = ?, grade_scale = ?, model_number = ?,
          collection_type = ?, status = ?, priority = ?, price = ?, retail_price = ?, currency = ?,
          purchase_date = ?, release_date = ?, started_date = ?, completed_date = ?, store_url = ?,
          display_location = ?, storage_box = ?, rating = ?, notes = ?,
          updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`
      ).run(
        name,
        body.category !== undefined ? String(body.category).trim() : existing.category,
        body.brand !== undefined ? String(body.brand).trim() : existing.brand,
        body.series !== undefined ? String(body.series).trim() : existing.series,
        body.grade_scale !== undefined ? String(body.grade_scale).trim() : existing.grade_scale,
        body.model_number !== undefined ? String(body.model_number).trim() : existing.model_number,
        collectionType,
        status,
        priority,
        Number.isFinite(price) ? price : null,
        Number.isFinite(retailPrice) ? retailPrice : null,
        body.currency !== undefined ? String(body.currency).trim() : existing.currency,
        body.purchase_date !== undefined
          ? String(body.purchase_date).trim()
          : existing.purchase_date,
        body.release_date !== undefined
          ? String(body.release_date).trim()
          : existing.release_date,
        body.started_date !== undefined ? String(body.started_date).trim() : existing.started_date,
        body.completed_date !== undefined
          ? String(body.completed_date).trim()
          : existing.completed_date,
        body.store_url !== undefined ? String(body.store_url).trim() : existing.store_url,
        body.display_location !== undefined
          ? String(body.display_location).trim()
          : existing.display_location,
        body.storage_box !== undefined ? String(body.storage_box).trim() : existing.storage_box,
        Number.isFinite(rating) ? rating : null,
        body.notes !== undefined ? String(body.notes).trim() : existing.notes,
        kitId,
        currentUser.id
      );

      const updated = db.prepare('SELECT * FROM kits WHERE id = ?').get(kitId);
      return sendJson(res, 200, { kit: hydrateKit(updated, db) });
    }

    if (method === 'DELETE') {
      const photos = db.prepare('SELECT filename FROM kit_photos WHERE kit_id = ?').all(kitId);
      const manuals = db.prepare('SELECT filename FROM kit_manuals WHERE kit_id = ?').all(kitId);

      db.prepare('DELETE FROM kits WHERE id = ? AND user_id = ?').run(kitId, currentUser.id);

      for (const p of photos) {
        if (p.filename) safeUnlink(path.join(PHOTOS_DIR, p.filename));
      }
      for (const m of manuals) {
        if (m.filename) safeUnlink(path.join(MANUALS_DIR, m.filename));
      }

      return sendJson(res, 200, { ok: true });
    }
  }

  // POST /api/kits/:id/photos - Upload one or more stance photos
  const photoUploadMatch = pathname.match(/^\/api\/kits\/(\d+)\/photos$/);
  if (photoUploadMatch && method === 'POST') {
    const kitId = Number(photoUploadMatch[1]);
    const kit = db
      .prepare('SELECT * FROM kits WHERE id = ? AND user_id = ?')
      .get(kitId, currentUser.id);
    if (!kit) {
      return sendJson(res, 404, { error: 'Kit not found.' });
    }

    const { fields, files } = await parseMultipart(req, 50 * 1024 * 1024);
    if (!files.length) {
      return sendJson(res, 400, { error: 'No image file provided.' });
    }

    const stanceName = String(fields.stance_name || 'Action Pose').trim();
    const caption = String(fields.caption || '').trim();
    const makeCover = fields.is_cover === 'true' || fields.is_cover === '1';

    const existingPhotos = db
      .prepare('SELECT COUNT(*) as cnt FROM kit_photos WHERE kit_id = ?')
      .get(kitId);
    let hasCover = existingPhotos && Number(existingPhotos.cnt) > 0 && !makeCover;

    if (makeCover) {
      db.prepare('UPDATE kit_photos SET is_cover = 0 WHERE kit_id = ?').run(kitId);
    }

    const inserted = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = path.extname(f.originalName || '.jpg').toLowerCase() || '.jpg';
      const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
      if (!allowedExts.includes(ext)) {
        return sendJson(res, 400, {
          error: `Unsupported image format (${ext}). Allowed: JPG, PNG, WEBP, GIF, AVIF.`
        });
      }

      const uniqueName = `kit_${kitId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(PHOTOS_DIR, uniqueName), f.buffer);

      const isCoverFlag = (!hasCover && i === 0) || (makeCover && i === 0) ? 1 : 0;
      if (isCoverFlag) hasCover = true;

      const info = db
        .prepare(
          `INSERT INTO kit_photos (
            kit_id, user_id, filename, original_name, mime_type, file_size, stance_name, caption, is_cover
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          kitId,
          currentUser.id,
          uniqueName,
          f.originalName,
          f.mimeType,
          f.size,
          stanceName,
          caption,
          isCoverFlag
        );

      inserted.push(Number(info.lastInsertRowid));
    }

    db.prepare("UPDATE kits SET updated_at = datetime('now') WHERE id = ?").run(kitId);
    const updatedKit = db.prepare('SELECT * FROM kits WHERE id = ?').get(kitId);
    return sendJson(res, 201, { kit: hydrateKit(updatedKit, db), inserted });
  }

  // GET /api/images/search?q=... - In-app web image search
  if (pathname === '/api/images/search' && method === 'GET') {
    const q = urlObj.searchParams.get('q') || '';
    if (!q.trim()) {
      return sendJson(res, 200, { results: [] });
    }
    const results = await searchWebImages(q.trim(), 20);
    return sendJson(res, 200, { results });
  }

  // POST /api/kits/:id/photos/from-url - Attach web image to kit
  const photoUrlMatch = pathname.match(/^\/api\/kits\/(\d+)\/photos\/from-url$/);
  if (photoUrlMatch && method === 'POST') {
    const kitId = Number(photoUrlMatch[1]);
    const body = await readJsonBody(req);
    const imageUrl = String(body.image_url || '').trim();
    if (!imageUrl) {
      return sendJson(res, 400, { error: 'Image URL is required' });
    }
    try {
      const attached = await attachImageFromUrl(kitId, currentUser.id, imageUrl, {
        stanceName: String(body.stance_name || 'Cover / Box Art').trim(),
        caption: String(body.caption || 'Web search import').trim(),
        isCover: body.is_cover !== false
      });
      const updatedKit = db.prepare('SELECT * FROM kits WHERE id = ?').get(kitId);
      return sendJson(res, 201, { kit: hydrateKit(updatedKit, db), attached });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Failed to attach image from URL' });
    }
  }

  // PUT or DELETE /api/photos/:photoId - Update stance/caption/cover or delete photo
  const photoItemMatch = pathname.match(/^\/api\/photos\/(\d+)$/);
  if (photoItemMatch) {
    const photoId = Number(photoItemMatch[1]);
    const photo = db
      .prepare('SELECT * FROM kit_photos WHERE id = ? AND user_id = ?')
      .get(photoId, currentUser.id);
    if (!photo) {
      return sendJson(res, 404, { error: 'Photo not found.' });
    }

    if (method === 'PUT') {
      const body = await readJsonBody(req);
      const stanceName =
        body.stance_name !== undefined ? String(body.stance_name).trim() : photo.stance_name;
      const caption = body.caption !== undefined ? String(body.caption).trim() : photo.caption;

      if (body.is_cover) {
        db.prepare('UPDATE kit_photos SET is_cover = 0 WHERE kit_id = ?').run(photo.kit_id);
        db.prepare('UPDATE kit_photos SET is_cover = 1 WHERE id = ?').run(photoId);
      }

      db.prepare('UPDATE kit_photos SET stance_name = ?, caption = ? WHERE id = ?').run(
        stanceName,
        caption,
        photoId
      );

      const updatedKit = db.prepare('SELECT * FROM kits WHERE id = ?').get(photo.kit_id);
      return sendJson(res, 200, { kit: hydrateKit(updatedKit, db) });
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM kit_photos WHERE id = ?').run(photoId);
      safeUnlink(path.join(PHOTOS_DIR, photo.filename));

      // If it was cover, assign cover to the next photo
      if (photo.is_cover) {
        const nextPhoto = db
          .prepare('SELECT id FROM kit_photos WHERE kit_id = ? ORDER BY id ASC LIMIT 1')
          .get(photo.kit_id);
        if (nextPhoto) {
          db.prepare('UPDATE kit_photos SET is_cover = 1 WHERE id = ?').run(nextPhoto.id);
        }
      }

      const updatedKit = db.prepare('SELECT * FROM kits WHERE id = ?').get(photo.kit_id);
      return sendJson(res, 200, { kit: hydrateKit(updatedKit, db) });
    }
  }

  // POST /api/kits/:id/manuals - Upload PDF/image manual OR add external manual link
  const manualUploadMatch = pathname.match(/^\/api\/kits\/(\d+)\/manuals$/);
  if (manualUploadMatch && method === 'POST') {
    const kitId = Number(manualUploadMatch[1]);
    const kit = db
      .prepare('SELECT * FROM kits WHERE id = ? AND user_id = ?')
      .get(kitId, currentUser.id);
    if (!kit) {
      return sendJson(res, 404, { error: 'Kit not found.' });
    }

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      const { fields, files } = await parseMultipart(req, 100 * 1024 * 1024);
      const externalUrl = String(fields.external_url || '').trim();
      const notes = String(fields.notes || '').trim();

      if (!files.length && !externalUrl) {
        return sendJson(res, 400, {
          error: 'Provide either a manual file (PDF/Image) or an external manual URL.'
        });
      }

      if (files.length > 0) {
        for (const f of files) {
          const ext = path.extname(f.originalName || '.pdf').toLowerCase() || '.pdf';
          const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
          if (!allowedExts.includes(ext)) {
            return sendJson(res, 400, {
              error: `Unsupported manual format (${ext}). Allowed: PDF, JPG, PNG, WEBP.`
            });
          }

          const uniqueName = `manual_${kitId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
          fs.writeFileSync(path.join(MANUALS_DIR, uniqueName), f.buffer);

          const title = String(fields.title || f.originalName.replace(/\.[^.]+$/, '')).trim();
          db.prepare(
            `INSERT INTO kit_manuals (
              kit_id, user_id, title, filename, original_name, mime_type, file_size, external_url, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            kitId,
            currentUser.id,
            title || 'Building Manual',
            uniqueName,
            f.originalName,
            f.mimeType,
            f.size,
            externalUrl,
            notes
          );
        }
      } else {
        const title = String(fields.title || 'External Building Manual').trim();
        db.prepare(
          `INSERT INTO kit_manuals (
            kit_id, user_id, title, filename, original_name, mime_type, file_size, external_url, notes
          ) VALUES (?, ?, ?, '', '', 'text/uri-list', 0, ?, ?)`
        ).run(kitId, currentUser.id, title, externalUrl, notes);
      }
    } else {
      const body = await readJsonBody(req);
      const title = String(body.title || 'External Manual').trim();
      const externalUrl = String(body.external_url || '').trim();
      const notes = String(body.notes || '').trim();
      if (!externalUrl) {
        return sendJson(res, 400, { error: 'External URL is required.' });
      }
      db.prepare(
        `INSERT INTO kit_manuals (
          kit_id, user_id, title, filename, original_name, mime_type, file_size, external_url, notes
        ) VALUES (?, ?, ?, '', '', 'text/uri-list', 0, ?, ?)`
      ).run(kitId, currentUser.id, title, externalUrl, notes);
    }

    db.prepare("UPDATE kits SET updated_at = datetime('now') WHERE id = ?").run(kitId);
    const updatedKit = db.prepare('SELECT * FROM kits WHERE id = ?').get(kitId);
    return sendJson(res, 201, { kit: hydrateKit(updatedKit, db) });
  }

  // DELETE /api/manuals/:manualId
  const manualItemMatch = pathname.match(/^\/api\/manuals\/(\d+)$/);
  if (manualItemMatch && method === 'DELETE') {
    const manualId = Number(manualItemMatch[1]);
    const manual = db
      .prepare('SELECT * FROM kit_manuals WHERE id = ? AND user_id = ?')
      .get(manualId, currentUser.id);
    if (!manual) {
      return sendJson(res, 404, { error: 'Manual not found.' });
    }

    db.prepare('DELETE FROM kit_manuals WHERE id = ?').run(manualId);
    if (manual.filename) {
      safeUnlink(path.join(MANUALS_DIR, manual.filename));
    }

    const updatedKit = db.prepare('SELECT * FROM kits WHERE id = ?').get(manual.kit_id);
    return sendJson(res, 200, { kit: hydrateKit(updatedKit, db) });
  }

  // ADMIN ENDPOINTS (User Management)
  if (pathname.startsWith('/api/admin/')) {
    if (currentUser.role !== 'admin') {
      return sendJson(res, 403, { error: 'Administrator privileges required.' });
    }

    // GET /api/admin/users - List all users & their kit counts + settings
    if (pathname === '/api/admin/users' && method === 'GET') {
      const users = db
        .prepare(
          `SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at,
            (SELECT COUNT(*) FROM kits k WHERE k.user_id = u.id AND k.collection_type = 'owned') as owned_count,
            (SELECT COUNT(*) FROM kits k WHERE k.user_id = u.id AND k.collection_type = 'wishlist') as wishlist_count,
            (SELECT COUNT(*) FROM kit_photos kp WHERE kp.user_id = u.id) as photo_count,
            (SELECT COUNT(*) FROM kit_manuals km WHERE km.user_id = u.id) as manual_count
           FROM users u
           ORDER BY u.id ASC`
        )
        .all();

      return sendJson(res, 200, {
        users,
        settings: {
          allowRegistration: isRegistrationAllowed()
        }
      });
    }

    // PUT /api/admin/settings - Toggle open registration
    if (pathname === '/api/admin/settings' && method === 'PUT') {
      const body = await readJsonBody(req);
      if (body.allowRegistration !== undefined) {
        setRegistrationAllowed(Boolean(body.allowRegistration));
      }
      return sendJson(res, 200, {
        settings: {
          allowRegistration: isRegistrationAllowed()
        }
      });
    }

    // POST /api/admin/users - Admin creates a new user directly
    if (pathname === '/api/admin/users' && method === 'POST') {
      const body = await readJsonBody(req);
      const username = String(body.username || '').trim();
      const displayName = String(body.displayName || username).trim();
      const password = String(body.password || '');
      const role = body.role === 'admin' ? 'admin' : 'user';

      if (!username || username.length < 2) {
        return sendJson(res, 400, { error: 'Username must be at least 2 characters.' });
      }
      if (!password || password.length < 6) {
        return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
      }
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return sendJson(res, 409, { error: 'Username already exists.' });
      }

      const passwordHash = hashPassword(password);
      const showcaseToken = crypto.randomBytes(12).toString('hex');
      const result = db
        .prepare(
          'INSERT INTO users (username, display_name, password_hash, role, showcase_token) VALUES (?, ?, ?, ?, ?)'
        )
        .run(username, displayName, passwordHash, role, showcaseToken);

      return sendJson(res, 201, {
        user: {
          id: Number(result.lastInsertRowid),
          username,
          display_name: displayName,
          role,
          disabled: 0
        }
      });
    }

    // PUT or DELETE /api/admin/users/:id
    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (adminUserMatch) {
      const targetUserId = Number(adminUserMatch[1]);
      const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
      if (!targetUser) {
        return sendJson(res, 404, { error: 'User not found.' });
      }

      if (method === 'PUT') {
        const body = await readJsonBody(req);

        // Prevent demoting or disabling the last active admin
        const activeAdmins = db
          .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND disabled = 0")
          .get();
        const isLastAdmin =
          targetUser.role === 'admin' &&
          !targetUser.disabled &&
          Number(activeAdmins.cnt) <= 1;

        if (isLastAdmin && (body.role === 'user' || body.disabled === true)) {
          return sendJson(res, 400, {
            error: 'Cannot demote or disable the last active administrator.'
          });
        }

        const newRole =
          body.role !== undefined ? (body.role === 'admin' ? 'admin' : 'user') : targetUser.role;
        const newDisabled =
          body.disabled !== undefined ? (body.disabled ? 1 : 0) : targetUser.disabled;
        const newDisplayName =
          body.displayName !== undefined
            ? String(body.displayName).trim()
            : targetUser.display_name;

        db.prepare('UPDATE users SET role = ?, disabled = ?, display_name = ? WHERE id = ?').run(
          newRole,
          newDisabled,
          newDisplayName,
          targetUserId
        );

        if (body.newPassword) {
          if (String(body.newPassword).length < 6) {
            return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
          }
          db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
            hashPassword(String(body.newPassword)),
            targetUserId
          );
        }

        if (newDisabled) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
        }

        return sendJson(res, 200, { ok: true });
      }

      if (method === 'DELETE') {
        if (targetUserId === currentUser.id) {
          return sendJson(res, 400, { error: 'You cannot delete your own active account.' });
        }

        const photos = db
          .prepare('SELECT filename FROM kit_photos WHERE user_id = ?')
          .all(targetUserId);
        const manuals = db
          .prepare('SELECT filename FROM kit_manuals WHERE user_id = ?')
          .all(targetUserId);

        db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);

        for (const p of photos) {
          if (p.filename) safeUnlink(path.join(PHOTOS_DIR, p.filename));
        }
        for (const m of manuals) {
          if (m.filename) safeUnlink(path.join(MANUALS_DIR, m.filename));
        }

        return sendJson(res, 200, { ok: true });
      }
    }
  }

  return sendJson(res, 404, { error: 'API endpoint not found.' });
}

function serveStatic(req, res, urlObj) {
  let reqPath = urlObj.pathname === '/' ? '/index.html' : urlObj.pathname;
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    // Always revalidate so UI updates are picked up immediately
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (urlObj.pathname.startsWith('/api/')) {
      await handleApi(req, res, urlObj);
    } else {
      serveStatic(req, res, urlObj);
    }
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message || 'Internal server error' });
    }
  }
});

if (require.main === module) {
  getDb(); // Initialize DB on boot
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`  KitCatalogue Server listening on port ${PORT}`);
    console.log(`  URL: http://0.0.0.0:${PORT}`);
    console.log(`=================================================`);
  });
}

module.exports = { server };
