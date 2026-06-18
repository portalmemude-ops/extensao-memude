/* ============================================================
   MeMude - Overlay
   Painel flutuante injetado no WhatsApp Web.
   Conecta extractor → fila staged → envio para o service worker.
   ============================================================ */

(function () {
  'use strict';

  // Guard global — impede listeners/timers duplicados caso o script
  // seja reinjetado.
  if (window.__MEMUDE_OVERLAY_LOADED) return;
  window.__MEMUDE_OVERLAY_LOADED = true;

  const log = (typeof Logger !== 'undefined')
    ? Logger
    : { debug() {}, info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };

  const PU = (typeof PhoneUtils !== 'undefined') ? PhoneUtils : null;
  const STAGE_KEY = 'memude_staged';

  let overlayMounted = false;
  let panelOpen = false;
  let staged = []; // [{ name, phone, status, source, notes, key }]
  let busy = false;

  // ============================================================
  // Mount
  // ============================================================
  function mount() {
    if (overlayMounted) return;
    if (document.getElementById('memude-overlay')) return;

    const root = document.createElement('div');
    root.id = 'memude-overlay';
    root.innerHTML = template();
    document.body.appendChild(root);

    bindEvents(root);
    overlayMounted = true;
    log.debug('Overlay mounted');

    loadStaged().then(updateBadge).then(renderQueue);
    pollDailyCount();
  }

  function template() {
    return `
      <button class="memude-fab" id="memude-fab" title="MeMude">
        <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M8 23 L8 13 Q8 10.6 10 11.4 L16 17 L22 11.4 Q24 10.6 24 13 L24 23"
                fill="none" stroke="#fff" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="16" cy="22" r="2" fill="#fff"/>
        </svg>
        <span class="memude-fab-badge hidden" id="memude-badge">0</span>
      </button>
      <div class="memude-panel hidden" id="memude-panel">
        <div class="memude-panel-header">
          <div class="memude-panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5a2 2 0 0 0-2-2z" /></svg>
            MeMude
          </div>
          <button class="memude-close" id="memude-close" title="Fechar">✕</button>
        </div>
        <div class="memude-panel-body">
          <div class="memude-status">
            <span class="memude-status-dot"></span>
            <span id="memude-status-text">Pronto</span>
            <span class="memude-jid-count" id="memude-daily">Hoje: 0</span>
          </div>

          <button class="memude-extract-btn" id="memude-capture">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
            Capturar do chat aberto
          </button>

          <div class="memude-results">
            <div class="memude-results-header">
              <span>Fila para enviar (<span id="memude-queue-count">0</span>)</span>
              <div class="memude-results-actions">
                <button class="memude-btn-sm" id="memude-select-all">Todos</button>
                <button class="memude-btn-sm" id="memude-clear-queue">Limpar</button>
                <button class="memude-btn-export" id="memude-send-all">Enviar</button>
              </div>
            </div>
            <div class="memude-contacts-list" id="memude-queue">
              <div class="memude-empty">Nenhum lead na fila.<br>Abra um chat individual e clique em capturar.</div>
            </div>
          </div>

          <div class="memude-progress hidden" id="memude-progress">
            <div class="memude-progress-bar"><div class="memude-progress-fill" id="memude-progress-fill"></div></div>
            <span class="memude-progress-text" id="memude-progress-text">Enviando...</span>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // Events
  // ============================================================
  function bindEvents(root) {
    root.querySelector('#memude-fab').addEventListener('click', togglePanel);
    root.querySelector('#memude-close').addEventListener('click', closePanel);
    root.querySelector('#memude-capture').addEventListener('click', captureCurrent);
    root.querySelector('#memude-send-all').addEventListener('click', sendSelected);
    root.querySelector('#memude-select-all').addEventListener('click', selectAll);
    root.querySelector('#memude-clear-queue').addEventListener('click', clearQueue);

    // Listen for messages (PING, EXTRACT_ACTIVE_CONTACT, RUN_QUICK_CAPTURE)
    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.action === 'RUN_QUICK_CAPTURE') {
        captureCurrent({ quick: true }).then(r => sendResponse(r || { ok: true }));
        return true;
      }
      if (req.action === 'OVERLAY_OPEN') {
        openPanel();
        sendResponse({ ok: true });
        return true;
      }
      return false;
    });
  }

  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }
  function openPanel() {
    document.getElementById('memude-panel').classList.remove('hidden');
    document.getElementById('memude-fab').classList.add('active');
    panelOpen = true;
    pollDailyCount();
    renderQueue();
  }
  function closePanel() {
    document.getElementById('memude-panel').classList.add('hidden');
    document.getElementById('memude-fab').classList.remove('active');
    panelOpen = false;
  }

  // ============================================================
  // Capture
  // ============================================================
  async function captureCurrent(opts = {}) {
    if (busy) return { ok: false, error: 'busy' };
    const extractor = window.__MEMUDE_EXTRACTOR;
    if (!extractor) {
      toast('Extrator não carregado. Recarregue o WhatsApp.', 'error');
      return { ok: false, error: 'NO_EXTRACTOR' };
    }

    setStatus('Capturando...');
    busy = true;

    try {
      const settingsForExtract = await getSettings();
      const res = await extractor.extractActiveContact({ knownSources: settingsForExtract.knownSources });
      if (res.error === 'NO_CHAT_OPEN') { toast('Abra uma conversa primeiro', 'info'); return { ok: false, error: res.error }; }
      if (res.error === 'GROUP_CHAT')   { toast('Chat de grupo — abra individual', 'info'); return { ok: false, error: res.error }; }
      if (res.error || !res.contact)    { toast('Não conseguiu extrair', 'error'); return { ok: false, error: res.error }; }

      const contact = res.contact;
      // Aplica 9º dígito se setting estiver ligada
      const settings = settingsForExtract;
      if (settings.add9thDigit && contact.phone && PU) {
        contact.phone = PU.add9thDigit(contact.phone);
      }
      if (contact.name) contact.name = contact.name.replace(/^~\s*/, '').trim();

      if (!contact.phone) {
        toast('Captura sem telefone — descartada', 'error');
        return { ok: false, error: 'NO_PHONE' };
      }

      const key = PU ? PU.phoneKey(contact.phone) : contact.phone.replace(/\D/g, '');
      if (staged.find(s => s.key === key)) {
        toast('Já está na fila', 'info');
        return { ok: false, error: 'DUP' };
      }

      staged.push({
        name: contact.name || '',
        phone: contact.phone,
        status: '', // Status não é preenchido pela extensão
        source: contact.source || settings.defaultSource || '', // Fonte vinda da etiqueta
        notes: '',
        key,
        selected: true
      });
      await saveStaged();
      renderQueue();
      updateBadge();

      // Auto-send se a setting estiver ligada
      if (settings.autoSendOnCapture || opts.quick) {
        await sendByKeys([key]);
      } else {
        toast(`+ ${contact.name || contact.phone}`, 'success');
      }
      return { ok: true, contact };
    } catch (err) {
      log.error('captureCurrent failed', err);
      toast('Erro: ' + err.message, 'error');
      return { ok: false, error: err.message };
    } finally {
      busy = false;
      setStatus('Pronto');
    }
  }

  // ============================================================
  // Queue
  // ============================================================
  function renderQueue() {
    const list = document.getElementById('memude-queue');
    const countEl = document.getElementById('memude-queue-count');
    if (!list) return;
    countEl.textContent = staged.length;
    if (!staged.length) {
      list.innerHTML = '<div class="memude-empty">Nenhum lead na fila.<br>Abra um chat individual e clique em capturar.</div>';
      return;
    }
    list.innerHTML = staged.map((c, i) => `
      <div class="memude-contact-item">
        <label class="memude-contact-label">
          <input type="checkbox" class="memude-checkbox" data-i="${i}" ${c.selected ? 'checked' : ''}>
          <div class="memude-contact-info">
            <span class="memude-contact-name">${escapeHtml(c.name || '(sem nome)')}</span>
            <span class="memude-contact-phone">${escapeHtml(c.phone)}</span>
          </div>
          <span class="memude-contact-source">${escapeHtml(c.source || '')}</span>
        </label>
      </div>
    `).join('');
    list.querySelectorAll('.memude-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const i = parseInt(e.target.dataset.i, 10);
        staged[i].selected = e.target.checked;
        saveStaged();
      });
    });
  }

  function selectAll() {
    staged.forEach(s => { s.selected = true; });
    saveStaged();
    renderQueue();
  }

  function clearQueue() {
    if (!staged.length) return;
    if (!confirm('Limpar a fila? Os contatos não enviados serão perdidos.')) return;
    staged = [];
    saveStaged();
    renderQueue();
    updateBadge();
  }

  async function sendSelected() {
    const selected = staged.filter(s => s.selected);
    if (!selected.length) {
      toast('Nada selecionado', 'info');
      return;
    }
    await sendByKeys(selected.map(s => s.key));
  }

  async function sendByKeys(keys) {
    if (busy) return;
    busy = true;
    showProgress(20, `Enviando ${keys.length}...`);
    try {
      const contacts = staged.filter(s => keys.includes(s.key)).map(s => ({
        name: s.name, phone: s.phone, status: s.status, source: s.source, notes: s.notes
      }));
      const resp = await chrome.runtime.sendMessage({ action: 'EXPORT_TO_SHEETS', data: { contacts } });
      if (!resp) throw new Error('Sem resposta da extensão');
      if (resp.code === 'NEEDS_AUTH') {
        toast('Conecte sua conta Google na extensão', 'error');
        showProgress(0, '');
        return;
      }
      if (!resp.success) throw new Error(resp.error || 'Falha');

      // Remove enviados da fila
      staged = staged.filter(s => !keys.includes(s.key));
      await saveStaged();
      renderQueue();
      updateBadge();

      const exported = resp.exported || 0;
      const dup = resp.duplicated || 0;
      let msg = `${exported} enviado(s)`;
      if (dup > 0) msg += ` · ${dup} duplicado(s)`;
      showProgress(100, msg + ' ✓');
      toast(msg, exported > 0 ? 'success' : 'info');
      pollDailyCount();
      setTimeout(() => showProgress(0, ''), 2500);
    } catch (err) {
      log.error('send failed', err);
      showProgress(100, 'Erro: ' + err.message);
      toast('Erro: ' + err.message, 'error');
      setTimeout(() => showProgress(0, ''), 3500);
    } finally {
      busy = false;
    }
  }

  function updateBadge() {
    const b = document.getElementById('memude-badge');
    if (!b) return;
    if (staged.length > 0) {
      b.textContent = staged.length;
      b.classList.remove('hidden');
    } else {
      b.classList.add('hidden');
    }
  }

  // ============================================================
  // Storage / Settings
  // ============================================================
  function loadStaged() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STAGE_KEY, (data) => {
        const raw = Array.isArray(data[STAGE_KEY]) ? data[STAGE_KEY] : [];
        // Sanitiza: entradas antigas podem não ter `key` — recalcula
        staged = raw.filter(c => c && c.phone).map(c => ({
          name: c.name || '',
          phone: c.phone,
          status: c.status || '',
          source: c.source || '',
          notes: c.notes || '',
          key: c.key || (PU ? PU.phoneKey(c.phone) : c.phone.replace(/\D/g, '')),
          selected: c.selected !== false
        }));
        resolve();
      });
    });
  }
  function saveStaged() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STAGE_KEY]: staged }, resolve);
    });
  }
  async function getSettings() {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    return (resp && resp.settings) || {};
  }

  // ============================================================
  // UI helpers
  // ============================================================
  function setStatus(text) {
    const el = document.getElementById('memude-status-text');
    if (el) el.textContent = text;
  }
  function showProgress(pct, text) {
    const c = document.getElementById('memude-progress');
    const fill = document.getElementById('memude-progress-fill');
    const txt = document.getElementById('memude-progress-text');
    if (!c) return;
    if (pct <= 0) { c.classList.add('hidden'); return; }
    c.classList.remove('hidden');
    fill.style.width = pct + '%';
    txt.textContent = text;
  }
  async function pollDailyCount() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_DAILY_COUNT' });
      const el = document.getElementById('memude-daily');
      if (el && resp && resp.success) el.textContent = `Hoje: ${resp.count}`;
    } catch (e) { /* ignore */ }
  }

  function toast(msg, type = 'info') {
    // Toast minimalista in-place na status line
    setStatus(msg);
    setTimeout(() => setStatus('Pronto'), 2500);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ============================================================
  // Boot: aguarda o WhatsApp ficar pronto
  // ============================================================
  function waitForWhatsApp() {
    const tries = setInterval(() => {
      if (document.querySelector('#app') && document.body) {
        clearInterval(tries);
        mount();
      }
    }, 800);
    setTimeout(() => clearInterval(tries), 30000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    waitForWhatsApp();
  } else {
    document.addEventListener('DOMContentLoaded', waitForWhatsApp);
  }
})();
