/* ============================================================
   MeMude Connect · Fonte do lead
   Converte a etiqueta da conversa do WhatsApp na Fonte usada pelo
   sistema (Google, Meta, Cadastro, Follow, Outros).
   ============================================================ */
(function (root) {
  'use strict';

  const FONTES = ['Google', 'Meta', 'Cadastro', 'Follow', 'Outros'];

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const MAPA = {
    google: 'Google',
    meta: 'Meta', facebook: 'Meta', instagram: 'Meta', trafego: 'Meta', 'trafego pago': 'Meta',
    cadastro: 'Cadastro', site: 'Cadastro',
    follow: 'Follow', 'follow up': 'Follow', reativacao: 'Follow',
    indicacao: 'Outros', organico: 'Outros', olx: 'Outros', outros: 'Outros',
  };

  /** Etiqueta (ex.: "Facebook") → Fonte do sistema ("Meta"); vazio quando não reconhece. */
  function fonteDaEtiqueta(etiqueta) {
    const n = norm(etiqueta);
    if (!n) return '';
    if (MAPA[n]) return MAPA[n];
    const parcial = Object.keys(MAPA).find((k) => n.includes(k));
    return parcial ? MAPA[parcial] : '';
  }

  root.MemudeFontes = { FONTES, fonteDaEtiqueta };
})(globalThis);
