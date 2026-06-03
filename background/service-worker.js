/* ============================================================
   MeMude - Background Service Worker
   Handles Google Sheets API calls, auth and message routing
   ============================================================ */

importScripts('/utils/auth.js', '/utils/sheets-api.js');

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
      AUTH.hasValidToken()
        .then(connected => sendResponse({ success: true, connected }))
        .catch(() => sendResponse({ success: true, connected: false }));
      return true;

    case 'LOGOUT':
      AUTH.logout()
        .then(() => sendResponse({ success: true }))
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

  const settings = await getSettings();
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
 * Deduplica e grava os contatos na planilha.
 */
async function writeContacts(contacts, settings, token) {
  const existingPhones = await SheetsAPI.getExistingPhones(
    settings.spreadsheetId,
    settings.sheetName,
    settings.colPhone,
    token
  );

  // Filter out duplicates (canonical key tolerates the optional 9th digit)
  const newContacts = contacts.filter(c => {
    const key = SheetsAPI.phoneKey(c.phone);
    return !existingPhones.has(key);
  });

  if (newContacts.length === 0) {
    return {
      success: true,
      exported: 0,
      errors: 0,
      message: 'Todos os contatos já existem na planilha'
    };
  }

  return SheetsAPI.appendContacts(
    settings.spreadsheetId,
    settings.sheetName,
    settings.colName,
    settings.colPhone,
    newContacts,
    token
  );
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
// Storage Utilities
// ============================================================

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('memude_settings', (data) => {
      resolve(data.memude_settings || null);
    });
  });
}

// ============================================================
// Installation Handler
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[MeMude] Extension installed');

    chrome.storage.sync.set({
      memude_settings: {
        sheetUrl: '',
        spreadsheetId: '',
        sheetName: '',
        colName: 'A',
        colPhone: 'B',
        add9thDigit: false
      }
    });
  }
});
