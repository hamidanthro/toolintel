// Marketplace — browse toys, see wallet, checkout with parent consent.
(function () {
  const Auth = window.STAARAuth;
  const root = document.getElementById('market-root');
  const ordersRoot = document.getElementById('orders-root');
  const summaryEl = document.getElementById('wallet-summary');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderWalletSummary(wallet) {
    const cap = wallet.capCents || 10000;
    const pct = Math.min(100, Math.round((wallet.lifetimeCents / cap) * 100));
    const remaining = Math.max(0, cap - wallet.lifetimeCents);
    const broke = (wallet.balanceCents || 0) === 0;
    summaryEl.innerHTML = `
      <div class="wallet-summary-stat">
        <div class="label">Wallet</div>
        <div class="value">${Auth.formatCents(wallet.balanceCents)}</div>
      </div>
      <div class="wallet-summary-stat">
        <div class="label">Earned all-time</div>
        <div class="value">${Auth.formatCents(wallet.lifetimeCents)}</div>
      </div>
      <div style="flex:1;min-width:220px;">
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--muted);margin-bottom:6px;">
          <span>Progress to $${(cap/100).toFixed(0)} cap</span>
          <span>${Auth.formatCents(remaining)} left</span>
        </div>
        <div class="wallet-progress"><div class="wallet-progress-fill" style="width:${pct}%"></div></div>
      </div>
      ${broke ? `<a href="practice.html" class="earn-cta">\u2728 Practice to earn points</a>` : ''}`;
  }

  async function load() {
    if (!Auth.currentUser()) return;
    try {
      const [walletData, toysData, ordersData] = await Promise.all([
        Auth.api('getWallet', { token: Auth.token() }),
        Auth.api('listToys', {}),
        Auth.api('listMyOrders', { token: Auth.token() })
      ]);
      renderWalletSummary(walletData);
      renderToys(toysData.toys || [], walletData.balanceCents);
      renderOrders(ordersData.orders || []);
    } catch (e) {
      root.innerHTML = `<p style="color:var(--error);">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderToys(toys, balance) {
    if (!toys.length) {
      root.innerHTML = `<p style="color:var(--muted);">No toys available yet. Check back soon!</p>`;
      return;
    }
    root.innerHTML = toys.map(t => {
      const canAfford = balance >= t.priceCents;
      const need = t.priceCents - balance;
      const stockLow = t.stock != null && t.stock <= 3;
      const stockNote = t.stock != null
        ? `<span class="toy-stock${stockLow ? ' low' : ''}">${t.stock} left</span>`
        : '<span class="toy-stock">In stock</span>';
      const looksBroken = t.imageUrl && /placehold\.co|placeholder/i.test(t.imageUrl);
      const img = (t.imageUrl && !looksBroken)
        ? `<img class="toy-img" src="${escapeHtml(t.imageUrl)}" alt="${escapeHtml(t.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'toy-img-placeholder\\'>\u{1F381}</div>'" />`
        : `<div class="toy-img-placeholder">\u{1F381}</div>`;
      const desc = (t.description || '').trim();
      const buyLabel = canAfford
        ? 'Buy with points'
        : `Need ${Auth.formatCents(need)} more`;
      return `
        <article class="toy-card${canAfford ? ' affordable' : ''}" data-toy-id="${escapeHtml(t.toyId)}">
          <div class="toy-img-wrap">
            ${img}
            <span class="toy-price-badge">${Auth.formatCents(t.priceCents)}</span>
          </div>
          <div class="toy-body">
            <h3 class="toy-name">${escapeHtml(t.name)}</h3>
            ${desc ? `<p class="toy-desc">${escapeHtml(desc)}</p>` : ''}
            <div class="toy-row">
              ${stockNote}
              ${canAfford ? '<span class="toy-stock can">\u2713 You can afford this!</span>' : ''}
            </div>
            <button class="btn ${canAfford ? 'btn-primary' : 'btn-ghost'} toy-buy" ${canAfford ? '' : 'disabled'}>
              ${buyLabel}
            </button>
          </div>
        </article>`;
    }).join('');
    root.querySelectorAll('.toy-card').forEach(card => {
      const toyId = card.dataset.toyId;
      const toy = toys.find(x => x.toyId === toyId);
      const btn = card.querySelector('.toy-buy');
      btn.addEventListener('click', () => {
        if (!btn.disabled) showCheckout(toy);
      });
    });
  }

  function renderOrders(orders) {
    if (!orders.length) {
      ordersRoot.innerHTML = `<p style="color:var(--muted);">No orders yet.</p>`;
      return;
    }
    ordersRoot.innerHTML = `
      <table class="admin-table">
        <thead><tr><th></th><th>Toy</th><th>Paid</th><th>Status</th><th>Tracking</th><th>Ordered</th></tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td>${o.toyImageUrl ? `<img src="${escapeHtml(o.toyImageUrl)}" alt="" />` : ''}</td>
              <td>${escapeHtml(o.toyName)}</td>
              <td>${Auth.formatCents(o.priceCents)}</td>
              <td><span class="status-pill status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
              <td>${escapeHtml(o.trackingNumber || '\u2014')}</td>
              <td>${new Date(o.createdAt).toLocaleDateString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  function showCheckout(toy) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay auth-modal';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title">Checkout: ${escapeHtml(toy.name)}</h3>
        <p class="modal-message">Price: <strong>${Auth.formatCents(toy.priceCents)}</strong>. A grown-up needs to fill this out.</p>

        <label class="auth-label">Shipping address</label>
        <input type="text" class="auth-input" id="co-line1" placeholder="Street address" />
        <input type="text" class="auth-input" id="co-line2" placeholder="Apt / suite (optional)" style="margin-top:8px;" />
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin-top:8px;">
          <input type="text" class="auth-input" id="co-city" placeholder="City" />
          <input type="text" class="auth-input" id="co-state" placeholder="State" maxlength="20" />
          <input type="text" class="auth-input" id="co-zip" placeholder="ZIP" maxlength="20" />
        </div>

        <label class="auth-label" style="margin-top:18px;">Parent / guardian</label>
        <input type="text" class="auth-input" id="co-pname" placeholder="Parent or guardian name" />
        <input type="email" class="auth-input" id="co-pemail" placeholder="Parent email" style="margin-top:8px;" />
        <input type="tel" class="auth-input" id="co-pphone" placeholder="Parent phone" style="margin-top:8px;" />

        <div class="consent-card">
          <label>
            <input type="checkbox" id="co-consent" />
            <span>I am the parent or legal guardian of this child. I consent to STAAR Prep collecting this address and shipping the toy here. I understand the cents have no cash value outside this app.</span>
          </label>
        </div>

        <p class="auth-error" id="co-err" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-act="buy">Place order</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    overlay.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
    const btn = overlay.querySelector('[data-act="buy"]');
    const err = overlay.querySelector('#co-err');
    btn.addEventListener('click', async () => {
      err.hidden = true;
      const body = {
        toyId: toy.toyId,
        address: {
          line1: overlay.querySelector('#co-line1').value.trim(),
          line2: overlay.querySelector('#co-line2').value.trim(),
          city:  overlay.querySelector('#co-city').value.trim(),
          state: overlay.querySelector('#co-state').value.trim(),
          zip:   overlay.querySelector('#co-zip').value.trim()
        },
        parent: {
          name:  overlay.querySelector('#co-pname').value.trim(),
          email: overlay.querySelector('#co-pemail').value.trim(),
          phone: overlay.querySelector('#co-pphone').value.trim(),
          consent: overlay.querySelector('#co-consent').checked
        }
      };
      if (!body.parent.consent) { err.textContent = 'A parent must check the consent box.'; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Placing order…';
      try {
        await Auth.api('checkout', { token: Auth.token(), ...body });
        closeModal();
        Auth.showToast('Order placed! A grown-up will get a shipping update soon.');
        await Auth.refreshWallet();
        load();
      } catch (e) {
        err.textContent = e.message || 'Could not place order.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Place order';
      }
    });
  }

  function closeModal() {
    const m = document.querySelector('.modal-overlay.auth-modal');
    if (m) { m.classList.remove('open'); setTimeout(() => m.remove(), 180); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Wait a tick for auth bootstrap.
    setTimeout(load, 50);
  });
  window.onSTAARLogin = () => load();
})();
