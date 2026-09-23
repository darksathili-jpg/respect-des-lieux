/*
 * Respect des Lieux — configuration publique V4.3
 * Ce fichier ne contient AUCUN secret.
 * La clé sb_publishable_* est conçue pour être exposée côté navigateur.
 *
 * V4.3 production lock :
 * - un seul backend de production ;
 * - aucun fichier config.json nécessaire ;
 * - l'ancien assistant Supabase est retiré de l'interface au chargement.
 */
(function () {
  'use strict';

  var BACKEND = {
    version: '4.3',
    projectRef: 'odrussbhwyvyudmybjxy',
    url: 'https://odrussbhwyvyudmybjxy.supabase.co',
    key: 'sb_publishable_vKsbN6d8Thyaa46ylDxGHA_LpiDEreR'
  };

  window.RL_BACKEND = BACKEND;

  if (window.SUPA) {
    SUPA.url = BACKEND.url;
    SUPA.key = BACKEND.key;
  }

  // Conserve uniquement la compatibilité avec les préférences non sensibles
  // déjà présentes dans l'ancien stockage local. Le backend est toujours
  // réécrit avec les valeurs de production ci-dessus.
  try {
    var saved = JSON.parse(localStorage.getItem('rl3-cfg') || '{}');
    saved.supaUrl = BACKEND.url;
    saved.supaKey = BACKEND.key;
    saved.config = saved.config || {};
    localStorage.setItem('rl3-cfg', JSON.stringify(saved));
  } catch (e) {}

  // Empêche tout flash de l'ancien assistant avant DOMContentLoaded.
  var lockStyle = document.createElement('style');
  lockStyle.id = 'rl-v43-production-lock';
  lockStyle.textContent = '#setup-screen{display:none!important}';
  document.head.appendChild(lockStyle);

  function productionOnlyMessage() {
    if (typeof window.toast === 'function') {
      window.toast(
        'Configuration Supabase verrouillée en V4.3 : aucun fichier config.json n’est nécessaire.',
        true
      );
    }
    return false;
  }

  // Neutralise les anciens points d'entrée de configuration manuelle.
  window.loadConfigFile = productionOnlyMessage;
  window.finishSetup = productionOnlyMessage;
  window.setupNext = productionOnlyMessage;
  window.setupPrev = productionOnlyMessage;
  window.copySetupSQL = productionOnlyMessage;
  window.reconfig = productionOnlyMessage;

  function removeLegacySetupUi() {
    var setup = document.getElementById('setup-screen');
    if (setup) setup.remove();

    document.querySelectorAll(
      '[onclick*="reconfig("], ' +
      '[onclick*="setupNext("], ' +
      '[onclick*="setupPrev("], ' +
      '[onclick*="finishSetup("], ' +
      '[onclick*="copySetupSQL("], ' +
      'input[type="file"][onchange*="loadConfigFile("]'
    ).forEach(function (el) {
      var removable = el.closest('label,button,.setup-actions,.setup-field') || el;
      if (removable && removable.parentNode) removable.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeLegacySetupUi, { once: true });
  } else {
    removeLegacySetupUi();
  }
})();
