(() => {
  const STATUS_LABELS = {
    backlog: 'Backlog',
    building: 'Building',
    panel_lining: 'Panel Lining & Decals',
    painting: 'Painting & Topcoat',
    finished: 'Finished',
    on_hold: 'On Hold',
    wishlist: 'Wishlist'
  };

  let state = {
    user: null,
    needsSetup: false,
    allowRegistration: true,
    authMode: 'login', // 'login' | 'register'
    showcaseMode: false,
    showcaseToken: '',
    showcaseOwner: null,
    kits: [],
    activeNav: 'all', // 'all' | 'owned' | 'wishlist' | 'status:...' | 'cat:...' | 'analytics' | 'portability' | 'admin'
    activeKitId: null,
    searchQuery: '',
    filterCategory: '',
    filterStatus: '',
    filterLocation: '',
    sortBy: 'updated_desc'
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  // Open a modal and guarantee it is stacked above any other open modal
  function showModal(id) {
    const el = $(id);
    document.body.appendChild(el);
    el.classList.remove('hidden');
  }

  function showToast(message, type = 'info') {
    const container = $('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3600);
  }

  async function api(url, options = {}) {
    const opts = { ...options };
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function triggerDownload(filename, content, mimeType = 'application/octet-stream') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // AUTHENTICATION OR PUBLIC SHOWCASE FLOW
  async function checkAuth() {
    try {
      const params = new URLSearchParams(window.location.search);
      const showcaseParam = params.get('showcase');
      if (showcaseParam) {
        const scData = await api(`/api/showcase/${encodeURIComponent(showcaseParam)}`);
        if (scData.tagline && $('brand-tag')) {
          $('brand-tag').textContent = scData.tagline;
        }
        state.showcaseMode = true;
        state.showcaseToken = showcaseParam;
        state.showcaseOwner = scData.owner;
        state.kits = scData.kits || [];

        $('auth-screen').classList.add('hidden');
        $('app-shell').classList.remove('hidden');
        $('showcase-top-banner').classList.remove('hidden');
        $('showcase-owner-name').textContent =
          scData.owner.displayName || scData.owner.username;

        // Hide owner-only controls in read-only showcase
        $('topbar-owner-actions').classList.add('hidden');
        $('empty-owner-actions').classList.add('hidden');
        $('nav-data-portability').classList.add('hidden');
        $('nav-settings')?.classList.add('hidden');
        $('sidebar-user-footer').classList.add('hidden');

        updateStatsAndCounts();
        renderKitsGrid();
        return;
      }

      const status = await api('/api/auth/status');
      if (status.tagline && $('brand-tag')) {
        $('brand-tag').textContent = status.tagline;
      }
      state.needsSetup = status.needsSetup;
      state.allowRegistration = status.allowRegistration;
      state.user = status.user;

      if (state.user) {
        $('auth-screen').classList.add('hidden');
        $('app-shell').classList.remove('hidden');
        renderUserSidebar();
        syncShowcaseSettingsUI();
        await loadKits();
      } else {
        $('app-shell').classList.add('hidden');
        $('auth-screen').classList.remove('hidden');
        if (state.needsSetup) {
          setAuthMode('register');
          $('first-admin-banner').classList.remove('hidden');
          $('auth-tabs').classList.add('hidden');
        } else {
          $('first-admin-banner').classList.add('hidden');
          if (state.allowRegistration) {
            $('auth-tabs').classList.remove('hidden');
          } else {
            $('auth-tabs').classList.add('hidden');
            setAuthMode('login');
          }
        }
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    $('auth-error').classList.add('hidden');
    const pwdInput = $('auth-password');
    if (mode === 'register') {
      $('tab-register').classList.add('active');
      $('tab-login').classList.remove('active');
      $('auth-displayname-group').classList.remove('hidden');
      if (pwdInput) {
        pwdInput.autocomplete = 'new-password';
      }
      $('auth-submit-btn').textContent = state.needsSetup
        ? 'Create Administrator Account'
        : 'Create Account';
    } else {
      $('tab-login').classList.add('active');
      $('tab-register').classList.remove('active');
      $('auth-displayname-group').classList.add('hidden');
      if (pwdInput) {
        pwdInput.autocomplete = 'current-password';
      }
      $('auth-submit-btn').textContent = 'Sign In';
    }
  }

  function renderUserSidebar() {
    if (!state.user) return;
    $('current-user-name').textContent = state.user.displayName || state.user.username;
    $('current-user-handle').textContent = `@${state.user.username}`;
    $('current-user-role').textContent = state.user.role;
    $('user-avatar').textContent = (state.user.displayName || state.user.username)
      .slice(0, 1)
      .toUpperCase();

    if (state.user.role === 'admin') {
      $('admin-nav-section').classList.remove('hidden');
    } else {
      $('admin-nav-section').classList.add('hidden');
    }
  }

  function syncShowcaseSettingsUI() {
    if (!state.user) return;
    $('showcase-enable-toggle').checked = Boolean(state.user.showcaseEnabled);
    if (state.user.showcaseEnabled && state.user.showcaseToken) {
      $('showcase-link-box').classList.remove('hidden');
      $('showcase-url-input').value = `${window.location.origin}/?showcase=${state.user.showcaseToken}`;
    } else {
      $('showcase-link-box').classList.add('hidden');
    }
  }

  // LOAD & RENDER KITS
  async function loadKits() {
    const data = await api('/api/kits');
    state.kits = data.kits || [];
    updateStatsAndCounts();
    renderKitsGrid();
  }

  function updateStatsAndCounts() {
    const owned = state.kits.filter((k) => k.collection_type === 'owned');
    const wishlist = state.kits.filter((k) => k.collection_type === 'wishlist');
    const backlog = owned.filter((k) => k.status === 'backlog');
    const building = owned.filter((k) =>
      ['building', 'panel_lining', 'painting', 'on_hold'].includes(k.status)
    );
    const finished = owned.filter((k) => k.status === 'finished');

    $('nav-count-all').textContent = state.kits.length;
    $('nav-count-owned').textContent = owned.length;
    $('nav-count-wishlist').textContent = wishlist.length;
    $('nav-count-backlog').textContent = backlog.length;
    $('nav-count-building').textContent = building.length;
    $('nav-count-finished').textContent = finished.length;

    $('stat-owned').textContent = owned.length;
    const totalOwnedValue = owned.reduce((acc, k) => acc + (Number(k.price) || 0), 0);
    $('stat-owned-val').textContent = `${totalOwnedValue.toFixed(2)} total value`;

    $('stat-backlog').textContent = backlog.length;
    $('stat-building').textContent = building.length;
    $('stat-finished').textContent = finished.length;
    const rate = owned.length ? Math.round((finished.length / owned.length) * 100) : 0;
    $('stat-completion-rate').textContent = `${rate}% completion rate`;

    $('stat-wishlist').textContent = wishlist.length;
    const totalPhotos = state.kits.reduce((acc, k) => acc + (k.photo_count || 0), 0);
    const totalManuals = state.kits.reduce((acc, k) => acc + (k.manual_count || 0), 0);
    $('stat-media-count').textContent = `${totalPhotos} stances · ${totalManuals} manuals`;

    // Populate dynamic display locations dropdown (Idea 3)
    const locations = Array.from(
      new Set(state.kits.map((k) => k.display_location).filter(Boolean))
    ).sort();
    const locSelect = $('filter-location');
    const currentLoc = state.filterLocation;
    locSelect.innerHTML =
      `<option value="">All Display Locations</option>` +
      locations
        .map(
          (loc) =>
            `<option value="${escapeHtml(loc)}" ${loc === currentLoc ? 'selected' : ''}>📍 ${escapeHtml(loc)}</option>`
        )
        .join('');

    // Render dynamic categories in sidebar
    const catCounts = {};
    for (const k of state.kits) {
      const c = k.category || 'Uncategorized';
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    const catContainer = $('sidebar-categories');
    catContainer.innerHTML = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([cat, count]) => `
        <button type="button" class="nav-item ${state.activeNav === `cat:${cat}` ? 'active' : ''}" data-nav="cat:${escapeHtml(cat)}">
          <span class="nav-icon">▸</span>
          <span>${escapeHtml(cat)}</span>
          <span class="nav-badge">${count}</span>
        </button>
      `
      )
      .join('');

    catContainer.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => switchNavigation(btn.dataset.nav));
    });
  }

  function getFilteredKits() {
    let list = [...state.kits];

    // Sidebar filter
    if (state.activeNav === 'owned') {
      list = list.filter((k) => k.collection_type === 'owned');
    } else if (state.activeNav === 'wishlist') {
      list = list.filter((k) => k.collection_type === 'wishlist');
    } else if (state.activeNav.startsWith('status:')) {
      const st = state.activeNav.split(':')[1];
      if (st === 'building') {
        list = list.filter((k) =>
          ['building', 'panel_lining', 'painting', 'on_hold'].includes(k.status)
        );
      } else {
        list = list.filter((k) => k.status === st);
      }
    } else if (state.activeNav.startsWith('cat:')) {
      const cat = state.activeNav.slice(4);
      list = list.filter((k) => k.category === cat);
    }

    // Toolbar dropdown filters
    if (state.filterCategory) {
      list = list.filter((k) => k.category === state.filterCategory);
    }
    if (state.filterStatus) {
      list = list.filter((k) => k.status === state.filterStatus);
    }
    if (state.filterLocation) {
      list = list.filter((k) => k.display_location === state.filterLocation);
    }

    // Search query (includes display_location and storage_box)
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter((k) =>
        [
          k.name,
          k.brand,
          k.series,
          k.grade_scale,
          k.model_number,
          k.category,
          k.display_location,
          k.storage_box,
          k.notes
        ]
          .filter(Boolean)
          .some((val) => val.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      if (state.sortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (state.sortBy === 'status') return a.status.localeCompare(b.status);
      if (state.sortBy === 'price_desc') return (Number(b.price) || 0) - (Number(a.price) || 0);
      if (state.sortBy === 'rating_desc') return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      if (state.sortBy === 'release_asc') {
        return (a.release_date || '9999').localeCompare(b.release_date || '9999');
      }
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });

    return list;
  }

  function renderKitsGrid() {
    const filtered = getFilteredKits();
    const grid = $('kits-grid');
    const empty = $('empty-state');

    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = filtered
      .map((kit) => {
        const statusLabel = STATUS_LABELS[kit.status] || kit.status;
        const stars = kit.rating ? '★'.repeat(kit.rating) + '☆'.repeat(5 - kit.rating) : '';
        let priceDisplay = '';
        if (kit.price !== null && kit.price !== undefined) {
          priceDisplay = `${escapeHtml(kit.currency)} ${Number(kit.price).toFixed(2)}`;
          if (kit.retail_price !== null && kit.retail_price !== undefined) {
            priceDisplay += ` <small style="color:var(--text-muted)">(MSRP ${Number(kit.retail_price).toFixed(2)})</small>`;
          }
        }

        const locBadges = [];
        if (kit.display_location) {
          locBadges.push(`<span class="kit-location-tag">📍 ${escapeHtml(kit.display_location)}</span>`);
        }
        if (kit.storage_box) {
          locBadges.push(`<span class="kit-location-tag">🗃️ ${escapeHtml(kit.storage_box)}</span>`);
        }
        if (kit.collection_type === 'wishlist' && kit.release_date) {
          locBadges.push(`<span class="kit-location-tag">📅 ${escapeHtml(kit.release_date)}</span>`);
        }

        return `
        <article class="kit-card" data-kit-id="${kit.id}">
          <div class="kit-card-media">
            ${
              kit.cover_url
                ? `<img src="${escapeHtml(kit.cover_url)}" alt="${escapeHtml(kit.name)}" loading="lazy" />`
                : `<div class="kit-placeholder">
                    <span class="kit-placeholder-icon">${kit.collection_type === 'wishlist' ? '★' : '🤖'}</span>
                    <span>No stance photo yet</span>
                   </div>`
            }
            <div class="kit-card-overlays">
              <span class="status-badge status-${escapeHtml(kit.status)}">${escapeHtml(statusLabel)}</span>
              ${
                kit.collection_type === 'wishlist' && kit.priority === 'high'
                  ? `<span class="badge badge-amber">Grail</span>`
                  : ''
              }
            </div>
            <div class="kit-card-counters">
              <span class="counter-pill" title="Stance Photos">📸 ${kit.photo_count || 0}</span>
              <span class="counter-pill" title="Building Manuals">📘 ${kit.manual_count || 0}</span>
            </div>
          </div>
          <div class="kit-card-body">
            <div class="kit-card-tags">
              <span>${escapeHtml(kit.category)}</span>
              ${kit.grade_scale ? `<span>· ${escapeHtml(kit.grade_scale)}</span>` : ''}
            </div>
            <h3 class="kit-card-title">${escapeHtml(kit.name)}</h3>
            <div class="kit-card-sub">
              ${[kit.brand, kit.series, kit.model_number].filter(Boolean).map(escapeHtml).join(' · ') || 'No brand/series specified'}
            </div>
            ${locBadges.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${locBadges.join('')}</div>` : ''}
            <div class="kit-card-footer">
              <span>${priceDisplay}</span>
              <span class="stars">${stars}</span>
            </div>
          </div>
        </article>
      `;
      })
      .join('');

    grid.querySelectorAll('.kit-card').forEach((card) => {
      card.addEventListener('click', () => {
        openKitDetail(Number(card.dataset.kitId));
      });
    });
  }

  // IDEA 4: RENDER ANALYTICS & COST TRACKING DASHBOARD
  function renderAnalyticsView() {
    const owned = state.kits.filter((k) => k.collection_type === 'owned');
    const wishlist = state.kits.filter((k) => k.collection_type === 'wishlist');

    const totalOwnedSpend = owned.reduce((s, k) => s + (Number(k.price) || 0), 0);
    const totalOwnedMsrp = owned.reduce(
      (s, k) => s + (Number(k.retail_price ?? k.price) || 0),
      0
    );
    const totalWishlistCost = wishlist.reduce(
      (s, k) => s + (Number(k.price ?? k.retail_price) || 0),
      0
    );
    const savingsDiff = totalOwnedMsrp - totalOwnedSpend;

    $('analytics-summary-cards').innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Total Hangar Spend</span>
        <strong class="stat-value text-sky">${totalOwnedSpend.toFixed(2)}</strong>
        <span class="stat-sub">Across ${owned.length} owned kits</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">MSRP vs. Paid Savings</span>
        <strong class="stat-value ${savingsDiff >= 0 ? 'text-emerald' : 'text-amber'}">
          ${savingsDiff >= 0 ? '+' : ''}${savingsDiff.toFixed(2)}
        </strong>
        <span class="stat-sub">${savingsDiff >= 0 ? 'Saved below retail MSRP' : 'Paid above retail MSRP'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Wishlist Target Budget</span>
        <strong class="stat-value text-amber">${totalWishlistCost.toFixed(2)}</strong>
        <span class="stat-sub">Across ${wishlist.length} wishlist kits</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Display &amp; Storage Tracked</span>
        <strong class="stat-value">${state.kits.filter((k) => k.display_location || k.storage_box).length}</strong>
        <span class="stat-sub">Kits with shelf or spare box indexed</span>
      </div>
    `;

    // Helper to render horizontal bar chart
    const renderBars = (containerId, rows) => {
      const el = $(containerId);
      if (!rows.length) {
        el.innerHTML = `<p class="view-subtitle">No data recorded yet.</p>`;
        return;
      }
      const maxVal = Math.max(...rows.map((r) => r.value), 1);
      el.innerHTML = rows
        .map(
          (r) => `
          <div class="bar-row">
            <div class="bar-row-header">
              <strong>${escapeHtml(r.label)}</strong>
              <span>${escapeHtml(r.rightText)}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${Math.max(4, Math.round((r.value / maxVal) * 100))}%"></div>
            </div>
          </div>
        `
        )
        .join('');
    };

    // 1. Pipeline breakdown
    const statusOrder = ['backlog', 'building', 'panel_lining', 'painting', 'finished', 'on_hold'];
    const pipelineRows = statusOrder
      .map((st) => {
        const count = owned.filter((k) => k.status === st).length;
        return {
          label: STATUS_LABELS[st],
          value: count,
          rightText: `${count} kit${count === 1 ? '' : 's'}`
        };
      })
      .filter((r) => r.value > 0);
    renderBars('chart-pipeline', pipelineRows);

    // 2. Spend & count by Brand
    const brandMap = {};
    for (const k of owned) {
      const b = k.brand || 'Unspecified Brand';
      if (!brandMap[b]) brandMap[b] = { count: 0, spend: 0 };
      brandMap[b].count++;
      brandMap[b].spend += Number(k.price) || 0;
    }
    const brandRows = Object.entries(brandMap)
      .sort((a, b) => b[1].spend - a[1].spend || b[1].count - a[1].count)
      .map(([brand, info]) => ({
        label: brand,
        value: info.spend || info.count,
        rightText: `${info.count} kits · ${info.spend.toFixed(2)}`
      }));
    renderBars('chart-brands', brandRows);

    // 3. Grade / Scale breakdown
    const gradeMap = {};
    for (const k of state.kits) {
      const g = k.grade_scale || 'Unspecified Grade/Scale';
      gradeMap[g] = (gradeMap[g] || 0) + 1;
    }
    const gradeRows = Object.entries(gradeMap)
      .sort((a, b) => b[1] - a[1])
      .map(([g, count]) => ({
        label: g,
        value: count,
        rightText: `${count} kit${count === 1 ? '' : 's'}`
      }));
    renderBars('chart-grades', gradeRows);

    // 4. Display Locations breakdown
    const locMap = {};
    for (const k of owned) {
      const loc = k.display_location || 'Unassigned Shelf / Location';
      locMap[loc] = (locMap[loc] || 0) + 1;
    }
    const locRows = Object.entries(locMap)
      .sort((a, b) => b[1] - a[1])
      .map(([loc, count]) => ({
        label: loc,
        value: count,
        rightText: `${count} kit${count === 1 ? '' : 's'}`
      }));
    renderBars('chart-locations', locRows);

    // 5. Wishlist table
    const tbody = $('analytics-wishlist-tbody');
    if (!wishlist.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No kits in your wishlist yet.</td></tr>`;
    } else {
      tbody.innerHTML = wishlist
        .map((k) => {
          const street = k.price !== null && k.price !== undefined ? Number(k.price) : null;
          const msrp =
            k.retail_price !== null && k.retail_price !== undefined ? Number(k.retail_price) : null;
          let dealHtml = '—';
          if (street !== null && msrp !== null && msrp > 0) {
            const diff = street - msrp;
            const pct = Math.round((diff / msrp) * 100);
            if (diff <= 0) {
              dealHtml = `<span class="text-emerald">${diff.toFixed(2)} (${pct}% below MSRP)</span>`;
            } else {
              dealHtml = `<span class="text-amber">+${diff.toFixed(2)} (+${pct}% markup)</span>`;
            }
          }
          return `
            <tr>
              <td><strong>${escapeHtml(k.name)}</strong></td>
              <td>${escapeHtml([k.brand, k.grade_scale].filter(Boolean).join(' · ') || '—')}</td>
              <td><span class="badge ${k.priority === 'high' ? 'badge-amber' : ''}">${escapeHtml((k.priority || 'medium').toUpperCase())}</span></td>
              <td>${escapeHtml(k.release_date || 'TBA')}</td>
              <td>${street !== null ? `${escapeHtml(k.currency)} ${street.toFixed(2)}` : '—'}</td>
              <td>${msrp !== null ? `${escapeHtml(k.currency)} ${msrp.toFixed(2)}` : '—'}</td>
              <td>${dealHtml}</td>
            </tr>
          `;
        })
        .join('');
    }
  }

  function switchNavigation(navKey) {
    state.activeNav = navKey;
    document.querySelectorAll('.sidebar-nav .nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === navKey);
    });

    $('catalogue-view').classList.add('hidden');
    $('analytics-view').classList.add('hidden');
    $('portability-view').classList.add('hidden');
    $('admin-view').classList.add('hidden');
    $('settings-view').classList.add('hidden');

    if (navKey === 'settings') {
      $('settings-view').classList.remove('hidden');
      $('view-title').textContent = 'Account & AI Settings';
      $('view-subtitle').textContent =
        'Personal AI extraction provider and user account security';
      loadUserSettings();
      return;
    }

    if (navKey === 'admin') {
      $('admin-view').classList.remove('hidden');
      $('view-title').textContent = 'Admin Settings';
      $('view-subtitle').textContent = 'Branding, server registration policy, and user management';
      loadAdminUsers();
      return;
    }

    if (navKey === 'analytics') {
      $('analytics-view').classList.remove('hidden');
      $('view-title').textContent = 'Hangar Analytics & Cost Tracker';
      $('view-subtitle').textContent =
        'Backlog breakdown, spend by brand & scale, display shelf distribution, and wishlist MSRP comparison';
      renderAnalyticsView();
      return;
    }

    if (navKey === 'portability') {
      $('portability-view').classList.remove('hidden');
      $('view-title').textContent = 'Backup, Import & Public Showcase';
      $('view-subtitle').textContent =
        'One-click full backup/restore, CSV/JSON import, and read-only public gallery link';
      syncShowcaseSettingsUI();
      return;
    }

    $('catalogue-view').classList.remove('hidden');

    const titles = {
      all: ['All Building Kits', 'Your complete owned collection and wishlist'],
      owned: ['Owned Collection', 'All kits currently in your hangar'],
      wishlist: ['Kit Wishlist', 'Upcoming kits and grails you plan to acquire'],
      'status:backlog': ['Backlog Queue', 'Owned kits waiting to be built'],
      'status:building': ['Active Workbench', 'Kits currently being built, panel-lined, or painted'],
      'status:finished': ['Finished Builds', 'Completed kits on display']
    };

    if (titles[navKey]) {
      $('view-title').textContent = titles[navKey][0];
      $('view-subtitle').textContent = titles[navKey][1];
    } else if (navKey.startsWith('cat:')) {
      const cat = navKey.slice(4);
      $('view-title').textContent = cat;
      $('view-subtitle').textContent = `Filtered by category: ${cat}`;
    }

    renderKitsGrid();
  }

  // CREATE / EDIT KIT MODAL
  function openKitFormModal(kit = null, defaultCollectionType = 'owned') {
    $('kit-form').reset();
    if (kit) {
      $('kit-form-title').textContent = `Edit Kit — ${kit.name}`;
      $('kit-id').value = kit.id;
      $('kit-collection-type').value = kit.collection_type;
      $('kit-status').value = kit.status;
      $('kit-name').value = kit.name;
      $('kit-category').value = kit.category || 'Gundam / Gunpla';
      $('kit-brand').value = kit.brand || '';
      $('kit-grade-scale').value = kit.grade_scale || '';
      $('kit-series').value = kit.series || '';
      $('kit-model-number').value = kit.model_number || '';
      $('kit-priority').value = kit.priority || 'medium';
      $('kit-display-location').value = kit.display_location || '';
      $('kit-storage-box').value = kit.storage_box || '';
      $('kit-price').value = kit.price !== null && kit.price !== undefined ? kit.price : '';
      $('kit-retail-price').value =
        kit.retail_price !== null && kit.retail_price !== undefined ? kit.retail_price : '';
      $('kit-currency').value = kit.currency || 'USD';
      $('kit-rating').value = kit.rating || '';
      $('kit-store-url').value = kit.store_url || '';
      $('kit-release-date').value = kit.release_date || '';
      $('kit-purchase-date').value = kit.purchase_date || '';
      $('kit-started-date').value = kit.started_date || '';
      $('kit-completed-date').value = kit.completed_date || '';
      $('kit-notes').value = kit.notes || '';
    } else {
      $('kit-form-title').textContent =
        defaultCollectionType === 'wishlist' ? 'Add Kit to Wishlist' : 'Add Owned Building Kit';
      $('kit-id').value = '';
      $('kit-collection-type').value = defaultCollectionType;
      $('kit-status').value = defaultCollectionType === 'wishlist' ? 'wishlist' : 'backlog';
      $('kit-category').value = 'Gundam / Gunpla';
      $('kit-currency').value = 'USD';
      $('kit-priority').value = 'medium';
      $('kit-auto-crawl').checked = false;
      $('kit-auto-crawl-group').classList.remove('hidden');
    }
    if (kit) {
      $('kit-auto-crawl-group').classList.add('hidden');
    }

    // Reset Smart Lookup panel
    if ($('kit-smart-lookup-input')) $('kit-smart-lookup-input').value = '';
    if ($('kit-autofill-image-url')) $('kit-autofill-image-url').value = '';
    if ($('kit-autofill-thumb-url')) $('kit-autofill-thumb-url').value = '';
    if ($('kit-lookup-status')) {
      $('kit-lookup-status').textContent = '';
      $('kit-lookup-status').classList.add('hidden');
    }
    if ($('kit-lookup-results')) {
      $('kit-lookup-results').innerHTML = '';
      $('kit-lookup-results').classList.add('hidden');
    }
    if ($('kit-autofill-cover-preview')) {
      $('kit-autofill-cover-preview').classList.add('hidden');
    }
    updateAiStatusIndicator();

    showModal('kit-form-modal');
    $('kit-name').focus();
  }

  // SMART KIT LOOKUP, AUTOFILL & PERSONAL AI CONFIGURATION
  const AI_PROVIDER_DEFAULTS = {
    gemini: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash'
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-haiku-latest'
    },
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-2.5-flash'
    },
    custom: {
      baseUrl: 'https://api.openai.com/v1',
      model: ''
    }
  };

  function updateAiStatusIndicator() {
    const label = $('kit-ai-status-label');
    if (!label) return;
    const ai = state.user?.aiSettings;
    if (ai && ai.hasApiKey && ai.enabled) {
      label.textContent = `AI Active (${ai.provider.toUpperCase()})`;
    } else if (ai && ai.hasApiKey) {
      label.textContent = `AI Paused (${ai.provider.toUpperCase()})`;
    } else {
      label.textContent = 'Configure AI Key';
    }
  }

  async function loadUserSettings() {
    if (!state.user) return;
    try {
      const res = await api('/api/user/ai-settings');
      const ai = res.aiSettings;
      state.user.aiSettings = ai;
      updateAiStatusIndicator();

      $('user-ai-account-handle').textContent = `@${state.user.username}`;
      $('user-ai-enabled').checked = Boolean(ai.enabled);
      $('user-ai-provider').value = ai.provider || 'gemini';
      $('user-ai-model').value = ai.model || AI_PROVIDER_DEFAULTS[ai.provider || 'gemini']?.model || '';
      $('user-ai-base-url').value = ai.baseUrl || '';
      $('user-ai-base-url').placeholder =
        AI_PROVIDER_DEFAULTS[ai.provider || 'gemini']?.baseUrl || 'https://...';
      $('user-ai-api-key').value = '';

      const keyBadge = $('user-ai-key-badge');
      if (ai.hasApiKey) {
        keyBadge.textContent = `Encrypted Key Saved (${ai.maskedKey})`;
        keyBadge.className = 'badge badge-cyan';
      } else {
        keyBadge.textContent = 'No API key stored';
        keyBadge.className = 'badge badge-outline';
      }

      $('user-ai-test-result').classList.add('hidden');
      $('user-profile-displayname').value = state.user.displayName || state.user.username;
      $('user-profile-password').value = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function openUserSettingsModal() {
    switchNavigation('settings');
  }

  function applyAutofillToKitForm(kitData, sourceName = '') {
    if (!kitData) return;

    if (kitData.name) $('kit-name').value = kitData.name;
    if (kitData.category) $('kit-category').value = kitData.category;
    if (kitData.brand) $('kit-brand').value = kitData.brand;
    if (kitData.gradeScale) $('kit-grade-scale').value = kitData.gradeScale;
    if (kitData.series) $('kit-series').value = kitData.series;
    if (kitData.modelNumber) $('kit-model-number').value = kitData.modelNumber;
    if (kitData.retailPrice !== null && kitData.retailPrice !== undefined && kitData.retailPrice !== '') {
      $('kit-retail-price').value = kitData.retailPrice;
    }
    if (kitData.currency) $('kit-currency').value = kitData.currency;
    if (kitData.releaseDate) $('kit-release-date').value = kitData.releaseDate;
    if (kitData.storeUrl || kitData.sourceUrl) {
      $('kit-store-url').value = kitData.storeUrl || kitData.sourceUrl;
    }
    if (kitData.notes && !$('kit-notes').value.trim()) {
      $('kit-notes').value = kitData.notes;
    }

    const imgUrl = kitData.imageUrl || '';
    const thumbUrl = kitData.thumbnailUrl || imgUrl;
    if (imgUrl) {
      $('kit-autofill-image-url').value = imgUrl;
      $('kit-autofill-thumb-url').value = thumbUrl;
      $('kit-autofill-cover-img').src = thumbUrl;
      $('kit-autofill-cover-preview').classList.remove('hidden');
    }

    if (sourceName) {
      showToast(`Autofilled from ${sourceName}!`, 'success');
    }
  }

  async function performSmartKitSearch() {
    const input = $('kit-smart-lookup-input');
    const q = (input.value || $('kit-name').value || '').trim();
    if (!q) {
      showToast('Enter a kit name, model code, barcode, or URL first.', 'error');
      input.focus();
      return;
    }

    // If user pasted a direct URL, run the deep extractor directly
    if (/^https?:\/\//i.test(q)) {
      return performSmartKitExtract({ url: q });
    }

    const statusEl = $('kit-lookup-status');
    const resultsEl = $('kit-lookup-results');
    const btn = $('kit-smart-search-btn');

    statusEl.textContent = `Searching KitCatalogue DB, Gundam Wiki & Web for "${q}"...`;
    statusEl.classList.remove('hidden');
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    btn.disabled = true;

    try {
      const data = await api(`/api/kits/lookup?q=${encodeURIComponent(q)}`);
      const results = data.results || [];
      if (!results.length) {
        statusEl.textContent = `No direct database matches for "${q}". Click "⚡ Smart Fill" to run heuristic / AI extraction.`;
        return;
      }

      statusEl.textContent = `Found ${results.length} candidate(s) — click any match to autofill form fields:`;
      resultsEl.classList.remove('hidden');

      resultsEl.innerHTML = results
        .map(
          (r, idx) => `
          <div class="smart-lookup-item">
            ${
              r.thumbnailUrl || r.imageUrl
                ? `<img class="smart-lookup-thumb" src="${escapeHtml(r.thumbnailUrl || r.imageUrl)}" alt="" loading="lazy" />`
                : `<div class="smart-lookup-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🤖</div>`
            }
            <div class="smart-lookup-meta">
              <strong>${escapeHtml(r.name)}</strong>
              <div class="smart-lookup-badges">
                ${r.brand ? `<span>🏭 ${escapeHtml(r.brand)}</span>` : ''}
                ${r.gradeScale ? `<span>📏 ${escapeHtml(r.gradeScale)}</span>` : ''}
                ${r.modelNumber ? `<span>🔢 ${escapeHtml(r.modelNumber)}</span>` : ''}
                ${r.series ? `<span>🎬 ${escapeHtml(r.series)}</span>` : ''}
                ${r.retailPrice ? `<span>💰 ${escapeHtml(String(r.retailPrice))} ${escapeHtml(r.currency || '')}</span>` : ''}
                <span class="badge badge-outline" style="font-size:0.68rem;">${escapeHtml(r.sourceName || 'Web')}</span>
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-pick-candidate="${idx}">⬇ Autofill</button>
          </div>
        `
        )
        .join('');

      resultsEl.querySelectorAll('[data-pick-candidate]').forEach((pickBtn) => {
        pickBtn.addEventListener('click', async () => {
          const candidate = results[Number(pickBtn.dataset.pickCandidate)];
          applyAutofillToKitForm(candidate, candidate.sourceName || 'Lookup');

          // If user has personal AI enabled, refine the selected candidate with AI
          if (state.user?.aiSettings?.enabled && state.user?.aiSettings?.hasApiKey) {
            await performSmartKitExtract({ candidate, query: q, silent: false });
          }
        });
      });
    } catch (err) {
      statusEl.textContent = `Lookup error: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  async function performSmartKitExtract({ url = '', query = '', candidate = null, silent = false } = {}) {
    const rawInput = ($('kit-smart-lookup-input').value || $('kit-name').value || '').trim();
    const targetUrl = url || (/^https?:\/\//i.test(rawInput) ? rawInput : '');
    const targetQuery = query || rawInput;

    if (!targetUrl && !targetQuery && !candidate) {
      showToast('Type a kit name, barcode, or paste a store/wiki URL first.', 'error');
      $('kit-smart-lookup-input').focus();
      return;
    }

    const statusEl = $('kit-lookup-status');
    const extractBtn = $('kit-smart-extract-btn');
    extractBtn.disabled = true;
    const origText = extractBtn.textContent;
    extractBtn.textContent = '⏳ Extracting...';

    const aiActive = Boolean(state.user?.aiSettings?.enabled && state.user?.aiSettings?.hasApiKey);
    statusEl.textContent = aiActive
      ? 'Extracting metadata & consulting your personal AI assistant...'
      : 'Extracting kit metadata from web & database sources...';
    statusEl.classList.remove('hidden');

    try {
      const res = await api('/api/kits/extract', {
        method: 'POST',
        body: {
          url: targetUrl,
          query: targetQuery,
          candidate,
          useAi: true
        }
      });

      applyAutofillToKitForm(res.kit, silent ? '' : res.source);
      if (res.aiError) {
        statusEl.textContent = `Autofilled via ${res.source} (Note: AI provider returned: ${res.aiError})`;
      } else {
        statusEl.textContent = `✓ Autofilled via ${res.source}`;
      }
    } catch (err) {
      statusEl.textContent = `Extraction failed: ${err.message}`;
      showToast(err.message, 'error');
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = origText;
    }
  }

  // IDEA 5: GENERATE QUICK LOOKUP LINKS (Dalong, 1999.co.jp HobbySearch, Scalemates, Mech9, Hpoi)
  function buildQuickLookupLinks(kit) {
    const queryTerms = [kit.brand, kit.grade_scale, kit.name, kit.model_number]
      .filter(Boolean)
      .join(' ')
      .trim();
    const shortQuery = [kit.name, kit.model_number].filter(Boolean).join(' ').trim();
    const encodedFull = encodeURIComponent(queryTerms);
    const encodedShort = encodeURIComponent(shortQuery);

    return [
      {
        label: '1999.co.jp (Manual & Runner Scans)',
        url: `https://www.1999.co.jp/eng/search?typ1_c=109&cat=&state=&sold=0&sortid=6&searchkey=${encodedShort}`
      },
      {
        label: 'Dalong.net (Gunpla Reviews & Manuals)',
        url: `https://www.google.com/search?q=${encodeURIComponent(`site:dalong.net ${shortQuery}`)}`
      },
      {
        label: 'Scalemates (Kit Database & PDFs)',
        url: `https://www.scalemates.com/search.php?fkSECTION[]=Kits&q=${encodedFull}`
      },
      {
        label: 'Mech9 (Translated Manuals & Color Guides)',
        url: `https://www.google.com/search?q=${encodeURIComponent(`site:mech9.com ${shortQuery}`)}`
      }
    ];
  }

  // IN-APP WEB IMAGE SEARCH LOGIC
  async function performWebImageSearch(query) {
    const statusEl = $('image-search-status');
    const resultsGrid = $('image-search-results');
    const submitBtn = $('image-search-submit-btn');

    statusEl.textContent = `Searching web for "${query}"...`;
    resultsGrid.innerHTML = '';
    submitBtn.disabled = true;

    try {
      const data = await api(`/api/images/search?q=${encodeURIComponent(query)}`);
      const items = data.results || [];
      if (!items.length) {
        statusEl.textContent = `No images found for "${query}". Try adjusting your keywords.`;
        return;
      }

      statusEl.textContent = `Found ${items.length} images. Click "Select Image" to attach to your kit:`;
      resultsGrid.innerHTML = items
        .map(
          (item, idx) => `
        <div class="web-image-card">
          <div class="web-image-thumb">
            <img src="${escapeHtml(item.thumbnail || item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" />
          </div>
          <div class="web-image-info">
            <span class="web-image-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
            <button type="button" class="btn btn-primary btn-sm web-image-select-btn" data-web-img-idx="${idx}">
              ✓ Select Image
            </button>
          </div>
        </div>
      `
        )
        .join('');

      resultsGrid.querySelectorAll('[data-web-img-idx]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.dataset.webImgIdx);
          const chosen = items[idx];
          if (!chosen || !state.activeKitId) return;

          btn.disabled = true;
          btn.textContent = 'Importing...';
          try {
            const res = await api(`/api/kits/${state.activeKitId}/photos/from-url`, {
              method: 'POST',
              body: {
                image_url: chosen.image || chosen.thumbnail,
                fallback_url: chosen.thumbnail || '',
                stance_name: $('image-search-stance').value.trim() || 'Cover / Box Art',
                caption: chosen.title || 'Web search import',
                is_cover: $('image-search-cover').checked
              }
            });
            replaceKitInState(res.kit);
            renderKitDetailModal(res.kit);
            $('image-search-modal').classList.add('hidden');
            showToast('Web image attached as kit cover/stance!', 'success');
          } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = '✓ Select Image';
          }
        });
      });
    } catch (err) {
      statusEl.textContent = `Search error: ${err.message}`;
    } finally {
      submitBtn.disabled = false;
    }
  }

  // KIT DETAIL MODAL (STANCES, MANUALS, QUICK LOOKUPS, STORAGE)
  function openKitDetail(kitId) {
    const kit = state.kits.find((k) => k.id === kitId);
    if (!kit) return;
    state.activeKitId = kit.id;
    renderKitDetailModal(kit);
    showModal('kit-detail-modal');
  }

  function renderKitDetailModal(kit) {
    const readOnly = state.showcaseMode;

    $('detail-name').textContent = kit.name;
    $('detail-collection-badge').textContent =
      kit.collection_type === 'wishlist' ? '★ Wishlist' : '📦 Owned';
    $('detail-collection-badge').className = `badge ${
      kit.collection_type === 'wishlist' ? 'badge-amber' : 'badge-cyan'
    }`;
    $('detail-category-badge').textContent = kit.category || 'Kit';

    if (kit.grade_scale) {
      $('detail-grade-badge').textContent = kit.grade_scale;
      $('detail-grade-badge').classList.remove('hidden');
    } else {
      $('detail-grade-badge').classList.add('hidden');
    }

    if (kit.display_location) {
      $('detail-location-badge').textContent = `📍 ${kit.display_location}`;
      $('detail-location-badge').classList.remove('hidden');
    } else {
      $('detail-location-badge').classList.add('hidden');
    }

    $('detail-subtitle').textContent =
      [kit.brand, kit.series, kit.model_number].filter(Boolean).join(' · ') ||
      'Building Kit Entry';

    // Hide edit/delete/upload controls when in read-only Showcase mode
    $('detail-toggle-wishlist-btn').classList.toggle('hidden', readOnly);
    $('detail-edit-btn').classList.toggle('hidden', readOnly);
    $('detail-delete-btn').classList.toggle('hidden', readOnly);
    $('upload-photo-form').classList.toggle('hidden', readOnly);
    $('upload-manual-form').classList.toggle('hidden', readOnly);
    $('detail-quick-status').disabled = readOnly;

    $('detail-toggle-wishlist-btn').textContent =
      kit.collection_type === 'wishlist' ? '📦 Move to Owned' : '★ Move to Wishlist';

    $('detail-quick-status').value = kit.status;
    $('detail-photo-count').textContent = (kit.photos || []).length;
    $('detail-manual-count').textContent = (kit.manuals || []).length;

    const pills = [];
    if (kit.price !== null && kit.price !== undefined) {
      let priceStr = `💰 ${escapeHtml(kit.currency)} ${Number(kit.price).toFixed(2)}`;
      if (kit.retail_price !== null && kit.retail_price !== undefined) {
        priceStr += ` (MSRP ${Number(kit.retail_price).toFixed(2)})`;
      }
      pills.push(priceStr);
    }
    if (kit.storage_box) {
      pills.push(`🗃️ Spare Parts: ${escapeHtml(kit.storage_box)}`);
    }
    if (kit.rating) {
      pills.push(`⭐ ${kit.rating}/5`);
    }
    if (kit.store_url) {
      pills.push(
        `<a href="${escapeHtml(kit.store_url)}" target="_blank" rel="noopener" style="color:var(--accent-sky)">Store Link ↗</a>`
      );
    }
    $('detail-meta-pills').innerHTML = pills.join(' · ');

    // Render Idea 5 Quick Lookup buttons
    const lookups = buildQuickLookupLinks(kit);
    $('detail-lookup-links').innerHTML = lookups
      .map(
        (lk) =>
          `<a href="${escapeHtml(lk.url)}" target="_blank" rel="noopener" class="lookup-pill">${escapeHtml(lk.label)} ↗</a>`
      )
      .join('');

    // Render Stances Gallery
    const gallery = $('stances-gallery');
    const photos = kit.photos || [];
    if (photos.length === 0) {
      gallery.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 34px;">
          <p style="margin-bottom:0">No stance photos uploaded yet.</p>
        </div>
      `;
    } else {
      gallery.innerHTML = photos
        .map(
          (p) => `
        <div class="stance-card">
          <div class="stance-img-wrap" data-lightbox-url="${escapeHtml(p.url)}" data-lightbox-stance="${escapeHtml(p.stance_name)}" data-lightbox-caption="${escapeHtml(p.caption)}">
            <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.stance_name)}" loading="lazy" />
            <span class="stance-badge">${escapeHtml(p.stance_name)}</span>
            ${p.is_cover ? `<span class="cover-star">COVER</span>` : ''}
          </div>
          <div class="stance-card-body">
            <div class="stance-caption">${escapeHtml(p.caption || p.original_name)}</div>
            ${
              !readOnly
                ? `<div class="stance-actions">
                    ${
                      !p.is_cover
                        ? `<button type="button" class="btn btn-secondary btn-sm" data-set-cover="${p.id}">Set Cover</button>`
                        : `<span></span>`
                    }
                    <button type="button" class="btn btn-danger btn-sm" data-delete-photo="${p.id}">Delete</button>
                  </div>`
                : ''
            }
          </div>
        </div>
      `
        )
        .join('');

      gallery.querySelectorAll('[data-lightbox-url]').forEach((el) => {
        el.addEventListener('click', () => {
          $('lightbox-img').src = el.dataset.lightboxUrl;
          $('lightbox-stance').textContent = el.dataset.lightboxStance;
          $('lightbox-text').textContent = el.dataset.lightboxCaption || '';
          showModal('lightbox-modal');
        });
      });

      gallery.querySelectorAll('[data-set-cover]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api(`/api/photos/${btn.dataset.setCover}`, {
              method: 'PUT',
              body: { is_cover: true }
            });
            replaceKitInState(res.kit);
            renderKitDetailModal(res.kit);
            showToast('Updated kit cover photo', 'success');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      gallery.querySelectorAll('[data-delete-photo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api(`/api/photos/${btn.dataset.deletePhoto}`, {
              method: 'DELETE'
            });
            replaceKitInState(res.kit);
            renderKitDetailModal(res.kit);
            showToast('Stance photo deleted');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    }

    // Render Manuals List
    const manualsList = $('manuals-list');
    const manuals = kit.manuals || [];
    $('manual-viewer-container').classList.add('hidden');

    if (manuals.length === 0) {
      manualsList.innerHTML = `
        <div class="empty-state" style="padding: 34px;">
          <p style="margin-bottom:0">No building manuals attached yet. Use the Quick Lookup links above to find scans on 1999.co.jp / Dalong, or upload a PDF/URL.</p>
        </div>
      `;
    } else {
      manualsList.innerHTML = manuals
        .map((m) => {
          const isLocal = Boolean(m.filename);
          return `
          <div class="manual-item">
            <div class="manual-info">
              <span class="manual-icon">${isLocal ? '📕' : '🔗'}</span>
              <div>
                <strong>${escapeHtml(m.title)}</strong>
                <div class="manual-meta">
                  ${isLocal ? `${escapeHtml(m.original_name)} (${formatBytes(m.file_size)})` : escapeHtml(m.external_url)}
                  ${m.notes ? ` · <em>${escapeHtml(m.notes)}</em>` : ''}
                </div>
              </div>
            </div>
            <div class="manual-actions">
              ${
                isLocal
                  ? `<button type="button" class="btn btn-primary btn-sm" data-preview-manual="${escapeHtml(m.url)}" data-preview-title="${escapeHtml(m.title)}">Preview Manual</button>`
                  : ''
              }
              <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Open / Download ↗</a>
              ${
                !readOnly
                  ? `<button type="button" class="btn btn-danger btn-sm" data-delete-manual="${m.id}">Delete</button>`
                  : ''
              }
            </div>
          </div>
        `;
        })
        .join('');

      manualsList.querySelectorAll('[data-preview-manual]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.previewManual;
          $('manual-viewer-title').textContent = btn.dataset.previewTitle;
          $('manual-viewer-open-tab').href = url;
          $('manual-viewer-iframe').src = url;
          $('manual-viewer-container').classList.remove('hidden');
        });
      });

      manualsList.querySelectorAll('[data-delete-manual]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api(`/api/manuals/${btn.dataset.deleteManual}`, {
              method: 'DELETE'
            });
            replaceKitInState(res.kit);
            renderKitDetailModal(res.kit);
            showToast('Manual removed');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    }

    // Render Overview, Storage & Specs
    const specs = [
      ['Display Location', kit.display_location || '—'],
      ['Spare Parts / Box Index', kit.storage_box || '—'],
      ['Category', kit.category || '—'],
      ['Brand / Maker', kit.brand || '—'],
      ['Series / Line', kit.series || '—'],
      ['Grade / Scale', kit.grade_scale || '—'],
      ['Model / Code', kit.model_number || '—'],
      ['Priority', (kit.priority || 'medium').toUpperCase()],
      [
        'Paid / Current Price',
        kit.price !== null && kit.price !== undefined
          ? `${kit.currency} ${Number(kit.price).toFixed(2)}`
          : '—'
      ],
      [
        'Retail / MSRP',
        kit.retail_price !== null && kit.retail_price !== undefined
          ? `${kit.currency} ${Number(kit.retail_price).toFixed(2)}`
          : '—'
      ],
      ['Release / Restock Date', kit.release_date || '—'],
      ['Purchase Date', kit.purchase_date || '—'],
      ['Build Started', kit.started_date || '—'],
      ['Build Completed', kit.completed_date || '—']
    ];
    $('detail-specs-grid').innerHTML = specs
      .map(
        ([label, val]) => `
        <div class="spec-box">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(val)}</strong>
        </div>
      `
      )
      .join('');

    $('detail-notes-content').textContent =
      kit.notes || 'No custom build notes, paint recipes, or modification logs recorded yet.';
  }

  function replaceKitInState(updatedKit) {
    const idx = state.kits.findIndex((k) => k.id === updatedKit.id);
    if (idx > -1) {
      state.kits[idx] = updatedKit;
    } else {
      state.kits.unshift(updatedKit);
    }
    updateStatsAndCounts();
    renderKitsGrid();
  }

  // IDEA 6: CSV EXPORT & CSV PARSER
  function exportCatalogueCsv() {
    const headers = [
      'name',
      'category',
      'brand',
      'grade_scale',
      'series',
      'model_number',
      'collection_type',
      'status',
      'priority',
      'price',
      'retail_price',
      'currency',
      'display_location',
      'storage_box',
      'release_date',
      'purchase_date',
      'started_date',
      'completed_date',
      'store_url',
      'rating',
      'notes'
    ];
    const escapeCsv = (val) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const rows = [
      headers.join(','),
      ...state.kits.map((k) => headers.map((h) => escapeCsv(k[h])).join(','))
    ];
    triggerDownload(
      `kitcatalogue-export-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.join('\n'),
      'text/csv;charset=utf-8'
    );
  }

  function parseCsvToKits(csvText) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i];
      const next = csvText[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(current.trim());
          current = '';
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && next === '\n') i++;
          row.push(current.trim());
          if (row.some((cell) => cell !== '')) rows.push(row);
          row = [];
          current = '';
        } else {
          current += ch;
        }
      }
    }
    if (current || row.length) {
      row.push(current.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
    }

    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => h.toLowerCase().trim());
    return rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = r[idx] ?? '';
      });
      return obj;
    });
  }

  // ADMIN USER MANAGEMENT
  async function loadAdminUsers() {
    try {
      const data = await api('/api/admin/users');
      $('admin-allow-reg-toggle').checked = Boolean(data.settings.allowRegistration);
      if ($('admin-tagline-input') && data.settings && data.settings.appTagline) {
        $('admin-tagline-input').value = data.settings.appTagline;
      }
      if (data.settings?.legal) {
        if ($('admin-impressum-input')) {
          $('admin-impressum-input').value = data.settings.legal.impressumText || '';
        }
        if ($('admin-privacy-input')) {
          $('admin-privacy-input').value = data.settings.legal.privacyText || '';
        }
      }

      const tbody = $('admin-users-tbody');
      tbody.innerHTML = data.users
        .map(
          (u) => `
        <tr>
          <td>#${u.id}${u.id === 1 ? ' <span class="badge badge-amber" title="First registered user">Founder</span>' : ''}</td>
          <td>
            <strong>${escapeHtml(u.display_name)}</strong>
            <div style="font-size:0.78rem;color:var(--text-muted)">@${escapeHtml(u.username)}</div>
          </td>
          <td>
            <select data-admin-role="${u.id}" style="width:auto;padding:4px 8px;">
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </td>
          <td>
            <span class="badge ${u.disabled ? 'status-on_hold' : 'status-finished'}">
              ${u.disabled ? 'Disabled' : 'Active'}
            </span>
          </td>
          <td>${u.owned_count}</td>
          <td>${u.wishlist_count}</td>
          <td>${u.photo_count} photos · ${u.manual_count} manuals</td>
          <td>${escapeHtml((u.created_at || '').slice(0, 10))}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-secondary btn-sm" data-toggle-disable="${u.id}" data-disabled="${u.disabled}">
                ${u.disabled ? 'Enable' : 'Disable'}
              </button>
              ${
                u.id !== state.user.id
                  ? `<button type="button" class="btn btn-danger btn-sm" data-delete-user="${u.id}">Delete</button>`
                  : ''
              }
            </div>
          </td>
        </tr>
      `
        )
        .join('');

      tbody.querySelectorAll('[data-admin-role]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            await api(`/api/admin/users/${sel.dataset.adminRole}`, {
              method: 'PUT',
              body: { role: sel.value }
            });
            showToast('User role updated', 'success');
            loadAdminUsers();
          } catch (err) {
            showToast(err.message, 'error');
            loadAdminUsers();
          }
        });
      });

      tbody.querySelectorAll('[data-toggle-disable]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const isCurrentlyDisabled = Number(btn.dataset.disabled) === 1;
          try {
            await api(`/api/admin/users/${btn.dataset.toggleDisable}`, {
              method: 'PUT',
              body: { disabled: !isCurrentlyDisabled }
            });
            showToast('User status updated', 'success');
            loadAdminUsers();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      tbody.querySelectorAll('[data-delete-user]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this user and all their kits, photos, and manuals?')) return;
          try {
            await api(`/api/admin/users/${btn.dataset.deleteUser}`, { method: 'DELETE' });
            showToast('User deleted', 'success');
            loadAdminUsers();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function openLegalModal() {
    try {
      const data = await api('/api/legal');
      if ($('legal-trademark-text')) {
        $('legal-trademark-text').textContent = data.trademarkNotice || '';
      }
      if ($('legal-copyright-text')) {
        $('legal-copyright-text').textContent = data.copyrightNotice || '';
      }
      if ($('legal-impressum-content')) {
        $('legal-impressum-content').textContent =
          data.impressumText || 'Not configured by server administrator.';
      }
      if ($('legal-privacy-content')) {
        $('legal-privacy-content').textContent =
          data.privacyText ||
          'When accessing this service, technical connection data (e.g. IP address, browser user-agent) is processed temporarily to transmit HTTP content.';
      }
      $('legal-modal').classList.remove('hidden');
    } catch (err) {
      showToast(err.message || 'Failed to load legal information', 'error');
    }
  }

  // EVENT LISTENERS INITIALIZATION
  function initEvents() {
    $('tab-login').addEventListener('click', () => setAuthMode('login'));
    $('tab-register').addEventListener('click', () => setAuthMode('register'));

    $('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = $('auth-error');
      errBox.classList.add('hidden');

      const username = $('auth-username').value.trim();
      const displayName = $('auth-displayname').value.trim();
      const password = $('auth-password').value;

      try {
        const endpoint =
          state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const res = await api(endpoint, {
          method: 'POST',
          body: { username, displayName, password }
        });
        if (res.isFirstAdmin) {
          showToast('Welcome! Your account has been granted Administrator privileges.', 'success');
        } else {
          showToast(`Welcome, ${res.user.displayName}!`, 'success');
        }
        $('auth-form').reset();
        await checkAuth();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      }
    });

    $('logout-btn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      state.user = null;
      state.kits = [];
      await checkAuth();
    });

    // Sidebar navigation
    document.querySelectorAll('.sidebar-nav [data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => switchNavigation(btn.dataset.nav));
    });

    // Add Kit buttons
    $('add-kit-btn').addEventListener('click', () => openKitFormModal(null, 'owned'));
    $('add-wishlist-btn').addEventListener('click', () => openKitFormModal(null, 'wishlist'));
    $('empty-add-owned').addEventListener('click', () => openKitFormModal(null, 'owned'));
    $('empty-add-wishlist').addEventListener('click', () => openKitFormModal(null, 'wishlist'));

    // Auto-sync collection_type & status in form modal
    $('kit-collection-type').addEventListener('change', (e) => {
      if (e.target.value === 'wishlist') {
        $('kit-status').value = 'wishlist';
      } else if ($('kit-status').value === 'wishlist') {
        $('kit-status').value = 'backlog';
      }
    });

    // Save kit form
    $('kit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('kit-id').value;
      const payload = {
        collection_type: $('kit-collection-type').value,
        status: $('kit-status').value,
        name: $('kit-name').value.trim(),
        category: $('kit-category').value.trim() || 'Gundam / Gunpla',
        brand: $('kit-brand').value.trim(),
        grade_scale: $('kit-grade-scale').value.trim(),
        series: $('kit-series').value.trim(),
        model_number: $('kit-model-number').value.trim(),
        priority: $('kit-priority').value,
        display_location: $('kit-display-location').value.trim(),
        storage_box: $('kit-storage-box').value.trim(),
        price: $('kit-price').value,
        retail_price: $('kit-retail-price').value,
        currency: $('kit-currency').value,
        rating: $('kit-rating').value,
        store_url: $('kit-store-url').value.trim(),
        release_date: $('kit-release-date').value,
        purchase_date: $('kit-purchase-date').value,
        started_date: $('kit-started-date').value,
        completed_date: $('kit-completed-date').value,
        notes: $('kit-notes').value.trim(),
        cover_image_url: $('kit-autofill-image-url') ? $('kit-autofill-image-url').value.trim() : '',
        cover_thumbnail_url: $('kit-autofill-thumb-url') ? $('kit-autofill-thumb-url').value.trim() : '',
        auto_crawl_image: $('kit-auto-crawl') ? $('kit-auto-crawl').checked : false
      };

      const saveBtn = $('kit-save-btn');
      saveBtn.disabled = true;
      try {
        if (id) {
          let res = await api(`/api/kits/${id}`, { method: 'PUT', body: payload });
          if (payload.cover_image_url) {
            try {
              res = await api(`/api/kits/${id}/photos/from-url`, {
                method: 'POST',
                body: {
                  image_url: payload.cover_image_url,
                  thumbnail_url: payload.cover_thumbnail_url,
                  stance_name: 'Box Art / Web Cover',
                  caption: `Autofilled: ${payload.name}`,
                  is_cover: true
                }
              });
            } catch (_) {}
          }
          replaceKitInState(res.kit);
          $('kit-form-modal').classList.add('hidden');
          if (state.activeKitId === Number(id)) {
            renderKitDetailModal(res.kit);
            showModal('kit-detail-modal');
          }
          showToast('Kit updated!', 'success');
        } else {
          const res = await api('/api/kits', { method: 'POST', body: payload });
          replaceKitInState(res.kit);
          $('kit-form-modal').classList.add('hidden');
          showToast('Kit added to your catalogue!', 'success');
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });

    // Smart Kit Lookup & Personal AI Settings Events
    $('kit-smart-search-btn')?.addEventListener('click', () => performSmartKitSearch());
    $('kit-smart-extract-btn')?.addEventListener('click', () => performSmartKitExtract());
    $('kit-smart-lookup-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performSmartKitSearch();
      }
    });
    $('kit-autofill-cover-clear')?.addEventListener('click', () => {
      $('kit-autofill-image-url').value = '';
      $('kit-autofill-thumb-url').value = '';
      $('kit-autofill-cover-preview').classList.add('hidden');
    });

    $('user-chip-trigger')?.addEventListener('click', () => switchNavigation('settings'));
    $('kit-open-ai-config-btn')?.addEventListener('click', () => {
      $('kit-form-modal').classList.add('hidden');
      switchNavigation('settings');
    });

    $('user-ai-provider')?.addEventListener('change', (e) => {
      const prov = e.target.value;
      const defaults = AI_PROVIDER_DEFAULTS[prov] || { baseUrl: '', model: '' };
      $('user-ai-base-url').placeholder = defaults.baseUrl || 'https://...';
      $('user-ai-model').value = defaults.model || '';
    });

    $('user-ai-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = $('user-ai-save-btn');
      saveBtn.disabled = true;
      try {
        const res = await api('/api/user/ai-settings', {
          method: 'PUT',
          body: {
            provider: $('user-ai-provider').value,
            model: $('user-ai-model').value.trim(),
            baseUrl: $('user-ai-base-url').value.trim(),
            enabled: $('user-ai-enabled').checked,
            apiKey: $('user-ai-api-key').value.trim()
          }
        });
        state.user.aiSettings = res.aiSettings;
        $('user-ai-api-key').value = '';
        const keyBadge = $('user-ai-key-badge');
        if (res.aiSettings.hasApiKey) {
          keyBadge.textContent = `Encrypted Key Saved (${res.aiSettings.maskedKey})`;
          keyBadge.className = 'badge badge-cyan';
        } else {
          keyBadge.textContent = 'No API key stored';
          keyBadge.className = 'badge badge-outline';
        }
        updateAiStatusIndicator();
        showToast('Personal AI configuration saved securely!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });

    $('user-ai-test-btn')?.addEventListener('click', async () => {
      const btn = $('user-ai-test-btn');
      const statusEl = $('user-ai-test-result');
      btn.disabled = true;
      btn.textContent = '⏳ Testing...';
      statusEl.textContent = 'Sending test extraction prompt to your AI provider...';
      statusEl.classList.remove('hidden');

      try {
        const res = await api('/api/user/ai-settings/test', {
          method: 'POST',
          body: {
            provider: $('user-ai-provider').value,
            model: $('user-ai-model').value.trim(),
            baseUrl: $('user-ai-base-url').value.trim(),
            apiKey: $('user-ai-api-key').value.trim()
          }
        });
        statusEl.textContent = `✓ Connection verified (${res.provider} — ${res.model})! Sample parsed: "${res.sample?.name || 'OK'}" (${res.sample?.gradeScale || ''})`;
        showToast('AI connection verified!', 'success');
      } catch (err) {
        statusEl.textContent = `✗ Connection failed: ${err.message}`;
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '🧪 Test AI Connection';
      }
    });

    $('user-ai-clear-btn')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/user/ai-settings', {
          method: 'PUT',
          body: { clearApiKey: true, enabled: false }
        });
        state.user.aiSettings = res.aiSettings;
        $('user-ai-api-key').value = '';
        $('user-ai-enabled').checked = false;
        const keyBadge = $('user-ai-key-badge');
        keyBadge.textContent = 'No API key stored';
        keyBadge.className = 'badge badge-outline';
        updateAiStatusIndicator();
        showToast('Stored API key deleted from server.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('user-profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const displayName = $('user-profile-displayname').value.trim();
        const newPassword = $('user-profile-password').value;
        await api('/api/auth/profile', {
          method: 'PUT',
          body: { displayName, newPassword }
        });
        state.user.displayName = displayName;
        $('user-profile-password').value = '';
        renderUserSidebar();
        showToast('Account profile updated!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Search & Filters
    $('search-input').addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      renderKitsGrid();
    });
    $('filter-category').addEventListener('change', (e) => {
      state.filterCategory = e.target.value;
      renderKitsGrid();
    });
    $('filter-status').addEventListener('change', (e) => {
      state.filterStatus = e.target.value;
      renderKitsGrid();
    });
    $('filter-location').addEventListener('change', (e) => {
      state.filterLocation = e.target.value;
      renderKitsGrid();
    });
    $('sort-select').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderKitsGrid();
    });

    // Detail modal actions
    $('detail-quick-status').addEventListener('change', async (e) => {
      if (!state.activeKitId) return;
      const newStatus = e.target.value;
      const collection_type = newStatus === 'wishlist' ? 'wishlist' : 'owned';
      try {
        const res = await api(`/api/kits/${state.activeKitId}`, {
          method: 'PUT',
          body: { status: newStatus, collection_type }
        });
        replaceKitInState(res.kit);
        renderKitDetailModal(res.kit);
        showToast(`Status updated to ${STATUS_LABELS[newStatus]}`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('detail-toggle-wishlist-btn').addEventListener('click', async () => {
      const kit = state.kits.find((k) => k.id === state.activeKitId);
      if (!kit) return;
      const targetType = kit.collection_type === 'wishlist' ? 'owned' : 'wishlist';
      const targetStatus = targetType === 'wishlist' ? 'wishlist' : 'backlog';
      try {
        const res = await api(`/api/kits/${kit.id}`, {
          method: 'PUT',
          body: { collection_type: targetType, status: targetStatus }
        });
        replaceKitInState(res.kit);
        renderKitDetailModal(res.kit);
        showToast(
          targetType === 'owned' ? 'Moved kit to Owned Collection!' : 'Moved kit to Wishlist!',
          'success'
        );
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('detail-edit-btn').addEventListener('click', () => {
      const kit = state.kits.find((k) => k.id === state.activeKitId);
      if (kit) {
        $('kit-detail-modal').classList.add('hidden');
        openKitFormModal(kit);
      }
    });

    $('detail-delete-btn').addEventListener('click', async () => {
      if (!state.activeKitId) return;
      if (!confirm('Delete this kit and all its stance photos & manuals?')) return;
      try {
        await api(`/api/kits/${state.activeKitId}`, { method: 'DELETE' });
        state.kits = state.kits.filter((k) => k.id !== state.activeKitId);
        state.activeKitId = null;
        $('kit-detail-modal').classList.add('hidden');
        updateStatsAndCounts();
        renderKitsGrid();
        showToast('Kit deleted');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Detail tabs
    document.querySelectorAll('[data-detail-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.detailTab;
        document.querySelectorAll('[data-detail-tab]').forEach((b) => {
          b.classList.toggle('active', b === tabBtn);
        });
        $('detail-tab-stances').classList.toggle('hidden', target !== 'stances');
        $('detail-tab-manuals').classList.toggle('hidden', target !== 'manuals');
        $('detail-tab-overview').classList.toggle('hidden', target !== 'overview');
      });
    });

    // Upload stance photo
    $('upload-photo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeKitId) return;
      const files = $('photo-file-input').files;
      if (!files || !files.length) return;

      const formData = new FormData();
      formData.append('stance_name', $('photo-stance-input').value.trim() || 'Action Pose');
      formData.append('caption', $('photo-caption-input').value.trim());
      formData.append('is_cover', $('photo-cover-checkbox').checked ? 'true' : 'false');
      for (const file of files) {
        formData.append('photo', file);
      }

      const btn = $('photo-upload-btn');
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      try {
        const res = await api(`/api/kits/${state.activeKitId}/photos`, {
          method: 'POST',
          body: formData
        });
        replaceKitInState(res.kit);
        renderKitDetailModal(res.kit);
        $('photo-file-input').value = '';
        $('photo-caption-input').value = '';
        $('photo-cover-checkbox').checked = false;
        showToast('Stance photo(s) uploaded!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '+ Upload Stance';
      }
    });

    // Upload building manual
    $('upload-manual-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeKitId) return;
      const files = $('manual-file-input').files;
      const externalUrl = $('manual-url-input').value.trim();

      if ((!files || !files.length) && !externalUrl) {
        showToast('Please select a PDF/Image file or enter an external manual URL.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('title', $('manual-title-input').value.trim());
      formData.append('external_url', externalUrl);
      formData.append('notes', $('manual-notes-input').value.trim());
      if (files && files.length) {
        for (const f of files) {
          formData.append('manual', f);
        }
      }

      const btn = $('manual-upload-btn');
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      try {
        const res = await api(`/api/kits/${state.activeKitId}/manuals`, {
          method: 'POST',
          body: formData
        });
        replaceKitInState(res.kit);
        renderKitDetailModal(res.kit);
        $('upload-manual-form').reset();
        showToast('Building manual added!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '+ Add Manual';
      }
    });

    $('manual-viewer-close').addEventListener('click', () => {
      $('manual-viewer-iframe').src = 'about:blank';
      $('manual-viewer-container').classList.add('hidden');
    });

    // IN-APP WEB IMAGE SEARCH EVENTS
    $('open-web-search-modal-btn').addEventListener('click', () => {
      const kit = state.kits.find((k) => k.id === state.activeKitId);
      if (!kit) return;
      const defaultQuery = [kit.brand, kit.grade_scale, kit.name, 'box art']
        .filter(Boolean)
        .join(' ');
      $('image-search-input').value = defaultQuery;
      $('image-search-stance').value = 'Box Art / Web Cover';
      $('image-search-cover').checked = true;
      $('image-search-status').textContent = 'Press Search to find images online.';
      $('image-search-results').innerHTML = '';
      showModal('image-search-modal');
      performWebImageSearch(defaultQuery);
    });

    $('image-search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('image-search-input').value.trim();
      if (q) performWebImageSearch(q);
    });

    $('image-direct-url-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.activeKitId) return;
      const directUrl = $('image-direct-url-input').value.trim();
      if (!directUrl) return;

      const btn = $('image-direct-url-btn');
      btn.disabled = true;
      btn.textContent = 'Importing...';
      try {
        const res = await api(`/api/kits/${state.activeKitId}/photos/from-url`, {
          method: 'POST',
          body: {
            image_url: directUrl,
            stance_name: $('image-search-stance').value.trim() || 'Cover / Box Art',
            caption: 'Direct URL import',
            is_cover: $('image-search-cover').checked
          }
        });
        replaceKitInState(res.kit);
        renderKitDetailModal(res.kit);
        $('image-direct-url-form').reset();
        $('image-search-modal').classList.add('hidden');
        showToast('Image imported from URL!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '+ Import Image URL';
      }
    });

    // IDEA 6: PORTABILITY, BACKUP & PUBLIC SHOWCASE EVENTS
    $('showcase-enable-toggle').addEventListener('change', async (e) => {
      try {
        const res = await api('/api/showcase/settings', {
          method: 'PUT',
          body: { enabled: e.target.checked }
        });
        state.user.showcaseEnabled = res.showcaseEnabled;
        state.user.showcaseToken = res.showcaseToken;
        syncShowcaseSettingsUI();
        showToast(
          res.showcaseEnabled
            ? 'Public Showcase enabled! Share the link below.'
            : 'Public Showcase disabled.',
          'success'
        );
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('copy-showcase-btn').addEventListener('click', async () => {
      const val = $('showcase-url-input').value;
      if (!val) return;
      try {
        await navigator.clipboard.writeText(val);
        showToast('Public Showcase URL copied to clipboard!', 'success');
      } catch (_) {
        $('showcase-url-input').select();
        showToast('Selected link — press Ctrl+C to copy');
      }
    });

    $('regen-showcase-btn').addEventListener('click', async () => {
      try {
        const res = await api('/api/showcase/settings', {
          method: 'PUT',
          body: { enabled: true, regenerateToken: true }
        });
        state.user.showcaseEnabled = res.showcaseEnabled;
        state.user.showcaseToken = res.showcaseToken;
        syncShowcaseSettingsUI();
        showToast('Generated a new Public Showcase link!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('export-full-backup-btn').addEventListener('click', async () => {
      try {
        showToast('Preparing full backup archive with photos & manuals...');
        const data = await api('/api/backup/export?media=true');
        triggerDownload(
          `kitcatalogue-full-backup-${new Date().toISOString().slice(0, 10)}.json`,
          JSON.stringify(data, null, 2),
          'application/json'
        );
        showToast('Full backup downloaded!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('export-metadata-json-btn').addEventListener('click', async () => {
      try {
        const data = await api('/api/backup/export?media=false');
        triggerDownload(
          `kitcatalogue-metadata-${new Date().toISOString().slice(0, 10)}.json`,
          JSON.stringify(data, null, 2),
          'application/json'
        );
        showToast('Metadata JSON downloaded!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('export-csv-btn').addEventListener('click', () => {
      exportCatalogueCsv();
      showToast('CSV spreadsheet downloaded!', 'success');
    });

    $('import-data-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = $('import-file-input').files[0];
      if (!file) return;

      const btn = $('import-submit-btn');
      btn.disabled = true;
      btn.textContent = 'Importing...';
      try {
        const text = await file.text();
        let kitsPayload = [];
        if (file.name.toLowerCase().endsWith('.csv')) {
          kitsPayload = parseCsvToKits(text);
        } else {
          const parsed = JSON.parse(text);
          kitsPayload = Array.isArray(parsed) ? parsed : parsed.kits || [];
        }

        const res = await api('/api/backup/import', {
          method: 'POST',
          body: { kits: kitsPayload }
        });
        $('import-data-form').reset();
        await loadKits();
        showToast(
          `Imported ${res.importedCount} kits (${res.photosRestored} photos, ${res.manualsRestored} manuals)!`,
          'success'
        );
      } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '⬆ Import Into Catalogue';
      }
    });

    // Admin controls
    $('admin-tagline-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('admin-tagline-input');
      const val = input.value.trim() || 'Model Hangar';
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          body: { appTagline: val }
        });
        const updated = res.settings?.appTagline || val;
        input.value = updated;
        if ($('brand-tag')) $('brand-tag').textContent = updated;
        showToast('Tagline updated', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('admin-allow-reg-toggle').addEventListener('change', async (e) => {
      try {
        await api('/api/admin/settings', {
          method: 'PUT',
          body: { allowRegistration: e.target.checked }
        });
        showToast('Registration policy updated', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('admin-create-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/users', {
          method: 'POST',
          body: {
            username: $('new-user-username').value.trim(),
            displayName: $('new-user-displayname').value.trim(),
            password: $('new-user-password').value,
            role: $('new-user-role').value
          }
        });
        $('admin-create-user-form').reset();
        showToast('User account created!', 'success');
        loadAdminUsers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    if ($('admin-legal-form')) {
      $('admin-legal-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/admin/settings', {
            method: 'PUT',
            body: {
              impressumText: $('admin-impressum-input').value,
              privacyText: $('admin-privacy-input').value
            }
          });
          showToast('Legal Notice & Impressum updated!', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    if ($('auth-legal-link')) {
      $('auth-legal-link').addEventListener('click', (e) => {
        e.preventDefault();
        openLegalModal();
      });
    }

    if ($('showcase-legal-btn')) {
      $('showcase-legal-btn').addEventListener('click', (e) => {
        e.preventDefault();
        openLegalModal();
      });
    }

    // Close modals
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $(btn.dataset.closeModal).classList.add('hidden');
      });
    });

    $('lightbox-close').addEventListener('click', () => {
      $('lightbox-modal').classList.add('hidden');
    });
    $('lightbox-modal').addEventListener('click', (e) => {
      if (e.target === $('lightbox-modal')) {
        $('lightbox-modal').classList.add('hidden');
      }
    });

    // Light-dismiss support for modal dialogs (clicking outside the panel)
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          backdrop.classList.add('hidden');
        }
      });
    });

    // Native Esc key to dismiss the topmost modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modals = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'));
        if (modals.length > 0) {
          // Close the last/topmost modal in the DOM
          const topModal = modals[modals.length - 1];
          topModal.classList.add('hidden');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    checkAuth();
  });
})();
