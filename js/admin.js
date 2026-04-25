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
        if (tab === 'orders') loadOrders();
      });
    });
  }

  // ---- Toys ----
  async function loadToys() {
    try {
      const r = await Auth.api('adminListToys', { token: Auth.token() });
      renderToys(r.toys || []);
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
      renderOrders(r.orders || []);
    } catch (e) {
      $('orders-table').innerHTML = `<p style="color:var(--error);">${escapeHtml(e.message)}</p>`;
    }
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

  document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupToyForm();
    setTimeout(() => {
      if (gate()) loadToys();
    }, 80);
  });
  window.onSTAARLogin = () => { if (gate()) loadToys(); };
})();
