/**
 * Single source of truth for kit categories, brands and classification rules.
 *
 * To support a new kit line, normally add one entry here:
 *  - new manufacturer  -> BRANDS
 *  - new product line  -> LINE_RULES
 *  - new category      -> CATEGORIES
 * The UI suggestions, the AI prompt, write-time normalisation and the startup
 * data migration all derive from these tables.
 */

const FALLBACK_CATEGORY = 'Other Kit';

const GUNDAM = 'Gundam / Gunpla';
const THIRTY_MINUTES = '30 Minutes Missions / Sisters';
const MECHA = 'Third-Party Mecha';
const BOOK_NOOK = 'Book Nook / Diorama';
const ZOIDS = 'Zoids / Kotobukiya';
const EVA = 'Evangelion / Moderoid';
const SCALE = 'Military / Scale Vehicle';
const PUZZLE = 'Wood / Metal Puzzle';
const FIGURE = 'Action Figure';
const BRICK = 'Brick / Block Set';

const CATEGORIES = [
  { name: GUNDAM, aliases: ['gundam', 'gunpla', 'gundam kit', 'gunpla kit'] },
  { name: THIRTY_MINUTES, aliases: ['30mm', '30ms', '30mf', '30 minutes missions', '30 minutes sisters', '30 minutes fantasy'] },
  {
    name: MECHA,
    aliases: ['moshow', 'moshow toys', 'moshow toys / mecha', 'mecha', 'in era+', 'in era', 'infinite dimension', 'motor nuclear', 'moto nuclear', 'snaa', 'alloy mecha']
  },
  { name: BOOK_NOOK, aliases: ['book nook', 'book nooks', 'booknook', 'diorama', 'miniature house'], defaultGrade: 'Book Nook Standard' },
  { name: ZOIDS, aliases: ['zoids', 'kotobukiya', 'frame arms', 'hexa gear', 'megami device'] },
  { name: EVA, aliases: ['evangelion', 'eva', 'moderoid', 'good smile'] },
  { name: SCALE, aliases: ['military', 'scale model', 'scale vehicle', 'scale models', 'military kit'] },
  { name: PUZZLE, aliases: ['puzzle', '3d puzzle', 'wood puzzle', 'wooden puzzle', 'metal puzzle'] },
  { name: FIGURE, aliases: ['action figures', 'figure', 'figures', 'figure kit', 'assembly figure'] },
  { name: BRICK, aliases: ['brick', 'bricks', 'lego', 'building blocks', 'block set'] },
  { name: FALLBACK_CATEGORY, aliases: ['other', 'misc', 'miscellaneous', 'uncategorized', 'unknown'] }
];

/**
 * Listed most-specific first: the first match wins (ROKR before Robotime).
 * `needsScale` marks names that are ordinary words, which only count as the
 * brand in free text when a 1/N scale is also present.
 * `category: null` means the maker spans too many lines to imply a category.
 */
const BRANDS = [
  { name: 'ROKR / Robotime', aliases: ['rokr'], category: PUZZLE },
  { name: 'Rolife / Robotime', aliases: ['rolife', 'robotime'], category: BOOK_NOOK },
  { name: 'Cutebee', aliases: [], category: BOOK_NOOK },
  { name: 'Tonecheer', aliases: [], category: BOOK_NOOK },
  { name: 'Moshow Toys', aliases: ['moshow'], category: MECHA, defaultGrade: '1/72 Progenitor Effect' },
  { name: 'In Era+ / Infinite Dimension', aliases: ['in era+', 'in era', 'infinite dimension'], category: MECHA },
  { name: 'Motor Nuclear', aliases: ['moto nuclear', 'motornuclear'], category: MECHA },
  { name: 'SNAA', aliases: [], category: MECHA },
  { name: 'Flame Toys', aliases: [], category: MECHA },
  { name: 'Good Smile / Moderoid', aliases: ['good smile', 'good smile company', 'moderoid'], category: EVA },
  { name: 'Kotobukiya', aliases: [], category: ZOIDS },
  { name: 'Takara Tomy', aliases: [], category: null },
  { name: 'Bandai Spirits', aliases: ['bandai', 'bandai hobby', 'bandai namco'], category: GUNDAM },
  { name: 'Blokees', aliases: [], category: FIGURE },
  { name: 'Fondjoy', aliases: [], category: FIGURE },
  { name: 'Tamiya', aliases: [], category: SCALE },
  { name: 'Hasegawa', aliases: [], category: SCALE },
  { name: 'Meng', aliases: ['meng model'], category: SCALE },
  { name: 'Academy', aliases: ['academy hobby'], category: SCALE, needsScale: true },
  { name: 'Revell', aliases: [], category: SCALE },
  { name: 'Italeri', aliases: [], category: SCALE },
  { name: 'Trumpeter', aliases: [], category: SCALE },
  { name: 'Airfix', aliases: [], category: SCALE },
  { name: 'Hobby Boss', aliases: ['hobbyboss'], category: SCALE },
  { name: 'Eduard', aliases: [], category: SCALE },
  { name: 'Aoshima', aliases: [], category: SCALE },
  { name: 'Fujimi', aliases: [], category: SCALE },
  { name: 'MiniArt', aliases: [], category: SCALE },
  { name: 'Zvezda', aliases: [], category: SCALE },
  { name: 'Dragon Models', aliases: ['dragon'], category: SCALE, needsScale: true },
  { name: 'Wave', aliases: [], category: SCALE, needsScale: true },
  { name: 'Metal Earth', aliases: [], category: PUZZLE },
  { name: 'UGears', aliases: [], category: PUZZLE },
  { name: 'Piececool', aliases: [], category: PUZZLE },
  { name: 'LEGO', aliases: [], category: BRICK },
  { name: 'CaDA', aliases: [], category: BRICK },
  { name: 'Nanoblock', aliases: [], category: BRICK },
  { name: 'Mould King', aliases: [], category: BRICK }
];

/**
 * Words naming a product line. These outrank the maker's default category, so
 * "Kotobukiya Evangelion" files under Evangelion rather than Kotobukiya.
 */
const LINE_RULES = [
  { re: /\bbook\s*nooks?\b|\bTGB\d+\b/i, category: BOOK_NOOK },
  { re: /\b30\s*(?:mm|ms|mf)\b|\b30\s*minutes\s*(?:missions|sisters|fantasy)\b/i, category: THIRTY_MINUTES, brand: 'Bandai Spirits' },
  { re: /\bprogenitor\s+effect\b|\bMCT-[a-z0-9]+\b/i, category: MECHA, brand: 'Moshow Toys', defaultGrade: '1/72 Progenitor Effect' },
  { re: /\bMNP-[a-z0-9]+\b/i, category: MECHA, brand: 'Motor Nuclear' },
  { re: /\bHMM\b|\bframe\s+arms\b|\bhexa\s+gear\b|\bmegami\s+device\b/i, category: ZOIDS, brand: 'Kotobukiya' },
  { re: /\bzoids?\b/i, category: ZOIDS },
  { re: /\bmoderoid\b/i, category: EVA, brand: 'Good Smile / Moderoid' },
  { re: /\bevangelion\b/i, category: EVA },
  { re: /\bfigure-?rise\b/i, category: FIGURE, brand: 'Bandai Spirits' },
  { re: /\bgundam\b|\bgunpla\b|\bzaku\b|\bsazabi\b|\bsinanju\b|\bmobile\s+suit\b/i, category: GUNDAM, brand: 'Bandai Spirits' }
];

/** Weak signals, used only when neither a product line nor a maker was recognised. */
const GENERIC_RULES = [
  { re: /\b(?:MGEX|MGSD|PGU|HGUC|HGCE|HGIBO|HGTWFM|HGGTO|HGAC|HGFC|HGBF|HGBD|SDCS|SDEX|SDW)\b|\bRE\/100\b|\b(?:MG|RG|HG|EG)\s*1\/(?:144|100)\b|\bPG\s*1\/60\b/i, category: GUNDAM },
  { re: /\bmecha\b/i, category: MECHA },
  { re: /\bdiorama\b/i, category: BOOK_NOOK },
  { re: /\baction\s+figures?\b/i, category: FIGURE },
  { re: /\b(?:wooden|metal|3d)\s+(?:puzzle|model\s+kit)\b|\bmechanical\s+gears?\b|\bmarble\s+run\b/i, category: PUZZLE },
  { re: /\bbuilding\s+blocks?\b|\bbrick\s+set\b/i, category: BRICK },
  { re: /\b(?:tank|panzer|aircraft|warship|battleship|motorcycle|submarine)\b/i, category: SCALE },
  { re: /(?<![\d/])1[/:](?:24|32|35|48|350|700)(?![\d/])/, category: SCALE }
];

/** Bandai grade labels. Only meaningful for families that use them; see detectGradeScale. */
const GRADE_RULES = [
  { re: /\bPG\s*Unleashed\b|\bPGU\b/i, label: 'PG Unleashed', scale: '1/60' },
  { re: /\bMGEX\b/i, label: 'MGEX', scale: '1/100' },
  { re: /\bMGSD\b/i, label: 'SD / MGSD' },
  { re: /\b(?:Master Grade|MG)\b/i, label: 'MG', scale: '1/100' },
  { re: /\b(?:Real Grade|RG)\b/i, label: 'RG', scale: '1/144' },
  { re: /\b(?:Perfect Grade|PG)\b/i, label: 'PG', scale: '1/60' },
  { re: /\b(?:High Grade|HGUC|HGCE|HGIBO|HGTWFM|HGGTO|HGAC|HGFC|HGBF|HGBD|HG)\b/i, label: 'HG', scale: '1/144' },
  { re: /\b(?:Full Mechanics|FM)\b/i, label: 'FM', scale: '1/100' },
  { re: /\bRE\/100\b/i, label: 'RE/100' },
  { re: /\b(?:Entry Grade|EG)\b/i, label: 'EG', scale: '1/144' },
  { re: /\b(?:SDCS|SDEX|SDW|SD\s+Gundam|BB\s+Senshi)\b/i, label: 'SD / MGSD' },
  { re: /\b30\s*MM\b|\b30\s*Minutes\s*Missions\b/i, label: '30MM', scale: '1/144' },
  { re: /\b30\s*MS\b|\b30\s*Minutes\s*Sisters\b/i, label: '30MS Non-Scale' }
];

const GRADED_CATEGORIES = new Set([GUNDAM, THIRTY_MINUTES, EVA]);

/** "Book Nook" and "book-nook" and "BOOKNOOK" compare equal. */
function lookupKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanLabel(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

const CATEGORY_LOOKUP = new Map();
for (const category of CATEGORIES) {
  CATEGORY_LOOKUP.set(lookupKey(category.name), category);
  for (const alias of category.aliases) CATEGORY_LOOKUP.set(lookupKey(alias), category);
}

function nameRegex(term) {
  const pattern = term
    .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    .replace(/\s+/g, '\\s*');
  return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, 'i');
}

const BRAND_LOOKUP = new Map();
for (const brand of BRANDS) {
  const terms = [brand.name, ...brand.aliases];
  brand.patterns = terms.map(nameRegex);
  for (const term of terms) BRAND_LOOKUP.set(lookupKey(term), brand);
}

const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
const BRAND_NAMES = BRANDS.map((b) => b.name);
const SCALE_RE = /(?<![\d/])1[/:](\d{1,4})(?![\d/])/;

function isKnownCategory(value) {
  return CATEGORY_NAMES.includes(value);
}

/** Maps a typed category onto its canonical name; unrecognised custom categories are kept. */
function normalizeCategory(value) {
  const known = CATEGORY_LOOKUP.get(lookupKey(value));
  return known ? known.name : cleanLabel(value, 60);
}

/** Maps a typed brand onto its canonical name; unrecognised brands are kept. */
function normalizeBrand(value) {
  const known = BRAND_LOOKUP.get(lookupKey(value));
  return known ? known.name : cleanLabel(value, 80);
}

function findBrandInText(text) {
  const hasScale = SCALE_RE.test(text);
  return BRANDS.find((b) => (!b.needsScale || hasScale) && b.patterns.some((re) => re.test(text)));
}

function matchRules(rules, text) {
  return text ? rules.find((rule) => rule.re.test(text)) : undefined;
}

/**
 * Classifies a kit. Signals are ranked so that the title and an explicitly
 * supplied brand outweigh incidental mentions in descriptions.
 * Returns `matched: false` with the fallback category when nothing was recognised:
 * unknown kits must never be filed under a specific line by default.
 */
function classifyKit({ title = '', brand = '', context = '' } = {}) {
  const titleText = String(title ?? '');
  const contextText = String(context ?? '');
  const explicitBrand = BRAND_LOOKUP.get(lookupKey(brand));
  const titleBrand = findBrandInText(titleText);
  const contextBrand = findBrandInText(contextText);

  const titleLine = matchRules(LINE_RULES, titleText);
  const contextLine = matchRules(LINE_RULES, contextText);
  const knownBrand = explicitBrand || titleBrand;

  const resolvedBrand =
    normalizeBrand(brand) ||
    knownBrand?.name ||
    titleLine?.brand ||
    contextBrand?.name ||
    contextLine?.brand ||
    '';

  const signals = [
    titleLine,
    knownBrand?.category ? knownBrand : null,
    matchRules(GENERIC_RULES, titleText),
    contextLine,
    contextBrand?.category ? contextBrand : null,
    matchRules(GENERIC_RULES, contextText)
  ];
  const winner = signals.find(Boolean);
  const category = winner ? winner.category : FALLBACK_CATEGORY;

  return {
    category,
    matched: Boolean(winner),
    brand: resolvedBrand,
    defaultGrade:
      (winner && winner.defaultGrade) ||
      CATEGORY_LOOKUP.get(lookupKey(category))?.defaultGrade ||
      ''
  };
}

/**
 * Derives a grade / scale label. A scale printed on the kit always beats the
 * scale a grade usually implies ("HG 1/100"), and Bandai grade acronyms are
 * ignored for other makers, so a Tamiya "MG 42" machine gun is not Master Grade.
 */
function detectGradeScale(text, category = '', defaultGrade = '') {
  const source = String(text ?? '');
  const scaleMatch = source.match(SCALE_RE);
  const denominator = scaleMatch ? Number(scaleMatch[1]) : 0;
  const explicitScale = denominator >= 4 ? `1/${denominator}` : '';

  const gradesApply =
    GRADED_CATEGORIES.has(category) || (category === FALLBACK_CATEGORY && Boolean(explicitScale));
  if (gradesApply) {
    const grade = GRADE_RULES.find((rule) => rule.re.test(source));
    if (grade) {
      const scale = grade.scale ? explicitScale || grade.scale : '';
      return scale ? `${grade.label} ${scale}` : grade.label;
    }
  }
  return explicitScale || defaultGrade;
}

/** Chooses the category to store: the user's choice if given, otherwise inferred. */
function resolveKitCategory({ category, name, brand, series, grade_scale: gradeScale, notes } = {}) {
  const chosen = normalizeCategory(category);
  if (chosen) return chosen;
  return classifyKit({
    title: [name, series, gradeScale].filter(Boolean).join(' '),
    brand,
    context: notes
  }).category;
}

/**
 * Brings stored kits in line with the registry: merges aliases and legacy names,
 * fixes brand misspellings and fills empty categories. Custom names are untouched,
 * and it is a no-op once the data is canonical, so it is safe to run on every boot.
 */
function migrateKitTaxonomy(db) {
  let changed = 0;
  const renameColumn = (column, normalize) => {
    const update = db.prepare(`UPDATE kits SET ${column} = ? WHERE ${column} = ?`);
    for (const row of db.prepare(`SELECT DISTINCT ${column} AS value FROM kits`).all()) {
      const next = normalize(row.value);
      if (next && next !== row.value) changed += Number(update.run(next, row.value).changes);
    }
  };
  renameColumn('category', normalizeCategory);
  renameColumn('brand', normalizeBrand);

  const setCategory = db.prepare('UPDATE kits SET category = ? WHERE id = ?');
  const blanks = db
    .prepare("SELECT id, name, brand, series, grade_scale, notes FROM kits WHERE TRIM(category) = ''")
    .all();
  for (const kit of blanks) {
    setCategory.run(resolveKitCategory({ ...kit, category: '' }), kit.id);
    changed += 1;
  }

  if (changed > 0) console.log(`[taxonomy] Normalised category/brand on ${changed} stored kit field(s).`);
  return changed;
}

module.exports = {
  FALLBACK_CATEGORY,
  CATEGORY_NAMES,
  BRAND_NAMES,
  isKnownCategory,
  normalizeCategory,
  normalizeBrand,
  classifyKit,
  detectGradeScale,
  resolveKitCategory,
  migrateKitTaxonomy
};
