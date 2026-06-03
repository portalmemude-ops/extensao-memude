/* ============================================================
   MeMude - Background Service Worker
   Handles Google Sheets API calls and message routing
   ============================================================ */

// Import Sheets API module
importScripts('../utils/sheets-api.js');

// ============================================================
// Message Handler
// ============================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXPORT_TO_SHEETS') {
    handleExportToSheets(request.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }

  if (request.action === 'EXPORT_TO_SHEETS_FROM_CONTENT') {
    handleExportFromContent(request.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'TEST_SHEET_CONNECTION') {
    handleTestConnection(request.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'GET_AUTH_TOKEN') {
    getAuthToken(request.interactive || false)
      .then(token => sendResponse({ success: true, token }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ============================================================
// Export Handlers
// ============================================================

/**
 * Handle export request from popup (has settings and token)
 */
async function handleExportToSheets(data) {
  const { contacts, settings, token } = data;

  if (!contacts || contacts.length === 0) {
    return { success: false, error: 'Nenhum contato para exportar' };
  }

  if (!settings || !settings.spreadsheetId) {
    return { success: false, error: 'Planilha não configurada' };
  }

  if (!token) {
    return { success: false, error: 'Token de autenticação não disponível' };
  }

  // Check for duplicates
  const existingPhones = await SheetsAPI.getExistingPhones(
    settings.spreadsheetId,
    settings.sheetName,
    settings.colPhone,
    token
  );

  // Filter out duplicates
  const newContacts = contacts.filter(c => {
    const normalizedPhone = c.phone.replace(/\D/g, '');
    return !existingPhones.has(normalizedPhone);
  });

  if (newContacts.length === 0) {
    return {
      success: true,
      exported: 0,
      errors: 0,
      message: 'Todos os contatos já existem na planilha'
    };
  }

  // Append to sheet
  const result = await SheetsAPI.appendContacts(
    settings.spreadsheetId,
    settings.sheetName,
    settings.colName,
    settings.colPhone,
    newContacts,
    token
  );

  return result;
}

/**
 * Handle export request from content script (needs to fetch settings and token)
 */
async function handleExportFromContent(data) {
  const { contacts } = data;

  if (!contacts || contacts.length === 0) {
    return { success: false, error: 'Nenhum contato para exportar' };
  }

  // Get settings from storage
  const settings = await getSettings();
  if (!settings || !settings.spreadsheetId) {
    return { success: false, error: 'Configure a planilha na extensão primeiro' };
  }

  // Get auth token
  let token;
  try {
    token = await getAuthToken(false);
  } catch (err) {
    return { success: false, error: 'Conecte sua conta Google na extensão primeiro' };
  }

  // Delegate to main export handler
  return handleExportToSheets({ contacts, settings, token });
}

/**
 * Test connection to the configured spreadsheet
 */
async function handleTestConnection(data) {
  const { spreadsheetId, token } = data;
  return SheetsAPI.testConnection(spreadsheetId, token);
}

// ============================================================
// Auth Utilities
// ============================================================

function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (token) {
        resolve(token);
      } else {
        reject(new Error('Nenhum token obtido'));
      }
    });
  });
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

    // Set default settings
    chrome.storage.sync.set({
      memude_settings: {
        sheetUrl: '',
        spreadsheetId: '',
        sheetName: 'Página1',
        colName: 'A',
        colPhone: 'B',
        add9thDigit: false
      }
    });
  }
});
