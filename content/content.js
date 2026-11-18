/* ============================================================
   MeMude Connect · Script de conteúdo
   Liga o leitor de telefones do WhatsApp e atende os atalhos de
   teclado (abrir painel, cadastro rápido) vindos do service worker.
   ============================================================ */
(function () {
  'use strict';

  if (window.__MEMUDE_CONTENT_LOADED) return;
  window.__MEMUDE_CONTENT_LOADED = true;

  if (window.__MEMUDE_EXTRACTOR) window.__MEMUDE_EXTRACTOR.startNetworkInterceptor();

  chrome.runtime.onMessage.addListener((pedido, _remetente, responder) => {
    const painel = window.__MEMUDE_PAINEL;
    if (pedido.acao === 'PING') { responder({ ok: true, painel: !!painel }); return true; }
    if (!painel) { responder({ ok: false }); return true; }
    if (pedido.acao === 'PAINEL_ABRIR') { painel.abrir(); responder({ ok: true }); return true; }
    if (pedido.acao === 'CADASTRO_RAPIDO') { painel.cadastroRapido(); responder({ ok: true }); return true; }
    return false;
  });
})();
