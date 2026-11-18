/* MeMude Connect · Popup: login (pelo Connect ou e-mail/senha), números do dia e atalhos. */
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

  function tela(qual) {
    $('verificando').hidden = qual !== 'verificando';
    $('sem-login').hidden = qual !== 'sem-login';
    $('com-login').hidden = qual !== 'com-login';
  }

  async function mostrar() {
    // SESSAO já tenta entrar sozinho se o Connect estiver aberto e logado.
    const sessao = await enviar('SESSAO').catch(() => null);
    if (!sessao) { tela('sem-login'); return; }
    tela('com-login');
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

  $('btn-entrar-connect').addEventListener('click', async () => {
    const btn = $('btn-entrar-connect');
    btn.disabled = true; btn.textContent = 'Entrando…'; $('aviso-connect').hidden = true;
    try {
      const r = await enviar('ENTRAR_CONNECT');
      if (r.entrou) { await mostrar(); return; }
      $('aviso-connect').textContent = 'Abri o Connect em outra aba. Faça o login lá: a extensão entra sozinha.';
      $('aviso-connect').hidden = false;
    } catch (er) {
      $('aviso-connect').textContent = er.message; $('aviso-connect').hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar com o Connect';
    }
  });

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

  if (window.Logger) {
    $('diag').checked = window.Logger.isDebug();
    $('diag').addEventListener('change', (e) => window.Logger.setDebug(e.target.checked));
  }

  tela('verificando');
  mostrar();
})();
