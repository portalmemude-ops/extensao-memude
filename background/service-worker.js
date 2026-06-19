/* ============================================================
   MeMude - Background Service Worker
   Handles Google Sheets API calls, auth and message routing
   ============================================================ */

importScripts(
  '/utils/logger.js',
  '/utils/phone-utils.js',
  '/utils/settings.js',
  '/utils/history.js',
  '/utils/auth.js',
  '/utils/sheets-api.js'
);

// ============================================================
// Message Handler
// ============================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'EXPORT_TO_SHEETS':
    case 'EXPORT_TO_SHEETS_FROM_CONTENT':
      handleExport(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'TEST_SHEET_CONNECTION':
      handleTestConnection(request.data)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_AUTH_TOKEN': // login (interactive=true) ou leitura silenciosa
      AUTH.getToken(request.interactive || false)
        .then(token => sendResponse({ success: true, token }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CHECK_AUTH':
      AUTH.validateLive()
        .then(connected => sendResponse({ success: true, connected }))
        .catch(() => sendResponse({ success: true, connected: false }));
      return true;

    case 'LOGOUT':
      AUTH.logout()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_SETTINGS':
      Settings.getSettings()
        .then(s => sendResponse({ success: true, settings: s }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SAVE_SETTINGS':
      Settings.saveSettings(request.settings || {})
        .then(s => sendResponse({ success: true, settings: s }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'RESET_SETTINGS':
      Settings.resetToTeamDefaults()
        .then(s => sendResponse({ success: true, settings: s }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_HISTORY':
      History.list(request.limit || 50)
        .then(items => sendResponse({ success: true, items }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CLEAR_HISTORY':
      History.clear()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_DAILY_COUNT':
      History.dailyCount()
        .then(count => sendResponse({ success: true, count }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      return false;
  }
});

// ============================================================
// Export
// ============================================================

/**
 * Recebe os contatos, busca config + token e grava na planilha.
 * O token é obtido aqui (não vem mais do popup). Em caso de 401,
 * o token é invalidado e devolvemos NEEDS_AUTH para o popup pedir
 * reconexão.
 */
async function handleExport(data) {
  const contacts = (data && data.contacts) || [];

  if (contacts.length === 0) {
    return { success: false, error: 'Nenhum contato para exportar' };
  }

  const settings = await Settings.getSettings();
  if (!settings || !settings.spreadsheetId) {
    return { success: false, error: 'Configure a planilha na extensão primeiro' };
  }

  let token;
  try {
    token = await AUTH.getToken(false);
  } catch (err) {
    return { success: false, error: 'Conecte sua conta Google primeiro', code: 'NEEDS_AUTH' };
  }

  let result = await writeContacts(contacts, settings, token);

  if (!result.success && isAuthError(result.error)) {
    await AUTH.invalidate();
    return { success: false, error: 'Sessão do Google expirou. Conecte novamente.', code: 'NEEDS_AUTH' };
  }

  return result;
}

/**
 * Deduplica, grava na planilha e atualiza o histórico.
 */
async function writeContacts(contacts, settings, token) {
  // Data dd/mm/aaaa montada manualmente (sem hora e sem depender de locale)
  const now = new Date();
  const today = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  // Aplica defaults da equipe nos campos opcionais
  const enriched = contacts.map(c => ({
    date: c.date || today,
    name: c.name || '',
    phone: c.phone || '',
    status: c.status || settings.defaultStatus || '', // "NOVO" por padrão
    source: c.source || settings.defaultSource || '',
    notes: c.notes || '',
    timestamp: c.timestamp || now.toLocaleString('pt-BR')
  }));

  // Corrige o 9º dígito (omitido pelo WhatsApp no JID) e formata p/ a planilha.
  for (const c of enriched) {
    if (settings.add9thDigit) c.phone = PhoneUtils.add9thDigit(c.phone);
    if (settings.formatPhone) c.phone = PhoneUtils.formatPhoneBR(c.phone);
  }

  // Carrega chaves já existentes na planilha + no histórico local
  const [remote, localKeys] = await Promise.all([
    SheetsAPI.getExistingPhones(settings.spreadsheetId, settings.sheetName, settings.colPhone, token),
    History.localPhoneKeys()
  ]);
  const seen = new Set([...remote, ...localKeys]);

  const newContacts = enriched.filter(c => {
    const key = PhoneUtils.phoneKey(c.phone);
    return key && !seen.has(key);
  });
  const duplicated = enriched.length - newContacts.length;

  if (newContacts.length === 0) {
    // Não polui o histórico com entradas duplicadas — só retorna o sumário.
    return {
      success: true,
      exported: 0,
      duplicated,
      errors: 0,
      message: 'Todos os contatos já existem na planilha'
    };
  }

  const cols = {
    date: settings.colDate,
    name: settings.colName,
    phone: settings.colPhone,
    status: settings.colStatus,
    source: settings.colSource,
    notes: settings.colNotes,
    timestamp: settings.colTimestamp
  };

  const result = await SheetsAPI.appendContacts(
    settings.spreadsheetId,
    settings.sheetName,
    cols,
    newContacts,
    token
  );

  if (result.success) {
    await History.addBulk(newContacts.map(c => ({ ...c, exported: true })), settings.historyLimit);
    result.duplicated = duplicated;
  } else {
    await History.addBulk(newContacts.map(c => ({ ...c, exported: false, error: result.error })));
  }
  return result;
}

function isAuthError(error) {
  return /401|unauthenticated|invalid.?credentials|invalid.?token|access.?token/i.test(String(error || ''));
}

/**
 * Test connection to the configured spreadsheet
 */
async function handleTestConnection(data) {
  let token = (data && data.token) || null;
  if (!token) {
    token = await AUTH.getToken(false).catch(() => null);
  }
  if (!token) return { success: false, error: 'Conecte sua conta Google primeiro', code: 'NEEDS_AUTH' };
  return SheetsAPI.testConnection(data.spreadsheetId, token);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Encontra a melhor aba do WhatsApp Web entre todas as janelas.
 * Prefere a aba ativa da janela focada → qualquer ativa → qualquer.
 */
async function findWhatsAppTab() {
  const all = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!all.length) return null;
  // Prefere uma aba ativa (qualquer janela), senão pega a primeira.
  return all.find(t => t.active) || all[0];
}

// ============================================================
// Atalhos de teclado (chrome.commands)
// ============================================================
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const tab = await findWhatsAppTab();
    if (!tab) {
      // Sem WhatsApp aberto em lugar nenhum — abre uma aba
      chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
      return;
    }
    // Garante que a aba está focada para os atalhos funcionarem
    try {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) { /* ignore */ }
    const action = command === 'open-overlay' ? 'OVERLAY_OPEN' : 'RUN_QUICK_CAPTURE';
    try {
      await chrome.tabs.sendMessage(tab.id, { action });
    } catch (e) {
      // Content script não carregou — injeta e tenta de novo
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [
          'utils/logger.js',
          'utils/phone-utils.js',
          'utils/phone-extractor.js',
          'content/overlay.js',
          'content/content.js'
        ]
      });
      await new Promise(r => setTimeout(r, 1500));
      await chrome.tabs.sendMessage(tab.id, { action });
    }
  } catch (err) {
    Logger.error('command failed', command, err);
  }
});

// ============================================================
// Installation Handler
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    Logger.warn('Extension installed — applying team defaults');
    Settings.resetToTeamDefaults();
  }
});
