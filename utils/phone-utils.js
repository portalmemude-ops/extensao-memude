/* ============================================================
   MeMude - Phone Utils (compartilhado)
   Única fonte de verdade para normalização, 9º dígito e chave
   canônica de telefone. Usado por popup, content script e
   service worker.
   ============================================================ */

(function (root) {
  'use strict';

  // Padrão BR razoavelmente estrito: opcional +, dígitos com ou sem
  // separadores comuns; deve casar pelo menos 10 dígitos (DDD+local).
  const PHONE_REGEX_LOOSE = /\+?\d{1,4}[\s\-.]?\(?\d{2,4}\)?[\s\-.]?\d{4,5}[\s\-.]?\d{4}/;

  // Padrão estrito para "isso é só um telefone" (sem texto ao redor)
  const PHONE_REGEX_STRICT = /^\+?[\d\s()\-.]{8,}$/;

  function looksLikePhone(str) {
    if (!str) return false;
    const cleaned = str.replace(/[\s\-()\.\+]/g, '');
    return /^\d{8,15}$/.test(cleaned);
  }

  /**
   * Normaliza para o formato +<digits>. Para números BR sem código
   * de país, assume +55.
   * @param {string} raw
   * @returns {string}
   */
  function normalizePhone(raw) {
    if (!raw) return '';
    let p = String(raw).trim();
    const hasPlus = p.startsWith('+');
    p = p.replace(/\D/g, '');
    if (!p) return '';
    if (hasPlus) return '+' + p;
    if (p.startsWith('55') && (p.length === 12 || p.length === 13)) return '+' + p;
    if (p.length === 10 || p.length === 11) return '+55' + p;
    return p; // sem inferência possível, devolve só os dígitos
  }

  /**
   * Adiciona o 9º dígito em celulares brasileiros que estão sem ele.
   * +55XX8XXXXXXX → +55XX98XXXXXXX
   * @param {string} phone
   * @returns {string}
   */
  function add9thDigit(phone) {
    if (!phone) return phone;
    // Com +
    let m = phone.match(/^\+55(\d{2})(\d{8})$/);
    if (m) {
      const local = m[2];
      if (!local.startsWith('9')) return `+55${m[1]}9${local}`;
      return phone;
    }
    // Sem +
    m = phone.match(/^55(\d{2})(\d{8})$/);
    if (m && !m[2].startsWith('9')) return `55${m[1]}9${m[2]}`;
    return phone;
  }

  /**
   * Chave canônica para comparar duplicados. Colapsa formatações
   * diferentes E o "9º dígito" opcional dos celulares BR.
   * Tanto "+55 85 8532-3726" quanto "+55 85 98532-3726" => mesma chave.
   * @param {string} raw
   * @returns {string}
   */
  function phoneKey(raw) {
    if (!raw) return '';
    let d = String(raw).replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (d.length === 13 && d.startsWith('55')) {
      const ddd = d.substring(2, 4);
      const local = d.substring(4);
      if (local.startsWith('9')) d = '55' + ddd + local.substring(1);
    }
    return d;
  }

  const PhoneUtils = {
    PHONE_REGEX_LOOSE,
    PHONE_REGEX_STRICT,
    looksLikePhone,
    normalizePhone,
    add9thDigit,
    phoneKey
  };

  if (typeof globalThis !== 'undefined') globalThis.PhoneUtils = PhoneUtils;
  if (typeof window !== 'undefined' && !window.PhoneUtils) window.PhoneUtils = PhoneUtils;
})(typeof self !== 'undefined' ? self : this);
