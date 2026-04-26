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
    if (!Auth.currentUser()) {
      // Guest mode: show toys + premium dark-glass sign-up callout; hide wallet/orders.
      if (summaryEl) {
        summaryEl.className = 'signin-callout';
        summaryEl.innerHTML = `
          <div class="signin-callout-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M16 4L19.5 12.5L28 13.5L21.5 19.5L23.5 28L16 23.5L8.5 28L10.5 19.5L4 13.5L12.5 12.5L16 4Z"
                    fill="url(#signinStarGradient)" stroke="rgba(251, 191, 36, 0.4)" stroke-width="0.5"/>
              <defs>
                <linearGradient id="signinStarGradient" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#fde68a"/><stop offset="0.5" stop-color="#fbbf24"/><stop offset="1" stop-color="#f59e0b"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div class="signin-callout-content">
            <span class="signin-callout-eyebrow">SIGN IN TO START EARNING</span>
            <p class="signin-callout-text">Practice questions to earn points, then redeem them for real toys.</p>
          </div>
          <button type="button" class="signin-callout-cta" id="market-signup">
            Sign up free
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>`;
        const su = document.getElementById('market-signup');
        if (su) su.onclick = () => Auth.showLogin && Auth.showLogin();
      }
      if (ordersRoot) ordersRoot.innerHTML = '<p class="orders-empty">Sign in to see your orders.</p>';
      try {
        const toysData = await Auth.api('listToys', {});
        renderToys(toysData.toys || [], 0);
      } catch (e) {
        root.innerHTML = `<p class="market-error">${escapeHtml(e.message)}</p>`;
      }
      return;
    }
    try {
      summaryEl.className = 'wallet-summary';
      const [walletData, toysData, ordersData] = await Promise.all([
        Auth.api('getWallet', { token: Auth.token() }),
        Auth.api('listToys', {}),
        Auth.api('listMyOrders', { token: Auth.token() })
      ]);
      renderWalletSummary(walletData);
      renderToys(toysData.toys || [], walletData.balanceCents);
      renderOrders(ordersData.orders || []);
    } catch (e) {
      root.innerHTML = `<p class="market-error">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderToys(toys, balance) {
    if (!toys.length) {
      root.innerHTML = `<p class="market-empty">No toys available yet. Check back soon!</p>`;
      return;
    }
    const isGuest = !Auth.currentUser();
    root.innerHTML = toys.map(t => {
      const canAfford = !isGuest && balance >= t.priceCents;
      const need = t.priceCents - balance;
      const stock = (t.stock != null) ? Number(t.stock) : null;
      let stockBadge = '';
      if (stock != null) {
        if (stock <= 0) {
          stockBadge = `<span class="toy-stock-badge toy-stock-badge--out">Sold out</span>`;
        } else if (stock <= 2) {
          stockBadge = `<span class="toy-stock-badge toy-stock-badge--scarce">Only ${stock} left!</span>`;
        } else {
          stockBadge = `<span class="toy-stock-badge toy-stock-badge--limited">${stock} left</span>`;
        }
      }
      const looksBroken = t.imageUrl && /placehold\.co|placeholder/i.test(t.imageUrl);
      const img = (t.imageUrl && !looksBroken)
        ? `<img class="toy-image" src="${escapeHtml(t.imageUrl)}" alt="${escapeHtml(t.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'toy-image-placeholder\\'>\u{1F381}</div>'" />`
        : `<div class="toy-image-placeholder">\u{1F381}</div>`;
      const desc = (t.description || '').trim();
      const priceLabel = formatPoints(t.priceCents);
      let buyLabel, buyDisabled;
      if (isGuest) { buyLabel = 'Sign up to earn'; buyDisabled = false; }
      else if (stock != null && stock <= 0) { buyLabel = 'Sold out'; buyDisabled = true; }
      else if (canAfford) { buyLabel = 'Redeem with points'; buyDisabled = false; }
      else { buyLabel = `Need ${formatPoints(need)} more`; buyDisabled = true; }
      const isAdmin = !!(Auth.currentUser && Auth.currentUser() && Auth.currentUser().isAdmin);
      const adminBadge = isAdmin
        ? `<a class="toy-edit" href="admin.html#edit=${encodeURIComponent(t.toyId)}" title="Edit this toy">Edit</a>`
        : '';
      return `
        <article class="toy-card${canAfford ? ' toy-card--affordable' : ''}" data-toy-id="${escapeHtml(t.toyId)}">
          ${stockBadge}
          ${adminBadge}
          <div class="toy-image-wrapper">
            <div class="toy-image-glow"></div>
            ${img}
            <span class="toy-points-badge">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="5" fill="#0a1628" stroke="rgba(10,22,40,0.4)" stroke-width="0.5"/>
                <path d="M6 2L7 4.5L9.5 4.8L7.6 6.5L8.2 9L6 7.7L3.8 9L4.4 6.5L2.5 4.8L5 4.5L6 2Z" fill="currentColor"/>
              </svg>
              ${priceLabel}
            </span>
          </div>
          <div class="toy-content">
            <h3 class="toy-title">${escapeHtml(t.name)}</h3>
            ${desc ? `<p class="toy-description">${escapeHtml(desc)}</p>` : '<p class="toy-description">&nbsp;</p>'}
          </div>
          <div class="toy-footer">
            <button class="toy-cta${buyDisabled ? ' toy-cta--disabled' : ''}" ${buyDisabled ? 'disabled' : ''}>
              ${buyLabel}
              ${buyDisabled ? '' : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6H9.5M9.5 6L6.5 3M9.5 6L6.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'}
            </button>
          </div>
        </article>`;
    }).join('');
    root.querySelectorAll('.toy-card').forEach(card => {
      const toyId = card.dataset.toyId;
      const toy = toys.find(x => x.toyId === toyId);
      const btn = card.querySelector('.toy-cta');
      if (!btn) return;
      btn.addEventListener('click', () => {
        if (!Auth.currentUser()) {
          if (Auth.showLogin) Auth.showLogin();
          return;
        }
        if (!btn.disabled) showCheckout(toy);
      });
    });
  }

  function formatPoints(cents) {
    const n = Math.max(0, parseInt(cents, 10) || 0);
    return `${n.toLocaleString()} pts`;
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
            <span>I am the parent or legal guardian of this child. I consent to StarTest collecting this address and shipping the toy here. I understand the points have no cash value outside this app.</span>
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
