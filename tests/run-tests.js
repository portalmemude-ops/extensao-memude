/* ============================================================
   MeMude - Suíte de testes (node, sem dependências)
   Roda:  node tests/run-tests.js
   Cobre: phone-utils, etiqueta (Fonte), mapa de fontes, login
          (renovação de sessão) e cliente da API (401 e sem conexão).

   ============================================================ */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; failures.push(`${msg}\n    esperado: ${e}\n    obtido:   ${a}`); }
}
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; failures.push(msg); }
}

// ------------------------------------------------------------
// Mocks globais (chrome, window, document, fetch)
// ------------------------------------------------------------
function makeChromeMock(initialSync = {}) {
  const sync = { ...initialSync };
  const local = {};
  const store = (bucket) => ({
    get(key, cb) {
      if (typeof key === 'string') cb({ [key]: bucket[key] });
      else if (Array.isArray(key)) { const o = {}; key.forEach(k => o[k] = bucket[k]); cb(o); }
      else cb({ ...bucket });
    },
    set(obj, cb) { Object.assign(bucket, obj); if (cb) cb(); },
    remove(key, cb) { [].concat(key).forEach((k) => delete bucket[k]); if (cb) cb(); }
  });
  return { storage: { sync: store(sync), local: store(local) }, _sync: sync, _local: local,
           runtime: { id: 'test', lastError: null } };
}

// Carrega um módulo IIFE que faz `globalThis.X = ...`, devolvendo X.
function loadGlobal(relPath, globalName) {
  delete require.cache[require.resolve(path.join(ROOT, relPath))];
  require(path.join(ROOT, relPath));
  return globalThis[globalName];
}

// ============================================================
// 1) phone-utils
// ============================================================
function testPhoneUtils() {
  globalThis.Logger = { isDebug: () => false, debug() {}, info() {}, warn() {}, error() {} };
  const P = loadGlobal('utils/phone-utils.js', 'PhoneUtils');

  // normalizePhone
  eq(P.normalizePhone('8588336228'), '+558588336228', 'normalize 10 dígitos → +55');
  eq(P.normalizePhone('85988336228'), '+5585988336228', 'normalize 11 dígitos → +55');
  eq(P.normalizePhone('+5585988336228'), '+5585988336228', 'normalize já com +');
  eq(P.normalizePhone(''), '', 'normalize vazio');

  // add9thDigit — o bug principal: JID BR vem sem o 9
  eq(P.add9thDigit('+558588336228'), '+5585988336228', '9 adicionado (com +)');
  eq(P.add9thDigit('558588336228'), '5585988336228', '9 adicionado (sem +)');
  eq(P.add9thDigit('+5585988336228'), '+5585988336228', '9 já presente → inalterado');
  // fixo não pode ganhar 9 (local começa em 2-5)
  eq(P.add9thDigit('+558533231234'), '+558533231234', 'fixo preservado (não ganha 9)');
  eq(P.add9thDigit('+558522221111'), '+558522221111', 'fixo DDD começando em 2 preservado');

  // formatPhoneBR
  eq(P.formatPhoneBR('+5585988336228'), '+55 (85) 98833-6228', 'formata celular');
  eq(P.formatPhoneBR('+558533231234'), '+55 (85) 3323-1234', 'formata fixo');
  eq(P.formatPhoneBR('+12025550123'), '+12025550123', 'não-BR mantém original');

  // phoneKey — dedup tolerante ao 9 e à formatação
  eq(P.phoneKey('+55 (85) 98833-6228'), P.phoneKey('+558588336228'),
     'phoneKey: com 9 formatado == sem 9 cru (mesmo lead)');
  ok(P.phoneKey('+5585988336228') !== P.phoneKey('+5585977776666'),
     'phoneKey: números diferentes → chaves diferentes');
}

// 2) phone-extractor — leitura da etiqueta (Fonte)
// ============================================================
function makeDomMock(headerText, selRowText, labelEls = []) {
  const mk = (t) => (t == null ? null : { textContent: t });
  return {
    querySelector(sel) {
      if (sel.includes('header')) return mk(headerText);
      if (sel.includes('pane-side')) return mk(selRowText);
      return null;
    },
    querySelectorAll(sel) {
      if (/etiqueta|label/i.test(sel)) return labelEls.map(mk);
      return [];
    }
  };
}

function testExtractorLabel() {
  globalThis.Logger = { isDebug: () => false, debug() {}, info() {}, warn() {}, error() {} };
  loadGlobal('utils/phone-utils.js', 'PhoneUtils');
  global.window = {};
  global.document = makeDomMock('Maria Silva\nonline', 'Maria Silva  Facebook  10:32');
  delete require.cache[require.resolve(path.join(ROOT, 'utils/phone-extractor.js'))];
  require(path.join(ROOT, 'utils/phone-extractor.js'));
  const EX = global.window.__MEMUDE_EXTRACTOR;

  // Etiqueta na linha selecionada
  eq(EX.extractLabel(), 'Facebook', 'detecta Facebook na linha selecionada');

  // Etiqueta no header
  global.document = makeDomMock('João\nGoogle', null);
  eq(EX.extractLabel(['Google', 'Facebook']), 'Google', 'detecta Google no header');

  // Em elemento marcado como etiqueta
  global.document = makeDomMock('Cliente', null, ['Indicação']);
  eq(EX.extractLabel(), 'Indicação', 'detecta em elemento [aria-label=etiqueta]');

  // Sem etiqueta → vazio (e "WhatsApp" no header NÃO casa por engano)
  global.document = makeDomMock('Fulano de Tal\nWhatsApp\nonline', null);
  eq(EX.extractLabel(), '', 'sem etiqueta conhecida → vazio');

  // Match é por palavra inteira (não casa substring)
  global.document = makeDomMock('Facebookiano', null);
  eq(EX.extractLabel(), '', 'não casa substring parcial (\\b)');
}

// ============================================================

// ============================================================
// 3) fontes — etiqueta do WhatsApp → Fonte do sistema
// ============================================================
function testFontes() {
  const F = loadGlobal('utils/fontes.js', 'MemudeFontes');
  eq(F.fonteDaEtiqueta('Google'), 'Google', 'Google → Google');
  eq(F.fonteDaEtiqueta('Facebook'), 'Meta', 'Facebook → Meta');
  eq(F.fonteDaEtiqueta('Instagram'), 'Meta', 'Instagram → Meta');
  eq(F.fonteDaEtiqueta('Tráfego'), 'Meta', 'Tráfego (com acento) → Meta');
  eq(F.fonteDaEtiqueta('Site'), 'Cadastro', 'Site → Cadastro');
  eq(F.fonteDaEtiqueta('Indicação'), 'Outros', 'Indicação → Outros');
  eq(F.fonteDaEtiqueta(''), '', 'sem etiqueta → vazio (SDR escolhe)');
  eq(F.fonteDaEtiqueta('Cliente VIP'), '', 'etiqueta desconhecida → vazio');
  eq(F.FONTES, ['Google', 'Meta', 'Cadastro', 'Follow', 'Outros'], 'mesmas fontes do sistema');
}

// ============================================================
// 4) login — sessão, renovação e expiração
// ============================================================
function respostaFetch(status, corpo) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

async function testAuth() {
  globalThis.chrome = makeChromeMock();
  loadGlobal('utils/config.js', 'MEMUDE_CONFIG');
  const chamadas = [];
  globalThis.fetch = (url, opts) => {
    chamadas.push({ url, corpo: JSON.parse(opts.body || '{}') });
    if (url.includes('grant_type=password')) {
      return opts && JSON.parse(opts.body).password === 'certa'
        ? respostaFetch(200, { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, user: { email: 'sdr@memude.com.br', id: 'u1' } })
        : respostaFetch(400, { error_description: 'Invalid login credentials' });
    }
    if (url.includes('grant_type=refresh_token')) {
      return JSON.parse(opts.body).refresh_token === 'R1'
        ? respostaFetch(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600, user: { email: 'sdr@memude.com.br', id: 'u1' } })
        : respostaFetch(400, {});
    }
    return respostaFetch(204, {});
  };
  const A = loadGlobal('utils/auth.js', 'MemudeAuth');

  let erro = null;
  try { await A.entrar('sdr@memude.com.br', 'errada'); } catch (e) { erro = e.message; }
  eq(erro, 'E-mail ou senha incorretos', 'senha errada → mensagem clara');

  await A.entrar('sdr@memude.com.br', 'certa');
  eq(await A.sessao(), { email: 'sdr@memude.com.br', user_id: 'u1' }, 'sessão guardada sem a senha');
  eq(await A.token(), 'A1', 'token válido é reaproveitado');
  ok(!JSON.stringify(globalThis.chrome._local).includes('certa'), 'senha nunca vai para o storage');

  // Token perto de vencer → renova sozinho
  globalThis.chrome._local[A.CHAVE].expira_em = Date.now() + 10_000;
  eq(await A.token(), 'A2', 'token vencendo é renovado');

  // Refresh recusado → sessão some e pede login
  globalThis.chrome._local[A.CHAVE].refresh_token = 'invalido';
  erro = null;
  try { await A.token(true); } catch (e) { erro = e.code; }
  eq(erro, 'NEEDS_LOGIN', 'refresh recusado → NEEDS_LOGIN');
  eq(await A.sessao(), null, 'sessão apagada depois de expirar');

  // Login pelo Connect aberto: token do site → sessão própria da extensão
  const payload = Buffer.from(JSON.stringify({ sub: 'u7' })).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const tokenSite = `cab.${payload}.ass`;
  eq(A.usuarioDoToken(tokenSite), 'u7', 'lê o usuário do token do site');
  eq(A.usuarioDoToken('lixo'), null, 'token inválido → null');
  const pedidos = [];
  globalThis.fetch = (url, opts) => {
    pedidos.push({ url, auth: opts.headers.Authorization, corpo: JSON.parse(opts.body || '{}') });
    if (url.includes('recurso=sessao')) {
      return opts.headers.Authorization === `Bearer ${tokenSite}` ? respostaFetch(200, { token_hash: 'H1', email: 'ramon@memude.com.br' }) : respostaFetch(401, { erro: 'Sessão inválida' });
    }
    if (url.endsWith('/auth/v1/verify')) {
      return JSON.parse(opts.body).token_hash === 'H1'
        ? respostaFetch(200, { access_token: 'E1', refresh_token: 'ER1', expires_in: 3600, user: { email: 'ramon@memude.com.br', id: 'u7' } })
        : respostaFetch(403, {});
    }
    return respostaFetch(404, {});
  };
  eq(await A.entrarComConnect(tokenSite), { email: 'ramon@memude.com.br', user_id: 'u7' }, 'entra com o Connect sem senha');
  eq(pedidos[1].corpo, { type: 'magiclink', token_hash: 'H1' }, 'troca o código por uma sessão própria');
  eq(await A.token(), 'E1', 'extensão usa o token próprio, não o do site');
  erro = null;
  try { await A.entrarComConnect('cab.x.y'); } catch (e) { erro = e.message; }
  eq(erro, 'Sessão inválida', 'token do site recusado → erro claro');
}

// ============================================================
// 5) API — renova em 401 e sinaliza falta de conexão
// ============================================================
async function testApi() {
  globalThis.chrome = makeChromeMock();
  loadGlobal('utils/config.js', 'MEMUDE_CONFIG');
  let tokens = ['T1', 'T2'];
  globalThis.MemudeAuth = { token: (forcar) => Promise.resolve(forcar ? tokens[1] : tokens[0]) };
  const usados = [];
  globalThis.fetch = (url, opts) => {
    usados.push(opts.headers.Authorization);
    return opts.headers.Authorization === 'Bearer T1' ? respostaFetch(401, { erro: 'expirado' }) : respostaFetch(201, { lead: { id: 'L1' } });
  };
  const Api = loadGlobal('utils/api.js', 'MemudeApi');
  const r = await Api.criarLead({ nome: 'Ana', telefone: '85999990000' });
  eq(r.lead.id, 'L1', 'cadastra depois de renovar o token');
  eq(usados, ['Bearer T1', 'Bearer T2'], 'tenta de novo uma vez com token renovado');

  globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  let code = null;
  try { await Api.buscar('85999990000'); } catch (e) { code = e.code; }
  eq(code, 'OFFLINE', 'sem internet → OFFLINE (vai para a fila)');

  globalThis.fetch = () => respostaFetch(409, { duplicado: true, lead: { id: 'L9' } });
  const dup = await Api.criarLead({ nome: 'Ana', telefone: '85999990000' });
  eq([dup.status, dup.duplicado], [409, true], '409 (já é lead) não é erro: devolve a ficha');

  globalThis.fetch = () => respostaFetch(400, { erro: 'Telefone inválido: informe DDD e número' });
  let msg = null;
  try { await Api.criarLead({ nome: 'Ana', telefone: '123' }); } catch (e) { msg = [e.message, e.code]; }
  eq(msg, ['Telefone inválido: informe DDD e número', 'RECUSADO'], 'erro do sistema chega em português');
}

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------
(async () => {
  try {
    testPhoneUtils();
    testExtractorLabel();
    testFontes();
    await testAuth();
    await testApi();
  } catch (err) {
    failed++;
    failures.push('EXCEÇÃO não tratada: ' + (err && err.stack || err));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${passed} passou · ${failed} falhou`);
  console.log('='.repeat(50));
  if (failures.length) {
    console.log('\nFALHAS:');
    failures.forEach((f, i) => console.log(`\n${i + 1}) ${f}`));
    process.exit(1);
  } else {
    console.log('\n✓ Tudo verde.\n');
  }
})();
