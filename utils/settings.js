/* ============================================================
   MeMude - Settings Module
   Config padrão da equipe + overrides locais por usuário.

   Edite TEAM_DEFAULTS abaixo com a planilha/colunas padrão do seu
   time. Quando alguém instalar a extensão, essa será a config
   inicial. Cada usuário pode personalizar pelo popup, mas pode
   restaurar o padrão da equipe a qualquer momento.
   ============================================================ */

(function (root) {
  'use strict';

  // ⚠️ EDITE AQUI para o padrão da SUA equipe
  const TEAM_DEFAULTS = {
    sheetUrl: '',          // ex.: 'https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit'
    spreadsheetId: '',     // preenchido automaticamente pela sheetUrl
    sheetName: '',         // vazio = aba ativa
    colName: 'A',
    colPhone: 'B',
    colStatus: '',         // ex.: 'C' — vazio = não grava
    colSource: '',         // ex.: 'D'
    colNotes: '',          // ex.: 'E'
    colTimestamp: '',      // ex.: 'F'
    add9thDigit: false,
    defaultStatus: 'Novo',
    defaultSource: 'WhatsApp',
    autoSendOnCapture: true,    // F2: captura → envia direto sem confirmar (default ON)
    keepHistory: true,
    historyLimit: 500
  };

  const STORAGE_KEY = 'memude_settings';

  /**
   * Lê config atual mesclando TEAM_DEFAULTS com o que está em storage.sync.
   * Chaves ausentes no storage caem no default da equipe.
   * @returns {Promise<object>}
   */
  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(STORAGE_KEY, (data) => {
        const user = data[STORAGE_KEY] || {};
        resolve({ ...TEAM_DEFAULTS, ...user });
      });
    });
  }

  function saveSettings(partial) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(STORAGE_KEY, (data) => {
        const merged = { ...TEAM_DEFAULTS, ...(data[STORAGE_KEY] || {}), ...partial };
        chrome.storage.sync.set({ [STORAGE_KEY]: merged }, () => resolve(merged));
      });
    });
  }

  function resetToTeamDefaults() {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: { ...TEAM_DEFAULTS } }, () => resolve({ ...TEAM_DEFAULTS }));
    });
  }

  const Settings = {
    TEAM_DEFAULTS,
    STORAGE_KEY,
    getSettings,
    saveSettings,
    resetToTeamDefaults
  };

  if (typeof globalThis !== 'undefined') globalThis.Settings = Settings;
  if (typeof window !== 'undefined' && !window.Settings) window.Settings = Settings;
})(typeof self !== 'undefined' ? self : this);
