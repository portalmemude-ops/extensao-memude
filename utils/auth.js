/* ============================================================
   MeMude Connect · Login
   Entra com o mesmo e-mail e senha do MeMude Connect (Supabase Auth).
   A sessão (tokens) fica só neste navegador, em chrome.storage.local;
   a senha nunca é guardada.
   ============================================================ */
(function (root) {
  'use strict';

  const CHAVE = 'memude_sessao';
  const MARGEM_MS = 60_000; // renova o token um minuto antes de vencer

  const cfg = () => root.MEMUDE_CONFIG;
  const ler = () => new Promise((r) => chrome.storage.local.get(CHAVE, (d) => r(d[CHAVE] || null)));
  const gravar = (s) => new Promise((r) => chrome.storage.local.set({ [CHAVE]: s }, r));
  const limpar = () => new Promise((r) => chrome.storage.local.remove(CHAVE, r));

  function sessaoDe(resposta) {
    return {
      access_token: resposta.access_token,
      refresh_token: resposta.refresh_token,
      expira_em: Date.now() + (Number(resposta.expires_in) || 3600) * 1000,
      email: resposta.user && resposta.user.email,
      user_id: resposta.user && resposta.user.id,
    };
  }

  async function chamarAuth(caminho, corpo, token) {
    const headers = { apikey: cfg().ANON_KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${cfg().SUPABASE_URL}/auth/v1/${caminho}`, { method: 'POST', headers, body: JSON.stringify(corpo || {}) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  /** Login com e-mail e senha do Connect. */
  async function entrar(email, senha) {
    const { ok, j } = await chamarAuth('token?grant_type=password', { email: String(email || '').trim(), password: senha });
    if (!ok) {
      const msg = /invalid/i.test(j.error_description || j.msg || '') ? 'E-mail ou senha incorretos' : (j.error_description || j.msg || 'Não foi possível entrar');
      throw new Error(msg);
    }
    const s = sessaoDe(j);
    await gravar(s);
    return { email: s.email };
  }

  /** Id do usuário dentro de um access_token (sem validar: a validação é do servidor). */
  function usuarioDoToken(jwt) {
    try {
      const parte = String(jwt || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(parte + '==='.slice((parte.length + 3) % 4))).sub || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Login sem senha a partir do Connect já aberto no navegador: o token do site
   * pede ao servidor uma sessão própria da extensão (o site continua logado).
   */
  async function entrarComConnect(tokenDoSite) {
    const r = await fetch(`${cfg().API_URL}?recurso=sessao`, {
      method: 'POST',
      headers: { apikey: cfg().ANON_KEY, Authorization: `Bearer ${tokenDoSite}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token_hash) throw new Error(j.erro || 'Não foi possível entrar com o Connect');
    const v = await chamarAuth('verify', { type: 'magiclink', token_hash: j.token_hash });
    if (!v.ok || !v.j.access_token) throw new Error('Não foi possível entrar com o Connect');
    const s = sessaoDe(v.j);
    await gravar(s);
    return { email: s.email, user_id: s.user_id };
  }

  let renovando = null;
  async function renovar(s) {
    if (!renovando) {
      renovando = (async () => {
        const { ok, j } = await chamarAuth('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
        if (!ok) { await limpar(); return null; }
        const nova = sessaoDe(j);
        await gravar(nova);
        return nova;
      })().finally(() => { renovando = null; });
    }
    return renovando;
  }

  /** Token válido (renova sozinho). Lança NEEDS_LOGIN quando não há sessão. */
  async function token(forcarRenovacao = false) {
    let s = await ler();
    if (!s) throw Object.assign(new Error('Entre com sua conta do MeMude Connect'), { code: 'NEEDS_LOGIN' });
    if (forcarRenovacao || s.expira_em - Date.now() < MARGEM_MS) s = await renovar(s);
    if (!s) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { code: 'NEEDS_LOGIN' });
    return s.access_token;
  }

  async function sair() {
    const s = await ler();
    if (s) await chamarAuth('logout', {}, s.access_token).catch(() => undefined);
    await limpar();
  }

  async function sessao() {
    const s = await ler();
    return s ? { email: s.email, user_id: s.user_id } : null;
  }

  root.MemudeAuth = { entrar, entrarComConnect, usuarioDoToken, token, sair, sessao, CHAVE };
})(globalThis);
