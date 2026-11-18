/* ============================================================
   MeMude Connect · Script de conteúdo
   Liga o leitor de telefones do WhatsApp e atende os atalhos de
   teclado (abrir painel, cadastro rápido) vindos do service worker.
   ============================================================ */
(function () {
  'use strict';

  // Uma versão anterior da extensão (atualizada sem F5) perde a conexão; esta assume.
  const vivo = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  if (window.__MMC_CONTENT && window.__MMC_CONTENT.vivo()) return;
  window.__MMC_CONTENT = { vivo };

  if (window.__MEMUDE_EXTRACTOR) window.__MEMUDE_EXTRACTOR.startNetworkInterceptor();

  chrome.runtime.onMessage.addListener((pedido, _remetente, responder) => {
    const painel = window.__MEMUDE_PAINEL;
    if (pedido.acao === 'PING') { responder({ ok: true, painel: !!painel }); return true; }
    if (!painel) { responder({ ok: false }); return true; }
    if (pedido.acao === 'PAINEL_ABRIR') { painel.abrir(); responder({ ok: true }); return true; }
    if (pedido.acao === 'CADASTRO_RAPIDO') { painel.cadastroRapido(); responder({ ok: true }); return true; }
    if (pedido.acao === 'SESSAO_MUDOU') { painel.recarregarSessao(); responder({ ok: true }); return true; }
    return false;
  });
})();
