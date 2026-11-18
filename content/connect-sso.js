/* ============================================================
   MeMude Connect · Login pelo site
   Roda só nas páginas do próprio Connect. Se você está logado no
   site, avisa a extensão para ela entrar com a mesma conta, sem
   pedir e-mail e senha de novo. Não altera nada no site.
   ============================================================ */
(function () {
  'use strict';

  if (window.__MEMUDE_SSO) return;
  window.__MEMUDE_SSO = true;

  const CHAVE = 'sb-oxybasvtphosdmlmrfnb-auth-token';
  let ultimo = null;

  function tokenDoSite() {
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      const sessao = s && (s.currentSession || s);
      if (!sessao || !sessao.access_token) return null;
      if (sessao.expires_at && sessao.expires_at * 1000 < Date.now() + 60_000) return null;
      return sessao.access_token;
    } catch (e) {
      return null;
    }
  }

  function avisar() {
    const token = tokenDoSite();
    if (!token || token === ultimo) return;
    ultimo = token;
    try {
      chrome.runtime.sendMessage({ acao: 'TOKEN_CONNECT', dados: { access_token: token } }, () => void chrome.runtime.lastError);
    } catch (e) { /* extensão recarregada: a próxima página resolve */ }
  }

  avisar();
  // Cobre o login feito nesta mesma aba e a renovação do token pelo site.
  setInterval(avisar, 10_000);
})();
