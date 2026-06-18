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
   * Casos:
   *   - +55XX 8XXXXXXX (12 dígitos com +) → +55XX 9 8XXXXXXX (13 dígitos)
   *   - Idem sem +
   *   - Já tem 9 (13 dígitos) → não modifica
   *   - Local 8-dig começa em 9 → mantém conservador (não dobra o 9)
   * @param {string} phone
   * @returns {string} phone com 9 (ou inalterado)
   */
  function add9thDigit(phone) {
    if (!phone) return phone;
    const orig = phone;
    let result = phone;
    let reason = 'no-match';

    // Só adiciona o 9 em CELULAR. Local de 8 dígitos começando em 6/7/8 é
    // celular antigo (sem 9); começando em 2/3/4/5 é telefone fixo — não mexe.
    const isMobileLocal = (local) => /^[6-8]/.test(local);

    // Com +
    let m = phone.match(/^\+55(\d{2})(\d{8})$/);
    if (m) {
      const local = m[2];
      if (local.startsWith('9')) {
        reason = 'local-already-starts-with-9';
      } else if (isMobileLocal(local)) {
        result = `+55${m[1]}9${local}`;
        reason = 'added-with-plus';
      } else {
        reason = 'landline-skip';
      }
    } else {
      // Sem +
      m = phone.match(/^55(\d{2})(\d{8})$/);
      if (m) {
        const local = m[2];
        if (local.startsWith('9')) {
          reason = 'local-already-starts-with-9';
        } else if (isMobileLocal(local)) {
          result = `55${m[1]}9${local}`;
          reason = 'added-no-plus';
        } else {
          reason = 'landline-skip';
        }
      } else if (/^\+?55\d{11}$/.test(phone)) {
        reason = 'already-13-digits';
      }
    }

    // Log opcional para diagnóstico
    if (typeof Logger !== 'undefined' && Logger.isDebug && Logger.isDebug()) {
      Logger.debug(`add9thDigit: "${orig}" → "${result}" [${reason}]`);
    }
    return result;
  }

  /**
   * Formata um telefone BR no padrão da planilha: "+55 (85) 9XXXX-XXXX"
   * (celular) ou "+55 (85) XXXX-XXXX" (fixo). Números fora do padrão BR
   * (outros países / incompletos) são devolvidos como vieram.
   * @param {string} raw
   * @returns {string}
   */
  function formatPhoneBR(raw) {
    if (!raw) return raw;
    const hasPlus = String(raw).trim().startsWith('+');
    const d = String(raw).replace(/\D/g, '');

    const fmt = (local) => local.length === 11           // DDD + 9 + 8 (celular)
      ? `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
      : `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`; // DDD + 8 (fixo)

    // Com código do país 55: formata o que sobra (10 ou 11 dígitos)
    if (d.startsWith('55')) {
      const rest = d.slice(2);
      if (rest.length === 10 || rest.length === 11) return fmt(rest);
      return raw;
    }
    // Sem código de país e sem "+": só assume BR para 10/11 dígitos crus.
    // (Um "+1..." internacional cai fora daqui e é mantido como veio.)
    if (!hasPlus && (d.length === 10 || d.length === 11)) return fmt(d);

    return raw; // não é BR padrão — mantém o que chegou
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
    formatPhoneBR,
    phoneKey
  };

  if (typeof globalThis !== 'undefined') globalThis.PhoneUtils = PhoneUtils;
  if (typeof window !== 'undefined' && !window.PhoneUtils) window.PhoneUtils = PhoneUtils;
})(typeof self !== 'undefined' ? self : this);
