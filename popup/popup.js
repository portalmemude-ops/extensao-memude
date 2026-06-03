/* ============================================================
   MeMude - Popup Logic
   Manages settings, auth, and single contact extraction
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);

// ---- State ----
let isAuthenticated = false;
let currentContact = null; // The extracted contact

// ---- Init ----
async function init() {
  loadSettings();
  checkAuthStatus();
  bindEvents();
}

// ---- Event Binding ----
function bindEvents() {
  document.getElementById('btn-google-auth').addEventListener('click', handleGoogleAuth);
  document.getElementById('btn-save').addEventListener('click', handleSave);
  document.getElementById('btn-extract').addEventListener('click', handleExtract);
  document.getElementById('btn-send-to-sheet').addEventListener('click', handleSendToSheet);
  document.getElementById('sheet-url').addEventListener('input', debounce(validateSheetUrl, 500));
  
  // Diagnostics
  const diagBtn = document.getElementById('btn-toggle-diag');
  if (diagBtn) {
    diagBtn.addEventListener('click', () => {
      document.getElementById('diagnostic-panel').classList.toggle('hidden');
    });
    document.getElementById('diag-ext-id').textContent = chrome.runtime.id;
  }
}

// ---- Google Auth ----
async function handleGoogleAuth() {
  const btn = document.getElementById('btn-google-auth');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    if (token) {
      isAuthenticated = true;
      updateAuthUI(true);
      showToast('Conectado ao Google com sucesso!', 'success');
    }
  } catch (err) {
    console.error('Auth error:', err);
    showToast('Erro na autenticação: ' + err.message, 'error');
    const diagError = document.getElementById('diag-last-error');
    if (diagError) diagError.textContent = err.message;
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function checkAuthStatus() {
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (chrome.runtime.lastError) {
      console.warn('Auth status check:', chrome.runtime.lastError.message);
      isAuthenticated = false;
      updateAuthUI(false);
      return;
    }
    if (token) {
      isAuthenticated = true;
      updateAuthUI(true);
    }
  });
}

function updateAuthUI(connected) {
  const badge = document.getElementById('auth-status');
  const btn = document.getElementById('btn-google-auth');

  if (connected) {
    badge.className = 'status-badge connected';
    badge.querySelector('.status-text').textContent = 'Conectado';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#25D366"/>
      </svg>
      <span>Google Conectado</span>
    `;
    btn.style.borderColor = 'rgba(37, 211, 102, 0.3)';
  } else {
    badge.className = 'status-badge disconnected';
    badge.querySelector('.status-text').textContent = 'Desconectado';
  }
}

// ---- Settings ----
function handleSave() {
  const url = document.getElementById('sheet-url').value.trim();
  const sheetName = document.getElementById('sheet-name').value.trim();
  const colName = document.getElementById('col-name').value.trim().toUpperCase() || 'A';
  const colPhone = document.getElementById('col-phone').value.trim().toUpperCase() || 'B';

  const spreadsheetId = extractSpreadsheetId(url);
  if (url && !spreadsheetId) {
    showToast('URL da planilha inválida', 'error');
    return;
  }

  if (colName === colPhone) {
    showToast('As colunas de Nome e WhatsApp devem ser diferentes', 'error');
    return;
  }

  const add9thDigit = document.getElementById('add-9th-digit').checked;

  const settings = {
    sheetUrl: url,
    spreadsheetId: spreadsheetId || '',
    sheetName,
    colName,
    colPhone,
    add9thDigit
  };

  chrome.storage.sync.set({ memude_settings: settings }, () => {
    showToast('Configurações salvas!', 'success');
  });
}

function loadSettings() {
  chrome.storage.sync.get('memude_settings', (data) => {
    const s = data.memude_settings;
    if (!s) return;

    document.getElementById('sheet-url').value = s.sheetUrl || '';
    document.getElementById('sheet-name').value = s.sheetName || '';
    document.getElementById('col-name').value = s.colName || 'A';
    document.getElementById('col-phone').value = s.colPhone || 'B';
    document.getElementById('add-9th-digit').checked = !!s.add9thDigit;

    if (s.sheetUrl) validateSheetUrl();
  });
}

// ---- Sheet URL Validation ----
function extractSpreadsheetId(url) {
  if (!url) return null;
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function validateSheetUrl() {
  const url = document.getElementById('sheet-url').value.trim();
  const hint = document.getElementById('sheet-url-status');

  if (!url) {
    hint.textContent = '';
    hint.className = 'input-hint';
    return;
  }

  const id = extractSpreadsheetId(url);
  if (id) {
    hint.textContent = '✓ Planilha detectada: ' + id.substring(0, 12) + '...';
    hint.className = 'input-hint success';
  } else {
    hint.textContent = '✗ URL inválida. Use o link completo do Google Sheets.';
    hint.className = 'input-hint error';
  }
}

// ============================================================
// EXTRACT — Single contact from active chat
// ============================================================
async function handleExtract() {
  const btn = document.getElementById('btn-extract');
  btn.classList.add('loading');
  btn.disabled = true;
  hideResult();

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) {
      showToast('Abra o WhatsApp Web primeiro!', 'error');
      return;
    }

    // Try to send message to content script
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_ACTIVE_CONTACT' });
    } catch (connErr) {
      // Content script not yet loaded — inject it manually
      console.log('[MeMude] Content script not loaded, injecting...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['utils/phone-extractor.js', 'content/content.js']
      });

      // Wait a moment for scripts to initialize
      await sleep(2500);

      // Retry
      response = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_ACTIVE_CONTACT' });
    }

    // Handle response
    if (response && response.error === 'NO_CHAT_OPEN') {
      showToast('Abra uma conversa no WhatsApp primeiro!', 'info');
      return;
    }

    if (response && response.error === 'GROUP_CHAT') {
      showToast('Chat de grupo detectado. Abra um chat individual.', 'info');
      return;
    }

    if (response && response.error === 'EXTRACTOR_NOT_LOADED') {
      showToast('Recarregue o WhatsApp Web e tente novamente.', 'error');
      return;
    }

    if (response && response.error === 'EXTRACTION_FAILED') {
      showToast('Não encontrou dados. Verifique o Console (F12) para detalhes.', 'error');
      return;
    }

    if (response && response.error) {
      showToast('Erro: ' + response.error, 'error');
      return;
    }

    const contact = response?.contact;
    if (!contact || (!contact.name && !contact.phone)) {
      showToast('Não foi possível extrair o contato. Abra um chat individual.', 'info');
      return;
    }

    // Show the extracted contact
    currentContact = contact;

    // Clean ~ prefix from pushnames (WhatsApp profile names)
    if (currentContact.name) {
      currentContact.name = currentContact.name.replace(/^~\s*/, '').trim();
    }

    // Apply 9th digit if setting is enabled
    const settings = await getSettings();
    if (settings && settings.add9thDigit && currentContact.phone) {
      currentContact.phone = apply9thDigit(currentContact.phone);
    }

    showResult(currentContact);
    showToast('Contato capturado!', 'success');

  } catch (err) {
    console.error('Extract error:', err);
    showToast('Erro: ' + err.message, 'error');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ============================================================
// SEND TO SHEET — Export the extracted contact
// ============================================================
async function handleSendToSheet() {
  if (!currentContact) {
    showToast('Capture um contato primeiro', 'error');
    return;
  }

  if (!currentContact.phone) {
    showToast('Contato sem telefone — não é possível enviar', 'error');
    return;
  }

  const settings = await getSettings();
  if (!settings || !settings.spreadsheetId) {
    showToast('Configure a planilha primeiro', 'error');
    return;
  }

  if (!isAuthenticated) {
    showToast('Conecte sua conta Google primeiro', 'error');
    return;
  }

  const btn = document.getElementById('btn-send-to-sheet');
  btn.classList.add('loading');
  btn.disabled = true;

  // Show progress
  document.getElementById('progress-container').classList.remove('hidden');
  updateProgress(30, 'Enviando para a planilha...');

  try {
    // Get auth token
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(token);
      });
    });

    updateProgress(60, 'Gravando dados...');

    // Send to Google Sheets via background
    let exportResult = await chrome.runtime.sendMessage({
      action: 'EXPORT_TO_SHEETS',
      data: {
        contacts: [currentContact],
        settings,
        token
      }
    });

    if (!exportResult) {
      throw new Error('Sem resposta do serviço da extensão. Recarregue a extensão e tente novamente.');
    }

    if (!exportResult.success && String(exportResult.error).includes('401')) {
      updateProgress(70, 'Renovando autenticação...');
      await chrome.runtime.sendMessage({ action: 'REMOVE_CACHED_TOKEN', token });
      
      const newToken = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (t) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });

      exportResult = await chrome.runtime.sendMessage({
        action: 'EXPORT_TO_SHEETS',
        data: { contacts: [currentContact], settings, token: newToken }
      });
    }

    if (exportResult.success) {
      updateProgress(100, 'Contato salvo na planilha! ✓');
      showToast('Contato exportado com sucesso!', 'success');

      // Reset after a moment
      setTimeout(() => {
        document.getElementById('progress-container').classList.add('hidden');
        updateProgress(0, '');
      }, 2500);
    } else {
      throw new Error(exportResult.error || 'Erro ao exportar');
    }

  } catch (err) {
    console.error('Export error:', err);
    updateProgress(100, 'Erro: ' + err.message);
    showToast('Erro: ' + err.message, 'error');

    setTimeout(() => {
      document.getElementById('progress-container').classList.add('hidden');
      updateProgress(0, '');
    }, 3500);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ============================================================
// UI Helpers
// ============================================================
function showResult(contact) {
  document.getElementById('result-name').textContent = contact.name || '(Sem nome salvo)';
  document.getElementById('result-phone').textContent = contact.phone || '(Sem telefone)';
  document.getElementById('extract-result').classList.remove('hidden');
}

function hideResult() {
  document.getElementById('extract-result').classList.add('hidden');
  currentContact = null;
}

function updateProgress(percent, text) {
  document.getElementById('progress-fill').style.width = percent + '%';
  document.getElementById('progress-text').textContent = text;
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('memude_settings', (data) => {
      resolve(data.memude_settings || null);
    });
  });
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  const icons = { success: '✓', error: '✗', info: 'ℹ' };

  toastIcon.textContent = icons[type] || icons.info;
  toastMessage.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Add the 9th digit to Brazilian mobile numbers missing it.
 * +55XX8XXXXXXX → +55XX98XXXXXXX
 */
function apply9thDigit(phone) {
  if (!phone) return phone;
  // Handle +55XXXXXXXXXXX (with +)
  let match = phone.match(/^\+55(\d{2})(\d{8})$/);
  if (match) {
    const ddd = match[1];
    const local = match[2];
    if (!local.startsWith('9')) {
      return `+55${ddd}9${local}`;
    }
    return phone;
  }
  // Handle 55XXXXXXXXXXX (without +)
  match = phone.match(/^55(\d{2})(\d{8})$/);
  if (match) {
    const ddd = match[1];
    const local = match[2];
    if (!local.startsWith('9')) {
      return `55${ddd}9${local}`;
    }
  }
  return phone;
}
