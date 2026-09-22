/*
 * ============================================================
 * RESPECT DES LIEUX — HOTFIX V4.2 / I-O HARDENING
 * ============================================================
 *
 * À charger APRÈS security-v4.js :
 *
 *   <script src="./security-v4.js"></script>
 *   <script src="./v4-2-hotfix.js"></script>
 *
 * Objectifs :
 * - supprime le polling toutes les 30 secondes ;
 * - évite les rafraîchissements concurrents ;
 * - n'actualise automatiquement qu'au retour sur l'onglet,
 *   au maximum une fois toutes les 2 minutes ;
 * - ajoute un bouton d'actualisation manuelle ;
 * - borne les appels réseau Supabase par un timeout ;
 * - remplace "Failed to fetch" par un diagnostic compréhensible ;
 * - conserve RLS et l'authentification Supabase ;
 * - n'enregistre aucune donnée sensible dans localStorage.
 * ============================================================
 */

(function () {
  'use strict';

  if (window.__RL_V42_HOTFIX__) return;
  window.__RL_V42_HOTFIX__ = true;

  var MIN_AUTO_REFRESH_MS = 120000;
  var NETWORK_TIMEOUT_MS = 12000;
  var state = {
    probePromise: null,
    refreshPromise: null,
    lastRefreshAt: 0,
    focusHandler: null,
    visibilityHandler: null
  };

  function auth() {
    return window.RL_AUTH || null;
  }

  function supa() {
    return window.SUPA || null;
  }

  function clearLegacyPolling() {
    try {
      if (typeof window.realtimeInterval !== 'undefined' && window.realtimeInterval) {
        clearInterval(window.realtimeInterval);
        window.realtimeInterval = null;
      }
    } catch (e) {}
  }

  function stopLowIoSync() {
    clearLegacyPolling();

    if (state.focusHandler) {
      window.removeEventListener('focus', state.focusHandler);
      state.focusHandler = null;
    }

    if (state.visibilityHandler) {
      document.removeEventListener('visibilitychange', state.visibilityHandler);
      state.visibilityHandler = null;
    }
  }

  function networkMessage(err) {
    var msg = String((err && err.message) || err || '');

    if (/aborted|aborterror|délai|timeout/i.test(msg)) {
      return 'Supabase ne répond pas dans le délai imparti. Le projet peut être temporairement saturé.';
    }

    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      return 'Impossible de joindre Supabase. Vérifiez le réseau et l’état du projet, puis réessayez.';
    }

    return msg || 'Connexion Supabase impossible.';
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    options = options || {};
    timeoutMs = Number(timeoutMs || NETWORK_TIMEOUT_MS);

    var controller = new AbortController();
    var inheritedSignal = options.signal;
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    if (inheritedSignal && inheritedSignal.addEventListener) {
      if (inheritedSignal.aborted) {
        controller.abort();
      } else {
        inheritedSignal.addEventListener(
          'abort',
          function () { controller.abort(); },
          { once: true }
        );
      }
    }

    try {
      return await fetch(
        url,
        Object.assign({}, options, { signal: controller.signal })
      );
    } catch (err) {
      throw new Error(networkMessage(err));
    } finally {
      clearTimeout(timer);
    }
  }

  function authHeaders() {
    var A = auth();
    var S = supa();

    if (!A || !S || !A.accessToken) {
      throw new Error('AUTH_REQUIRED');
    }

    return {
      'Content-Type': 'application/json',
      'apikey': S.key,
      'Authorization': 'Bearer ' + A.accessToken
    };
  }

  function installAuthHardening() {
    var A = auth();
    var S = supa();
    if (!A || !S || A.__rlV42Wrapped) return;

    A.__rlV42Wrapped = true;

    A.login = async function (email, password) {
      var r = await fetchWithTimeout(
        S.url + '/auth/v1/token?grant_type=password',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': S.key
          },
          body: JSON.stringify({
            email: email,
            password: password
          })
        },
        NETWORK_TIMEOUT_MS
      );

      var body = await r.json().catch(function () { return {}; });

      if (!r.ok || !body.access_token) {
        throw new Error(
          body.msg ||
          body.message ||
          body.error_description ||
          body.error ||
          'Identifiants incorrects.'
        );
      }

      this.save(body);
      return body;
    };

    A.refresh = async function () {
      if (!this.refreshToken) {
        throw new Error('Session expirée.');
      }

      var r = await fetchWithTimeout(
        S.url + '/auth/v1/token?grant_type=refresh_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': S.key
          },
          body: JSON.stringify({
            refresh_token: this.refreshToken
          })
        },
        NETWORK_TIMEOUT_MS
      );

      var body = await r.json().catch(function () { return {}; });

      if (!r.ok || !body.access_token) {
        if (r.status === 400 || r.status === 401 || r.status === 403) {
          this.clear();
        }

        throw new Error(
          body.msg ||
          body.message ||
          body.error_description ||
          body.error ||
          'Session expirée. Reconnectez-vous.'
        );
      }

      this.save(body);
      return body;
    };

    A.getUser = async function () {
      if (!this.accessToken) return null;

      try {
        var r = await fetchWithTimeout(
          S.url + '/auth/v1/user',
          {
            headers: {
              'apikey': S.key,
              'Authorization': 'Bearer ' + this.accessToken
            }
          },
          10000
        );

        if (!r.ok) return null;
        return await r.json();
      } catch (err) {
        console.warn('Respect des Lieux V4.2 — validation session :', networkMessage(err));
        return null;
      }
    };

    var oldClear = A.clear.bind(A);
    A.clear = function () {
      stopLowIoSync();
      state.refreshPromise = null;
      state.lastRefreshAt = 0;
      return oldClear();
    };
  }

  async function getTable(table, query) {
    var S = supa();
    if (!S) throw new Error('Supabase non configuré.');

    var r = await fetchWithTimeout(
      S.url + '/rest/v1/' + table + '?' + query,
      {
        headers: authHeaders()
      },
      NETWORK_TIMEOUT_MS
    );

    if (!r.ok) {
      var body = await r.text().catch(function () { return ''; });
      var err = new Error(
        'GET ' + table + ' — HTTP ' + r.status +
        (body ? ' — ' + body.slice(0, 240) : '')
      );
      err.status = r.status;
      throw err;
    }

    return await r.json();
  }

  function installLowIoReader() {
    window.fetchFromSupabase = function () {
      if (state.refreshPromise) return state.refreshPromise;

      state.refreshPromise = Promise.all([
        getTable(
          'signalements',
          'select=id,num,date,heure,lieu,type,gravite,signale_par,description,eleve,classe,famille,photos_urls,statut,created_at' +
          '&order=date.desc&limit=500'
        ),
        getTable(
          'reparations',
          'select=id,signa_id,mesure,referent,debut,duree,notes,cloture,statut,created_at' +
          '&order=created_at.desc&limit=1000'
        )
      ])
      .then(function (results) {
        if (typeof window.STATE !== 'undefined') {
          STATE.signalements = results[0] || [];
          STATE.reparations = results[1] || [];
        }

        if (typeof window.computeNextNum === 'function') computeNextNum();
        if (typeof window.saveLocalCache === 'function') saveLocalCache();
        if (typeof window.refreshAll === 'function') refreshAll();

        return results;
      })
      .finally(function () {
        state.refreshPromise = null;
      });

      return state.refreshPromise;
    };

    window.probeSupa = function () {
      if (window.location.protocol === 'file:') return Promise.resolve('file-local');

      var A = auth();
      var S = supa();

      if (!A || !A.accessToken) return Promise.resolve('auth-required');
      if (!S || !S.url || !S.key) return Promise.resolve('bad-key');
      if (state.probePromise) return state.probePromise;

      state.probePromise = (async function () {
        try {
          var r = await fetchWithTimeout(
            S.url + '/rest/v1/signalements?select=id&limit=1',
            { headers: authHeaders() },
            8000
          );

          if (r.ok) {
            await window.fetchFromSupabase();
            return 'ok';
          }

          var body = await r.text().catch(function () { return ''; });

          if (r.status === 401) return 'session-expired';
          if (r.status === 403) return 'rls-blocked';

          if (
            r.status === 404 ||
            body.indexOf('42P01') !== -1 ||
            body.indexOf('does not exist') !== -1
          ) {
            return 'no-tables';
          }

          return 'offline';
        } catch (err) {
          console.warn(
            'Respect des Lieux V4.2 — Supabase indisponible :',
            networkMessage(err)
          );
          return 'offline';
        } finally {
          state.probePromise = null;
        }
      })();

      return state.probePromise;
    };
  }

  async function refreshNow(force) {
    var A = auth();

    if (!A || !A.accessToken) return false;
    if (typeof window.STATE === 'undefined' || !STATE.online) return false;
    if (!force && document.visibilityState === 'hidden') return false;
    if (state.refreshPromise) return state.refreshPromise.then(function () { return true; });

    var now = Date.now();
    if (!force && (now - state.lastRefreshAt) < MIN_AUTO_REFRESH_MS) {
      return false;
    }

    state.lastRefreshAt = now;

    try {
      if (typeof window.setSyncing === 'function') setSyncing(true);
      await window.fetchFromSupabase();
      if (typeof window.setOnline === 'function') setOnline(true);
      return true;
    } catch (err) {
      console.warn(
        'Respect des Lieux V4.2 — actualisation différée :',
        networkMessage(err)
      );
      return false;
    } finally {
      if (typeof window.setSyncing === 'function') setSyncing(false);
    }
  }

  function installLowIoSync() {
    clearLegacyPolling();
    stopLowIoSync();

    state.focusHandler = function () {
      refreshNow(false);
    };

    state.visibilityHandler = function () {
      if (document.visibilityState === 'visible') {
        refreshNow(false);
      }
    };

    window.addEventListener('focus', state.focusHandler);
    document.addEventListener('visibilitychange', state.visibilityHandler);
  }

  window.subscribeRealtime = function () {
    installLowIoSync();
  };

  window.rlRefreshNow = function () {
    return refreshNow(true);
  };

  function addRefreshButton() {
    var actions = document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('rl-sync-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'rl-sync-btn';
    btn.className = 'btn btn-ghost btn-sm';
    btn.type = 'button';
    btn.textContent = 'Actualiser';
    btn.title = 'Actualiser les données à la demande';

    btn.addEventListener('click', async function () {
      btn.disabled = true;

      var ok = await refreshNow(true);

      btn.disabled = false;

      if (typeof window.toast === 'function') {
        toast(
          ok
            ? 'Données actualisées.'
            : 'Supabase ne répond pas pour le moment.',
          !ok
        );
      }
    });

    var logout = document.getElementById('rl-logout-btn');
    if (logout && logout.parentNode === actions) {
      actions.insertBefore(btn, logout);
    } else {
      actions.appendChild(btn);
    }
  }

  function addAuthRepairButton() {
    var screen = document.getElementById('rl-auth-screen');
    if (!screen || document.getElementById('rl-auth-reconfig')) return;

    var card = screen.querySelector('.rl-auth-card');
    var foot = screen.querySelector('.rl-auth-foot');
    if (!card) return;

    var btn = document.createElement('button');
    btn.id = 'rl-auth-reconfig';
    btn.type = 'button';
    btn.textContent = 'Vérifier la configuration Supabase';
    btn.style.cssText =
      'width:100%;border:1px solid #cbd8e5;border-radius:9px;' +
      'padding:9px 12px;background:#fff;color:#53697d;' +
      'font:700 12px Nunito,Arial,sans-serif;cursor:pointer;margin-top:9px';

    btn.addEventListener('click', function () {
      screen.classList.remove('open');

      if (typeof window.reconfig === 'function') {
        reconfig();
      }
    });

    if (foot) {
      card.insertBefore(btn, foot);
    } else {
      card.appendChild(btn);
    }
  }

  function installUiObserver() {
    addRefreshButton();
    addAuthRepairButton();

    var observer = new MutationObserver(function () {
      addRefreshButton();
      addAuthRepairButton();
      clearLegacyPolling();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  clearLegacyPolling();
  installAuthHardening();
  installLowIoReader();

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      function () {
        clearLegacyPolling();
        installAuthHardening();
        installLowIoReader();
        installUiObserver();
      },
      { once: true }
    );
  } else {
    installUiObserver();
  }

  window.addEventListener('beforeunload', stopLowIoSync);
})();
