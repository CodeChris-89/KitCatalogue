const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'uploads', 'photos');
const MANUALS_DIR = path.join(DATA_DIR, 'uploads', 'manuals');

function ensureDirs() {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  fs.mkdirSync(MANUALS_DIR, { recursive: true });
}

let dbInstance = null;

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function getDb() {
  if (dbInstance) return dbInstance;
  ensureDirs();
  const dbPath = path.join(DATA_DIR, 'kitcatalogue.db');
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_registration', 'true');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('app_tagline', 'Model Hangar');

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      showcase_enabled INTEGER NOT NULL DEFAULT 0,
      showcase_token TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Gundam / Gunpla',
      brand TEXT NOT NULL DEFAULT '',
      series TEXT NOT NULL DEFAULT '',
      grade_scale TEXT NOT NULL DEFAULT '',
      model_number TEXT NOT NULL DEFAULT '',
      collection_type TEXT NOT NULL DEFAULT 'owned' CHECK (collection_type IN ('owned', 'wishlist')),
      status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'building', 'panel_lining', 'painting', 'finished', 'on_hold', 'wishlist')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      price REAL,
      retail_price REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      purchase_date TEXT NOT NULL DEFAULT '',
      release_date TEXT NOT NULL DEFAULT '',
      started_date TEXT NOT NULL DEFAULT '',
      completed_date TEXT NOT NULL DEFAULT '',
      store_url TEXT NOT NULL DEFAULT '',
      display_location TEXT NOT NULL DEFAULT '',
      storage_box TEXT NOT NULL DEFAULT '',
      rating INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      cover_photo_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kit_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kit_id INTEGER NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      stance_name TEXT NOT NULL DEFAULT 'Front / Standard',
      caption TEXT NOT NULL DEFAULT '',
      is_cover INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kit_manuals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kit_id INTEGER NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      external_url TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_kits_user ON kits(user_id);
    CREATE INDEX IF NOT EXISTS idx_photos_kit ON kit_photos(kit_id);
    CREATE INDEX IF NOT EXISTS idx_manuals_kit ON kit_manuals(kit_id);
  `);

  // Safe schema migrations for existing databases
  ensureColumn(db, 'users', 'showcase_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'showcase_token', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'kits', 'display_location', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'kits', 'storage_box', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'kits', 'retail_price', 'REAL');
  ensureColumn(db, 'kits', 'release_date', "TEXT NOT NULL DEFAULT ''");

  dbInstance = db;
  return db;
}

module.exports = {
  getDb,
  DATA_DIR,
  PHOTOS_DIR,
  MANUALS_DIR,
  ensureDirs
};
