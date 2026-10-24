const { getDb } = require('./db');
const { encryptSecret, decryptSecret, maskApiKey } = require('./crypto');
const { isSafeUrl, USER_AGENT, searchWebImages } = require('./websearch');

const PROVIDER_DEFAULTS = {
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash'
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  anthropic: {
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-latest'
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash'
  },
  custom: {
    name: 'Custom (OpenAI-Compatible)',
    baseUrl: '',
    model: ''
  }
};

/**
 * Built-in curated index of popular Building Kits across categories (Gunpla, Moshow, Book Nooks, Zoids, etc.)
 * Provides instant matches and fallback metadata even when offline or behind restricted firewalls.
 */
const CURATED_KITS = [
  {
    name: 'MGEX 1/100 Strike Freedom Gundam',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'MGEX 1/100',
    series: 'Mobile Suit Gundam SEED Destiny',
    modelNumber: 'ZGMF-X20A',
    releaseDate: '2022-11-19',
    retailPrice: 15400,
    currency: 'JPY',
    notes: 'Master Grade Extreme featuring multi-metallic inner frame with gold-plated, copper-plated, and etched parts.'
  },
  {
    name: 'PG Unleashed 1/60 RX-78-2 Gundam',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'PG Unleashed 1/60',
    series: 'Mobile Suit Gundam (0079)',
    modelNumber: 'RX-78-2',
    releaseDate: '2020-12-19',
    retailPrice: 27500,
    currency: 'JPY',
    notes: 'Gunpla 40th Anniversary flagship kit with phased truss frame, chrome parts, aluminum thrusters, and LED saber/head unit.'
  },
  {
    name: 'RG 1/144 RX-78-2 Gundam Ver. 2.0',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'RG 1/144',
    series: 'Mobile Suit Gundam (0079)',
    modelNumber: 'RX-78-2',
    releaseDate: '2024-08-10',
    retailPrice: 3850,
    currency: 'JPY',
    notes: 'Completely redesigned Real Grade 2.0 with internal frame engineering and core fighter integration.'
  },
  {
    name: 'RG 1/144 Hi-Nu Gundam',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'RG 1/144',
    series: "Mobile Suit Gundam: Char's Counterattack - Beltorchika's Children",
    modelNumber: 'RX-93-v2',
    releaseDate: '2021-09-11',
    retailPrice: 4950,
    currency: 'JPY',
    notes: 'Multi-link armor gimmick with gold and silver injection parts and fully articulated Fin Funnels.'
  },
  {
    name: 'RG 1/144 Nu Gundam',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'RG 1/144',
    series: "Mobile Suit Gundam: Char's Counterattack",
    modelNumber: 'RX-93',
    releaseDate: '2019-08-10',
    retailPrice: 4620,
    currency: 'JPY',
    notes: 'Real Grade Amuro Ray mobile suit with articulated Fin Funnels and shoulder/waist armor expansion.'
  },
  {
    name: 'RG 1/144 Sazabi',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'RG 1/144',
    series: "Mobile Suit Gundam: Char's Counterattack",
    modelNumber: 'MSN-04',
    releaseDate: '2018-08-11',
    retailPrice: 4950,
    currency: 'JPY',
    notes: 'Massive 1/144 scale Char Aznable mobile suit with opening maintenance hatches and funnel rack.'
  },
  {
    name: 'MG 1/100 Barbatos Gundam',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'MG 1/100',
    series: 'Mobile Suit Gundam: Iron-Blooded Orphans',
    modelNumber: 'ASW-G-08',
    releaseDate: '2019-12-14',
    retailPrice: 4950,
    currency: 'JPY',
    notes: 'Features full Gundam Frame inner structure with hydraulic cylinder pistons, Mace, Katana, and 300mm Smoothbore Gun.'
  },
  {
    name: 'MGSD Gundam Barbatos',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'SD / MGSD',
    series: 'Mobile Suit Gundam: Iron-Blooded Orphans',
    modelNumber: 'ASW-G-08',
    releaseDate: '2023-10-21',
    retailPrice: 4290,
    currency: 'JPY',
    notes: 'Master Grade SD line combining SD proportions with Master Grade internal frame articulation.'
  },
  {
    name: 'MGSD Freedom Gundam',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'SD / MGSD',
    series: 'Mobile Suit Gundam SEED',
    modelNumber: 'ZGMF-X10A',
    releaseDate: '2023-01-21',
    retailPrice: 4290,
    currency: 'JPY',
    notes: 'First entry in the MGSD series with Real Metallic Gloss Injection and clear reflection cut eyes.'
  },
  {
    name: 'MGSD Wing Gundam Zero EW',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'SD / MGSD',
    series: 'Mobile Suit Gundam Wing: Endless Waltz',
    modelNumber: 'XXXG-00W0',
    releaseDate: '2024-11-30',
    retailPrice: 4950,
    currency: 'JPY',
    notes: 'MGSD Wing Zero EW featuring articulated angel wing binders, Twin Buster Rifle, and atmospheric re-entry mode.'
  },
  {
    name: 'HG 1/144 Gundam Calibarn',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'HG 1/144',
    series: 'Mobile Suit Gundam: The Witch from Mercury',
    modelNumber: 'X-EX01',
    releaseDate: '2023-07-15',
    retailPrice: 2200,
    currency: 'JPY',
    notes: 'Includes iridescent in-mold rainbow Permet Score shell units and Variable Rod Rifle.'
  },
  {
    name: 'HG 1/144 Gundam Aerial',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'HG 1/144',
    series: 'Mobile Suit Gundam: The Witch from Mercury',
    modelNumber: 'XVX-016',
    releaseDate: '2022-10-01',
    retailPrice: 1430,
    currency: 'JPY',
    notes: 'Features double-side printed shell units and Escutcheon shield that separates into 11 Bit Staves.'
  },
  {
    name: 'HG 1/144 Mighty Strike Freedom Gundam',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'HG 1/144',
    series: 'Mobile Suit Gundam SEED Freedom',
    modelNumber: 'ZGMF/A-262PD-P',
    releaseDate: '2024-05-25',
    retailPrice: 2970,
    currency: 'JPY',
    notes: 'SEED Action System articulation with Proud Defender wing unit and Futsunomitama physical katana.'
  },
  {
    name: 'MG 1/100 Narrative Gundam C-Packs Ver.Ka',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'MG 1/100',
    series: 'Mobile Suit Gundam Narrative',
    modelNumber: 'RX-9/C',
    releaseDate: '2024-04-27',
    retailPrice: 7700,
    currency: 'JPY',
    notes: 'Hajime Katoki Ver.Ka release with dual-color Psycho-Frame parts (clear pink and unactivated gray).'
  },
  {
    name: 'MG 1/100 Zeta Gundam Ver.Ka',
    category: 'Gundam / Gunpla',
    brand: 'Bandai Spirits',
    gradeScale: 'MG 1/100',
    series: 'Mobile Suit Zeta Gundam',
    modelNumber: 'MSZ-006',
    releaseDate: '2023-04-29',
    retailPrice: 7150,
    currency: 'JPY',
    notes: 'Anime-accurate proportions with lock-assisted Wave Rider transformation.'
  },
  {
    name: 'Moshow Toys 1/72 Takeda Shingen (MCT-J02)',
    category: 'Moshow Toys / Mecha',
    brand: 'Moshow Toys',
    gradeScale: '1/72 Progenitor Effect',
    series: 'Progenitor Effect',
    modelNumber: 'MCT-J02',
    releaseDate: '2022-01-15',
    retailPrice: 135,
    currency: 'USD',
    notes: 'Progenitor Effect die-cast alloy frame mecha figure/kit with LED head/chest and samurai katana.'
  },
  {
    name: 'Moshow Toys 1/72 Date Masamune Bontenmaru (MCT-J03)',
    category: 'Moshow Toys / Mecha',
    brand: 'Moshow Toys',
    gradeScale: '1/72 Progenitor Effect',
    series: 'Progenitor Effect',
    modelNumber: 'MCT-J03',
    releaseDate: '2022-08-01',
    retailPrice: 140,
    currency: 'USD',
    notes: 'Dual flintlock cannons, six samurai swords, and LED illuminated visor.'
  },
  {
    name: 'Moshow Toys 1/72 Lancelot of the Lake (MCT-E02)',
    category: 'Moshow Toys / Mecha',
    brand: 'Moshow Toys',
    gradeScale: '1/72 Progenitor Effect',
    series: 'Progenitor Effect',
    modelNumber: 'MCT-E02',
    releaseDate: '2023-09-01',
    retailPrice: 145,
    currency: 'USD',
    notes: 'Knight-themed mecha with royal lance, shield, cape, and LED effects.'
  },
  {
    name: 'Rolife Sakura Densya Book Nook (TGB01)',
    category: 'Book Nook / Diorama',
    brand: 'Rolife / Robotime',
    gradeScale: 'Book Nook Standard',
    series: 'Rolife Time Travel / Street Scene',
    modelNumber: 'TGB01',
    releaseDate: '2022-05-01',
    retailPrice: 44.99,
    currency: 'USD',
    notes: '340-piece wooden miniature Tokyo spring tram & cherry blossom street bookshelf insert with touch LED lighting.'
  },
  {
    name: 'Rolife Sunshine Town Book Nook (TGB02)',
    category: 'Book Nook / Diorama',
    brand: 'Rolife / Robotime',
    gradeScale: 'Book Nook Standard',
    series: 'Rolife Street Scene',
    modelNumber: 'TGB02',
    releaseDate: '2022-06-01',
    retailPrice: 44.99,
    currency: 'USD',
    notes: '246-piece European café & bookshop alleyway miniature book nook with warm LED lights.'
  },
  {
    name: 'Rolife Magic House Book Nook (TGB03)',
    category: 'Book Nook / Diorama',
    brand: 'Rolife / Robotime',
    gradeScale: 'Book Nook Standard',
    series: 'Rolife Fantasy Alley',
    modelNumber: 'TGB03',
    releaseDate: '2022-07-01',
    retailPrice: 44.99,
    currency: 'USD',
    notes: '216-piece wizard alley diorama insert with LED illumination.'
  },
  {
    name: 'Rolife Bookstore Book Nook (TGB07)',
    category: 'Book Nook / Diorama',
    brand: 'Rolife / Robotime',
    gradeScale: 'Book Nook Standard',
    series: 'Rolife Classic',
    modelNumber: 'TGB07',
    releaseDate: '2023-06-01',
    retailPrice: 42.99,
    currency: 'USD',
    notes: 'Shakespeare & Co. inspired vintage bookstore shelf insert with LED chandelier.'
  },
  {
    name: 'Kotobukiya HMM 1/72 Liger Zero Marking Plus Ver.',
    category: 'Zoids / Kotobukiya',
    brand: 'Kotobukiya',
    gradeScale: '1/72',
    series: 'Zoids Highend Master Model (HMM)',
    modelNumber: 'RZ-041',
    releaseDate: '2019-04-25',
    retailPrice: 6930,
    currency: 'JPY',
    notes: 'Features removable Changing Armor System (CAS) and comprehensive water-slide decal sheet.'
  },
  {
    name: 'In Era+ 1/100 Ruling Type 01 Mecha',
    category: 'Moshow Toys / Mecha',
    brand: 'In Era+ / Infinite Dimension',
    gradeScale: 'MG 1/100',
    series: 'Realminfinity Series',
    modelNumber: 'RMD-01',
    releaseDate: '2023-02-01',
    retailPrice: 89.99,
    currency: 'USD',
    notes: 'Pre-assembled die-cast metal inner frame with heavy backpack cannon system and water slides.'
  }
];

/**
 * Returns the authenticated user's AI configuration with masked API key (safe for frontend).
 */
function getUserAiConfigPublic(userId) {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT provider, api_key_encrypted, base_url, model, enabled, updated_at FROM user_ai_settings WHERE user_id = ?'
    )
    .get(userId);

  if (!row) {
    return {
      provider: 'gemini',
      hasApiKey: false,
      maskedKey: '',
      baseUrl: '',
      model: PROVIDER_DEFAULTS.gemini.model,
      enabled: false,
      providers: PROVIDER_DEFAULTS
    };
  }

  const decryptedKey = decryptSecret(row.api_key_encrypted);
  const provider = PROVIDER_DEFAULTS[row.provider] ? row.provider : 'gemini';

  return {
    provider,
    hasApiKey: Boolean(decryptedKey),
    maskedKey: maskApiKey(decryptedKey),
    baseUrl: row.base_url || '',
    model: row.model || PROVIDER_DEFAULTS[provider].model,
    enabled: Boolean(row.enabled) && Boolean(decryptedKey),
    updatedAt: row.updated_at,
    providers: PROVIDER_DEFAULTS
  };
}

/**
 * Internal helper: retrieves decrypted AI config for a specific userId.
 * NEVER expose the return value of this function over HTTP responses.
 */
function getUserAiConfigInternal(userId) {
  if (!userId) return null;
  const db = getDb();
  const row = db
    .prepare(
      'SELECT provider, api_key_encrypted, base_url, model, enabled FROM user_ai_settings WHERE user_id = ?'
    )
    .get(userId);

  if (!row) return null;
  const apiKey = decryptSecret(row.api_key_encrypted);
  if (!apiKey) return null;

  const provider = PROVIDER_DEFAULTS[row.provider] ? row.provider : 'gemini';
  const defaults = PROVIDER_DEFAULTS[provider];

  return {
    provider,
    apiKey,
    baseUrl: (row.base_url || defaults.baseUrl || '').replace(/\/+$/, ''),
    model: row.model || defaults.model,
    enabled: Boolean(row.enabled)
  };
}

/**
 * Saves or updates a user's personal AI configuration with AES-256-GCM encryption.
 */
function saveUserAiConfig(userId, body = {}) {
  const db = getDb();
  const existing = db
    .prepare('SELECT provider, api_key_encrypted, base_url, model, enabled FROM user_ai_settings WHERE user_id = ?')
    .get(userId);

  const provider = PROVIDER_DEFAULTS[body.provider]
    ? body.provider
    : existing?.provider || 'gemini';

  let encryptedKey = existing?.api_key_encrypted || '';
  if (body.clearApiKey) {
    encryptedKey = '';
  } else if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
    encryptedKey = encryptSecret(body.apiKey.trim());
  }

  const baseUrl =
    body.baseUrl !== undefined ? String(body.baseUrl).trim() : existing?.base_url || '';
  const model =
    body.model !== undefined
      ? String(body.model).trim()
      : existing?.model || PROVIDER_DEFAULTS[provider].model;
  const enabled =
    body.enabled !== undefined
      ? body.enabled
        ? 1
        : 0
      : existing
        ? existing.enabled
        : 1;

  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Base URL must use http:// or https://');
      }
    } catch (_) {
      throw new Error('Invalid custom provider Base URL');
    }
  }

  db.prepare(
    `INSERT INTO user_ai_settings (user_id, provider, api_key_encrypted, base_url, model, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       provider = excluded.provider,
       api_key_encrypted = excluded.api_key_encrypted,
       base_url = excluded.base_url,
       model = excluded.model,
       enabled = excluded.enabled,
       updated_at = datetime('now')`
  ).run(userId, provider, encryptedKey, baseUrl, model, enabled);

  return getUserAiConfigPublic(userId);
}

/**
 * Heuristic parser that extracts structured kit attributes from freeform text, titles, and snippets.
 */
function parseKitMetadataFromText(rawTitle = '', rawSnippet = '', sourceUrl = '', extra = {}) {
  const combined = `${rawTitle} ${rawSnippet}`.replace(/\s+/g, ' ').trim();

  // 1. Clean Kit Name
  let name = String(rawTitle || '')
    .replace(/\s*[|\-–—]\s*(HobbyLink Japan|HLJ\.com|Scalemates|Gundam Wiki|Fandom|Newtype|USA Gundam Store|Amazon\.com|Bandai Hobby Site|MyFigureCollection|BigBadToyStore|PlazaJapan).*$/i, '')
    .replace(/^(Amazon\.com\s*:\s*|Buy\s+)/i, '')
    .trim();

  // 2. Detect Grade / Scale
  let gradeScale = extra.gradeScale || '';
  if (!gradeScale) {
    const gradePatterns = [
      { re: /\bPG\s*Unleashed\b|\bPGU\b/i, val: 'PG Unleashed 1/60' },
      { re: /\bMGEX\b/i, val: 'MGEX 1/100' },
      { re: /\bMGSD\b/i, val: 'SD / MGSD' },
      { re: /\b(Master Grade|MG)\s*(1\/100)?\b/i, val: 'MG 1/100' },
      { re: /\b(Real Grade|RG)\s*(1\/144)?\b/i, val: 'RG 1/144' },
      { re: /\b(Perfect Grade|PG)\s*(1\/60)?\b/i, val: 'PG 1/60' },
      { re: /\b(High Grade|HGUC|HGCE|HGIBO|HGTWFM|HGGTO|HGAC|HGFC|HGBF|HGBD|HG)\s*(1\/144)?\b/i, val: 'HG 1/144' },
      { re: /\b(Full Mechanics|FM)\s*(1\/100)?\b/i, val: 'FM 1/100' },
      { re: /\bRE\/100\b/i, val: 'RE/100' },
      { re: /\b(Entry Grade|EG)\s*(1\/144)?\b/i, val: 'EG 1/144' },
      { re: /\b(SDCS|SDEX|SDW|SD\s+Gundam|BB\s+Senshi)\b/i, val: 'SD / MGSD' },
      { re: /\b30\s*MM\b|\b30\s*Minutes\s*Missions\b/i, val: '30MM 1/144' },
      { re: /\b30\s*MS\b|\b30\s*Minutes\s*Sisters\b/i, val: '30MS Non-Scale' },
      { re: /\b1\/72\b/i, val: '1/72' },
      { re: /\b1\/60\b/i, val: '1/60' },
      { re: /\b1\/100\b/i, val: '1/100' },
      { re: /\b1\/144\b/i, val: '1/144' },
      { re: /\b1\/24\b/i, val: '1/24' },
      { re: /\b1\/35\b/i, val: '1/35' },
      { re: /\b1\/48\b/i, val: '1/48' }
    ];
    for (const gp of gradePatterns) {
      if (gp.re.test(combined)) {
        gradeScale = gp.val;
        break;
      }
    }
  }

  // 3. Detect Brand & Category
  let brand = extra.brand || '';
  let category = extra.category || 'Gundam / Gunpla';

  if (/moshow|progenitor\s+effect|mct-[a-z0-9]+/i.test(combined)) {
    brand = brand || 'Moshow Toys';
    category = 'Moshow Toys / Mecha';
    if (!gradeScale) gradeScale = '1/72 Progenitor Effect';
  } else if (/rolife|robotime|cutebee|tonecheer|book\s*nook|tgb\d+/i.test(combined)) {
    brand = brand || (/cutebee/i.test(combined) ? 'Cutebee' : /tonecheer/i.test(combined) ? 'Tonecheer' : 'Rolife / Robotime');
    category = 'Book Nook / Diorama';
    if (!gradeScale) gradeScale = 'Book Nook Standard';
  } else if (/30\s*minutes\s*(missions|sisters|fantasy)|\b30mm\b|\b30ms\b|\b30mf\b/i.test(combined)) {
    brand = brand || 'Bandai Spirits';
    category = '30 Minutes Missions / Sisters';
  } else if (/zoids|kotobukiya|hmm\b|megami\s+device|frame\s+arms|hexa\s+gear/i.test(combined)) {
    brand = brand || 'Kotobukiya';
    category = 'Zoids / Kotobukiya';
  } else if (/moderoid|good\s+smile|evangelion/i.test(combined)) {
    brand = brand || (/moderoid|good\s+smile/i.test(combined) ? 'Good Smile / Moderoid' : 'Bandai Spirits');
    category = 'Evangelion / Moderoid';
  } else if (/in\s+era\+|infinite\s+dimension|motor\s+nuclear|snaa\b/i.test(combined)) {
    brand = brand || (/motor\s+nuclear/i.test(combined) ? 'Motor Nuclear' : 'In Era+ / Infinite Dimension');
    category = 'Moshow Toys / Mecha';
  } else if (/tamiya|hasegawa|meng|academy|revell|italeri|trumpeter/i.test(combined)) {
    const bMatch = combined.match(/\b(Tamiya|Hasegawa|Meng|Academy|Revell|Italeri|Trumpeter)\b/i);
    brand = brand || (bMatch ? bMatch[1] : 'Tamiya');
    category = 'Military / Scale Vehicle';
  } else if (/gundam|gunpla|bandai|zaku|sazabi|sinanju|pla-?model/i.test(combined)) {
    brand = brand || 'Bandai Spirits';
    category = 'Gundam / Gunpla';
  }

  // 4. Detect Model / Frame / Kit Code
  let modelNumber = extra.modelNumber || '';
  if (!modelNumber) {
    const codeMatch = combined.match(
      /\b(RX-\d+[A-Z0-9-]*|MSN-\d+[A-Z0-9-]*|MSZ-\d+[A-Z0-9-]*|ZGMF-[A-Z0-9-]+|GAT-X\d+[A-Z0-9-]*|XVX-\d+[A-Z0-9-]*|X-EX\d+[A-Z0-9-]*|ASW-G-\d+[A-Z0-9-]*|GN-\d+[A-Z0-9-]*|XXXG-\d+[A-Z0-9-]*|GF\d+-[A-Z0-9-]+|MCT-[A-Z0-9-]+|TGB\d+|DG\d+|RZ-\d+|EZ-\d+|MNP-[A-Z0-9-]+)\b/i
    );
    if (codeMatch) {
      modelNumber = codeMatch[1].toUpperCase();
    }
  }

  // 5. Detect Series / Timeline
  let series = extra.series || '';
  if (!series) {
    const seriesPatterns = [
      { re: /SEED\s+Freedom/i, val: 'Mobile Suit Gundam SEED Freedom' },
      { re: /SEED\s+Destiny/i, val: 'Mobile Suit Gundam SEED Destiny' },
      { re: /\bGundam\s+SEED\b/i, val: 'Mobile Suit Gundam SEED' },
      { re: /Witch\s+from\s+Mercury|G-Witch/i, val: 'Mobile Suit Gundam: The Witch from Mercury' },
      { re: /Iron-?Blooded\s+Orphans|\bIBO\b/i, val: 'Mobile Suit Gundam: Iron-Blooded Orphans' },
      { re: /Char'?s\s+Counterattack|\bCCA\b/i, val: "Mobile Suit Gundam: Char's Counterattack" },
      { re: /Gundam\s+Unicorn|\bUC\s+0096\b/i, val: 'Mobile Suit Gundam Unicorn' },
      { re: /Gundam\s+Narrative/i, val: 'Mobile Suit Gundam Narrative' },
      { re: /Hathaway/i, val: "Mobile Suit Gundam: Hathaway's Flash" },
      { re: /Zeta\s+Gundam/i, val: 'Mobile Suit Zeta Gundam' },
      { re: /Gundam\s+ZZ/i, val: 'Mobile Suit Gundam ZZ' },
      { re: /Gundam\s+00\b/i, val: 'Mobile Suit Gundam 00' },
      { re: /Gundam\s+Wing|Endless\s+Waltz/i, val: 'Mobile Suit Gundam Wing' },
      { re: /GQuuuuuuX/i, val: 'Mobile Suit Gundam GQuuuuuuX' },
      { re: /08th\s+MS\s+Team/i, val: 'Mobile Suit Gundam: The 08th MS Team' },
      { re: /Stardust\s+Memory|\b0083\b/i, val: 'Mobile Suit Gundam 0083: Stardust Memory' },
      { re: /War\s+in\s+the\s+Pocket|\b0080\b/i, val: 'Mobile Suit Gundam 0080: War in the Pocket' },
      { re: /Thunderbolt/i, val: 'Mobile Suit Gundam Thunderbolt' },
      { re: /Progenitor\s+Effect/i, val: 'Progenitor Effect' },
      { re: /Armored\s+Core/i, val: 'Armored Core' }
    ];
    for (const sp of seriesPatterns) {
      if (sp.re.test(combined)) {
        series = sp.val;
        break;
      }
    }
  }

  // 6. Detect Price & Currency
  let retailPrice = extra.retailPrice ?? null;
  let currency = extra.currency || 'USD';
  if (retailPrice === null || retailPrice === undefined || retailPrice === '') {
    const yenMatch = combined.match(/(?:¥|JPY\s*)([\d,]{3,7})|([\d,]{3,7})\s*(?:yen|円|JPY)/i);
    const usdMatch = combined.match(/\$\s*([\d]{1,4}(?:\.\d{2})?)/);
    const eurMatch = combined.match(/€\s*([\d]{1,4}(?:[.,]\d{2})?)/);

    if (yenMatch) {
      retailPrice = Number((yenMatch[1] || yenMatch[2]).replace(/,/g, ''));
      currency = 'JPY';
    } else if (usdMatch) {
      retailPrice = Number(usdMatch[1]);
      currency = 'USD';
    } else if (eurMatch) {
      retailPrice = Number(eurMatch[1].replace(',', '.'));
      currency = 'EUR';
    }
  }

  // 7. Detect Release Date (YYYY-MM-DD or Month YYYY)
  let releaseDate = extra.releaseDate || '';
  if (!releaseDate) {
    const isoMatch = combined.match(/\b(20\d{2}|199\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch) {
      releaseDate = isoMatch[0];
    } else {
      const monthNames = {
        january: '01', jan: '01',
        february: '02', feb: '02',
        march: '03', mar: '03',
        april: '04', apr: '04',
        may: '05',
        june: '06', jun: '06',
        july: '07', jul: '07',
        august: '08', aug: '08',
        september: '09', sep: '09', sept: '09',
        october: '10', oct: '10',
        november: '11', nov: '11',
        december: '12', dec: '12'
      };
      const mMatch = combined.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z.,\s]+(199\d|20\d{2})\b/i
      );
      if (mMatch) {
        const mm = monthNames[mMatch[1].toLowerCase()];
        const yyyy = mMatch[2];
        if (mm && yyyy) releaseDate = `${yyyy}-${mm}-01`;
      }
    }
  }

  return {
    name: name || rawTitle || '',
    category,
    brand,
    gradeScale,
    series,
    modelNumber,
    retailPrice: retailPrice !== null && !Number.isNaN(Number(retailPrice)) ? Number(retailPrice) : null,
    currency,
    releaseDate,
    storeUrl: sourceUrl || extra.storeUrl || '',
    imageUrl: extra.imageUrl || '',
    notes: extra.notes || (rawSnippet ? rawSnippet.slice(0, 280).trim() : '')
  };
}

/**
 * Searches the Curated Kits database for immediate local matches.
 */
function searchCuratedKits(query, limit = 5) {
  const tokens = query
    .toLowerCase()
    .split(/[\s\-_/]+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return [];

  const scored = [];
  for (const kit of CURATED_KITS) {
    const haystack = `${kit.name} ${kit.brand} ${kit.gradeScale} ${kit.series} ${kit.modelNumber} ${kit.category}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += 2;
      if (kit.name.toLowerCase().includes(token)) score += 3;
      if (kit.modelNumber && kit.modelNumber.toLowerCase().includes(token)) score += 4;
    }
    if (score > 0) {
      scored.push({ score, kit });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({
      ...item.kit,
      sourceName: 'KitCatalogue Database',
      sourceUrl: '',
      imageUrl: ''
    }));
}

/**
 * Queries the public MediaWiki API on Gundam Wiki / Gunpla Wiki.
 */
async function searchFandomWiki(query, limit = 5) {
  const endpoints = [
    'https://gundam.fandom.com/api.php',
    'https://gunplabuilders.fandom.com/api.php'
  ];

  for (const apiBase of endpoints) {
    try {
      const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: `${query}`,
        gsrlimit: String(limit),
        prop: 'pageimages|extracts|info',
        inprop: 'url',
        pithumbsize: '500',
        exintro: '1',
        explaintext: '1',
        exchars: '320',
        format: 'json'
      });

      const res = await fetch(`${apiBase}?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) continue;

      const data = await res.json();
      const pages = data?.query?.pages;
      if (!pages) continue;

      const results = Object.values(pages)
        .sort((a, b) => (a.index || 99) - (b.index || 99))
        .map((p) => {
          const parsed = parseKitMetadataFromText(p.title, p.extract || '', p.fullurl || '', {
            imageUrl: p.thumbnail?.source || ''
          });
          return {
            ...parsed,
            sourceName: 'Gundam / Gunpla Wiki',
            sourceUrl: p.fullurl || ''
          };
        });

      if (results.length > 0) return results;
    } catch (_) {
      // Try next wiki endpoint
    }
  }
  return [];
}

/**
 * Queries DuckDuckGo HTML / Web Image Search to find any kit across all manufacturers.
 */
async function searchWebKitCandidates(query, limit = 5) {
  try {
    const imgResults = await searchWebImages(`${query} model kit box art`, limit);
    return imgResults.map((img) => {
      const parsed = parseKitMetadataFromText(img.title, '', img.source || '', {
        imageUrl: img.image || img.thumbnail || ''
      });
      return {
        ...parsed,
        thumbnailUrl: img.thumbnail || img.image || '',
        sourceName: 'Web Lookup',
        sourceUrl: img.source || ''
      };
    });
  } catch (_) {
    return [];
  }
}

/**
 * Multi-source candidate lookup combining Curated DB + Fandom MediaWiki API + Web Lookup.
 */
async function lookupKitCandidates(query) {
  const clean = String(query || '').trim();
  if (!clean) return [];

  const [curated, wikiResults, webResults] = await Promise.all([
    Promise.resolve(searchCuratedKits(clean, 4)),
    searchFandomWiki(clean, 4),
    searchWebKitCandidates(clean, 5)
  ]);

  // Attach image from webResults to curated results if they don't have one yet
  if (curated.length > 0 && webResults.length > 0) {
    const firstImg = webResults[0].imageUrl || webResults[0].thumbnailUrl || '';
    if (firstImg && !curated[0].imageUrl) {
      curated[0].imageUrl = firstImg;
      curated[0].thumbnailUrl = webResults[0].thumbnailUrl || firstImg;
    }
  }

  const combined = [...curated, ...wikiResults, ...webResults];
  const seen = new Set();
  const deduped = [];

  for (const item of combined) {
    const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= 8) break;
  }

  return deduped;
}

/**
 * Extracts structured JSON-LD Product data and OpenGraph tags from a web page URL.
 */
async function scrapeProductUrlMetadata(targetUrl) {
  if (!isSafeUrl(targetUrl)) {
    throw new Error('URL blocked by SSRF security policy (must be a public HTTP/HTTPS address).');
  }

  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(9000)
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL (HTTP ${res.status})`);
  }

  const html = await res.text();

  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : '';

  // Extract OpenGraph / Meta tags
  const getMeta = (prop) => {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    return m ? decodeHtmlEntities(m[1].trim()) : '';
  };

  const ogTitle = getMeta('og:title') || getMeta('twitter:title');
  const ogDesc = getMeta('og:description') || getMeta('description');
  let ogImage = getMeta('og:image') || getMeta('twitter:image');
  const ogPrice = getMeta('product:price:amount') || getMeta('og:price:amount');
  const ogCurrency = getMeta('product:price:currency') || getMeta('og:price:currency');

  // Parse JSON-LD blocks for Schema.org Product
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch;
  const extra = {};

  while ((ldMatch = ldRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(ldMatch[1].trim());
      const items = Array.isArray(parsed)
        ? parsed
        : parsed['@graph'] && Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];

      for (const node of items) {
        if (!node || typeof node !== 'object') continue;
        const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : String(node['@type'] || '');
        if (/Product/i.test(type)) {
          if (node.name) title = decodeHtmlEntities(String(node.name));
          if (node.brand) {
            extra.brand =
              typeof node.brand === 'string'
                ? node.brand
                : node.brand.name || '';
          }
          if (node.sku || node.mpn || node.productID) {
            extra.modelNumber = String(node.mpn || node.sku || node.productID);
          }
          if (node.image) {
            const imgVal = Array.isArray(node.image) ? node.image[0] : node.image;
            ogImage = (typeof imgVal === 'string' ? imgVal : imgVal?.url) || ogImage;
          }
          if (node.description && !extra.notes) {
            extra.notes = decodeHtmlEntities(String(node.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          }
          if (node.releaseDate) {
            extra.releaseDate = String(node.releaseDate).slice(0, 10);
          }
          const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
          if (offers && (offers.price || offers.lowPrice)) {
            extra.retailPrice = Number(offers.price || offers.lowPrice);
            if (offers.priceCurrency) extra.currency = String(offers.priceCurrency).toUpperCase();
          }
        }
      }
    } catch (_) {
      // Ignore invalid JSON-LD block
    }
  }

  if (ogImage && ogImage.startsWith('/')) {
    try {
      ogImage = new URL(ogImage, targetUrl).href;
    } catch (_) {}
  }

  if (!extra.retailPrice && ogPrice) {
    extra.retailPrice = Number(ogPrice.replace(/,/g, ''));
  }
  if (!extra.currency && ogCurrency) {
    extra.currency = ogCurrency.toUpperCase();
  }
  if (ogImage) {
    extra.imageUrl = ogImage;
  }

  const parsedMetadata = parseKitMetadataFromText(ogTitle || title, ogDesc, targetUrl, extra);
  return {
    metadata: parsedMetadata,
    rawContext: `Title: ${ogTitle || title}\nDescription: ${ogDesc}\nURL: ${targetUrl}\nExtracted JSON-LD: ${JSON.stringify(extra)}`
  };
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Calls the user's configured AI provider to extract structured kit metadata JSON.
 */
async function callAiForKitExtraction(aiConfig, queryOrContext) {
  const systemPrompt = `You are a specialist Building Kit & Scale Model archivist (expert in Bandai Gunpla, Moshow Toys, Rolife/Cutebee Book Nooks, Kotobukiya Zoids/Mecha, 30 Minutes Missions, and scale models).
Given the user's kit query and any scraped web/wiki context, return ONLY a valid JSON object with the following fields:
{
  "name": "Full clean official kit title (e.g. 'MGEX 1/100 Strike Freedom Gundam' or 'Rolife Sakura Densya Book Nook')",
  "category": "One of: 'Gundam / Gunpla', 'Moshow Toys / Mecha', 'Book Nook / Diorama', '30 Minutes Missions / Sisters', 'Zoids / Kotobukiya', 'Evangelion / Moderoid', 'Military / Scale Vehicle', 'Wood / Metal Puzzle'",
  "brand": "Manufacturer name (e.g. 'Bandai Spirits', 'Moshow Toys', 'Rolife / Robotime', 'Kotobukiya')",
  "gradeScale": "Grade and scale (e.g. 'HG 1/144', 'RG 1/144', 'MG 1/100', 'MGEX 1/100', 'PG 1/60', 'SD / MGSD', '1/72 Progenitor Effect', 'Book Nook Standard')",
  "series": "Anime, timeline, or product line (e.g. 'Mobile Suit Gundam SEED Destiny', 'Mobile Suit Gundam: The Witch from Mercury', 'Progenitor Effect')",
  "modelNumber": "Mobile suit frame code or box SKU (e.g. 'ZGMF-X20A', 'RX-78-2', 'XVX-016', 'MCT-J02', 'TGB01')",
  "releaseDate": "Release date in YYYY-MM-DD format if known, or empty string",
  "retailPrice": "Numeric MSRP price if known, or null",
  "currency": "3-letter currency code for retailPrice ('JPY', 'USD', 'EUR'), default 'USD'",
  "notes": "Brief 1-2 sentence factual summary of the kit's key features, gimmicks, or accessories"
}
Respond ONLY with raw JSON and no markdown code fences.`;

  const userPrompt = `Extract accurate building kit specifications for:\n${queryOrContext}`;

  const rawResponse = await invokeUserAiProvider(aiConfig, systemPrompt, userPrompt);
  const jsonText = extractJsonBlock(rawResponse);
  return JSON.parse(jsonText);
}

/**
 * Low-level multi-provider AI dispatcher (Gemini, OpenAI, Anthropic, OpenRouter, Custom).
 */
async function invokeUserAiProvider(aiConfig, systemPrompt, userPrompt) {
  const { provider, apiKey, baseUrl, model } = aiConfig;

  if (provider === 'gemini') {
    const endpoint = `${baseUrl || PROVIDER_DEFAULTS.gemini.baseUrl}/models/${encodeURIComponent(model || PROVIDER_DEFAULTS.gemini.model)}:generateContent`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 180)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) throw new Error('Gemini returned an empty response');
    return text;
  }

  if (provider === 'anthropic') {
    const endpoint = `${baseUrl || PROVIDER_DEFAULTS.anthropic.baseUrl}/messages`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || PROVIDER_DEFAULTS.anthropic.model,
        max_tokens: 800,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Anthropic API error (${res.status}): ${errBody.slice(0, 180)}`);
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    if (!text) throw new Error('Anthropic returned an empty response');
    return text;
  }

  // OpenAI, OpenRouter, or Custom OpenAI-compatible endpoint
  const resolvedBase = baseUrl || PROVIDER_DEFAULTS[provider]?.baseUrl;
  if (!resolvedBase) {
    throw new Error('Custom provider requires a valid Base URL (e.g. https://api.openai.com/v1)');
  }
  const endpoint = `${resolvedBase.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS[provider]?.model || 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`AI Provider error (${res.status}): ${errBody.slice(0, 180)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('AI Provider returned an empty response');
  return text;
}

function extractJsonBlock(text) {
  const clean = String(text || '').trim();
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return clean.slice(firstBrace, lastBrace + 1);
  }
  return clean;
}

/**
 * Full extraction pipeline:
 * 1. Scrapes direct URL if provided (JSON-LD + OpenGraph) OR gathers multi-source search candidates.
 * 2. Applies deterministic heuristic parser.
 * 3. If user has AI configured & enabled (or requested useAi), enhances metadata via user's AI provider.
 */
async function extractKitDetails({ url = '', query = '', candidate = null, userId = null, useAi = true }) {
  let baseMetadata = null;
  let contextParts = [];
  let sourceLabel = 'Smart Parser';

  // Step 1: If a direct URL is provided, scrape JSON-LD and OpenGraph
  const cleanUrl = String(url || '').trim();
  const cleanQuery = String(query || '').trim();

  if (cleanUrl && /^https?:\/\//i.test(cleanUrl)) {
    const scraped = await scrapeProductUrlMetadata(cleanUrl);
    baseMetadata = scraped.metadata;
    contextParts.push(scraped.rawContext);
    sourceLabel = 'URL Metadata (JSON-LD / OpenGraph)';
  } else if (candidate && typeof candidate === 'object') {
    baseMetadata = parseKitMetadataFromText(
      candidate.name || cleanQuery,
      candidate.notes || '',
      candidate.sourceUrl || candidate.storeUrl || '',
      candidate
    );
    contextParts.push(`Selected Candidate: ${JSON.stringify(baseMetadata)}`);
    sourceLabel = candidate.sourceName || 'Catalogue Lookup';
  } else if (cleanQuery) {
    if (/^https?:\/\//i.test(cleanQuery)) {
      const scraped = await scrapeProductUrlMetadata(cleanQuery);
      baseMetadata = scraped.metadata;
      contextParts.push(scraped.rawContext);
      sourceLabel = 'URL Metadata (JSON-LD / OpenGraph)';
    } else {
      const candidates = await lookupKitCandidates(cleanQuery);
      if (candidates.length > 0) {
        baseMetadata = { ...candidates[0] };
        contextParts.push(
          `Query: ${cleanQuery}\nTop Search Matches:\n${candidates
            .slice(0, 3)
            .map((c) => `- ${c.name} (${c.brand}, ${c.gradeScale}, ${c.series}, ${c.modelNumber}): ${c.notes}`)
            .join('\n')}`
        );
        sourceLabel = candidates[0].sourceName || 'Multi-Source Search';
      } else {
        baseMetadata = parseKitMetadataFromText(cleanQuery, '', '');
        contextParts.push(`Query: ${cleanQuery}`);
      }
    }
  } else {
    throw new Error('Provide a kit name, barcode, or product URL to autofill.');
  }

  // Ensure cover image candidate is populated if missing
  if (!baseMetadata.imageUrl && (baseMetadata.name || cleanQuery)) {
    try {
      const imgs = await searchWebImages(`${baseMetadata.name || cleanQuery} box art`, 2);
      if (imgs.length > 0) {
        baseMetadata.imageUrl = imgs[0].image || imgs[0].thumbnail || '';
        baseMetadata.thumbnailUrl = imgs[0].thumbnail || imgs[0].image || '';
      }
    } catch (_) {}
  }

  // Step 2: Optional AI-Assisted Enhancement using the user's personal encrypted API Key
  let aiUsed = false;
  let aiProvider = null;
  let aiError = null;

  if (useAi && userId) {
    const aiConfig = getUserAiConfigInternal(userId);
    if (aiConfig && aiConfig.enabled && aiConfig.apiKey) {
      try {
        const aiResult = await callAiForKitExtraction(aiConfig, contextParts.join('\n\n'));
        if (aiResult && typeof aiResult === 'object') {
          baseMetadata = {
            ...baseMetadata,
            name: aiResult.name || baseMetadata.name,
            category: aiResult.category || baseMetadata.category,
            brand: aiResult.brand || baseMetadata.brand,
            gradeScale: aiResult.gradeScale || baseMetadata.gradeScale,
            series: aiResult.series || baseMetadata.series,
            modelNumber: aiResult.modelNumber || baseMetadata.modelNumber,
            releaseDate: aiResult.releaseDate || baseMetadata.releaseDate,
            retailPrice:
              aiResult.retailPrice !== null && aiResult.retailPrice !== undefined && aiResult.retailPrice !== ''
                ? Number(aiResult.retailPrice)
                : baseMetadata.retailPrice,
            currency: aiResult.currency || baseMetadata.currency || 'USD',
            notes: aiResult.notes || baseMetadata.notes
          };
          aiUsed = true;
          aiProvider = PROVIDER_DEFAULTS[aiConfig.provider]?.name || aiConfig.provider;
          sourceLabel = `${sourceLabel} + ✨ AI (${aiProvider})`;
        }
      } catch (err) {
        aiError = err.message;
      }
    }
  }

  return {
    kit: baseMetadata,
    source: sourceLabel,
    aiUsed,
    aiProvider,
    aiError
  };
}

module.exports = {
  PROVIDER_DEFAULTS,
  getUserAiConfigPublic,
  saveUserAiConfig,
  lookupKitCandidates,
  extractKitDetails,
  callAiForKitExtraction,
  getUserAiConfigInternal
};
