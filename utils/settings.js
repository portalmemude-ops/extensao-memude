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

  // Quando este número muda, os campos de mapeamento de coluna abaixo são
  // reaplicados automaticamente em instalações já existentes (sem perder a
  // URL da planilha nem o login). Veja getSettings().
  const DEFAULTS_VERSION = 2;

  // ⚠️ EDITE AQUI para o padrão da SUA equipe.
  // Mapa de colunas segue o layout da planilha LEADS do MeMude:
  //   A=Data  B=Nome  C=Whatsapp  D=Email  E=Imóvel  F=Fonte  G=Status ...
  const TEAM_DEFAULTS = {
    sheetUrl: '',          // ex.: 'https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit'
    spreadsheetId: '',     // preenchido automaticamente pela sheetUrl
    sheetName: '',         // vazio = aba ativa
    colDate: 'A',          // Data da captura (dd/mm/aaaa)
    colName: 'B',          // Nome
    colPhone: 'C',         // Whatsapp
    colStatus: '',         // Status (G) — vazio de propósito: NÃO é preenchido pela extensão
    colSource: 'F',        // Fonte (vem da etiqueta da conversa)
    colNotes: '',          // Observação — vazio = não grava
    colTimestamp: '',      // Timestamp completo — vazio = não grava
    add9thDigit: true,     // corrige o 9º dígito que o WhatsApp omite no JID
    formatPhone: true,     // grava como "+55 (85) 9XXXX-XXXX"
    // Etiquetas reconhecidas como Fonte. A extensão procura estes nomes na
    // conversa aberta; a primeira que casar vira a Fonte do lead.
    knownSources: ['Google', 'Facebook', 'Instagram', 'Indicação', 'Site', 'OLX', 'Tráfego', 'Orgânico'],
    defaultStatus: 'Novo',
    defaultSource: '',     // fallback quando nenhuma etiqueta é encontrada
    autoSendOnCapture: true,    // F2: captura → envia direto sem confirmar (default ON)
    keepHistory: true,
    historyLimit: 500,
    defaultsVersion: DEFAULTS_VERSION
  };

  // Campos reaplicados na migração de versão (preserva sheetUrl/login/etc.)
  const MIGRATED_FIELDS = [
    'colDate', 'colName', 'colPhone', 'colStatus', 'colSource',
    'add9thDigit', 'formatPhone', 'knownSources', 'defaultsVersion'
  ];

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
        const merged = { ...TEAM_DEFAULTS, ...user };

        // Migração: instalação antiga com mapa de colunas defasado.
        // Reaplica só os campos de mapeamento; mantém URL, login e prefs.
        const hasUser = Object.keys(user).length > 0;
        if (hasUser && user.defaultsVersion !== DEFAULTS_VERSION) {
          for (const f of MIGRATED_FIELDS) merged[f] = TEAM_DEFAULTS[f];
          chrome.storage.sync.set({ [STORAGE_KEY]: merged }, () => resolve(merged));
          return;
        }
        resolve(merged);
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
