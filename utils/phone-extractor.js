/* ============================================================
   MeMude - Phone Extractor Module
   Extracts contact data from the ACTIVE CHAT in WhatsApp Web
   
   Handles ALL scenarios:
   A) Contact NOT saved → header shows phone number directly
   B) Contact IS saved → header shows name, phone via drawer/DOM
   C) WhatsApp Business → header shows business name, phone via drawer/DOM
   ============================================================ */

(function () {
  'use strict';

  // Shared utilities
  const log = (typeof Logger !== 'undefined')
    ? Logger
    : { debug() {}, info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
  const PU = (typeof PhoneUtils !== 'undefined') ? PhoneUtils : null;

  const JID_REGEX = /(\d{10,15})@(c\.us|s\.whatsapp\.net)/g;
  // Padrão mais restritivo: exige um '+' OU pelo menos 11 dígitos (BR completo)
  // para reduzir falso positivo de números no corpo de mensagens.
  const PHONE_PATTERN = /\+\d{1,4}[\s\-.]?\(?\d{2,4}\)?[\s\-.]?\d{4,5}[\s\-.]?\d{4}|\b\d{11,13}\b/;

  // ---- JID Cache ----
  const jidCache = new Map();
  let interceptorActive = false;

  // ============================================================
  // Network Interception
  // ============================================================
  function startNetworkInterceptor() {
    if (interceptorActive) return;
    interceptorActive = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        response.clone().text().then(t => scanForJids(t)).catch(() => {});
      } catch (e) {}
      return response;
    };

    const origXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try { if (this.responseText) scanForJids(this.responseText); } catch (e) {}
      });
      return origXhrSend.apply(this, args);
    };

    try {
      const OrigWS = window.WebSocket;
      window.WebSocket = function (...args) {
        const ws = new OrigWS(...args);
        ws.addEventListener('message', e => {
          try { if (typeof e.data === 'string') scanForJids(e.data); } catch (ex) {}
        });
        return ws;
      };
      window.WebSocket.prototype = OrigWS.prototype;
      Object.assign(window.WebSocket, {
        CONNECTING: OrigWS.CONNECTING, OPEN: OrigWS.OPEN,
        CLOSING: OrigWS.CLOSING, CLOSED: OrigWS.CLOSED
      });
    } catch (e) {}

    log.debug('Network interceptor active');
  }

  function scanForJids(text) {
    if (!text || text.length < 10) return;
    JID_REGEX.lastIndex = 0;
    let m;
    while ((m = JID_REGEX.exec(text)) !== null) {
      jidCache.set(m[0], m[1]);
    }
  }

  // ============================================================
  // Helpers — delegam para PhoneUtils quando disponível
  // ============================================================
  const looksLikePhone = (s) => PU ? PU.looksLikePhone(s) : !!s && /^\d{8,15}$/.test(String(s).replace(/[\s\-()\.\+]/g, ''));
  const normalizePhone = (s) => PU ? PU.normalizePhone(s) : String(s || '');
  const add9thDigit    = (s) => PU ? PU.add9thDigit(s)    : s;

  /**
   * Check if a string is a known WhatsApp UI text (not a real name).
   */
  function isWhatsAppUIText(text) {
    if (!text) return true;
    const t = text.toLowerCase().trim();
    const uiPatterns = [
      'clique para mostrar',
      'clique aqui',
      'click here',
      'click to show',
      'adicione notas',
      'add notes',
      'digite uma mensagem',
      'type a message',
      'pesquisar',
      'search',
      'silenciar notificações',
      'mute notifications',
      'mensagens temporárias',
      'disappearing messages',
      'mensagens fixadas',
      'pinned messages',
      'mídia, links e docs',
      'media, links and docs',
      'criptografia',
      'encryption',
      'denunciar',
      'report',
      'bloquear',
      'block',
      'sair do grupo',
      'exit group',
      'sobre e número de telefone',
      'about and phone number',
      'configurações',
      'settings',
      'novo grupo',
      'new group',
      'comunidade',
      'community',
      'mensagem',
      'message',
      'sem mensagens',
      'no messages',
      'status',
      'online',
      'digitando',
      'typing',
      'visto por último',
      'last seen',
      'gravando',
      'recording',
      'whatsapp business',
      'conta comercial',
      'business account',
      'catálogo',
      'catalog'
    ];
    return uiPatterns.some(pattern => t.startsWith(pattern) || t === pattern);
  }

  function isChatOpen() {
    const main = document.querySelector('#main');
    if (main && main.querySelector('header')) return true;
    if (document.querySelector('footer [contenteditable="true"]')) return true;
    if (document.querySelector('[data-testid="conversation-panel-wrapper"]')) return true;
    return false;
  }

  function isGroupChat() {
    // Indicadores explícitos (legacy testids + aria-label atual)
    if (document.querySelector('[data-icon="default-group"], [data-testid="default-group"], [data-testid="group-title"], [data-testid="group-subject-input"]')) {
      return true;
    }

    const main = document.querySelector('#main');
    if (!main) return false;
    const header = main.querySelector('header');
    if (!header) return false;

    // Em alguns layouts atuais, o header de grupo lista participantes em
    // span[dir="auto"]: "Maria, João, Pedro" ou "5 participantes".
    const spans = header.querySelectorAll('span[dir="auto"], span[title]');
    let foundFirst = false;
    for (const span of spans) {
      const text = (span.getAttribute('title') || span.textContent || '').trim();
      if (!text) continue;
      if (!foundFirst) { foundFirst = true; continue; }
      if (text.includes(',') && text.split(',').length >= 3) return true;
      if (/\d+\s*(participante|membro|member|participant|integrante)/i.test(text)) return true;
    }

    // Botão "Adicionar participante" aparece só em grupos
    if (header.querySelector('[aria-label*="participante" i], [aria-label*="participant" i]')) {
      return true;
    }
    return false;
  }

  // ============================================================
  // Wait helpers
  // ============================================================
  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForElement(selector, parent, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const el = parent.querySelector(selector);
      if (el) { resolve(el); return; }

      const observer = new MutationObserver(() => {
        const found = parent.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(parent, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(parent.querySelector(selector));
      }, timeoutMs);
    });
  }

  // ============================================================
  // Find the right-side panel / drawer (works for all scenarios)
  // Cobre testids legados + aria-label atual (PT/EN/ES).
  // ============================================================
  function findDrawer() {
    const candidates = [
      '[data-testid="contact-info-drawer"]',
      'section[data-testid="contact-info"]',
      '[data-animate-drawer-open="true"]',
      '[data-testid="panel-right"]',
      'aside[aria-label*="contato" i]',
      'aside[aria-label*="contact" i]',
      'div[role="region"][aria-label*="contato" i]',
      'div[role="region"][aria-label*="contact" i]',
      'span[role="region"][aria-label*="contato" i]',
      '#app aside section',
      '#app aside'
    ];
    for (const sel of candidates) {
      // Nunca confundir o painel da própria extensão com o menu do contato do WhatsApp.
      const el = [...document.querySelectorAll(sel)].find((e) => !e.closest('#mmc-app, #memude-overlay'));
      if (el) return el;
    }
    return null;
  }

  // ============================================================
  // Open the drawer by clicking the header
  // ============================================================
  async function openDrawer(header) {
    const clickTarget =
         header.querySelector('[data-testid="conversation-header-contact-info"]')
      || header.querySelector('[aria-label*="Dados do contato" i]')
      || header.querySelector('[aria-label*="Informações do contato" i]')
      || header.querySelector('[aria-label*="Contact info" i]')
      || header.querySelector('[aria-label*="Datos del contacto" i]')
      || header.querySelector('div[role="button"]')
      || header.querySelector('[role="button"]')
      || header.querySelector('div[tabindex="-1"]')
      || header.querySelector('span[title]')?.closest('[role="button"]')
      || header;

    log.debug('Clicking header to open contact drawer...');
    clickTarget.click();

    // Wait slightly for animation to start
    await waitMs(300);

    let drawer = findDrawer();
    if (!drawer) {
      // Retry with a MutationObserver — só dentro do WhatsApp (#app), nunca no painel da extensão
      const app = document.getElementById('app') || document.body;
      drawer = await waitForElement(
        '[data-testid="contact-info-drawer"], [data-testid="panel-right"], aside, section',
        app,
        4000
      );
    }

    if (drawer) {
      // Wait extra for drawer content to fully render
      // Business profiles load additional sections asynchronously
      await waitMs(800);
      log.debug('Drawer opened and content loaded');
    }

    return drawer;
  }

  // ============================================================
  // MAIN EXTRACTION (async)
  // Ordem:
  //   1) JID das mensagens (mais confiável, sem abrir drawer)
  //   2) Header → nome e/ou telefone
  //   3) Data-attrs do #main / DOM scan / cache (fallbacks p/ telefone)
  //   4) Drawer só quando ainda faltar algo (lento por causa do click)
  // ============================================================
  // Fontes reconhecidas por padrão quando o caller não passa uma lista.
  // NÃO inclui "WhatsApp" de propósito (a página inteira casaria).
  const DEFAULT_SOURCES = ['Google', 'Facebook', 'Instagram', 'Indicação', 'Site', 'OLX', 'Tráfego', 'Orgânico'];

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Lê a etiqueta (Fonte) da conversa aberta. Procura os nomes conhecidos
   * dentro do header do chat, da linha selecionada na lista e de elementos
   * marcados como etiqueta. Retorna o primeiro que casar (canônico) ou ''.
   * @param {string[]} knownSources
   * @returns {string}
   */
  function extractLabel(knownSources) {
    const sources = (Array.isArray(knownSources) && knownSources.length) ? knownSources : DEFAULT_SOURCES;

    const scopes = [];
    const header = document.querySelector('#main header');
    if (header) scopes.push(header);

    // Linha selecionada na lista de conversas (etiqueta costuma aparecer aqui).
    const selRow = document.querySelector('#pane-side [aria-selected="true"], #pane-side [role="row"][tabindex="0"]');
    if (selRow) scopes.push(selRow);

    // Elementos explicitamente marcados como etiqueta/label.
    document.querySelectorAll('[aria-label*="etiqueta" i], [aria-label*="label" i], [data-testid*="label" i]')
      .forEach(el => scopes.push(el));

    const text = scopes.map(s => s.textContent || '').join('\n');

    for (const src of sources) {
      const re = new RegExp('\\b' + escapeRegex(src) + '\\b', 'i');
      if (re.test(text)) {
        log.debug(`Label/Fonte detectada: "${src}"`);
        return src;
      }
    }
    log.debug('Nenhuma etiqueta de Fonte encontrada');
    return '';
  }

  async function extractActiveContact(opts = {}) {
    log.debug('=== Starting extraction ===');

    if (!isChatOpen()) return { error: 'NO_CHAT_OPEN', contact: null };
    if (isGroupChat()) return { error: 'GROUP_CHAT', contact: null };

    let name = '';
    let phone = '';

    const main = document.querySelector('#main');
    const header = main ? main.querySelector('header') : null;

    // --- 1) JID das mensagens (rápido e estável) ---
    phone = getPhoneFromMessageJids();

    // --- 2) Header: extrai nome e/ou telefone ---
    if (header) {
      const headerInfo = readHeader(header);
      if (headerInfo.name) name = headerInfo.name;
      if (!phone && headerInfo.phone) phone = headerInfo.phone;
    }

    // --- 3) Fallbacks de telefone (não abre drawer) ---
    if (!phone) phone = getPhoneFromConversationAttributes();
    if (!phone) phone = getPhoneFromFullDomScan();
    if (!phone && jidCache.size > 0) {
      const entries = Array.from(jidCache.entries());
      phone = normalizePhone(entries[entries.length - 1][1]);
      log.debug(`Phone from JID cache (last entry): ${phone}`);
    }

    // --- 4) Drawer: usado só se faltar telefone OU se temos só o telefone
    //                e queremos descobrir o nome ---
    // opts.semGaveta: leitura rápida (troca de conversa) sem abrir o painel de dados do contato
    if (header && !opts.semGaveta && (!phone || !name)) {
      const drawer = await ensureDrawer(header);
      if (drawer) {
        if (!phone) {
          const p = extractPhoneFromDrawerContent(drawer);
          if (p) phone = p;
        }
        if (!name) {
          const n = extractNameFromDrawerContent(drawer);
          if (n) name = n;
        }
        // se nós abrimos, fechamos
        if (drawer.__memudeOpenedByUs) closeDrawer(drawer);
      }
    }

    // --- 5) Último recurso: regex no texto do header (escopo bounded) ---
    if (!phone && header) {
      const match = (header.textContent || '').match(PHONE_PATTERN);
      if (match) {
        const candidate = normalizePhone(match[0]);
        if (looksLikePhone(candidate)) {
          phone = candidate;
          log.debug(`Phone via header regex: ${phone}`);
        }
      }
    }

    // CLEANUP
    if (name) name = name.replace(/^~\s*/, '').trim();

    // Fonte a partir da etiqueta da conversa
    const source = extractLabel(opts.knownSources);

    log.debug(`=== Result: name="${name}", phone="${phone}", source="${source}" ===`);

    if (phone || name) {
      return { error: null, contact: { name: name || '', phone: phone || '', source: source || '' } };
    }
    return { error: 'EXTRACTION_FAILED', contact: null };
  }

  /**
   * Lê o header e extrai (nome, telefone) sem abrir o drawer.
   */
  function readHeader(header) {
    let name = '', phone = '';
    const cand = [
      ...header.querySelectorAll('span[title]'),
      ...header.querySelectorAll('span[dir="auto"]')
    ];
    for (const span of cand) {
      const val = (span.getAttribute('title') || span.textContent || '').trim();
      if (!val || val.length < 2) continue;
      if (looksLikePhone(val)) {
        if (!phone) phone = normalizePhone(val);
      } else if (!isWhatsAppUIText(val) && val.length < 80) {
        if (!name) name = val;
      }
      if (name && phone) break;
    }
    return { name, phone };
  }

  /**
   * Garante um drawer aberto. Marca quando abrimos para fechar depois.
   */
  async function ensureDrawer(header) {
    let drawer = findDrawer();
    if (drawer) {
      await waitMs(300);
      return drawer;
    }
    drawer = await openDrawer(header);
    if (drawer) drawer.__memudeOpenedByUs = true;
    return drawer;
  }

  /**
   * Procura um nome dentro do drawer já aberto.
   */
  function extractNameFromDrawerContent(drawer) {
    const nameSelectors = [
      '[data-testid="contact-info-subtitle"]',
      '[data-testid="section-about"] span[dir="auto"]',
      '[data-testid="business-profile-name"]',
      'header span[dir="auto"]',
      'h2 span[dir="auto"]'
    ];
    for (const sel of nameSelectors) {
      const el = drawer.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text && text.length > 1 && text.length < 80 && !looksLikePhone(text) && !isWhatsAppUIText(text)) {
          return text;
        }
      }
    }
    const spans = drawer.querySelectorAll('span[dir="auto"]');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (!text || text.length < 2 || text.length > 80) continue;
      if (looksLikePhone(text)) continue;
      if (isWhatsAppUIText(text)) continue;
      return text;
    }
    return '';
  }

  // ============================================================
  // Strategy 2A: Get phone from message row data-id attributes
  // This is the MOST RELIABLE method for ALL account types
  // because every message row in WhatsApp Web has a data-id
  // like "true_5511999999999@c.us_..." or "false_55..."
  // ============================================================
  function getPhoneFromMessageJids() {
    const main = document.querySelector('#main');
    if (!main) return '';

    // All message rows have data-id containing the JID
    const msgRows = main.querySelectorAll('[data-id]');
    const jidCount = new Map();

    for (const el of msgRows) {
      const dataId = el.getAttribute('data-id') || '';
      JID_REGEX.lastIndex = 0;
      const match = JID_REGEX.exec(dataId);
      if (match) {
        const num = match[1];
        jidCount.set(num, (jidCount.get(num) || 0) + 1);
      }
    }

    if (jidCount.size === 0) {
      log.debug('No JIDs found in message data-id attributes');
      return '';
    }

    // If there's only one JID, use it directly
    if (jidCount.size === 1) {
      const num = jidCount.keys().next().value;
      const phone = normalizePhone(num);
      log.debug(`Found phone from message JIDs (single): ${phone}`);
      return phone;
    }

    // Multiple JIDs — the contact's JID appears in "false_" prefixed messages
    // (incoming messages) while "true_" are our own
    let contactPhone = '';
    for (const el of msgRows) {
      const dataId = el.getAttribute('data-id') || '';
      if (dataId.startsWith('false_')) {
        JID_REGEX.lastIndex = 0;
        const match = JID_REGEX.exec(dataId);
        if (match) {
          contactPhone = normalizePhone(match[1]);
          log.debug(`Found phone from incoming message JID: ${contactPhone}`);
          return contactPhone;
        }
      }
    }

    // Fallback: most frequent JID (excluding our own number)
    let maxCount = 0;
    let mostFrequent = '';
    for (const [num, count] of jidCount) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = num;
      }
    }
    if (mostFrequent) {
      const phone = normalizePhone(mostFrequent);
      log.debug(`Found phone from message JIDs (most frequent): ${phone}`);
      return phone;
    }

    return '';
  }

  // ============================================================
  // Extract phone from drawer content
  // Handles personal contacts, business, and all variants
  // ============================================================
  function extractPhoneFromDrawerContent(drawer) {
    if (!drawer) return '';

    // 1. Specific phone data-testid selectors
    const phoneSelectors = [
      '[data-testid="chat-info-phone-number"]',
      '[data-testid="contact-info-phone-number"]',
      '[data-testid="chat-info-drawer-phone"]',
      '[data-testid="business-phone"]',
      '[data-testid="section-phone"] span',
      '[data-testid="phone-number"]'
    ];

    for (const sel of phoneSelectors) {
      const el = drawer.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (looksLikePhone(text)) {
          log.debug(`Found phone via drawer selector ${sel}: ${text}`);
          return normalizePhone(text);
        }
      }
    }

    // 2. Spans with title attribute containing phone
    const titledSpans = drawer.querySelectorAll('span[title]');
    for (const span of titledSpans) {
      const title = span.getAttribute('title');
      if (title && looksLikePhone(title)) {
        log.debug(`Found phone in drawer span[title]: ${title}`);
        return normalizePhone(title);
      }
    }

    // 3. Spans with dir="ltr" (phone numbers are LTR)
    const ltrSpans = drawer.querySelectorAll('span[dir="ltr"]');
    for (const span of ltrSpans) {
      const text = span.textContent.trim();
      if (looksLikePhone(text)) {
        log.debug(`Found phone in drawer span[dir=ltr]: ${text}`);
        return normalizePhone(text);
      }
    }

    // 4. Spans with dir="auto" containing phone
    const autoSpans = drawer.querySelectorAll('span[dir="auto"]');
    for (const span of autoSpans) {
      const text = span.textContent.trim();
      if (looksLikePhone(text)) {
        log.debug(`Found phone in drawer span[dir=auto]: ${text}`);
        return normalizePhone(text);
      }
    }

    // 5. Search in copyable-area elements (business profiles may use these)
    const copyableAreas = drawer.querySelectorAll('[data-testid="copyable-area"], [copyable-area], .copyable-area, [role="button"]');
    for (const area of copyableAreas) {
      const text = area.textContent.trim();
      if (looksLikePhone(text)) {
        log.debug(`Found phone in drawer copyable area: ${text}`);
        return normalizePhone(text);
      }
    }

    // 6. Look for sections that mention "telefone", "phone", "número"
    const allSections = drawer.querySelectorAll('div, section');
    for (const section of allSections) {
      const sectionText = section.textContent || '';
      // Check if this section contains phone-related labels
      if (/(?:telefone|phone|número|celular|whatsapp)/i.test(sectionText)) {
        // Now scan children of this section specifically
        const innerSpans = section.querySelectorAll('span');
        for (const span of innerSpans) {
          const text = span.textContent.trim();
          if (looksLikePhone(text)) {
            log.debug(`Found phone in labeled section: ${text}`);
            return normalizePhone(text);
          }
        }
      }
    }

    // 7. Check data attributes for JIDs within drawer
    //    (regex no textContent inteiro foi removida — pegava "número" da bio/about)
    const jidEls = drawer.querySelectorAll('*');
    for (const el of jidEls) {
      for (const attr of el.attributes) {
        if (attr.value && attr.value.length > 10) {
          JID_REGEX.lastIndex = 0;
          const match = JID_REGEX.exec(attr.value);
          if (match) {
            const phone = normalizePhone(match[1]);
            log.debug(`Found phone in drawer attr [${attr.name}]: ${phone}`);
            return phone;
          }
        }
      }
    }

    log.debug('No phone found in drawer content');
    return '';
  }

  // ============================================================
  // Close the contact details drawer
  // ============================================================
  function closeDrawer(drawer) {
    try {
      const closeBtn = drawer.querySelector('[data-testid="btn-closer-drawer"]')
                    || drawer.querySelector('[data-testid="back"]')
                    || drawer.querySelector('[data-testid="x-viewer"]')
                    || drawer.querySelector('[data-icon="x"]')
                    || drawer.querySelector('[data-icon="x-viewer"]')
                    || drawer.querySelector('button[aria-label="Close"]')
                    || drawer.querySelector('button[aria-label="Fechar"]')
                    || drawer.querySelector('header button')
                    || drawer.querySelector('header [role="button"]')
                    || drawer.querySelector('[data-testid="back-btn"]');

      if (closeBtn) {
        log.debug('Closing drawer...');
        closeBtn.click();
      } else {
        log.debug('No close button found, pressing Escape...');
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
        }));
      }
    } catch (err) {
      log.error('Error closing drawer:', err);
    }
  }

  // ============================================================
  // Phone search: conversation panel data attributes
  // ============================================================
  function getPhoneFromConversationAttributes() {
    const main = document.querySelector('#main');
    if (!main) return '';

    const allEls = main.querySelectorAll('[data-id], [data-jid], [data-peer]');
    for (const el of allEls) {
      for (const attr of el.attributes) {
        if (attr.value) {
          JID_REGEX.lastIndex = 0;
          const match = JID_REGEX.exec(attr.value);
          if (match) {
            const phone = normalizePhone(match[1]);
            log.debug(`Found phone in data attribute [${attr.name}]: ${phone}`);
            return phone;
          }
        }
      }
    }
    return '';
  }

  // ============================================================
  // Full DOM scan: scan ALL attributes in #main for JIDs
  // Last resort before JID cache
  // ============================================================
  function getPhoneFromFullDomScan() {
    const main = document.querySelector('#main');
    if (!main) return '';

    // Get the entire HTML of #main and regex for JIDs.
    // Guard de tamanho: chats gigantescos podem chegar a vários MB
    // de innerHTML. Pulamos esse fallback nesse caso (estratégias
    // anteriores cobrem o caso comum).
    const mainHtml = main.innerHTML || '';
    if (mainHtml.length > 500_000) {
      log.debug('Full DOM scan skipped (innerHTML > 500KB)');
      return '';
    }
    JID_REGEX.lastIndex = 0;
    
    const jidCount = new Map();
    let m;
    while ((m = JID_REGEX.exec(mainHtml)) !== null) {
      const num = m[1];
      jidCount.set(num, (jidCount.get(num) || 0) + 1);
    }

    if (jidCount.size === 0) return '';

    // If only one JID, that's our contact
    if (jidCount.size === 1) {
      const num = jidCount.keys().next().value;
      const phone = normalizePhone(num);
      log.debug(`Found phone from full DOM scan (single JID): ${phone}`);
      return phone;
    }

    // Multiple: pick most frequent
    let maxCount = 0;
    let mostFrequent = '';
    for (const [num, count] of jidCount) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = num;
      }
    }
    if (mostFrequent) {
      const phone = normalizePhone(mostFrequent);
      log.debug(`Found phone from full DOM scan (most frequent): ${phone}`);
      return phone;
    }

    return '';
  }

  // ============================================================
  // Expose API
  // ============================================================
  window.__MEMUDE_EXTRACTOR = {
    startNetworkInterceptor,
    extractActiveContact,
    extractLabel,
    isChatOpen,
    isGroupChat,
    normalizePhone,
    add9thDigit,
    getJidCacheSize: () => jidCache.size
  };
})();
