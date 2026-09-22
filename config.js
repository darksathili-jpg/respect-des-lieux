/*
 * Respect des Lieux — configuration publique V4.3
 * Ce fichier ne contient AUCUN secret.
 * La clé sb_publishable_* est conçue pour être exposée côté navigateur.
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

  // Compatibilité avec l'assistant de configuration historique.
  // Seules l'URL publique et la clé publishable sont persistées.
  try {
    var saved = JSON.parse(localStorage.getItem('rl3-cfg') || '{}');
    saved.supaUrl = BACKEND.url;
    saved.supaKey = BACKEND.key;
    saved.config = saved.config || {};
    localStorage.setItem('rl3-cfg', JSON.stringify(saved));
  } catch (e) {}
})();
