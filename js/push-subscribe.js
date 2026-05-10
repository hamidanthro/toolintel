/**
 * GradeEarn — web push subscribe pipeline (Tier 6 AD, May 10)
 *
 * Subscribe / unsubscribe flow that uses the browser PushManager API
 * with VAPID. Once a kid (or parent) opts in, the subscription object
 * is persisted server-side via the savePushSubscription lambda action.
 *
 * VAPID public key must be set on window.GE_PUSH_VAPID_PUB before this
 * module is invoked. If unset, the module is inert (logs a warning,
 * exposes a "not configured" status).
 *
 * Sender side: not in this commit. The server still needs VAPID keys
 * + the web-push npm package to actually deliver notifications. The
 * subscriptions written here become live the moment the sender ships.
 *
 * Exposed as window.GEPush.
 *   GEPush.status()  -> 'unsupported' | 'unconfigured' | 'denied' |
 *                       'unsubscribed' | 'subscribed'
 *   GEPush.subscribe()    async — requests permission + registers
 *   GEPush.unsubscribe()  async
 */
(function () {
  'use strict';

  function supported() {
    return !!('serviceWorker' in navigator) &&
           !!('PushManager' in window) &&
           !!('Notification' in window);
  }

  function configured() {
    return typeof window.GE_PUSH_VAPID_PUB === 'string' && window.GE_PUSH_VAPID_PUB.length > 0;
  }

  // Convert base64-url public key to Uint8Array for applicationServerKey.
  function urlBase64ToUint8(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const base64Std = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64Std);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function getRegistration() {
    if (!supported()) return null;
    return await navigator.serviceWorker.ready;
  }

  async function status() {
    if (!supported()) return 'unsupported';
    if (!configured()) return 'unconfigured';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await getRegistration();
    if (!reg) return 'unsupported';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'unsubscribed';
  }

  async function subscribe() {
    if (!supported()) throw new Error('Push notifications aren\'t supported in this browser.');
    if (!configured()) throw new Error('Push isn\'t configured yet on this build. Try again later.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notification permission was denied.');
    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8(window.GE_PUSH_VAPID_PUB)
      });
    }
    await persistSubscription(sub.toJSON());
    return sub;
  }

  async function unsubscribe() {
    const reg = await getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const ok = await sub.unsubscribe();
    if (ok) await persistSubscription(null);
    return ok;
  }

  async function persistSubscription(subJson) {
    try {
      if (!window.STAARAuth || !window.STAARAuth.api) return;
      const token = window.STAARAuth.token && window.STAARAuth.token();
      if (!token) return;
      await window.STAARAuth.api('savePushSubscription', {
        token,
        subscription: subJson  // null = explicit unsubscribe
      });
    } catch (e) {
      console.warn('[push subscribe]', e && e.message);
    }
  }

  window.GEPush = { supported, configured, status, subscribe, unsubscribe };
})();
