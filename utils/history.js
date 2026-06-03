/* ============================================================
   MeMude - History Module
   Histórico local de leads enviados (chrome.storage.local).
   Permite consulta, contagem do dia e limpeza.
   ============================================================ */

(function (root) {
  'use strict';

  const STORAGE_KEY = 'memude_history';
  const DEFAULT_LIMIT = 500;

  function _read() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (data) => resolve(data[STORAGE_KEY] || []));
    });
  }

  function _write(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: items }, resolve);
    });
  }

  /**
   * Adiciona uma entrada no histórico.
   * @param {{name?: string, phone: string, status?: string, source?: string, notes?: string, exported?: boolean, error?: string}} entry
   * @param {number} limit
   */
  async function add(entry, limit = DEFAULT_LIMIT) {
    const items = await _read();
    items.unshift({
      ...entry,
      ts: Date.now()
    });
    if (items.length > limit) items.length = limit;
    await _write(items);
  }

  async function addBulk(entries, limit = DEFAULT_LIMIT) {
    const items = await _read();
    const now = Date.now();
    for (let i = entries.length - 1; i >= 0; i--) {
      items.unshift({ ...entries[i], ts: now });
    }
    if (items.length > limit) items.length = limit;
    await _write(items);
  }

  async function list(limit = 50) {
    const items = await _read();
    return items.slice(0, limit);
  }

  async function dailyCount(date = new Date()) {
    const items = await _read();
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return items.filter(e => e.exported && e.ts >= start).length;
  }

  async function clear() {
    await _write([]);
  }

  /**
   * Lista chaves canônicas de telefone já presentes no histórico,
   * útil para dedup local antes do envio (offline-friendly).
   */
  async function localPhoneKeys() {
    const items = await _read();
    const PU = (typeof PhoneUtils !== 'undefined') ? PhoneUtils : null;
    const set = new Set();
    for (const it of items) {
      if (!it.phone) continue;
      const k = PU ? PU.phoneKey(it.phone) : it.phone.replace(/\D/g, '');
      if (k) set.add(k);
    }
    return set;
  }

  const History = { add, addBulk, list, dailyCount, clear, localPhoneKeys, STORAGE_KEY };

  if (typeof globalThis !== 'undefined') globalThis.History = History;
  if (typeof window !== 'undefined' && !window.History) window.History = History;
})(typeof self !== 'undefined' ? self : this);
