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
  await loadSettings();
  checkAuthStatus();
  bindEvents();
  refreshDailyCount();
  refreshHistorySummary();
}

// ---- Event Binding ----
function bindEvents() {
  document.getElementById('btn-google-auth').addEventListener('click', handleGoogleAuth);
  document.getElementById('btn-save').addEventListener('click', handleSave);
  document.getElementById('btn-extract').addEventListener('click', handleExtract);
  document.getElementById('btn-send-to-sheet').addEventListener('click', handleSendToSheet);
  document.getElementById('sheet-url').addEventListener('input', debounce(validateSheetUrl, 500));

  // Auto-save dos toggles principais (sem precisar clicar em Salvar)
  document.getElementById('add-9th-digit').addEventListener('change', autoSaveToggle);
  document.getElementById('auto-send').addEventListener('change', () => {
    autoSaveToggle();
    updateCaptureButtonLabel();
  });

  // Secondary actions
  const btnTest = document.getElementById('btn-test-sheet');
  if (btnTest) btnTest.addEventListener('click', handleTestSheet);
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) btnReset.addEventListener('click', handleResetSettings);

  // History
  const histBtn = document.getElementById('btn-toggle-history');
  if (histBtn) histBtn.addEventListener('click', toggleHistory);
  const clearBtn = document.getElementById('btn-clear-history');
  if (clearBtn) clearBtn.addEventListener('click', handleClearHistory);

  // Diagnostics
  const diagBtn = document.getElementById('btn-toggle-diag');
  if (diagBtn) {
    diagBtn.addEventListener('click', () => {
      document.getElementById('diagnostic-panel').classList.toggle('hidden');
    });
    document.getElementById('diag-ext-id').textContent = chrome.runtime.id;
  }
  const dbgToggle = document.getElementById('diag-debug-toggle');
  if (dbgToggle) {
    dbgToggle.checked = Logger.isDebug();
    dbgToggle.addEventListener('change', (e) => Logger.setDebug(e.target.checked));
  }
}

// ---- Google Auth ----
async function handleGoogleAuth() {
  const btn = document.getElementById('btn-google-auth');
  btn.classList.add('loading');
  btn.disabled = true;
  showToast('Abrindo login do Google...', 'info');

  try {
    // O login roda no service worker (launchWebAuthFlow). A janela do Google
    // pode fechar este popup; se isso acontecer, ao reabrir a extensão o
    // status já aparecerá como "Conectado".
    const resp = await chrome.runtime.sendMessage({ action: 'GET_AUTH_TOKEN', interactive: true });

    if (resp && resp.success && resp.token) {
      isAuthenticated = true;
      updateAuthUI(true);
      showToast('Conectado ao Google com sucesso!', 'success');
    } else {
      throw new Error((resp && resp.error) || 'Não foi possível conectar');
    }
  } catch (err) {
    Logger.error('Auth error:', err);
    showToast('Erro na autenticação: ' + err.message, 'error');
    const diagError = document.getElementById('diag-last-error');
    if (diagError) diagError.textContent = err.message;
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function checkAuthStatus() {
  chrome.runtime.sendMessage({ action: 'CHECK_AUTH' }, (resp) => {
    if (chrome.runtime.lastError) {
      Logger.warn('Auth status check:', chrome.runtime.lastError.message);
      isAuthenticated = false;
      updateAuthUI(false);
      return;
    }
    const connected = !!(resp && resp.connected);
    isAuthenticated = connected;
    updateAuthUI(connected);
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
async function handleSave() {
  const url = document.getElementById('sheet-url').value.trim();
  const sheetName = document.getElementById('sheet-name').value.trim();
  const colName = document.getElementById('col-name').value.trim().toUpperCase() || 'B';
  const colPhone = document.getElementById('col-phone').value.trim().toUpperCase() || 'C';

  const spreadsheetId = extractSpreadsheetId(url);
  if (url && !spreadsheetId) {
    showToast('URL da planilha inválida', 'error');
    return;
  }

  if (colName === colPhone) {
    showToast('As colunas de Nome e WhatsApp devem ser diferentes', 'error');
    return;
  }

  const cols = [colName, colPhone];
  for (const id of ['col-status', 'col-source', 'col-notes', 'col-timestamp']) {
    const v = document.getElementById(id).value.trim().toUpperCase();
    if (v) {
      if (cols.includes(v)) {
        showToast(`Coluna ${v} repetida — escolha letras diferentes`, 'error');
        return;
      }
      cols.push(v);
    }
  }

  const settings = {
    sheetUrl: url,
    spreadsheetId: spreadsheetId || '',
    sheetName,
    colName,
    colPhone,
    colStatus: document.getElementById('col-status').value.trim().toUpperCase(),
    colSource: document.getElementById('col-source').value.trim().toUpperCase(),
    colNotes: document.getElementById('col-notes').value.trim().toUpperCase(),
    colTimestamp: document.getElementById('col-timestamp').value.trim().toUpperCase(),
    defaultStatus: document.getElementById('default-status').value.trim(),
    defaultSource: document.getElementById('default-source').value.trim(),
    add9thDigit: document.getElementById('add-9th-digit').checked,
    autoSendOnCapture: document.getElementById('auto-send').checked
  };

  await Settings.saveSettings(settings);
  showToast('Configurações salvas!', 'success');
}

async function loadSettings() {
  const s = await Settings.getSettings();
  document.getElementById('sheet-url').value = s.sheetUrl || '';
  document.getElementById('sheet-name').value = s.sheetName || '';
  document.getElementById('col-name').value = s.colName || 'B';
  document.getElementById('col-phone').value = s.colPhone || 'C';
  document.getElementById('col-status').value = s.colStatus || '';
  document.getElementById('col-source').value = s.colSource || '';
  document.getElementById('col-notes').value = s.colNotes || '';
  document.getElementById('col-timestamp').value = s.colTimestamp || '';
  document.getElementById('default-status').value = s.defaultStatus || '';
  document.getElementById('default-source').value = s.defaultSource || '';
  document.getElementById('add-9th-digit').checked = !!s.add9thDigit;
  document.getElementById('auto-send').checked = !!s.autoSendOnCapture;
  // Pre-popular os campos da captura com os defaults
  document.getElementById('field-status').placeholder = s.defaultStatus || 'Novo';
  document.getElementById('field-source').placeholder = s.defaultSource || 'WhatsApp';
  if (s.sheetUrl) validateSheetUrl();
  updateCaptureButtonLabel();
}

/**
 * Salva imediatamente as toggles principais (add-9th-digit, auto-send)
 * sem precisar do botão Salvar. Mostra um feedback discreto.
 */
async function autoSaveToggle() {
  const partial = {
    add9thDigit: document.getElementById('add-9th-digit').checked,
    autoSendOnCapture: document.getElementById('auto-send').checked
  };
  await Settings.saveSettings(partial);
  showToast('Salvo', 'success');
}

/**
 * Atualiza o label do botão de capturar conforme o modo de envio
 * automático: "Capturar e Enviar" (1 clique) vs "Capturar do Chat Aberto".
 */
function updateCaptureButtonLabel() {
  const auto = document.getElementById('auto-send').checked;
  const span = document.querySelector('#btn-extract span');
  if (span) span.textContent = auto ? 'Capturar e Enviar' : 'Capturar do Chat Aberto';
}

async function handleResetSettings() {
  if (!confirm('Restaurar a configuração padrão da equipe? Suas personalizações serão perdidas.')) return;
  await Settings.resetToTeamDefaults();
  await loadSettings();
  showToast('Padrão da equipe restaurado', 'success');
}

async function handleTestSheet() {
  const s = await Settings.getSettings();
  if (!s.spreadsheetId) {
    showToast('Configure a URL da planilha primeiro', 'error');
    return;
  }
  const btn = document.getElementById('btn-test-sheet');
  btn.disabled = true;
  btn.textContent = 'Testando...';
  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'TEST_SHEET_CONNECTION',
      data: { spreadsheetId: s.spreadsheetId }
    });
    if (resp && resp.success) {
      showToast(`✓ Conectado a "${resp.title}"`, 'success');
    } else {
      throw new Error((resp && resp.error) || 'Falha desconhecida');
    }
  } catch (err) {
    showToast('Falha: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Testar planilha';
  }
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
    // Procura qualquer aba do WhatsApp Web (em qualquer janela)
    const waTabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    const tab = waTabs.find(t => t.active) || waTabs[0];

    if (!tab) {
      showToast('Abra o WhatsApp Web primeiro!', 'error');
      return;
    }

    // Try to send message to content script
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_ACTIVE_CONTACT' });
    } catch (connErr) {
      // Content script not yet loaded — inject it manually
      Logger.debug('Content script not loaded, injecting...');
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

    if (currentContact.name) {
      currentContact.name = currentContact.name.replace(/^~\s*/, '').trim();
    }

    const settings = await Settings.getSettings();
    const phoneBefore9 = currentContact.phone;
    if (settings && settings.add9thDigit && currentContact.phone) {
      currentContact.phone = apply9thDigit(currentContact.phone);
    }
    const ninthApplied = phoneBefore9 !== currentContact.phone;

    // F2: envio automático = pula UI de preview/confirmação
    if (settings.autoSendOnCapture && currentContact.phone) {
      // Aplica defaults se não houver edição manual no popup (em auto-send
      // não há edição inline — usa defaultStatus/defaultSource direto)
      await handleSendToSheet({ skipResultUI: true });
    } else {
      showResult(currentContact, { ninthApplied });
      showToast('Contato capturado!', 'success');
    }

  } catch (err) {
    Logger.error('Extract error:', err);
    showToast('Erro: ' + err.message, 'error');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ============================================================
// SEND TO SHEET — Export the extracted contact
// ============================================================
async function handleSendToSheet(opts = {}) {
  if (!currentContact) {
    showToast('Capture um contato primeiro', 'error');
    return;
  }

  if (!currentContact.phone) {
    showToast('Contato sem telefone — não é possível enviar', 'error');
    return;
  }

  // Mescla campos editados no popup ao contato corrente
  // (skipResultUI = auto-send: não há edição manual)
  if (!opts.skipResultUI) {
    const editStatus = document.getElementById('field-status').value.trim();
    const editSource = document.getElementById('field-source').value.trim();
    const editNotes = document.getElementById('field-notes').value.trim();
    if (editStatus) currentContact.status = editStatus;
    if (editSource) currentContact.source = editSource;
    if (editNotes) currentContact.notes = editNotes;
  }

  const settings = await Settings.getSettings();
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
  updateProgress(40, 'Enviando para a planilha...');

  try {
    // O token é obtido pelo próprio service worker
    const exportResult = await chrome.runtime.sendMessage({
      action: 'EXPORT_TO_SHEETS',
      data: { contacts: [currentContact] }
    });

    if (!exportResult) {
      throw new Error('Sem resposta do serviço da extensão. Recarregue a extensão e tente novamente.');
    }

    if (!exportResult.success && exportResult.code === 'NEEDS_AUTH') {
      isAuthenticated = false;
      updateAuthUI(false);
      throw new Error('Sessão do Google expirou. Clique em "Conectar Google" e tente de novo.');
    }

    if (exportResult.success) {
      if (exportResult.exported === 0 && exportResult.message) {
        updateProgress(100, exportResult.message);
        showToast(exportResult.message, 'info');
      } else {
        updateProgress(100, 'Contato salvo na planilha! ✓');
        showToast('Contato exportado com sucesso!', 'success');
      }

      refreshDailyCount();
      refreshHistorySummary();

      // Reset after a moment
      setTimeout(() => {
        document.getElementById('progress-container').classList.add('hidden');
        updateProgress(0, '');
        hideResult();
      }, 2500);
    } else {
      throw new Error(exportResult.error || 'Erro ao exportar');
    }

  } catch (err) {
    Logger.error('Export error:', err);
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
function showResult(contact, opts = {}) {
  document.getElementById('result-name').textContent = contact.name || '(Sem nome salvo)';
  const phoneEl = document.getElementById('result-phone');
  phoneEl.textContent = contact.phone || '(Sem telefone)';
  // Badge "9 aplicado" quando a função add9thDigit transformou o número
  const badge = document.getElementById('result-phone-badge');
  if (badge) {
    if (opts.ninthApplied) {
      badge.textContent = '9 aplicado';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  // Pré-preenche a Fonte com a etiqueta detectada na conversa (editável)
  const sourceField = document.getElementById('field-source');
  if (sourceField && contact.source) sourceField.value = contact.source;
  document.getElementById('extract-result').classList.remove('hidden');
}

function hideResult() {
  document.getElementById('extract-result').classList.add('hidden');
  document.getElementById('field-status').value = '';
  document.getElementById('field-source').value = '';
  document.getElementById('field-notes').value = '';
  currentContact = null;
}

function updateProgress(percent, text) {
  document.getElementById('progress-fill').style.width = percent + '%';
  document.getElementById('progress-text').textContent = text;
}

async function refreshDailyCount() {
  try {
    const n = await History.dailyCount();
    document.getElementById('daily-count-value').textContent = n;
  } catch (e) { /* ignore */ }
}

async function refreshHistorySummary() {
  try {
    const items = await History.list(50);
    const summaryEl = document.getElementById('history-summary');
    if (summaryEl) summaryEl.textContent = items.length ? `${items.length} registros` : '';
    const list = document.getElementById('history-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<li class="history-empty">Nenhum lead capturado ainda</li>';
      return;
    }
    list.innerHTML = items.slice(0, 20).map(it => {
      const cls = !it.exported ? (it.duplicate ? 'h-dup' : 'h-failed') : '';
      const when = formatTime(it.ts);
      return `<li class="history-item ${cls}">
        <span class="h-status"></span>
        <div class="h-info">
          <span class="h-name">${escapeHtml(it.name || '(sem nome)')}</span>
          <span class="h-phone">${escapeHtml(it.phone || '')}</span>
        </div>
        <span class="h-time">${when}</span>
      </li>`;
    }).join('');
  } catch (e) { /* ignore */ }
}

function toggleHistory() {
  const panel = document.getElementById('history-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) refreshHistorySummary();
}

async function handleClearHistory() {
  if (!confirm('Apagar todo o histórico local? Isso não afeta a planilha.')) return;
  await History.clear();
  refreshDailyCount();
  refreshHistorySummary();
  showToast('Histórico limpo', 'success');
}

function formatTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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

// 9º dígito vem de PhoneUtils.add9thDigit (utils/phone-utils.js)
const apply9thDigit = (phone) => PhoneUtils.add9thDigit(phone);
