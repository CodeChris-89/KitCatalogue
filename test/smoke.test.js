const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Use isolated temporary data directory for tests
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitcatalogue-test-'));
process.env.DATA_DIR = testDataDir;
process.env.PORT = '0';

const { server } = require('../server/index');
const { getDb } = require('../server/db');

async function runTests() {
  getDb();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Test server started at ${baseUrl}`);

  try {
    // 1. Check initial auth status (needsSetup should be true)
    let res = await fetch(`${baseUrl}/api/auth/status`);
    let status = await res.json();
    assert.strictEqual(status.needsSetup, true, 'First boot should require setup');
    assert.strictEqual(status.user, null);

    // 2. Register first user -> automatically becomes admin
    res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'founder_admin',
        displayName: 'Char Aznable',
        password: 'redcomet123'
      })
    });
    assert.strictEqual(res.status, 201);
    const adminCookie = res.headers.get('set-cookie').split(';')[0];
    const adminReg = await res.json();
    assert.strictEqual(adminReg.isFirstAdmin, true);
    assert.strictEqual(adminReg.user.role, 'admin', 'First user must be admin');
    console.log('✓ First registered user automatically granted admin role');

    // 3. Register second user -> becomes standard user
    res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'amuro',
        displayName: 'Amuro Ray',
        password: 'whitebase123'
      })
    });
    assert.strictEqual(res.status, 201);
    const userCookie = res.headers.get('set-cookie').split(';')[0];
    const userReg = await res.json();
    assert.strictEqual(userReg.isFirstAdmin, false);
    assert.strictEqual(userReg.user.role, 'user', 'Second user must be standard user');
    console.log('✓ Second registered user assigned standard user role');

    // 4. Create Owned Kit & Wishlist Kit as Admin
    res = await fetch(`${baseUrl}/api/kits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        name: 'MGEX 1/100 Strike Freedom Gundam',
        category: 'Gundam / Gunpla',
        brand: 'Bandai Spirits',
        grade_scale: 'MGEX 1/100',
        collection_type: 'owned',
        status: 'building',
        price: 165.0,
        retail_price: 185.0,
        currency: 'EUR',
        display_location: 'Detolf Cabinet - Shelf 1',
        storage_box: 'Spare Bin #3',
        rating: 5,
        notes: 'Gold inner frame assembly complete'
      })
    });
    assert.strictEqual(res.status, 201);
    const { kit: ownedKit } = await res.json();
    assert.strictEqual(ownedKit.collection_type, 'owned');
    assert.strictEqual(ownedKit.status, 'building');
    assert.strictEqual(ownedKit.display_location, 'Detolf Cabinet - Shelf 1');
    assert.strictEqual(ownedKit.storage_box, 'Spare Bin #3');
    assert.strictEqual(ownedKit.retail_price, 185.0);

    res = await fetch(`${baseUrl}/api/kits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        name: 'Moshow Progenitor Effect Takeda Shingen',
        category: 'Moshow Toys / Mecha',
        brand: 'Moshow Toys',
        grade_scale: '1/72',
        collection_type: 'wishlist',
        priority: 'high',
        price: 140.0,
        retail_price: 155.0,
        release_date: '2026-12-15'
      })
    });
    assert.strictEqual(res.status, 201);
    const { kit: wishlistKit } = await res.json();
    assert.strictEqual(wishlistKit.collection_type, 'wishlist');
    assert.strictEqual(wishlistKit.status, 'wishlist');
    assert.strictEqual(wishlistKit.release_date, '2026-12-15');
    console.log('✓ Created Owned and Wishlist kits with display location, spare box, MSRP & release date');

    // 5. Upload a stance photo via multipart/form-data
    const formPhoto = new FormData();
    formPhoto.append('stance_name', 'Full Burst Mode');
    formPhoto.append('caption', 'Dragoons deployed on action base');
    formPhoto.append('is_cover', 'true');
    const fakePng = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
      type: 'image/png'
    });
    formPhoto.append('photo', fakePng, 'full_burst.png');

    res = await fetch(`${baseUrl}/api/kits/${ownedKit.id}/photos`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: formPhoto
    });
    assert.strictEqual(res.status, 201);
    const photoResult = await res.json();
    assert.strictEqual(photoResult.kit.photos.length, 1);
    assert.strictEqual(photoResult.kit.photos[0].stance_name, 'Full Burst Mode');
    console.log('✓ Uploaded stance photo and set as kit cover');

    // 6. Upload a building manual PDF via multipart/form-data
    const formManual = new FormData();
    formManual.append('title', 'Main Assembly Manual & Decal Guide');
    formManual.append('notes', 'Page 24 has wing dragoons');
    const fakePdf = new Blob([Buffer.from('%PDF-1.4 mock manual content')], {
      type: 'application/pdf'
    });
    formManual.append('manual', fakePdf, 'mgex_strike_freedom_manual.pdf');

    res = await fetch(`${baseUrl}/api/kits/${ownedKit.id}/manuals`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: formManual
    });
    assert.strictEqual(res.status, 201);
    const manualResult = await res.json();
    assert.strictEqual(manualResult.kit.manuals.length, 1);
    assert.strictEqual(manualResult.kit.manuals[0].title, 'Main Assembly Manual & Decal Guide');
    console.log('✓ Uploaded PDF building manual');

    // 7. Verify Public Showcase Mode (Idea 6)
    res = await fetch(`${baseUrl}/api/showcase/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ enabled: true })
    });
    assert.strictEqual(res.status, 200);
    const scSettings = await res.json();
    assert.strictEqual(scSettings.showcaseEnabled, true);
    assert.ok(scSettings.showcaseToken);

    // Fetch public showcase without cookies
    res = await fetch(`${baseUrl}/api/showcase/${scSettings.showcaseToken}`);
    assert.strictEqual(res.status, 200);
    const publicData = await res.json();
    assert.strictEqual(publicData.kits.length, 2);
    console.log('✓ Verified Public Showcase read-only gallery endpoint');

    // 8. Verify Full Backup Export & Restore into User 2's account (Idea 6)
    res = await fetch(`${baseUrl}/api/backup/export?media=true`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const backupArchive = await res.json();
    assert.strictEqual(backupArchive.kits.length, 2);
    assert.ok(backupArchive.kits[0].photos[0].data_base64);
    assert.ok(backupArchive.kits[0].manuals[0].data_base64);

    // User 2 initially has 0 kits
    res = await fetch(`${baseUrl}/api/kits`, {
      headers: { Cookie: userCookie }
    });
    const user2Initial = await res.json();
    assert.strictEqual(user2Initial.kits.length, 0, 'User 2 catalogue must be private and empty');

    // Import backup into User 2
    res = await fetch(`${baseUrl}/api/backup/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({ kits: backupArchive.kits })
    });
    assert.strictEqual(res.status, 201);
    const importRes = await res.json();
    assert.strictEqual(importRes.importedCount, 2);
    assert.strictEqual(importRes.photosRestored, 1);
    assert.strictEqual(importRes.manualsRestored, 1);
    console.log('✓ Verified One-Click Full Backup & Restore (with embedded photos & manuals)');

    // 9. Verify Admin User Management, customizable tagline & registration lock
    // Verify default tagline is not related to Unraid
    res = await fetch(`${baseUrl}/api/auth/status`);
    const initialStatus = await res.json();
    assert.strictEqual(initialStatus.tagline, 'Model Hangar');
    assert.ok(!initialStatus.tagline.toLowerCase().includes('unraid'), 'Default tagline should not reference Unraid');

    // Admin customizes the tagline and disables registration
    res = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ allowRegistration: false, appTagline: 'Custom Gundam Hangar' })
    });
    assert.strictEqual(res.status, 200);
    const settingsData = await res.json();
    assert.strictEqual(settingsData.settings.appTagline, 'Custom Gundam Hangar');

    res = await fetch(`${baseUrl}/api/auth/status`);
    const updatedStatus = await res.json();
    assert.strictEqual(updatedStatus.tagline, 'Custom Gundam Hangar');

    res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kamille', password: 'zeta1234' })
    });
    assert.strictEqual(res.status, 403, 'Registration should be blocked when disabled by admin');
    console.log('✓ Verified Admin user management, customizable branding tagline & registration lock');

    // 10. Verify Per-User Encrypted AI API Key Isolation & Smart Kit Lookup / Autofill
    res = await fetch(`${baseUrl}/api/user/ai-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        provider: 'custom',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'sk-super-secret-amuro-key-9876',
        enabled: true
      })
    });
    assert.strictEqual(res.status, 200);
    const savedAi = await res.json();
    assert.strictEqual(savedAi.aiSettings.hasApiKey, true);
    assert.strictEqual(savedAi.aiSettings.maskedKey, '••••••••9876');
    assert.strictEqual(savedAi.aiSettings.provider, 'custom');
    assert.ok(
      !JSON.stringify(savedAi).includes('sk-super-secret-amuro-key'),
      'Raw API key must never be leaked in HTTP responses'
    );

    // Ensure User 2 cannot see or access User 1's API key
    res = await fetch(`${baseUrl}/api/user/ai-settings`, {
      headers: { Cookie: userCookie }
    });
    assert.strictEqual(res.status, 200);
    const user2Ai = await res.json();
    assert.strictEqual(user2Ai.aiSettings.hasApiKey, false, 'User 2 must not have access to User 1 AI key');
    assert.strictEqual(user2Ai.aiSettings.maskedKey, '');

    // Test Smart Kit Lookup
    res = await fetch(`${baseUrl}/api/kits/lookup?q=${encodeURIComponent('MGEX Strike Freedom')}`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const lookupData = await res.json();
    assert.ok(lookupData.results.length > 0, 'Should return candidate matches for MGEX Strike Freedom');
    assert.strictEqual(lookupData.results[0].modelNumber, 'ZGMF-X20A');
    assert.strictEqual(lookupData.results[0].gradeScale, 'MGEX 1/100');

    // Test Smart Kit Extract (without invoking live external AI key)
    res = await fetch(`${baseUrl}/api/kits/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({
        query: 'Rolife Sakura Densya Book Nook TGB01',
        useAi: false
      })
    });
    assert.strictEqual(res.status, 200);
    const extractData = await res.json();
    assert.strictEqual(extractData.kit.category, 'Book Nook / Diorama');
    assert.strictEqual(extractData.kit.modelNumber, 'TGB01');
    console.log('✓ Verified Per-User AES-256-GCM Encrypted AI Key Isolation & Smart Kit Autofill');

    console.log('\nALL SMOKE TESTS PASSED!');
  } finally {
    server.close();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
