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
  let debugFlag = null; // lazy

  function isDebug() {
    if (debugFlag !== null) return debugFlag;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('memude_debug') === '1') {
        return (debugFlag = true);
      }
    } catch (e) {}
    return (debugFlag = false);
  }

  // Permite ligar/desligar em runtime (popup ou overlay)
  function setDebug(flag) {
    debugFlag = !!flag;
    try {
      if (typeof localStorage !== 'undefined') {
        if (flag) localStorage.setItem('memude_debug', '1');
        else localStorage.removeItem('memude_debug');
      }
    } catch (e) {}
  }

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
