/* MeMude Connect · Popup: login, números do dia e atalhos. */
(function () {
  'use strict';

  const APP_URL = 'https://core.memudecore.com.br';
  const $ = (id) => document.getElementById(id);

  function enviar(acao, dados) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ acao, dados }, (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!r || !r.ok) { const e = new Error((r && r.erro) || 'Falha inesperada'); e.code = r && r.code; return reject(e); }
        resolve(r.dados);
      });
    });
  }

  async function mostrar() {
    const sessao = await enviar('SESSAO').catch(() => null);
    $('sem-login').hidden = !!sessao;
    $('com-login').hidden = !sessao;
    if (!sessao) { $('email').focus(); return; }
    $('usuario').textContent = sessao.email;
    try {
      const [r, fila] = await Promise.all([enviar('RESUMO'), enviar('FILA')]);
      $('n-leads').textContent = r.leads_hoje;
      $('n-visitas').textContent = r.visitas_agendadas_hoje;
      $('n-tarefas').textContent = r.tarefas_pendentes;
      $('fila').hidden = !fila.length;
      $('n-fila').textContent = fila.length;
    } catch (e) {
      if (e.code === 'NEEDS_LOGIN') return mostrar();
    }
  }

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('btn-entrar');
    btn.disabled = true; btn.textContent = 'Entrando…'; $('erro-login').hidden = true;
    try {
      await enviar('ENTRAR', { email: $('email').value, senha: $('senha').value });
      $('senha').value = '';
      await mostrar();
    } catch (er) {
      $('erro-login').textContent = er.message; $('erro-login').hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });

  $('btn-sair').addEventListener('click', async () => { await enviar('SAIR'); mostrar(); });
  $('btn-fila').addEventListener('click', async () => { await enviar('ENVIAR_FILA').catch(() => undefined); mostrar(); });
  $('btn-connect').addEventListener('click', () => chrome.tabs.create({ url: `${APP_URL}/hoje` }));
  $('btn-whatsapp').addEventListener('click', async () => {
    const [aba] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (aba) { chrome.tabs.update(aba.id, { active: true }); chrome.windows.update(aba.windowId, { focused: true }); }
    else chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
    window.close();
  });

  if (window.Logger) {
    $('diag').checked = window.Logger.isDebug();
    $('diag').addEventListener('change', (e) => window.Logger.setDebug(e.target.checked));
  }

  mostrar();
})();
