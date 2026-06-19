/* ============================================================
   MeMude - Suíte de testes (node, sem dependências)
   Roda:  node tests/run-tests.js
   Cobre: phone-utils, settings (migração), sheets-api (linhas/
          dedup), phone-extractor (etiqueta/Fonte) e o enriquecimento
          de contatos do service worker.
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
    set(obj, cb) { Object.assign(bucket, obj); if (cb) cb(); }
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

// ============================================================
// 2) settings — migração de versão
// ============================================================
function testSettingsMigration() {
  // Instalação ANTIGA: mapa defasado (colName A / colPhone B) e sem versão.
  const oldUser = {
    sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC123/edit',
    spreadsheetId: 'ABC123',
    sheetName: 'LEADS',
    colName: 'A', colPhone: 'B', colStatus: 'C',
    add9thDigit: false,
    autoSendOnCapture: false
  };
  global.chrome = makeChromeMock({ memude_settings: oldUser });
  const S = loadGlobal('utils/settings.js', 'Settings');

  return S.getSettings().then((s) => {
    // Campos migrados
    eq(s.colDate, 'A', 'migração: colDate = A');
    eq(s.colName, 'B', 'migração: colName = B');
    eq(s.colPhone, 'C', 'migração: colPhone = C');
    eq(s.colStatus, 'G', 'migração: colStatus = G (Status preenchido)');
    eq(s.colSource, 'F', 'migração: colSource = F');
    eq(s.add9thDigit, true, 'migração: 9º dígito ligado');
    eq(s.formatPhone, true, 'migração: formatação ligada');
    eq(s.defaultStatus, 'NOVO', 'migração: status padrão NOVO');
    ok(Array.isArray(s.knownSources) && s.knownSources.includes('Facebook'), 'migração: knownSources presente');
    eq(s.defaultsVersion, 3, 'migração: versão atualizada');
    // Preservados
    eq(s.sheetUrl, oldUser.sheetUrl, 'preserva sheetUrl');
    eq(s.spreadsheetId, 'ABC123', 'preserva spreadsheetId');
    eq(s.sheetName, 'LEADS', 'preserva sheetName');
    eq(s.autoSendOnCapture, false, 'preserva preferência do usuário (autoSend)');
    // Persistiu no storage?
    eq(global.chrome._sync.memude_settings.defaultsVersion, 3, 'migração foi gravada no storage');

    // Segunda chamada não deve re-migrar nem quebrar
    return S.getSettings().then((s2) => {
      eq(s2.colPhone, 'C', 'idempotente: 2ª leitura mantém mapa');
    });
  });
}

// ============================================================
// 3) sheets-api — montagem de linhas + dedup
// ============================================================
function testSheetsApi() {
  globalThis.Logger = { isDebug: () => false, debug() {}, info() {}, warn() {}, error() {} };
  loadGlobal('utils/phone-utils.js', 'PhoneUtils');
  const API = loadGlobal('utils/sheets-api.js', 'SheetsAPI');

  // Conversões de coluna
  eq(API.colLetterToIndex('A'), 0, 'A → 0');
  eq(API.colLetterToIndex('F'), 5, 'F → 5');
  eq(API._indexToColLetter(0), 'A', '0 → A');
  eq(API._indexToColLetter(5), 'F', '5 → F');
  eq(API.parseSpreadsheetUrl('https://docs.google.com/spreadsheets/d/XYZ/edit#gid=0'), 'XYZ', 'parse URL');

  // appendContacts deve montar A..G com Data/Nome/Whatsapp/Fonte/Status,
  // forçando o telefone como texto (apóstrofo) p/ não virar fórmula.
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ updates: { updatedRows: 1 } }) };
  };
  const cols = { date: 'A', name: 'B', phone: 'C', status: 'G', source: 'F', notes: '', timestamp: '' };
  const contacts = [{ date: '18/06/2026', name: 'Maria', phone: '+55 (85) 98833-6228', source: 'Facebook', status: 'NOVO' }];

  return API.appendContacts('SID', 'LEADS', cols, contacts, 'tok').then((res) => {
    ok(res.success, 'append retornou sucesso');
    const row = captured.body.values[0];
    eq(row.length, 7, 'linha cobre A..G (7 colunas)');
    eq(row[0], '18/06/2026', 'A = Data');
    eq(row[1], 'Maria', 'B = Nome');
    eq(row[2], "'+55 (85) 98833-6228", 'C = Whatsapp como texto (apóstrofo anti-fórmula)');
    eq(row[3], '', 'D = Email vazio');
    eq(row[4], '', 'E = Imóvel vazio');
    eq(row[5], 'Facebook', 'F = Fonte (etiqueta)');
    eq(row[6], 'NOVO', 'G = Status NOVO');
    ok(captured.url.includes('A%3AG') || decodeURIComponent(captured.url).includes('A:G'), 'range A:G');

    // getExistingPhones: dedup tolerante ao 9
    global.fetch = async () => ({ ok: true, json: async () => ({ values: [['+55 (85) 8833-6228']] }) });
    return API.getExistingPhones('SID', 'LEADS', 'C', 'tok').then((set) => {
      const P = globalThis.PhoneUtils;
      ok(set.has(P.phoneKey('+5585988336228')), 'dedup: número com 9 reconhece existente sem 9');
    });
  });
}

// ============================================================
// 4) phone-extractor — leitura da etiqueta (Fonte)
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
// 5) Enriquecimento estilo service-worker (data + 9 + formato)
// ============================================================
function testEnrichment() {
  globalThis.Logger = { isDebug: () => false, debug() {}, info() {}, warn() {}, error() {} };
  const P = loadGlobal('utils/phone-utils.js', 'PhoneUtils');
  const settings = { add9thDigit: true, formatPhone: true, defaultSource: '', defaultStatus: 'NOVO' };

  const c = { name: 'Ana', phone: P.normalizePhone('8588336228'), source: 'Google' };
  let phone = c.phone;
  if (settings.add9thDigit) phone = P.add9thDigit(phone);
  if (settings.formatPhone) phone = P.formatPhoneBR(phone);

  eq(phone, '+55 (85) 98833-6228', 'pipeline completo: 9 + formato');
  eq(c.source || settings.defaultSource || '', 'Google', 'fonte preservada da etiqueta');
  // status recebe o default "NOVO"
  const status = c.status || settings.defaultStatus || '';
  eq(status, 'NOVO', 'status default NOVO no enriquecimento');
}

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------
(async () => {
  try {
    testPhoneUtils();
    await testSettingsMigration();
    await testSheetsApi();
    testExtractorLabel();
    testEnrichment();
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
