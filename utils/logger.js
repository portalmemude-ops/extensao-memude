/* ============================================================
   MeMude - Logger
   Logs com níveis. Silencioso em produção, exceto erros.
   Habilite logs detalhados no Console com:
       localStorage.setItem('memude_debug','1')
   ou via popup → Diagnóstico → "Logs detalhados".
   ============================================================ */

(function (root) {
  'use strict';

  const PREFIX = '[MeMude]';
  const STORAGE_KEY = 'memude_debug';
  let debugFlag = null; // lazy

  function isDebug() {
    if (debugFlag !== null) return debugFlag;
    // 1) localStorage (popup/content scripts)
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') {
        return (debugFlag = true);
      }
    } catch (e) {}
    // 2) chrome.storage.local — async, mas dispara a leitura para
    //    próximas chamadas (funciona no service worker)
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(STORAGE_KEY, (data) => {
          debugFlag = data && data[STORAGE_KEY] === true;
        });
      }
    } catch (e) {}
    return (debugFlag = false);
  }

  // Permite ligar/desligar em runtime (popup ou overlay)
  function setDebug(flag) {
    debugFlag = !!flag;
    try {
      if (typeof localStorage !== 'undefined') {
        if (flag) localStorage.setItem(STORAGE_KEY, '1');
        else localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {}
    // Espalha para o service worker via storage.local
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        if (flag) chrome.storage.local.set({ [STORAGE_KEY]: true });
        else chrome.storage.local.remove(STORAGE_KEY);
      }
    } catch (e) {}
  }

  // Service worker: escuta mudanças no flag para sincronizar imediatamente
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY]) {
          debugFlag = changes[STORAGE_KEY].newValue === true;
        }
      });
    }
  } catch (e) {}

  const Logger = {
    debug(...args) { if (isDebug()) console.log(PREFIX, ...args); },
    info(...args)  { if (isDebug()) console.info(PREFIX, ...args); },
    warn(...args)  { console.warn(PREFIX, ...args); },
    error(...args) { console.error(PREFIX, ...args); },
    setDebug,
    isDebug
  };

  if (typeof globalThis !== 'undefined') globalThis.Logger = Logger;
  if (typeof window !== 'undefined' && !window.Logger) window.Logger = Logger;
})(typeof self !== 'undefined' ? self : this);
