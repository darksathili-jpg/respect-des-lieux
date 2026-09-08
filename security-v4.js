/*
 * ============================================================
 * RESPECT DES LIEUX — SECURITY PATCH V4.1
 * ============================================================
 *
 * À charger APRÈS le script principal de index.html :
 *
 *   <script src="./security-v4.js"></script>
 *
 * Ce correctif :
 * - impose une authentification Supabase email + mot de passe ;
 * - utilise le JWT de l'utilisateur pour toutes les requêtes REST ;
 * - fonctionne avec RLS activé ;
 * - retire les copies persistantes de données élèves dans localStorage ;
 * - conserve seulement la configuration publique Supabase ;
 * - utilise sessionStorage pour la session d'authentification ;
 * - transforme le bucket rl-photos en usage privé ;
 * - génère des URLs temporaires pour afficher les photos ;
 * - empêche l'ancien fallback Base64 en cas d'échec d'upload ;
 * - remplace l'ancien script SQL dangereux qui désactivait RLS ;
 * - gère les invitations Supabase et permet de définir le mot de passe.
 *
 * IMPORTANT :
 * Dans Supabase, désactivez "Allow new users to sign up" et créez
 * uniquement les comptes autorisés depuis Authentication > Users.
 * ============================================================
 */

(function () {
  'use strict';

  var SESSION_KEY = 'rl4-auth-session';
  var SENSITIVE_LOCAL_KEYS = ['rl3-sig', 'rl3-rep', 'rl3-queue'];
  var refreshTimer = null;
  var signedCache = new Map();

  var SECURE_SQL = [
    '-- Respect des Lieux V4.1 : utilisez le fichier supabase_secure_v4.sql fourni.',
    '-- IMPORTANT : RLS doit rester ACTIVE.',
    '-- Ne réutilisez jamais ALTER TABLE ... DISABLE ROW LEVEL SECURITY.'
  ].join('\n');

  function clearSensitiveLocalData() {
    SENSITIVE_LOCAL_KEYS.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  clearSensitiveLocalData();

  if (typeof window.STATE !== 'undefined') {
    STATE.signalements = [];
    STATE.reparations = [];
    STATE.queue = [];
  }

  // Empêche désormais toute persistance locale des données élèves.
  window.saveLocalCache = function () {
    clearSensitiveLocalData();
  };

  window.loadLocalCache = function () {
    clearSensitiveLocalData();
    if (typeof window.STATE !== 'undefined') {
      STATE.signalements = [];
      STATE.reparations = [];
      STATE.queue = [];
      if (typeof computeNextNum === 'function') computeNextNum();
    }
  };

  // Remplace le SQL affiché par l'assistant de configuration.
  try {
    window.SQL_SCRIPT = SECURE_SQL;
    var sqlBox = document.getElementById('sql-setup-box');
    if (sqlBox) sqlBox.textContent = SECURE_SQL;

    var setupSql = document.getElementById('setup-step-2');
    if (setupSql) {
      var desc = setupSql.querySelector('.setup-desc');
      if (desc) {
        desc.innerHTML =
          'Utilisez le fichier <strong>supabase_secure_v4.sql</strong> fourni avec la V4. ' +
          '<br><br><strong style="color:var(--green)">RLS doit rester activé.</strong> ' +
          'La clé publique seule ne doit jamais permettre de lire les données.';
      }
    }
  } catch (e) {}

  if (typeof window.realtimeInterval !== 'undefined' && window.realtimeInterval) {
    clearInterval(window.realtimeInterval);
    window.realtimeInterval = null;
  }

  var AUTH = {
    session: null,

    get accessToken() {
      return this.session && this.session.access_token ? this.session.access_token : '';
    },

    get refreshToken() {
      return this.session && this.session.refresh_token ? this.session.refresh_token : '';
    },

    save: function (payload) {
      if (!payload || !payload.access_token) return;
      this.session = {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || (this.session && this.session.refresh_token) || '',
        token_type: payload.token_type || 'bearer',
        expires_at: Date.now() + (Number(payload.expires_in || 3600) * 1000),
        user: payload.user || (this.session && this.session.user) || null
      };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      } catch (e) {}
      this.scheduleRefresh();
    },

    clear: function () {
      this.session = null;
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
      signedCache.clear();
    },

    load: function () {
      try {
        var raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) this.session = JSON.parse(raw);
      } catch (e) {
        this.session = null;
      }
      return this.session;
    },

    authHeaders: function () {
      return {
        'Content-Type': 'application/json',
        'apikey': SUPA.key,
        'Authorization': 'Bearer ' + this.accessToken
      };
    },

    login: async function (email, password) {
      var r = await fetch(
        SUPA.url + '/auth/v1/token?grant_type=password',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPA.key
          },
          body: JSON.stringify({ email: email, password: password })
        }
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
    },

    refresh: async function () {
      if (!this.refreshToken) throw new Error('Session expirée.');

      var r = await fetch(
        SUPA.url + '/auth/v1/token?grant_type=refresh_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPA.key
          },
          body: JSON.stringify({ refresh_token: this.refreshToken })
        }
      );

      var body = await r.json().catch(function () { return {}; });

      if (!r.ok || !body.access_token) {
        this.clear();
        throw new Error('Session expirée. Reconnectez-vous.');
      }

      this.save(body);
      return body;
    },

    getUser: async function () {
      if (!this.accessToken) return null;

      var r = await fetch(SUPA.url + '/auth/v1/user', {
        headers: {
          'apikey': SUPA.key,
          'Authorization': 'Bearer ' + this.accessToken
        }
      });

      if (!r.ok) return null;
      return r.json();
    },

    ensureValid: async function () {
      if (!this.session) this.load();
      if (!this.session || !this.accessToken) return false;

      var expiresAt = Number(this.session.expires_at || 0);
      if (expiresAt && expiresAt < Date.now() + 90 * 1000) {
        try {
          await this.refresh();
        } catch (e) {
          return false;
        }
      }

      var user = await this.getUser();
      if (!user) {
        try {
          await this.refresh();
          user = await this.getUser();
        } catch (e) {
          this.clear();
          return false;
        }
      }

      if (user) {
        this.session.user = user;
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch (e) {}
      }

      return !!user;
    },

    scheduleRefresh: function () {
      if (refreshTimer) clearTimeout(refreshTimer);
      if (!this.session || !this.session.expires_at) return;

      var delay = Math.max(
        30 * 1000,
        Number(this.session.expires_at) - Date.now() - 5 * 60 * 1000
      );

      refreshTimer = setTimeout(async function () {
        try {
          await AUTH.refresh();
        } catch (e) {
          AUTH.clear();
          showAuthScreen('Votre session a expiré. Reconnectez-vous.');
        }
      }, delay);
    },

    logout: async function () {
      if (this.accessToken) {
        try {
          await fetch(SUPA.url + '/auth/v1/logout', {
            method: 'POST',
            headers: {
              'apikey': SUPA.key,
              'Authorization': 'Bearer ' + this.accessToken
            }
          });
        } catch (e) {}
      }

      this.clear();
      clearSensitiveLocalData();

      if (typeof window.STATE !== 'undefined') {
        STATE.signalements = [];
        STATE.reparations = [];
        STATE.queue = [];
      }

      if (typeof refreshAll === 'function') refreshAll();
      showAuthScreen('Vous êtes déconnecté.');
    }
  };

  window.RL_AUTH = AUTH;

  // ==========================================================
  // V4.1 — Invitation / récupération : définition du mot de passe
  // ==========================================================

  function parseAuthCallback() {
    var hash = new URLSearchParams(
      window.location.hash && window.location.hash.charAt(0) === '#'
        ? window.location.hash.slice(1)
        : window.location.hash
    );

    var query = new URLSearchParams(window.location.search || '');

    var error =
      hash.get('error_description') ||
      hash.get('error') ||
      query.get('error_description') ||
      query.get('error');

    if (error) {
      return {
        error: decodeURIComponent(String(error).replace(/\+/g, ' '))
      };
    }

    var accessToken = hash.get('access_token');
    var refreshToken = hash.get('refresh_token');
    var type = hash.get('type') || query.get('type') || '';
    var expiresIn = Number(hash.get('expires_in') || 3600);

    if (!accessToken) return null;

    return {
      access_token: accessToken,
      refresh_token: refreshToken || '',
      token_type: hash.get('token_type') || 'bearer',
      expires_in: expiresIn,
      type: type
    };
  }

  function cleanAuthUrl() {
    try {
      var clean = window.location.pathname;
      if (window.location.search) {
        var q = new URLSearchParams(window.location.search);
        [
          'type',
          'error',
          'error_code',
          'error_description',
          'code',
          'token',
          'token_hash'
        ].forEach(function (k) { q.delete(k); });

        var s = q.toString();
        if (s) clean += '?' + s;
      }
      window.history.replaceState({}, document.title, clean);
    } catch (e) {}
  }

  function ensurePasswordSetupUi() {
    var existing = document.getElementById('rl-password-setup-screen');
    if (existing) return existing;

    var style = document.createElement('style');
    style.textContent = [
      '#rl-password-setup-screen{position:fixed;inset:0;z-index:5100;',
      'background:linear-gradient(135deg,#edf3f8 0%,#f8fafc 100%);',
      'display:none;align-items:center;justify-content:center;padding:22px;',
      'font-family:Nunito,Arial,sans-serif}',
      '#rl-password-setup-screen.open{display:flex}',
      '.rl-pass-card{width:min(460px,100%);background:#fff;',
      'border:1px solid #dde6ef;border-radius:20px;padding:34px 36px;',
      'box-shadow:0 18px 60px rgba(44,62,80,.16)}',
      '.rl-pass-title{font-family:"Playfair Display",Georgia,serif;',
      'font-size:25px;font-weight:700;color:#2c3e50;margin-bottom:4px}',
      '.rl-pass-sub{font-size:12px;color:#8aa0b1;margin-bottom:22px}',
      '.rl-pass-info{background:#edfaf3;border:1px solid #bfe7d0;',
      'border-radius:9px;padding:11px 12px;color:#39745a;font-size:12px;',
      'margin-bottom:18px;line-height:1.5}',
      '.rl-pass-email{font-weight:800;word-break:break-word}',
      '.rl-pass-field{display:flex;flex-direction:column;gap:5px;margin-bottom:13px}',
      '.rl-pass-field label{font-size:12px;font-weight:700;color:#5d7080}',
      '.rl-pass-field input{font:inherit;padding:11px 12px;border:1.5px solid #dde6ef;',
      'border-radius:9px;outline:none;color:#2c3e50}',
      '.rl-pass-field input:focus{border-color:#6c8ebf;',
      'box-shadow:0 0 0 3px rgba(108,142,191,.12)}',
      '.rl-pass-btn{width:100%;border:0;border-radius:9px;padding:11px 14px;',
      'background:#6c8ebf;color:#fff;font:700 13px Nunito,Arial,sans-serif;',
      'cursor:pointer;margin-top:5px}',
      '.rl-pass-btn:disabled{opacity:.55;cursor:wait}',
      '.rl-pass-msg{display:none;margin-top:12px;padding:9px 11px;',
      'border-radius:8px;font-size:12px;line-height:1.5}',
      '.rl-pass-msg.err{display:block;background:#fdf0f0;color:#b54b4b}',
      '.rl-pass-msg.ok{display:block;background:#edfaf3;color:#39745a}',
      '.rl-pass-foot{font-size:10px;color:#9ab0c0;text-align:center;',
      'margin-top:17px;line-height:1.5}'
    ].join('');
    document.head.appendChild(style);

    var screen = document.createElement('div');
    screen.id = 'rl-password-setup-screen';
    screen.innerHTML =
      '<div class="rl-pass-card">' +
        '<div class="rl-pass-title">Créer votre mot de passe</div>' +
        '<div class="rl-pass-sub">Respect des Lieux — activation de votre accès</div>' +
        '<div class="rl-pass-info">✅ Votre invitation Supabase a été reconnue.<br>' +
          'Définissez maintenant votre mot de passe pour terminer la création du compte.' +
          '<div id="rl-pass-email" class="rl-pass-email" style="margin-top:7px"></div>' +
        '</div>' +
        '<form id="rl-password-setup-form">' +
          '<div class="rl-pass-field">' +
            '<label for="rl-new-password">Nouveau mot de passe</label>' +
            '<input id="rl-new-password" type="password" autocomplete="new-password" minlength="8" required>' +
          '</div>' +
          '<div class="rl-pass-field">' +
            '<label for="rl-new-password-confirm">Confirmer le mot de passe</label>' +
            '<input id="rl-new-password-confirm" type="password" autocomplete="new-password" minlength="8" required>' +
          '</div>' +
          '<button id="rl-pass-submit" class="rl-pass-btn" type="submit">Créer mon mot de passe</button>' +
          '<div id="rl-pass-msg" class="rl-pass-msg"></div>' +
        '</form>' +
        '<div class="rl-pass-foot">Le mot de passe est transmis directement à Supabase via HTTPS et n’est pas enregistré dans l’application.</div>' +
      '</div>';

    document.body.appendChild(screen);

    screen.querySelector('#rl-password-setup-form').addEventListener('submit', async function (e) {
      e.preventDefault();

      var p1 = screen.querySelector('#rl-new-password').value;
      var p2 = screen.querySelector('#rl-new-password-confirm').value;
      var btn = screen.querySelector('#rl-pass-submit');
      var msg = screen.querySelector('#rl-pass-msg');

      msg.className = 'rl-pass-msg';
      msg.textContent = '';

      if (p1.length < 8) {
        msg.className = 'rl-pass-msg err';
        msg.textContent = 'Choisissez un mot de passe d’au moins 8 caractères.';
        return;
      }

      if (p1 !== p2) {
        msg.className = 'rl-pass-msg err';
        msg.textContent = 'Les deux mots de passe ne sont pas identiques.';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Enregistrement…';

      try {
        var r = await fetch(SUPA.url + '/auth/v1/user', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPA.key,
            'Authorization': 'Bearer ' + AUTH.accessToken
          },
          body: JSON.stringify({ password: p1 })
        });

        var body = await r.json().catch(function () { return {}; });

        if (!r.ok) {
          throw new Error(
            body.msg ||
            body.message ||
            body.error_description ||
            body.error ||
            'Supabase a refusé ce mot de passe.'
          );
        }

        AUTH.session.user = body;
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(AUTH.session));
        } catch (e) {}

        msg.className = 'rl-pass-msg ok';
        msg.textContent = 'Mot de passe créé. Ouverture de l’application…';

        await new Promise(function (resolve) { setTimeout(resolve, 500); });

        screen.classList.remove('open');
        await launchAuthenticatedApp();
      } catch (err) {
        msg.className = 'rl-pass-msg err';
        msg.textContent = err.message || 'Impossible de créer le mot de passe.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Créer mon mot de passe';
      }
    });

    return screen;
  }

  async function showPasswordSetupScreen(flowType) {
    var screen = ensurePasswordSetupUi();

    if (document.getElementById('main-app')) {
      document.getElementById('main-app').style.display = 'none';
    }

    if (document.getElementById('rl-auth-screen')) {
      document.getElementById('rl-auth-screen').classList.remove('open');
    }

    if (document.getElementById('loading-overlay')) {
      document.getElementById('loading-overlay').classList.add('hidden');
    }

    var user = await AUTH.getUser();
    if (user) {
      AUTH.session.user = user;
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(AUTH.session));
      } catch (e) {}
    }

    var title = screen.querySelector('.rl-pass-title');
    var sub = screen.querySelector('.rl-pass-sub');

    if (flowType === 'recovery') {
      title.textContent = 'Choisir un nouveau mot de passe';
      sub.textContent = 'Respect des Lieux — récupération du compte';
    } else {
      title.textContent = 'Créer votre mot de passe';
      sub.textContent = 'Respect des Lieux — activation de votre accès';
    }

    var email = screen.querySelector('#rl-pass-email');
    email.textContent = user && user.email ? user.email : '';

    screen.classList.add('open');

    setTimeout(function () {
      var p = screen.querySelector('#rl-new-password');
      if (p) p.focus();
    }, 50);
  }

  async function consumeAuthCallback() {
    var callback = parseAuthCallback();
    if (!callback) return false;

    if (callback.error) {
      cleanAuthUrl();
      showAuthScreen(
        'Le lien Supabase est invalide ou a expiré : ' + callback.error +
        '. Renvoyez une nouvelle invitation.'
      );
      return true;
    }

    AUTH.save(callback);

    // Important : le JWT d'invitation ne doit pas rester visible dans l'URL.
    cleanAuthUrl();

    if (callback.type === 'invite' || callback.type === 'recovery') {
      await showPasswordSetupScreen(callback.type);
      return true;
    }

    // Autres callbacks valides : on conserve la session et on poursuit.
    return false;
  }

  async function secureFetch(url, options, retry) {
    options = options || {};
    if (retry === undefined) retry = true;

    if (!AUTH.accessToken) {
      throw new Error('AUTH_REQUIRED');
    }

    if (AUTH.session && AUTH.session.expires_at < Date.now() + 60 * 1000) {
      await AUTH.refresh();
    }

    var headers = Object.assign({}, options.headers || {}, {
      'apikey': SUPA.key,
      'Authorization': 'Bearer ' + AUTH.accessToken
    });

    options.headers = headers;
    var r = await fetch(url, options);

    if (r.status === 401 && retry && AUTH.refreshToken) {
      await AUTH.refresh();
      return secureFetch(url, options, false);
    }

    return r;
  }

  function installSecureSupabaseClient() {
    if (typeof window.SUPA === 'undefined') return;

    SUPA.hdr = function () {
      return {
        'Content-Type': 'application/json',
        'apikey': SUPA.key,
        'Authorization': 'Bearer ' + AUTH.accessToken,
        'Prefer': 'return=representation'
      };
    };

    SUPA.get = async function (table, params) {
      var qs = params ? '?' + params : '';
      var r = await secureFetch(
        SUPA.url + '/rest/v1/' + table + qs,
        { headers: SUPA.hdr() }
      );

      if (!r.ok) {
        var t = await r.text();
        throw new Error('GET ' + table + ' ' + r.status + ' ' + t);
      }
      return r.json();
    };

    SUPA.post = async function (table, body) {
      var r = await secureFetch(
        SUPA.url + '/rest/v1/' + table,
        {
          method: 'POST',
          headers: SUPA.hdr(),
          body: JSON.stringify(body)
        }
      );

      if (!r.ok) {
        var t = await r.text();
        throw new Error(t || ('POST ' + r.status));
      }
      return r.json();
    };

    SUPA.patch = async function (table, id, body) {
      var r = await secureFetch(
        SUPA.url + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: SUPA.hdr(),
          body: JSON.stringify(body)
        }
      );

      if (!r.ok) {
        var t = await r.text();
        throw new Error(t || ('PATCH ' + r.status));
      }
      return r.json();
    };

    SUPA.del = async function (table, id) {
      var r = await secureFetch(
        SUPA.url + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id),
        {
          method: 'DELETE',
          headers: SUPA.hdr()
        }
      );
      if (!r.ok) throw new Error('DELETE ' + r.status);
      return true;
    };

    SUPA.upload = async function (bucket, path, blob) {
      var encodedPath = path
        .split('/')
        .map(function (part) { return encodeURIComponent(part); })
        .join('/');

      var r = await secureFetch(
        SUPA.url + '/storage/v1/object/' +
          encodeURIComponent(bucket) + '/' + encodedPath,
        {
          method: 'POST',
          headers: {
            'Content-Type': blob.type || 'application/octet-stream',
            'x-upsert': 'false'
          },
          body: blob
        }
      );

      if (!r.ok) {
        var t = await r.text();
        throw new Error(t || ('Upload ' + r.status));
      }

      // Ne stocke jamais d'URL publique ou signée dans la base.
      return 'private:' + bucket + '/' + path;
    };

    SUPA.pubUrl = function (bucket, path) {
      return 'private:' + bucket + '/' + path;
    };
  }

  function markerInfo(value) {
    if (!value || typeof value !== 'string') return null;

    if (value.indexOf('private:') === 0) {
      var rest = value.slice('private:'.length);
      var slash = rest.indexOf('/');
      if (slash <= 0) return null;
      return {
        bucket: rest.slice(0, slash),
        path: rest.slice(slash + 1),
        marker: value
      };
    }

    var publicNeedle = '/storage/v1/object/public/rl-photos/';
    var idx = value.indexOf(publicNeedle);
    if (idx !== -1) {
      return {
        bucket: 'rl-photos',
        path: value.slice(idx + publicNeedle.length),
        marker: 'private:rl-photos/' + value.slice(idx + publicNeedle.length)
      };
    }

    return null;
  }

  async function signedUrlFor(value) {
    var info = markerInfo(value);
    if (!info) return value;

    var cached = signedCache.get(info.marker);
    if (cached && cached.expires > Date.now()) return cached.url;

    var encodedPath = info.path
      .split('/')
      .map(function (part) { return encodeURIComponent(part); })
      .join('/');

    var r = await secureFetch(
      SUPA.url + '/storage/v1/object/sign/' +
        encodeURIComponent(info.bucket) + '/' + encodedPath,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 900 })
      }
    );

    var body = await r.json().catch(function () { return {}; });

    if (!r.ok || !body.signedURL) {
      throw new Error(
        body.message ||
        body.error ||
        'Impossible de générer l’URL temporaire de la photo.'
      );
    }

    var full = body.signedURL.indexOf('http') === 0
      ? body.signedURL
      : SUPA.url + '/storage/v1' + body.signedURL;

    signedCache.set(info.marker, {
      url: full,
      expires: Date.now() + 12 * 60 * 1000
    });

    return full;
  }

  window.rlSignedUrlFor = signedUrlFor;

  async function secureImage(img) {
    if (!img || img.dataset.rlSecureResolving === '1') return;

    var raw = img.getAttribute('src') || '';
    var info = markerInfo(raw);
    if (!info) return;

    img.dataset.rlSecureResolving = '1';
    img.dataset.rlPrivateSource = info.marker;

    try {
      // Évite une tentative inutile sur le protocole "private:".
      img.removeAttribute('src');
      var signed = await signedUrlFor(info.marker);
      img.setAttribute('src', signed);
    } catch (e) {
      img.alt = 'Photo protégée indisponible';
      img.title = e.message || 'Photo protégée indisponible';
    } finally {
      img.dataset.rlSecureResolving = '0';
    }
  }

  function scanImages(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.tagName === 'IMG') secureImage(root);
    if (root.querySelectorAll) {
      root.querySelectorAll('img[src]').forEach(secureImage);
    }
  }

  scanImages(document);

  var imageObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.type === 'attributes' && m.target.tagName === 'IMG') {
        secureImage(m.target);
      }
      m.addedNodes.forEach(function (n) {
        scanImages(n);
      });
    });
  });

  imageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

  var oldOpenLightbox = window.openLightbox;
  window.openLightbox = async function (src) {
    try {
      src = await signedUrlFor(src);
    } catch (e) {
      if (typeof toast === 'function') toast('Photo protégée indisponible.', true);
      return;
    }

    if (typeof oldOpenLightbox === 'function') {
      oldOpenLightbox(src);
    }
  };

  // Upload sécurisé : aucun fallback Base64 en base de données.
  window.uploadPendingPhotos = async function (sigId) {
    var urls = [];
    if (!STATE.pendingPhotos.length) return urls;

    var status = document.getElementById('upload-status');
    if (status) {
      status.style.display = 'block';
      status.textContent = 'Envoi sécurisé des photos…';
    }

    for (var i = 0; i < STATE.pendingPhotos.length; i++) {
      var p = STATE.pendingPhotos[i];
      var path = 'sig-' + sigId + '/' + p.name;

      try {
        if (status) {
          status.textContent = 'Photo ' + (i + 1) + '/' +
            STATE.pendingPhotos.length + '…';
        }

        var marker = await SUPA.upload('rl-photos', path, p.blob);
        urls.push(marker);
      } catch (e) {
        console.warn('Upload photo sécurisé échoué:', e);
        if (typeof toast === 'function') {
          toast(
            'La photo ' + (i + 1) +
            ' n’a pas été enregistrée. Le signalement restera sans cette photo.',
            true
          );
        }
      }
    }

    if (status) status.style.display = 'none';
    return urls;
  };

  function ensureAuthUi() {
    var existing = document.getElementById('rl-auth-screen');
    if (existing) return existing;

    var style = document.createElement('style');
    style.textContent = [
      '#rl-auth-screen{position:fixed;inset:0;z-index:5000;',
      'background:linear-gradient(135deg,#edf3f8 0%,#f8fafc 100%);',
      'display:none;align-items:center;justify-content:center;padding:22px;',
      'font-family:Nunito,Arial,sans-serif}',
      '#rl-auth-screen.open{display:flex}',
      '.rl-auth-card{width:min(440px,100%);background:#fff;',
      'border:1px solid #dde6ef;border-radius:20px;padding:34px 36px;',
      'box-shadow:0 18px 60px rgba(44,62,80,.16)}',
      '.rl-auth-title{font-family:"Playfair Display",Georgia,serif;',
      'font-size:25px;font-weight:700;color:#2c3e50;margin-bottom:4px}',
      '.rl-auth-sub{font-size:12px;color:#8aa0b1;margin-bottom:24px}',
      '.rl-auth-secure{background:#edfaf3;border:1px solid #bfe7d0;',
      'border-radius:9px;padding:10px 12px;color:#39745a;font-size:12px;',
      'margin-bottom:18px;line-height:1.5}',
      '.rl-auth-field{display:flex;flex-direction:column;gap:5px;',
      'margin-bottom:13px}',
      '.rl-auth-field label{font-size:12px;font-weight:700;color:#5d7080}',
      '.rl-auth-field input{font:inherit;padding:11px 12px;border:1.5px solid #dde6ef;',
      'border-radius:9px;outline:none;color:#2c3e50}',
      '.rl-auth-field input:focus{border-color:#6c8ebf;',
      'box-shadow:0 0 0 3px rgba(108,142,191,.12)}',
      '.rl-auth-btn{width:100%;border:0;border-radius:9px;padding:11px 14px;',
      'background:#6c8ebf;color:#fff;font:700 13px Nunito,Arial,sans-serif;',
      'cursor:pointer;margin-top:5px}',
      '.rl-auth-btn:disabled{opacity:.55;cursor:wait}',
      '.rl-auth-msg{display:none;margin-top:12px;padding:9px 11px;',
      'border-radius:8px;font-size:12px;line-height:1.5}',
      '.rl-auth-msg.err{display:block;background:#fdf0f0;color:#b54b4b}',
      '.rl-auth-msg.ok{display:block;background:#edfaf3;color:#39745a}',
      '.rl-auth-foot{font-size:10px;color:#9ab0c0;text-align:center;',
      'margin-top:18px;line-height:1.5}',
      '.rl-user-chip{font-size:11px;color:#5d7080;max-width:190px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    ].join('');
    document.head.appendChild(style);

    var screen = document.createElement('div');
    screen.id = 'rl-auth-screen';
    screen.innerHTML =
      '<div class="rl-auth-card">' +
        '<div class="rl-auth-title">Respect des Lieux</div>' +
        '<div class="rl-auth-sub">Lycée Antoine Watteau — Accès sécurisé</div>' +
        '<div class="rl-auth-secure">🔒 Les signalements, identités et photos ne sont accessibles qu’après authentification Supabase.</div>' +
        '<form id="rl-auth-form">' +
          '<div class="rl-auth-field">' +
            '<label for="rl-auth-email">Adresse e-mail</label>' +
            '<input id="rl-auth-email" type="email" autocomplete="username" required>' +
          '</div>' +
          '<div class="rl-auth-field">' +
            '<label for="rl-auth-password">Mot de passe</label>' +
            '<input id="rl-auth-password" type="password" autocomplete="current-password" required>' +
          '</div>' +
          '<button id="rl-auth-submit" class="rl-auth-btn" type="submit">Se connecter</button>' +
          '<div id="rl-auth-msg" class="rl-auth-msg"></div>' +
        '</form>' +
        '<div class="rl-auth-foot">Aucune création de compte depuis cette page. Les comptes sont gérés par l’établissement dans Supabase.</div>' +
      '</div>';

    document.body.appendChild(screen);

    screen.querySelector('#rl-auth-form').addEventListener('submit', async function (e) {
      e.preventDefault();

      var email = screen.querySelector('#rl-auth-email').value.trim();
      var password = screen.querySelector('#rl-auth-password').value;
      var btn = screen.querySelector('#rl-auth-submit');
      var msg = screen.querySelector('#rl-auth-msg');

      btn.disabled = true;
      btn.textContent = 'Connexion…';
      msg.className = 'rl-auth-msg';
      msg.textContent = '';

      try {
        await AUTH.login(email, password);
        msg.className = 'rl-auth-msg ok';
        msg.textContent = 'Connexion réussie.';
        hideAuthScreen();
        await launchAuthenticatedApp();
      } catch (err) {
        msg.className = 'rl-auth-msg err';
        msg.textContent = err.message || 'Connexion impossible.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Se connecter';
      }
    });

    return screen;
  }

  function showAuthScreen(message) {
    var screen = ensureAuthUi();

    if (document.getElementById('main-app')) {
      document.getElementById('main-app').style.display = 'none';
    }

    if (document.getElementById('loading-overlay')) {
      document.getElementById('loading-overlay').classList.add('hidden');
    }

    screen.classList.add('open');

    var msg = screen.querySelector('#rl-auth-msg');
    if (message) {
      msg.className = 'rl-auth-msg err';
      msg.textContent = message;
    } else {
      msg.className = 'rl-auth-msg';
      msg.textContent = '';
    }

    setTimeout(function () {
      var email = screen.querySelector('#rl-auth-email');
      if (email) email.focus();
    }, 50);
  }

  function hideAuthScreen() {
    var screen = ensureAuthUi();
    screen.classList.remove('open');
  }

  window.rlLogout = function () {
    AUTH.logout();
  };

  function installLogoutUi() {
    var actions = document.querySelector('.topbar-actions');
    if (!actions) return;
    if (document.getElementById('rl-logout-btn')) return;

    var user = AUTH.session && AUTH.session.user;
    var email = user && user.email ? user.email : '';

    var chip = document.createElement('span');
    chip.className = 'rl-user-chip';
    chip.id = 'rl-user-chip';
    chip.title = email;
    chip.textContent = email;

    var btn = document.createElement('button');
    btn.id = 'rl-logout-btn';
    btn.className = 'btn btn-ghost btn-sm';
    btn.type = 'button';
    btn.textContent = 'Déconnexion';
    btn.onclick = function () { AUTH.logout(); };

    actions.appendChild(chip);
    actions.appendChild(btn);
  }

  window.probeSupa = async function () {
    if (window.location.protocol === 'file:') return 'file-local';
    if (!AUTH.accessToken) return 'auth-required';

    try {
      var r = await secureFetch(
        SUPA.url + '/rest/v1/signalements?select=id&limit=1',
        { headers: SUPA.hdr() }
      );

      if (r.ok) {
        await fetchFromSupabase();
        return 'ok';
      }

      var body = await r.text();
      console.warn('Supabase sécurisé HTTP', r.status, body.slice(0, 300));

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
    } catch (e) {
      console.warn('Supabase sécurisé fetch error:', e);
      return 'offline';
    }
  };

  async function launchAuthenticatedApp() {
    installSecureSupabaseClient();

    if (typeof setLoading === 'function') {
      setLoading('Connexion sécurisée à Supabase…');
    }

    loadLocalCache();

    if (typeof updateAppConfig === 'function') updateAppConfig();

    var main = document.getElementById('main-app');
    if (main) main.style.display = 'flex';

    if (typeof refreshAll === 'function') refreshAll();

    var status = await probeSupa();

    if (typeof setLoading === 'function') setLoading(false);

    if (status === 'ok') {
      if (typeof setOnline === 'function') setOnline(true);
      if (typeof flushQueue === 'function') flushQueue();
      if (typeof subscribeRealtime === 'function') subscribeRealtime();
      installLogoutUi();

      var banner = document.getElementById('supa-error-banner');
      if (banner) banner.remove();

      if (typeof toast === 'function') {
        toast('✓ Connexion sécurisée — RLS actif.');
      }
      return;
    }

    if (typeof setOnline === 'function') setOnline(false);

    if (status === 'session-expired' || status === 'auth-required') {
      AUTH.clear();
      showAuthScreen('Session expirée. Reconnectez-vous.');
      return;
    }

    if (status === 'rls-blocked') {
      if (typeof showSupaError === 'function') {
        showSupaError(
          'Accès refusé par Supabase. Exécutez supabase_secure_v4.sql et vérifiez les policies. ' +
          'Ne désactivez pas RLS.'
        );
      }
      return;
    }

    if (status === 'no-tables') {
      if (typeof showSupaError === 'function') {
        showSupaError(
          'Tables introuvables. Exécutez supabase_secure_v4.sql dans Supabase SQL Editor, puis rechargez.'
        );
      }
      return;
    }

    if (status === 'file-local') {
      if (typeof showSupaError === 'function') {
        showSupaError(
          'Ouvrez l’application via GitHub Pages ou un serveur HTTP(S), pas avec file://.'
        );
      }
      return;
    }

    if (typeof showSupaError === 'function') {
      showSupaError(
        'Connexion Supabase indisponible. Les données sensibles ne sont pas enregistrées localement.'
      );
    }
  }

  window.startApp = async function () {
    clearSensitiveLocalData();
    installSecureSupabaseClient();

    if (!SUPA.url || !SUPA.key) return;

    var valid = await AUTH.ensureValid();
    if (!valid) {
      showAuthScreen();
      return;
    }

    hideAuthScreen();
    await launchAuthenticatedApp();
  };

  async function secureBoot() {
    installSecureSupabaseClient();
    clearSensitiveLocalData();

    if (typeof window.STATE !== 'undefined') {
      STATE.signalements = [];
      STATE.reparations = [];
      STATE.queue = [];
    }

    // Si l'ancienne app avait démarré avant le chargement du patch,
    // on masque immédiatement les données et on repart proprement.
    var main = document.getElementById('main-app');
    if (main) main.style.display = 'none';

    if (!SUPA.url || !SUPA.key) {
      // La configuration initiale reste affichée.
      return;
    }

    // V4.1 : une invitation Supabase arrive avec une session temporaire
    // dans le fragment #... de l'URL. Elle doit être consommée AVANT
    // l'affichage du formulaire de connexion.
    var callbackHandled = await consumeAuthCallback();
    if (callbackHandled) return;

    var valid = await AUTH.ensureValid();

    if (!valid) {
      showAuthScreen();
      return;
    }

    hideAuthScreen();
    await launchAuthenticatedApp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', secureBoot, { once: true });
  } else {
    secureBoot();
  }
})();
