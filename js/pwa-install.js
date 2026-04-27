/**
 * StarTest — PWA INSTALL PROMPT
 *
 * Captures `beforeinstallprompt` (Chrome/Edge/Android), and detects iOS Safari
 * to show a manual "Add to Home Screen" guide instead.
 *
 * UX rules:
 *   - Never prompt during the first 30s of any visit
 *   - Never prompt mid-practice
 *   - Never prompt twice in a session
 *   - Defer prompt for 7 days if user dismisses ("Maybe later")
 *   - Show after sign-in OR after 2nd correct answer (high engagement)
 */

(function () {
  const DISMISS_KEY = 'startest.pwa-dismissed-until';
  const SHOWN_KEY = 'startest.pwa-shown-this-session';
  const DAY_MS = 24 * 60 * 60 * 1000;

  let deferredPrompt = null;
  let isInstalled = false;

  // ============================================================
  // STATE DETECTION
  // ============================================================

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  function isOnPracticePage() {
    return /practice\.html/i.test(location.pathname);
  }

  function shouldShowPrompt() {
    if (isInstalled) return false;
    if (isStandalone()) return false;
    if (sessionStorage.getItem(SHOWN_KEY)) return false;
    if (isOnPracticePage()) return false;

    const dismissedUntil = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (Date.now() < dismissedUntil) return false;

    return true;
  }

  // ============================================================
  // CAPTURE NATIVE PROMPT (Chrome / Edge / Android)
  // ============================================================

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    setTimeout(() => {
      if (shouldShowPrompt() && deferredPrompt) {
        showCustomPrompt();
      }
    }, 30000);
  });

  window.addEventListener('appinstalled', () => {
    isInstalled = true;
    deferredPrompt = null;
    if (window.STAARAuth && window.STAARAuth.showToast) {
      window.STAARAuth.showToast('Installed! Look for the StarTest icon.');
    }
  });

  // ============================================================
  // ENGAGEMENT TRIGGERS
  // ============================================================

  document.addEventListener('startest:auth-changed', (e) => {
    if (!e.detail || !e.detail.user) return;

    setTimeout(() => {
      if (shouldShowPrompt() && (deferredPrompt || isIOS())) {
        showCustomPrompt();
      }
    }, 2000);
  });

  document.addEventListener('startest:correct-answer', (e) => {
    const count = (e.detail && e.detail.count) || 0;
    if (count !== 2) return;

    setTimeout(() => {
      // Practice page is guarded inside shouldShowPrompt; this fires post-session.
      if (shouldShowPrompt() && (deferredPrompt || isIOS())) {
        showCustomPrompt();
      }
    }, 1500);
  });

  // ============================================================
  // CUSTOM PROMPT UI
  // ============================================================

  function showCustomPrompt() {
    if (sessionStorage.getItem(SHOWN_KEY)) return;
    sessionStorage.setItem(SHOWN_KEY, '1');

    const isIos = isIOS();

    const html = `
      <div class="pwa-install-scrim" id="pwa-scrim"></div>
      <div class="pwa-install-card" id="pwa-card" role="dialog" aria-labelledby="pwa-title" aria-modal="true">
        <button type="button" class="pwa-install-close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div class="pwa-install-icon">
          <img src="/icons/icon-192.png" alt="StarTest" />
        </div>

        <h3 class="pwa-install-title" id="pwa-title">Add StarTest to your home screen</h3>
        <p class="pwa-install-sub">
          Faster to open. Works offline. Looks and feels like a real app.
        </p>

        ${isIos ? renderIOSInstructions() : renderInstallButton()}

        <button type="button" class="pwa-install-later" id="pwa-later">Maybe later</button>
      </div>
    `;

    const wrap = document.createElement('div');
    wrap.className = 'pwa-install-wrap';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);

    requestAnimationFrame(() => {
      document.getElementById('pwa-scrim').dataset.open = 'true';
      document.getElementById('pwa-card').dataset.open = 'true';
    });

    document.getElementById('pwa-scrim').addEventListener('click', dismissPrompt);
    document.querySelector('.pwa-install-close').addEventListener('click', dismissPrompt);
    document.getElementById('pwa-later').addEventListener('click', () => {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * DAY_MS));
      dismissPrompt();
    });

    if (!isIos && deferredPrompt) {
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.addEventListener('click', triggerInstall);
    }
  }

  function renderInstallButton() {
    return `
      <button type="button" class="pwa-install-cta" id="pwa-install-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Install StarTest
      </button>
    `;
  }

  function renderIOSInstructions() {
    return `
      <ol class="pwa-ios-steps">
        <li class="pwa-ios-step">
          <span class="pwa-ios-step-num">1</span>
          <span class="pwa-ios-step-text">
            Tap the <strong>Share</strong> button
            <span class="pwa-ios-share-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </span>
            in Safari's bottom bar.
          </span>
        </li>
        <li class="pwa-ios-step">
          <span class="pwa-ios-step-num">2</span>
          <span class="pwa-ios-step-text">
            Scroll down. Tap <strong>"Add to Home Screen"</strong>.
          </span>
        </li>
        <li class="pwa-ios-step">
          <span class="pwa-ios-step-num">3</span>
          <span class="pwa-ios-step-text">
            Tap <strong>"Add"</strong> in the top right.
          </span>
        </li>
      </ol>
      <p class="pwa-ios-tip">
        Already there? Look for the gold StarTest icon on your home screen.
      </p>
    `;
  }

  async function triggerInstall() {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome !== 'accepted') {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * DAY_MS));
    }

    deferredPrompt = null;
    dismissPrompt();
  }

  function dismissPrompt() {
    const wrap = document.querySelector('.pwa-install-wrap');
    if (!wrap) return;

    const scrim = document.getElementById('pwa-scrim');
    const card = document.getElementById('pwa-card');
    if (scrim) scrim.dataset.open = 'false';
    if (card) card.dataset.open = 'false';

    setTimeout(() => wrap.remove(), 300);
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.STARTEST_PWA = {
    isStandalone,
    isInstalled: () => isStandalone(),
    show: () => {
      sessionStorage.removeItem(SHOWN_KEY);
      localStorage.removeItem(DISMISS_KEY);
      showCustomPrompt();
    }
  };

  // Mark body class for standalone-aware CSS
  if (isStandalone()) {
    if (document.body) {
      document.body.classList.add('is-standalone');
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.add('is-standalone');
      });
    }
  }
})();
