// Admin panel — toy CRUD with image upload + orders list.
(function () {
  const Auth = window.STAARAuth;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function $(id) { return document.getElementById(id); }

  function gate() {
    const u = Auth.currentUser();
    if (!u) {
      // Not signed in yet — auth modal is already showing because of requireLoginOnLoad.
      $('admin-body').hidden = true;
      return false;
    }
    if (!u.isAdmin) {
      // Signed in, but not an admin. Bounce to home — admin URL is not for them.
      $('admin-body').hidden = true;
      $('admin-gate').hidden = false;
      $('admin-gate').innerHTML = `
        <p style="color:var(--error);">This area is for admins only. Redirecting you home\u2026</p>`;
      setTimeout(() => { window.location.href = 'index.html'; }, 1500);
      return false;
    }
    $('admin-body').hidden = false;
    $('admin-gate').hidden = true;
    return true;
  }

  function setupTabs() {
    document.querySelectorAll('.admin-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        $('tab-toys').hidden = tab !== 'toys';
        $('tab-orders').hidden = tab !== 'orders';
        $('tab-users').hidden = tab !== 'users';
        const tabStates = $('tab-states');
        if (tabStates) tabStates.hidden = tab !== 'states';
        if (tab === 'orders') loadOrders();
        if (tab === 'users') { loadLiveUsers(); startLiveUsersPolling(); }
        else { stopLiveUsersPolling(); }
        if (tab === 'states') loadStatesTab();
      });
    });
  }

  function switchTab(name) {
    const btn = document.querySelector(`.admin-tab[data-tab="${name}"]`);
    if (btn) btn.click();
  }

  // ---- Toys ----
  async function loadToys() {
    try {
      const r = await Auth.api('adminListToys', { token: Auth.token() });
      renderToys(r.toys || []);
      // Honor #edit=<toyId> deep-link from the marketplace.
      const m = (location.hash || '').match(/#edit=([^&]+)/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const t = (r.toys || []).find(x => x.toyId === id);
        if (t) editToy(t);
      }
    } catch (e) {
      $('toys-table').innerHTML = `<p style="color:var(--error);">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderToys(toys) {
    if (!toys.length) {
      $('toys-table').innerHTML = '<p style="color:var(--muted);">No toys yet. Add one above.</p>';
      return;
    }
    $('toys-table').innerHTML = `
      <table class="admin-table">
        <thead><tr><th></th><th>Name</th><th>Description</th><th>Price</th><th>Stock</th><th>Active</th><th></th></tr></thead>
        <tbody>
          ${toys.map(t => {
            const desc = t.description || '';
            const short = desc.length > 80 ? desc.slice(0, 80).trim() + '…' : desc;
            return `
            <tr data-id="${escapeHtml(t.toyId)}">
              <td>${t.imageUrl ? `<img src="${escapeHtml(t.imageUrl)}" alt="" />` : ''}</td>
              <td>${escapeHtml(t.name)}</td>
              <td style="max-width:280px;color:var(--muted);font-size:0.88rem;" title="${escapeHtml(desc)}">${escapeHtml(short)}</td>
              <td>${Auth.formatCents(t.priceCents)}</td>
              <td>${t.stock == null ? '\u221E' : t.stock}</td>
              <td>${t.active === false ? 'no' : 'yes'}</td>
              <td>
                <button class="btn btn-ghost" data-act="edit">Edit</button>
                <button class="btn btn-ghost" data-act="del" style="color:var(--error);">Delete</button>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>`;
    $('toys-table').querySelectorAll('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      const t = toys.find(x => x.toyId === id);
      tr.querySelector('[data-act="edit"]').addEventListener('click', () => editToy(t));
      tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm(`Delete "${t.name}"?`)) return;
        await Auth.api('adminDeleteToy', { token: Auth.token(), toyId: id });
        loadToys();
      });
    });
  }

  function editToy(t) {
    $('toy-id').value = t.toyId;
    $('toy-name').value = t.name;
    $('toy-desc').value = t.description || '';
    $('toy-price').value = t.priceCents;
    $('toy-stock').value = t.stock == null ? '' : t.stock;
    $('toy-image-url').value = t.imageUrl || '';
    if (t.imageUrl) {
      const p = $('toy-img-preview');
      p.src = t.imageUrl; p.hidden = false;
    } else {
      $('toy-img-preview').hidden = true;
    }
    $('toy-upload-status').textContent = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetToyForm() {
    $('toy-form').reset();
    $('toy-id').value = '';
    $('toy-image-url').value = '';
    $('toy-img-preview').hidden = true;
    $('toy-upload-status').textContent = '';
  }

  async function uploadImage(file) {
    const status = $('toy-upload-status');
    status.textContent = 'Uploading…';
    const presign = await Auth.api('adminPresignUpload', {
      token: Auth.token(),
      contentType: file.type
    });
    const put = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    });
    if (!put.ok) throw new Error('Upload failed (' + put.status + ')');
    status.textContent = 'Uploaded \u2713';
    return presign.publicUrl;
  }

  function setupToyForm() {
    $('toy-file').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const p = $('toy-img-preview');
        p.src = ev.target.result; p.hidden = false;
      };
      reader.readAsDataURL(f);
      try {
        const url = await uploadImage(f);
        $('toy-image-url').value = url;
      } catch (err) {
        $('toy-upload-status').textContent = 'Upload failed: ' + err.message;
        $('toy-upload-status').style.color = 'var(--error)';
      }
    });

    $('toy-reset').addEventListener('click', resetToyForm);

    $('toy-form').addEventListener('submit', async e => {
      e.preventDefault();
      const stockVal = $('toy-stock').value;
      const toy = {
        toyId: $('toy-id').value || undefined,
        name: $('toy-name').value.trim(),
        description: $('toy-desc').value.trim(),
        priceCents: parseInt($('toy-price').value, 10),
        stock: stockVal === '' ? null : parseInt(stockVal, 10),
        imageUrl: $('toy-image-url').value
      };
      try {
        await Auth.api('adminUpsertToy', { token: Auth.token(), toy });
        Auth.showToast('Saved');
        resetToyForm();
        loadToys();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // ---- Orders ----
  async function loadOrders() {
    try {
      const r = await Auth.api('adminListOrders', { token: Auth.token() });
      const orders = r.orders || [];
      renderOrders(orders);
      renderShipPanel(orders);
      updateOrdersBadge(orders);
    } catch (e) {
      $('orders-table').innerHTML = `<p style="color:var(--error);">${escapeHtml(e.message)}</p>`;
    }
  }

  function updateOrdersBadge(orders) {
    const pending = (orders || []).filter(o => (o.status || 'pending') === 'pending').length;
    const badge = $('orders-tab-badge');
    if (!badge) return;
    if (pending > 0) {
      badge.hidden = false;
      badge.textContent = String(pending);
    } else {
      badge.hidden = true;
    }
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      Auth.showToast('Copied');
    } catch (_) { /* ignore */ }
  }

  function formatAddress(a) {
    if (!a) return '';
    const line2 = a.line2 ? `\n${a.line2}` : '';
    return `${a.line1 || ''}${line2}\n${a.city || ''}, ${a.state || ''} ${a.zip || ''}\n${a.country || 'USA'}`;
  }

  function renderShipPanel(orders) {
    const panel = $('ship-panel');
    const list = $('ship-list');
    const countEl = $('ship-count');
    const subEl = $('ship-panel-sub');
    if (!panel || !list) return;
    const pending = (orders || []).filter(o => (o.status || 'pending') === 'pending');
    if (!pending.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    countEl.textContent = String(pending.length);
    subEl.textContent = pending.length === 1
      ? '1 kid is waiting for their toy.'
      : `${pending.length} kids are waiting for their toys.`;
    list.innerHTML = pending.map(o => {
      const a = o.address || {};
      const p = o.parent || {};
      const fullAddr = formatAddress(a);
      const blockText = `${o.toyName}\nFor: ${o.displayName || o.username}\nParent: ${p.name || ''}  ${p.email || ''}  ${p.phone || ''}\n${fullAddr}`;
      return `
        <div class="ship-card" data-id="${escapeHtml(o.orderId)}">
          <div class="ship-card-head">
            <div>
              <div class="ship-toy">${escapeHtml(o.toyName)}</div>
              <div class="ship-when">Ordered ${new Date(o.createdAt).toLocaleString()}</div>
            </div>
            <div class="ship-price">${Auth.formatCents(o.priceCents)}</div>
          </div>
          <div class="ship-card-body">
            <div class="ship-block">
              <div class="ship-block-label">Kid</div>
              <div class="ship-block-value">${escapeHtml(o.displayName || o.username || '')}<br><span class="ship-muted">@${escapeHtml(o.username || '')}</span></div>
            </div>
            <div class="ship-block">
              <div class="ship-block-label">Parent</div>
              <div class="ship-block-value">
                ${escapeHtml(p.name || '—')}<br>
                <a href="mailto:${escapeHtml(p.email || '')}">${escapeHtml(p.email || '')}</a><br>
                <a href="tel:${escapeHtml(p.phone || '')}">${escapeHtml(p.phone || '')}</a>
              </div>
            </div>
            <div class="ship-block ship-block-addr">
              <div class="ship-block-label">Ship to</div>
              <div class="ship-block-value">
                ${escapeHtml(a.line1 || '')}${a.line2 ? '<br>' + escapeHtml(a.line2) : ''}<br>
                ${escapeHtml(a.city || '')}, ${escapeHtml(a.state || '')} ${escapeHtml(a.zip || '')}<br>
                ${escapeHtml(a.country || 'USA')}
              </div>
              <button type="button" class="btn btn-ghost ship-copy" data-act="copy-addr" title="Copy address">📋 Copy address</button>
            </div>
          </div>
          <div class="ship-card-foot">
            <input type="text" class="auth-input ship-track" data-act="tracking" placeholder="Tracking # (optional)" />
            <button type="button" class="btn btn-primary" data-act="mark-shipped">Mark shipped ✓</button>
            <button type="button" class="btn btn-ghost" data-act="copy-all">📋 Copy all info</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.ship-card').forEach(card => {
      const orderId = card.dataset.id;
      const o = pending.find(x => x.orderId === orderId);
      card.querySelector('[data-act="copy-addr"]').addEventListener('click', () => {
        copyText(formatAddress(o.address || {}));
      });
      card.querySelector('[data-act="copy-all"]').addEventListener('click', () => {
        const a = o.address || {}, p = o.parent || {};
        const text = [
          `Toy: ${o.toyName}`,
          `For kid: ${o.displayName || o.username}`,
          `Parent: ${p.name || ''}`,
          `Email: ${p.email || ''}`,
          `Phone: ${p.phone || ''}`,
          `Address:`,
          formatAddress(a)
        ].join('\n');
        copyText(text);
      });
      card.querySelector('[data-act="mark-shipped"]').addEventListener('click', async () => {
        const trackingNumber = card.querySelector('[data-act="tracking"]').value.trim();
        try {
          await Auth.api('adminUpdateOrder', { token: Auth.token(), orderId, status: 'shipped', trackingNumber });
          Auth.showToast('Marked shipped');
          loadOrders();
        } catch (err) { alert(err.message); }
      });
    });
  }

  function renderOrders(orders) {
    if (!orders.length) {
      $('orders-table').innerHTML = '<p style="color:var(--muted);">No orders yet.</p>';
      return;
    }
    $('orders-table').innerHTML = `
      <table class="admin-table">
        <thead><tr><th>When</th><th>Kid</th><th>Toy</th><th>Paid</th><th>Ship to</th><th>Parent</th><th>Status</th><th>Tracking</th><th></th></tr></thead>
        <tbody>
          ${orders.map(o => {
            const a = o.address || {};
            const p = o.parent || {};
            const ship = `${escapeHtml(a.line1 || '')}${a.line2 ? ', ' + escapeHtml(a.line2) : ''}<br>${escapeHtml(a.city || '')}, ${escapeHtml(a.state || '')} ${escapeHtml(a.zip || '')}`;
            const parent = `${escapeHtml(p.name || '')}<br><a href="mailto:${escapeHtml(p.email || '')}">${escapeHtml(p.email || '')}</a><br>${escapeHtml(p.phone || '')}`;
            return `
              <tr data-id="${escapeHtml(o.orderId)}">
                <td>${new Date(o.createdAt).toLocaleString()}</td>
                <td>${escapeHtml(o.displayName || o.username || '')}<br><span style="color:var(--muted);font-size:0.78rem;">@${escapeHtml(o.username || '')}</span></td>
                <td>${escapeHtml(o.toyName)}</td>
                <td>${Auth.formatCents(o.priceCents)}</td>
                <td style="font-size:0.82rem;">${ship}</td>
                <td style="font-size:0.82rem;">${parent}</td>
                <td>
                  <select class="auth-input" data-act="status" style="padding:6px 10px;font-size:0.85rem;">
                    ${['pending','shipped','delivered','cancelled'].map(s =>
                      `<option value="${s}" ${s===o.status?'selected':''}>${s}</option>`).join('')}
                  </select>
                </td>
                <td><input type="text" class="auth-input" data-act="tracking" placeholder="Tracking #" value="${escapeHtml(o.trackingNumber || '')}" style="padding:6px 10px;font-size:0.85rem;width:140px;" /></td>
                <td><button class="btn btn-primary" data-act="save" style="padding:6px 12px;font-size:0.85rem;">Save</button></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    $('orders-table').querySelectorAll('tr[data-id]').forEach(tr => {
      tr.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const orderId = tr.dataset.id;
        const status = tr.querySelector('[data-act="status"]').value;
        const trackingNumber = tr.querySelector('[data-act="tracking"]').value.trim();
        try {
          await Auth.api('adminUpdateOrder', { token: Auth.token(), orderId, status, trackingNumber });
          Auth.showToast('Order updated');
        } catch (err) { alert(err.message); }
      });
    });
  }

  // ---- Live users (Users tab) ----
  let _liveUsersTimer = null;

  function startLiveUsersPolling() {
    stopLiveUsersPolling();
    _liveUsersTimer = setInterval(loadLiveUsers, 15000);
  }
  function stopLiveUsersPolling() {
    if (_liveUsersTimer) { clearInterval(_liveUsersTimer); _liveUsersTimer = null; }
  }

  function gradeLabel(slug) {
    if (!slug) return '—';
    if (slug === 'grade-k') return 'K';
    if (slug === 'algebra-1') return 'Alg I';
    const m = String(slug).match(/^grade-(\d+)$/);
    return m ? `G${m[1]}` : slug;
  }
  function relativeTime(ts, now) {
    if (!ts) return '—';
    const sec = Math.max(0, Math.round((now - ts) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const d = Math.round(hr / 24);
    return `${d}d ago`;
  }
  function avatarLetter(name) {
    return (String(name || '?').trim().charAt(0) || '?').toUpperCase();
  }

  // Cached on each adminLiveUsers fetch so the State filter + States tab
  // can operate without extra round trips. allUsers is the full roster
  // (online + offline); onlineUsers is the practicing/recent subset.
  let allUsers = [];
  let onlineUsers = [];
  let serverNow = Date.now();
  let _stateFilterWired = false;

  function stateMeta(slug) {
    if (!slug) return null;
    const api = window.STATES_API;
    return (api && api.getBySlug && api.getBySlug(slug)) || null;
  }

  function stateCellPill(slug) {
    const info = stateMeta(slug);
    if (!info) return `<span class="admin-state-mini admin-state-mini--none">—</span>`;
    return `<span class="admin-state-mini">`
      + `<span class="admin-state-mini-abbr">${escapeHtml(info.nameAbbr || info.slug.slice(0, 2).toUpperCase())}</span>`
      + escapeHtml(info.testName || '')
      + `</span>`;
  }

  function populateUsersStateFilter() {
    const select = $('users-state-filter');
    if (!select) return;
    const api = window.STATES_API;
    const slugs = new Set(allUsers.map(u => u.state).filter(Boolean));
    const options = Array.from(slugs)
      .map(s => api && api.getBySlug ? api.getBySlug(s) : null)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    const prev = select.value;
    select.innerHTML = '<option value="">All states</option>';
    options.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.slug;
      opt.textContent = `${s.name} (${s.testName})`;
      select.appendChild(opt);
    });
    const noStateCount = allUsers.filter(u => !u.state).length;
    if (noStateCount > 0) {
      const opt = document.createElement('option');
      opt.value = '__none__';
      opt.textContent = `No state set (${noStateCount})`;
      select.appendChild(opt);
    }
    // Preserve current selection if still valid.
    if (prev && Array.from(select.options).some(o => o.value === prev)) {
      select.value = prev;
    }

    if (!_stateFilterWired) {
      select.addEventListener('change', () => renderLiveUsers());
      _stateFilterWired = true;
    }
  }

  function applyStateFilter(users) {
    const select = $('users-state-filter');
    const v = select ? select.value : '';
    if (!v) return users;
    if (v === '__none__') return users.filter(u => !u.state);
    return users.filter(u => u.state === v);
  }

  function renderLiveUsers() {
    const users = applyStateFilter(onlineUsers);
    const now = serverNow || Date.now();
    const target = $('live-users-table');
    if (!users.length) {
      target.innerHTML = `<p class="live-users-empty">${onlineUsers.length === 0 ? 'Nobody is online right now.' : 'No online users match this filter.'}</p>`;
      return;
    }
    target.innerHTML = `
      <table class="live-users-table">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Username</th>
            <th>State</th>
            <th>Grade</th>
            <th>Status</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => {
            const color = u.color || '#1e40af';
            const status = u.isPracticing
              ? `<span class="live-status live-status--practicing"><span class="live-dot live-dot--gold"></span>Practicing</span>`
              : `<span class="live-status live-status--online"><span class="live-dot"></span>Online</span>`;
            return `
              <tr class="${u.isPracticing ? 'live-row live-row--practicing' : 'live-row'}">
                <td><span class="live-avatar" style="background:${escapeHtml(color)}">${escapeHtml(avatarLetter(u.displayName))}</span></td>
                <td class="live-name">${escapeHtml(u.displayName || u.username)}</td>
                <td class="live-uname">@${escapeHtml(u.username)}</td>
                <td>${stateCellPill(u.state)}</td>
                <td><span class="live-grade-pill">${escapeHtml(gradeLabel(u.grade))}</span></td>
                <td>${status}</td>
                <td class="live-time">${escapeHtml(relativeTime(u.lastSeenAt, now))}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  async function loadLiveUsers() {
    if (!gate()) return;
    try {
      const r = await Auth.api('adminLiveUsers', { token: Auth.token() });
      const totalUsers = r.totalUsers || 0;
      const onlineCount = r.onlineCount || 0;
      const practicingCount = r.practicingCount || 0;
      onlineUsers = Array.isArray(r.users) ? r.users : [];
      allUsers = Array.isArray(r.allUsers) ? r.allUsers : onlineUsers.slice();
      serverNow = r.serverNow || Date.now();

      $('stat-total').textContent = totalUsers.toLocaleString();
      $('stat-online').textContent = onlineCount.toLocaleString();
      $('stat-practicing').textContent = practicingCount.toLocaleString();

      // Tab badge: how many practicing right now.
      const badge = $('users-tab-badge');
      if (practicingCount > 0) {
        badge.hidden = false;
        badge.textContent = String(practicingCount);
      } else {
        badge.hidden = true;
      }

      const meta = $('live-users-meta');
      if (meta) {
        const stamp = new Date(serverNow).toLocaleTimeString();
        meta.textContent = `Updated ${stamp} · auto-refresh every 15s`;
      }

      populateUsersStateFilter();
      renderLiveUsers();
    } catch (e) {
      $('live-users-table').innerHTML = `<p style="color:#fca5a5;">${escapeHtml(e.message || 'Could not load live users')}</p>`;
    }
  }

  // ---- States tab ----
  let _statesLoaded = false;

  async function loadStatesTab() {
    if (!gate()) return;
    const updated = $('states-updated');
    if (updated) updated.textContent = 'Loading…';
    try {
      const r = await Auth.api('adminListStates', { token: Auth.token() });
      _statesLoaded = true;
      renderStatesTab(r);
      if (updated) {
        const stamp = new Date().toLocaleTimeString();
        updated.textContent = `Updated ${stamp}`;
      }
    } catch (e) {
      if (updated) updated.textContent = 'Failed to load';
      const wrap = $('states-table-wrap');
      const empty = $('states-empty');
      if (wrap) wrap.hidden = true;
      if (empty) {
        empty.hidden = false;
        const t = empty.querySelector('.admin-empty-text');
        if (t) t.textContent = e.message || 'Could not load states';
      }
    }
  }

  function renderStatesTab(data) {
    const summary = data.summary || {};
    const states = Array.isArray(data.states) ? data.states : [];

    $('states-summary-active').textContent = (summary.statesActive || 0).toLocaleString();
    $('states-summary-with').textContent = (summary.totalWithState || 0).toLocaleString();
    $('states-summary-without').textContent = (summary.totalWithoutState || 0).toLocaleString();

    const navBadge = $('states-tab-badge');
    if (navBadge) {
      if (summary.statesActive > 0) {
        navBadge.hidden = false;
        navBadge.textContent = String(summary.statesActive);
      } else {
        navBadge.hidden = true;
      }
    }

    const wrap = $('states-table-wrap');
    const empty = $('states-empty');
    if (states.length === 0) {
      if (wrap) wrap.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (wrap) wrap.hidden = false;
    if (empty) empty.hidden = true;

    const maxUsers = Math.max(...states.map(s => s.userCount), 1);

    const tbody = $('states-tbody');
    tbody.innerHTML = states.map((s, idx) => {
      const info = stateMeta(s.state);
      const stateName = info ? info.name : s.state;
      const abbr = info ? (info.nameAbbr || s.state.slice(0, 2).toUpperCase()) : s.state.slice(0, 2).toUpperCase();
      const testName = info ? info.testName : '—';
      const pct = (s.userCount / maxUsers) * 100;
      const isTop = idx < 3;
      return `
        <tr data-state="${escapeHtml(s.state)}">
          <td>
            <div class="admin-state-cell">
              <span class="admin-state-cell-abbr ${isTop ? 'is-top' : ''}">${escapeHtml(abbr)}</span>
              <span class="admin-state-cell-name">${escapeHtml(stateName)}</span>
              ${idx === 0 ? '<span class="admin-state-cell-rank">#1</span>' : ''}
            </div>
          </td>
          <td><span class="admin-test-pill">${escapeHtml(testName)}</span></td>
          <td><span class="admin-user-count">${(s.userCount || 0).toLocaleString()}</span></td>
          <td>
            <div class="admin-distribution-bar-wrap">
              <div class="admin-distribution-bar" style="width:${pct.toFixed(1)}%"></div>
            </div>
          </td>
          <td>
            ${(s.signupsLast30Days || 0) > 0
              ? `<span class="admin-signups-badge">+${s.signupsLast30Days}</span>`
              : `<span class="admin-zero">0</span>`}
          </td>
          <td><span class="admin-cents-cell">${(s.totalLifetimeCents || 0).toLocaleString()}</span></td>
        </tr>`;
    }).join('');

    // Click a state row → switch to Users tab pre-filtered to that state.
    tbody.querySelectorAll('tr[data-state]').forEach(tr => {
      tr.addEventListener('click', () => {
        const slug = tr.dataset.state;
        switchTab('users');
        // Selection is applied after loadLiveUsers populates the dropdown.
        const apply = () => {
          const sel = $('users-state-filter');
          if (!sel) return;
          if (Array.from(sel.options).some(o => o.value === slug)) {
            sel.value = slug;
            renderLiveUsers();
          } else {
            // Filter rebuilt async; try again shortly.
            setTimeout(apply, 200);
          }
        };
        apply();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupToyForm();
    setTimeout(() => {
      if (gate()) { loadToys(); loadOrders(); loadLiveUsers(); }
    }, 80);
  });
  window.onSTAARLogin = () => { if (gate()) { loadToys(); loadOrders(); loadLiveUsers(); } };
})();
