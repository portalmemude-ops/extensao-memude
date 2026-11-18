/* ============================================================
   MeMude Connect · Service worker
   Login, chamadas ao sistema (leads-api), cache das opções e fila de
   segurança: cadastro que falha por falta de conexão fica guardado e é
   reenviado sozinho a cada minuto. Nenhum lead se perde.
   ============================================================ */

importScripts(
  '/utils/config.js',
  '/utils/logger.js',
  '/utils/phone-utils.js',
  '/utils/history.js',
  '/utils/auth.js',
  '/utils/api.js'
);

const FILA = 'memude_fila_envio';
const CACHE_OPCOES = 'memude_opcoes';
const OPCOES_VALIDADE_MS = 30 * 60 * 1000;
const ALARME_FILA = 'memude-fila';

const local = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, (d) => r(d[k]))),
  set: (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: v }, r)),
};

// ============================================================
// Mensagens do painel (WhatsApp) e do popup
// ============================================================
const ROTAS = {
  ENTRAR: (d) => MemudeAuth.entrar(d.email, d.senha).then(async (r) => { await aposEntrar(); return r; }),
  ENTRAR_CONNECT: () => entrarPeloConnect(true),
  TOKEN_CONNECT: (d) => tokenDoConnect(d.access_token),
  SAIR: () => MemudeAuth.sair().then(async () => { await local.set(CACHE_OPCOES, null); await local.set(SAIU, true); }),
  SESSAO: () => sessaoOuConnect(),
  OPCOES: (d) => opcoes(d && d.forcar),
  RESUMO: () => MemudeApi.resumo(),
  BUSCAR: (d) => MemudeApi.buscar(d.telefone),
  CRIAR_LEAD: (d) => criarLead(d),
  ATUALIZAR_LEAD: (d) => MemudeApi.atualizarLead(d),
  CORRETORES: (d) => MemudeApi.corretores(d.empreendimento_id, d.data, d.hora),
  AGENDAR_VISITA: (d) => MemudeApi.agendarVisita(d),
  LEMBRETE: (d) => MemudeApi.lembrete(d),
  FILA: () => local.get(FILA).then((f) => f || []),
  ENVIAR_FILA: () => enviarFila(),
  HISTORICO: (d) => History.list((d && d.limite) || 30),
};

chrome.runtime.onMessage.addListener((pedido, _remetente, responder) => {
  const rota = ROTAS[pedido && pedido.acao];
  if (!rota) return false;
  Promise.resolve()
    .then(() => rota(pedido.dados || {}))
    .then((dados) => responder({ ok: true, dados }))
    .catch((e) => responder({ ok: false, erro: e.message, code: e.code || null, status: e.status || null }));
  return true;
});

// ============================================================
// Login pelo Connect aberto no navegador (sem digitar senha)
// ============================================================
const SAIU = 'memude_saiu'; // depois de "Sair", só volta a entrar quando a pessoa pedir
const CHAVE_SITE = 'sb-oxybasvtphosdmlmrfnb-auth-token';
const PADROES_CONNECT = [`${MEMUDE_CONFIG.APP_URL}/*`, 'https://memude-connect.vercel.app/*'];

async function aposEntrar() {
  await local.set(CACHE_OPCOES, null);
  await local.set(SAIU, false);
  avisarAbasWhatsApp();
}

let entrando = null;
async function tokenDoConnect(token, pedidoPeloUsuario) {
  if (!token) return null;
  if (!pedidoPeloUsuario && (await local.get(SAIU))) return null;
  const atual = await MemudeAuth.sessao();
  if (atual && atual.user_id === MemudeAuth.usuarioDoToken(token)) return atual;
  if (!entrando) {
    entrando = MemudeAuth.entrarComConnect(token)
      .then(async (r) => { await aposEntrar(); return r; })
      .finally(() => { entrando = null; });
  }
  return entrando;
}

/** Lê o login das abas do Connect já abertas (o site guarda a sessão no localStorage). */
async function tokenDasAbasDoConnect() {
  const abas = await chrome.tabs.query({ url: PADROES_CONNECT }).catch(() => []);
  for (const aba of abas) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: aba.id },
        args: [CHAVE_SITE],
        func: (chave) => {
          try {
            const s = JSON.parse(localStorage.getItem(chave) || 'null');
            const sessao = s && (s.currentSession || s);
            if (!sessao || !sessao.access_token) return null;
            if (sessao.expires_at && sessao.expires_at * 1000 < Date.now() + 60000) return null;
            return sessao.access_token;
          } catch (e) { return null; }
        },
      });
      if (r && r.result) return r.result;
    } catch (e) { /* aba carregando ou sem acesso */ }
  }
  return null;
}

async function entrarPeloConnect(pedidoPeloUsuario) {
  const token = await tokenDasAbasDoConnect();
  if (token) {
    const s = await tokenDoConnect(token, pedidoPeloUsuario);
    return { ...(s || {}), entrou: !!s };
  }
  if (pedidoPeloUsuario) {
    // Sem o Connect aberto: abre o site; ao terminar o login lá, a extensão entra sozinha.
    await local.set(SAIU, false);
    await chrome.tabs.create({ url: `${MEMUDE_CONFIG.APP_URL}/` });
    return { entrou: false, abriu_connect: true };
  }
  return { entrou: false };
}

async function sessaoOuConnect() {
  const s = await MemudeAuth.sessao();
  if (s) return s;
  try {
    const r = await entrarPeloConnect(false);
    if (r.entrou) return MemudeAuth.sessao();
  } catch (e) {
    Logger.warn('login pelo Connect falhou', e && e.message);
  }
  return null;
}

/** Avisa o painel do WhatsApp que o login mudou (ele se atualiza sem F5). */
async function avisarAbasWhatsApp() {
  const abas = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }).catch(() => []);
  for (const aba of abas) chrome.tabs.sendMessage(aba.id, { acao: 'SESSAO_MUDOU' }).catch(() => undefined);
}

async function opcoes(forcar) {
  const cache = await local.get(CACHE_OPCOES);
  if (!forcar && cache && Date.now() - cache.em < OPCOES_VALIDADE_MS) return cache.dados;
  const dados = await MemudeApi.opcoes();
  await local.set(CACHE_OPCOES, { em: Date.now(), dados });
  return dados;
}

// ============================================================
// Cadastro com fila de segurança
// ============================================================
async function criarLead(dados) {
  try {
    const r = await MemudeApi.criarLead(dados);
    await History.add({ name: dados.nome, phone: dados.telefone, source: dados.fonte, exported: true, lead_id: r.lead && r.lead.id, duplicado: !!r.duplicado });
    return r;
  } catch (e) {
    if (e.code === 'OFFLINE' || e.code === 'SERVIDOR') {
      const fila = (await local.get(FILA)) || [];
      const chave = PhoneUtils.phoneKey(dados.telefone);
      if (!fila.some((f) => PhoneUtils.phoneKey(f.dados.telefone) === chave)) {
        fila.push({ dados, tentativas: 0, criado: Date.now(), erro: e.message });
        await local.set(FILA, fila);
      }
      atualizarSelo();
      return { na_fila: true, aviso: 'Sem conexão: o lead ficou guardado e será enviado sozinho.' };
    }
    throw e;
  }
}

let enviandoFila = false;
async function enviarFila() {
  if (enviandoFila) return { enviados: 0, restantes: ((await local.get(FILA)) || []).length };
  enviandoFila = true;
  try {
    const fila = (await local.get(FILA)) || [];
    const restantes = [];
    let enviados = 0;
    for (const item of fila) {
      try {
        const r = await MemudeApi.criarLead(item.dados);
        await History.add({ name: item.dados.nome, phone: item.dados.telefone, source: item.dados.fonte, exported: true, lead_id: r.lead && r.lead.id, duplicado: !!r.duplicado });
        enviados += 1;
      } catch (e) {
        if (e.code === 'NEEDS_LOGIN') { restantes.push(item); continue; }
        // Recusa definitiva (dados inválidos) sai da fila depois de 5 tentativas para não travar o resto.
        item.tentativas += 1;
        item.erro = e.message;
        if (e.code === 'RECUSADO' && item.tentativas >= 5) {
          await History.add({ name: item.dados.nome, phone: item.dados.telefone, exported: false, error: e.message });
          continue;
        }
        restantes.push(item);
      }
    }
    await local.set(FILA, restantes);
    atualizarSelo();
    return { enviados, restantes: restantes.length };
  } finally {
    enviandoFila = false;
  }
}

async function atualizarSelo() {
  const n = ((await local.get(FILA)) || []).length;
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e92662' });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARME_FILA) enviarFila().catch(() => undefined); });

function agendarFila() {
  chrome.alarms.create(ALARME_FILA, { periodInMinutes: 1 });
  atualizarSelo();
}
const SCRIPTS_WHATSAPP = ['utils/config.js', 'utils/logger.js', 'utils/phone-utils.js', 'utils/fontes.js', 'utils/phone-extractor.js', 'content/overlay.js', 'content/content.js'];

/**
 * Ao instalar/atualizar, coloca o painel novo nas abas já abertas (sem precisar
 * de F5). O painel novo remove o botão da versão anterior que ficou na página.
 */
async function prepararAbasAbertas() {
  const whats = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }).catch(() => []);
  for (const aba of whats) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: aba.id }, files: ['content/overlay.css'] });
      await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: SCRIPTS_WHATSAPP });
    } catch (e) { /* aba carregando */ }
  }
  const connect = await chrome.tabs.query({ url: PADROES_CONNECT }).catch(() => []);
  for (const aba of connect) {
    chrome.scripting.executeScript({ target: { tabId: aba.id }, files: ['content/connect-sso.js'] }).catch(() => undefined);
  }
}

chrome.runtime.onInstalled.addListener(() => { agendarFila(); prepararAbasAbertas(); });
chrome.runtime.onStartup.addListener(agendarFila);

// ============================================================
// Atalhos de teclado
// ============================================================
async function abaDoWhatsApp() {
  const abas = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  return abas.find((t) => t.active) || abas[0] || null;
}

chrome.commands.onCommand.addListener(async (comando) => {
  try {
    const aba = await abaDoWhatsApp();
    if (!aba) { chrome.tabs.create({ url: 'https://web.whatsapp.com/' }); return; }
    try {
      await chrome.tabs.update(aba.id, { active: true });
      if (aba.windowId != null) await chrome.windows.update(aba.windowId, { focused: true });
    } catch (e) { /* aba fechando */ }
    const acao = comando === 'open-overlay' ? 'PAINEL_ABRIR' : 'CADASTRO_RAPIDO';
    try {
      await chrome.tabs.sendMessage(aba.id, { acao });
    } catch (e) {
      await chrome.scripting.insertCSS({ target: { tabId: aba.id }, files: ['content/overlay.css'] }).catch(() => undefined);
      await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: SCRIPTS_WHATSAPP });
      await new Promise((r) => setTimeout(r, 1500));
      await chrome.tabs.sendMessage(aba.id, { acao });
    }
  } catch (err) {
    Logger.error('atalho falhou', comando, err);
  }
});
