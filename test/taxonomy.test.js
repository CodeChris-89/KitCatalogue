const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitcatalogue-taxonomy-'));
process.env.DATA_DIR = testDataDir;

const {
  CATEGORY_NAMES,
  BRAND_NAMES,
  normalizeCategory,
  normalizeBrand,
  classifyKit,
  detectGradeScale,
  resolveKitCategory,
  migrateKitTaxonomy
} = require('../server/taxonomy');
const {
  PROVIDER_DEFAULTS,
  CURATED_KITS,
  searchCuratedKits,
  parseKitMetadataFromText,
  sanitizeAiKitResult,
  buildAiTestConfig,
  callAiForKitExtraction,
  saveUserAiConfig,
  getUserAiConfigPublic,
  getUserAiConfigInternal
} = require('../server/kitlookup');
const { getDb } = require('../server/db');

// [title, expected category, expected brand ('' = none), expected grade (undefined = don't check)]
const CLASSIFICATION_CASES = [
  ['Blokees Star Wars Bo-Katan', 'Action Figure', 'Blokees'],
  ['Fondjoy 1/12 Iron Man MK45', 'Action Figure', 'Fondjoy', '1/12'],
  ['LEGO Technic 42143 Ferrari', 'Brick / Block Set', 'LEGO'],
  ['Hobby Boss 1/48 F-14 Tomcat', 'Military / Scale Vehicle', 'Hobby Boss', '1/48'],
  ['Airfix 1/72 Spitfire', 'Military / Scale Vehicle', 'Airfix', '1/72'],
  ['Tamiya 1/35 MG 42 Machine Gun Team', 'Military / Scale Vehicle', 'Tamiya', '1/35'],
  ['Metal Earth Millennium Falcon', 'Wood / Metal Puzzle', 'Metal Earth'],
  ['ROKR Marble Run', 'Wood / Metal Puzzle', 'ROKR / Robotime'],
  ['Robotime ROKR Mechanical Gears', 'Wood / Metal Puzzle', 'ROKR / Robotime'],
  ['UGears Steam Locomotive', 'Wood / Metal Puzzle', 'UGears'],
  ['HG 1/100 Gundam Barbatos 6th Form', 'Gundam / Gunpla', 'Bandai Spirits', 'HG 1/100'],
  ['HGUC 1/144 Zaku II', 'Gundam / Gunpla', 'Bandai Spirits', 'HG 1/144'],
  ['MGEX Strike Freedom Gundam', 'Gundam / Gunpla', 'Bandai Spirits', 'MGEX 1/100'],
  ['Motor Nuclear 1/72 MNP-XH01', 'Third-Party Mecha', 'Motor Nuclear', '1/72'],
  ['Moshow Lancelot', 'Third-Party Mecha', 'Moshow Toys', '1/72 Progenitor Effect'],
  ['IN ERA+ FENRIR', 'Third-Party Mecha', 'In Era+ / Infinite Dimension'],
  ['Kotobukiya Evangelion Unit-01', 'Evangelion / Moderoid', 'Kotobukiya'],
  ['Kotobukiya Frame Arms Girl', 'Zoids / Kotobukiya', 'Kotobukiya'],
  ['30MS Sis-A00 Luluce', '30 Minutes Missions / Sisters', 'Bandai Spirits', '30MS Non-Scale'],
  ['Rolife Sakura Densya Book Nook', 'Book Nook / Diorama', 'Rolife / Robotime', 'Book Nook Standard'],
  ['Tonecheer Howl\'s Moving Castle', 'Book Nook / Diorama', 'Tonecheer'],
  // Ordinary words must not be mistaken for makers
  ['Asticassia Academy Set', 'Other Kit', ''],
  ['Mengniu Toy', 'Other Kit', ''],
  ['Wave Rider Stand', 'Other Kit', ''],
  ['Some Unknown Kit', 'Other Kit', '']
];

function testClassification() {
  for (const [title, category, brand, grade] of CLASSIFICATION_CASES) {
    const parsed = parseKitMetadataFromText(title);
    assert.strictEqual(parsed.category, category, `category of "${title}"`);
    assert.strictEqual(parsed.brand, brand, `brand of "${title}"`);
    if (grade !== undefined) assert.strictEqual(parsed.gradeScale, grade, `grade of "${title}"`);
  }

  // A brand from structured data classifies a title that doesn't name it
  assert.strictEqual(
    parseKitMetadataFromText('Tiger I Early Production', '', '', { brand: 'Tamiya' }).category,
    'Military / Scale Vehicle'
  );
  // An explicit category is never overridden
  assert.strictEqual(
    parseKitMetadataFromText('MG Gundam', '', '', { category: 'Wood / Metal Puzzle' }).category,
    'Wood / Metal Puzzle'
  );
  // The title outweighs a passing mention in a description
  assert.strictEqual(
    parseKitMetadataFromText('Tamiya Lancaster', 'Looks great beside your Gundam shelf').category,
    'Military / Scale Vehicle'
  );
  assert.strictEqual(classifyKit({ title: 'Mystery', context: 'a Gundam kit' }).category, 'Gundam / Gunpla');
  // Dates are not scales
  assert.strictEqual(detectGradeScale('released 1/24/2023', 'Other Kit'), '');
  assert.strictEqual(detectGradeScale('1:144 kit', 'Other Kit'), '1/144');
  console.log(`✓ Classified ${CLASSIFICATION_CASES.length} kit titles`);
}

function testNormalization() {
  for (const [input, expected] of [
    ['gundam', 'Gundam / Gunpla'],
    ['  GUNDAM/GUNPLA ', 'Gundam / Gunpla'],
    ['In Era+', 'Third-Party Mecha'],
    ['Moshow Toys / Mecha', 'Third-Party Mecha'],
    ['book-nook', 'Book Nook / Diorama'],
    ['uncategorized', 'Other Kit'],
    ['My   Custom Shelf', 'My Custom Shelf'],
    ['', '']
  ]) {
    assert.strictEqual(normalizeCategory(input), expected, `category "${input}"`);
  }
  for (const [input, expected] of [
    ['Moto Nuclear', 'Motor Nuclear'],
    ['BANDAI', 'Bandai Spirits'],
    ['rolife', 'Rolife / Robotime'],
    ['Unknown Maker', 'Unknown Maker']
  ]) {
    assert.strictEqual(normalizeBrand(input), expected, `brand "${input}"`);
  }
  assert.strictEqual(normalizeCategory(null), '');
  assert.strictEqual(resolveKitCategory({ category: '', name: 'Tamiya Tiger I' }), 'Military / Scale Vehicle');
  assert.strictEqual(resolveKitCategory({ name: 'Nameless' }), 'Other Kit');
  console.log('✓ Normalised category and brand aliases, keeping custom values');
}

function testCuratedIndexIsConsistent() {
  for (const kit of CURATED_KITS) {
    assert.ok(CATEGORY_NAMES.includes(kit.category), `"${kit.name}" has unknown category ${kit.category}`);
    assert.ok(BRAND_NAMES.includes(kit.brand), `"${kit.name}" has unregistered brand ${kit.brand}`);
    const inferred = classifyKit({ title: kit.name, brand: kit.brand }).category;
    assert.strictEqual(inferred, kit.category, `classifier disagrees with curated "${kit.name}"`);
  }
  console.log(`✓ All ${CURATED_KITS.length} curated kits agree with the registry`);
}

function testCuratedSearchPrecision() {
  for (const query of ["Rolife Cathy's Flower House", 'Tamiya 1/144 F-14', 'Bandai Pokepla Pikachu']) {
    assert.deepStrictEqual(searchCuratedKits(query), [], `"${query}" must not match another kit`);
  }
  assert.strictEqual(searchCuratedKits('MGEX Strike Freedom')[0].modelNumber, 'ZGMF-X20A');
  assert.strictEqual(searchCuratedKits('Rolife Sakura Densya Book Nook TGB01')[0].modelNumber, 'TGB01');
  assert.ok(searchCuratedKits('Gundam').length > 0, 'broad queries still browse');
  console.log('✓ Curated search no longer returns unrelated kits from the same brand');
}

function testMigration() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE kits (
    id INTEGER PRIMARY KEY, name TEXT, category TEXT, brand TEXT,
    series TEXT DEFAULT '', grade_scale TEXT DEFAULT '', notes TEXT DEFAULT ''
  )`);
  const insert = db.prepare('INSERT INTO kits (name, category, brand) VALUES (?, ?, ?)');
  insert.run('IN ERA+ FENRIR', 'In Era+', 'In Era+ / Infinite Dimension');
  insert.run('MNP-CR02A', 'Moshow Toys / Mecha', 'Moto Nuclear');
  insert.run('Iron Man', 'Action Figure', 'Fondjoy');
  insert.run('Mine', 'My Custom Shelf', 'Unknown Maker');
  insert.run('Tamiya Tiger I', '', '');

  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.ok(migrateKitTaxonomy(db) > 0);
    const rows = db.prepare('SELECT category, brand FROM kits ORDER BY id').all();
    assert.deepStrictEqual(rows.map((r) => r.category), [
      'Third-Party Mecha',
      'Third-Party Mecha',
      'Action Figure',
      'My Custom Shelf',
      'Military / Scale Vehicle'
    ]);
    assert.strictEqual(rows[1].brand, 'Motor Nuclear');
    assert.strictEqual(rows[3].brand, 'Unknown Maker');
    assert.strictEqual(migrateKitTaxonomy(db), 0, 'second run must be a no-op');
  } finally {
    console.log = originalLog;
  }
  console.log('✓ Migration merges legacy names, keeps custom values and is idempotent');
}

function testAiResultSanitizing() {
  const clean = sanitizeAiKitResult({
    name: ' Kit ',
    category: 'moshow',
    brand: 'BANDAI',
    retailPrice: '¥15,400',
    currency: 'jpy',
    releaseDate: '2024-05',
    series: ['not', 'a', 'string']
  });
  assert.strictEqual(clean.name, 'Kit');
  assert.strictEqual(clean.category, 'Third-Party Mecha');
  assert.strictEqual(clean.brand, 'Bandai Spirits');
  assert.strictEqual(clean.retailPrice, 15400);
  assert.strictEqual(clean.currency, 'JPY');
  assert.strictEqual(clean.releaseDate, '2024-05-01');
  assert.strictEqual(clean.series, '');

  const bad = sanitizeAiKitResult({ category: 'Robots', retailPrice: 'unknown', currency: 'US dollars', releaseDate: 'soon' });
  assert.strictEqual(bad.category, '');
  assert.strictEqual(bad.retailPrice, null);
  assert.strictEqual(bad.currency, '');
  assert.strictEqual(bad.releaseDate, '');
  assert.deepStrictEqual(sanitizeAiKitResult(['x']), {});
  console.log('✓ AI output is validated before reaching the kit form');
}

function testProviderConfig() {
  const db = getDb();
  const addUser = (name) =>
    Number(
      db.prepare("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, 'x')").run(name, name)
        .lastInsertRowid
    );

  // Every provider resolves to a real adapter style and has what it needs
  for (const [id, p] of Object.entries(PROVIDER_DEFAULTS)) {
    assert.ok(['gemini', 'openai', 'anthropic'].includes(p.apiStyle), `${id} apiStyle`);
    assert.ok(p.requiresBaseUrl || p.baseUrl, `${id} needs a default base URL`);
    assert.ok(p.requiresModel || p.model, `${id} needs a default model`);
  }

  // Object.prototype names are not providers
  const protoUser = addUser('proto');
  assert.strictEqual(saveUserAiConfig(protoUser, { provider: 'constructor', apiKey: 'k1' }).provider, 'gemini');

  // Switching provider drops the previous vendor's key, endpoint and model
  const switcher = addUser('switcher');
  saveUserAiConfig(switcher, {
    provider: 'custom',
    baseUrl: 'https://llm.example/v1',
    model: 'local-model',
    apiKey: 'secret-custom'
  });
  const switched = saveUserAiConfig(switcher, { provider: 'openai' });
  assert.strictEqual(switched.hasApiKey, false);
  assert.strictEqual(switched.baseUrl, '');
  assert.strictEqual(switched.model, PROVIDER_DEFAULTS.openai.model);

  // A test run never sends a stored key to another provider
  const stored = { provider: 'openai', apiKey: 'sk-saved', baseUrl: 'https://api.openai.com/v1', model: 'gpt-x' };
  assert.throws(() => buildAiTestConfig(stored, { provider: 'gemini' }), /No API Key/);
  const sameProvider = buildAiTestConfig(stored, { provider: 'openai', baseUrl: '', model: '' });
  assert.strictEqual(sameProvider.apiKey, 'sk-saved');
  assert.strictEqual(sameProvider.model, 'gpt-x');
  assert.throws(() => buildAiTestConfig(stored, { provider: 'openai', baseUrl: 'ftp://x' }), /http/);

  // Custom needs an endpoint and model when enabled
  const customUser = addUser('custom');
  assert.throws(() => saveUserAiConfig(customUser, { provider: 'custom', apiKey: 'k', enabled: true }), /Base URL/);

  // A row naming a removed provider is not silently rerouted to another vendor
  const orphan = addUser('orphan');
  saveUserAiConfig(orphan, { provider: 'openai', apiKey: 'sk-orphan' });
  db.prepare("UPDATE user_ai_settings SET provider = 'removed' WHERE user_id = ?").run(orphan);
  assert.strictEqual(getUserAiConfigInternal(orphan), null);
  assert.strictEqual(getUserAiConfigPublic(orphan).enabled, false);

  // A saved retired model is replaced by the current default
  const retired = addUser('retired');
  saveUserAiConfig(retired, { provider: 'anthropic', apiKey: 'sk-ant' });
  db.prepare("UPDATE user_ai_settings SET model = 'claude-3-5-haiku-latest' WHERE user_id = ?").run(retired);
  assert.strictEqual(getUserAiConfigInternal(retired).model, PROVIDER_DEFAULTS.anthropic.model);
  assert.strictEqual(getUserAiConfigPublic(retired).model, PROVIDER_DEFAULTS.anthropic.model);
  console.log('✓ Provider settings are isolated per vendor and survive registry changes');
}

// Exercises each wire format against a local stand-in for the vendor API.
async function testProviderAdapters() {
  const reply = JSON.stringify({ name: 'Kit', category: 'Gundam', retailPrice: 10, currency: 'usd' });
  const requests = [];
  const mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) });
      let payload;
      if (req.url === '/messages') {
        payload = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: reply }] };
      } else if (req.url === '/chat/completions') {
        payload = { choices: [{ message: { content: `\`\`\`json\n${reply}\n\`\`\`` } }] };
      } else {
        payload = { candidates: [{ content: { parts: [{ text: reply }] } }] };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${mock.address().port}/`;

  try {
    for (const provider of Object.keys(PROVIDER_DEFAULTS)) {
      const result = await callAiForKitExtraction({ provider, apiKey: 'key', baseUrl, model: 'test-model' }, 'query');
      assert.strictEqual(result.category, 'Gundam / Gunpla', `${provider} result`);
      assert.strictEqual(result.currency, 'USD');
    }

    const anthropic = requests.find((r) => r.url === '/messages');
    assert.strictEqual(anthropic.headers['x-api-key'], 'key');
    assert.strictEqual(anthropic.body.temperature, undefined, 'current Claude models reject temperature');

    const openai = requests.find((r) => r.url === '/chat/completions');
    assert.strictEqual(openai.headers.authorization, 'Bearer key');

    const gemini = requests.find((r) => r.url.includes(':generateContent'));
    assert.strictEqual(gemini.headers['x-goog-api-key'], 'key');

    for (const name of CATEGORY_NAMES) {
      assert.ok(anthropic.body.system.includes(name), `AI prompt must offer "${name}"`);
    }

    await assert.rejects(
      callAiForKitExtraction({ provider: 'constructor', apiKey: 'k' }, 'q'),
      /Unknown AI provider/
    );
    await assert.rejects(
      callAiForKitExtraction({ provider: 'custom', apiKey: 'k', baseUrl: '', model: 'm' }, 'q'),
      /Base URL/
    );
  } finally {
    mock.close();
  }
  console.log('✓ Every provider adapter round-trips against a mock API');
}

async function run() {
  try {
    testClassification();
    testNormalization();
    testCuratedIndexIsConsistent();
    testCuratedSearchPrecision();
    testMigration();
    testAiResultSanitizing();
    testProviderConfig();
    await testProviderAdapters();
    console.log('\nALL TAXONOMY TESTS PASSED!\n');
  } finally {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
