/* ============================================================
   MeMude - Content Script
   Injected into WhatsApp Web
   Handles communication with popup for active chat extraction
   ============================================================ */

(function () {
  'use strict';

  // Guard global — impede listener duplicado caso o script seja
  // reinjetado (chrome.scripting.executeScript) por cima da carga
  // automática do manifest.
  if (window.__MEMUDE_CONTENT_LOADED) return;
  window.__MEMUDE_CONTENT_LOADED = true;

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;

    if (typeof Logger !== 'undefined') Logger.debug('Content script loaded on WhatsApp Web');

    // Start network interceptor (from phone-extractor.js)
    if (window.__MEMUDE_EXTRACTOR) {
      window.__MEMUDE_EXTRACTOR.startNetworkInterceptor();
    }

    // Listen for messages from popup / background
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // ============================================================
  // Message Handler
  // ============================================================
  function handleMessage(request, sender, sendResponse) {
    if (request.action === 'EXTRACT_ACTIVE_CONTACT') {
      const extractor = window.__MEMUDE_EXTRACTOR;
      if (!extractor) {
        sendResponse({ error: 'EXTRACTOR_NOT_LOADED', contact: null });
        return true;
      }

      // extractActiveContact is now async (uses drawer opening)
      extractor.extractActiveContact()
        .then(result => sendResponse(result))
        .catch(err => {
          if (typeof Logger !== 'undefined') Logger.error('Extraction error:', err); else console.error('[MeMude] Extraction error:', err);
          sendResponse({ error: err.message, contact: null });
        });
      return true; // Keep channel open for async response
    }

    if (request.action === 'PING') {
      sendResponse({ status: 'ok', hasExtractor: !!window.__MEMUDE_EXTRACTOR });
      return true;
    }

    return false;
  }

  // ============================================================
  // Wait for WhatsApp Web to load
  // ============================================================
  function waitForWhatsApp() {
    const checkInterval = setInterval(() => {
      const app = document.querySelector('[data-testid="chat-list"]') ||
                  document.querySelector('#app') ||
                  document.querySelector('#main');
      if (app) {
        clearInterval(checkInterval);
        init();
      }
    }, 1000);

    // Fallback: init after 8 seconds regardless
    setTimeout(() => {
      clearInterval(checkInterval);
      init();
    }, 8000);
  }

  // Start
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    waitForWhatsApp();
  } else {
    document.addEventListener('DOMContentLoaded', waitForWhatsApp);
  }

})();
