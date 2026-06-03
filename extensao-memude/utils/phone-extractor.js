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

  const JID_REGEX = /(\d{10,15})@(c\.us|s\.whatsapp\.net)/g;
  const PHONE_PATTERN = /\+?\d{1,4}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{4,5}[\s\-.]?\d{4}/;

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

    console.log('[MeMude] Network interceptor active');
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
  // Helpers
  // ============================================================
  function looksLikePhone(str) {
    if (!str) return false;
    const cleaned = str.replace(/[\s\-\(\)\.\+]/g, '');
    return /^\d{8,15}$/.test(cleaned);
  }

  function normalizePhone(raw) {
    if (!raw) return '';
    let p = raw.trim();
    const hasPlus = p.startsWith('+');
    p = p.replace(/\D/g, '');
    if (hasPlus) p = '+' + p;
    // Brazilian numbers from JIDs come as 55XXXXXXXXXX (12 or 13 digits)
    if (!hasPlus && p.startsWith('55') && (p.length === 12 || p.length === 13)) p = '+' + p;
    // Local BR numbers without country code
    if (!hasPlus && !p.startsWith('+') && (p.length === 10 || p.length === 11)) p = '+55' + p;
    return p;
  }

  /**
   * Add the 9th digit to Brazilian mobile numbers that are missing it.
   * +55XX8XXXXXXX (12 digits after +) → +55XX9 8XXXXXXX (13 digits after +)
   * Only affects numbers starting with +55 where the local part has 8 digits.
   */
  function add9thDigit(phone) {
    if (!phone) return phone;
    // Match +55 + DDD(2) + 8-digit local number (total 12 digits after +)
    const match = phone.match(/^\+55(\d{2})(\d{8})$/);
    if (match) {
      const ddd = match[1];
      const local = match[2];
      // Only add 9 if local number doesn't already start with 9
      if (!local.startsWith('9')) {
        const result = `+55${ddd}9${local}`;
        console.log(`[MeMude] Added 9th digit: ${phone} → ${result}`);
        return result;
      }
    }
    return phone;
  }

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
    const selectors = [
      '#main',
      '[data-testid="conversation-panel-wrapper"]',
      '[data-testid="conversation-compose-box-input"]',
      'footer [contenteditable="true"]'
    ];
    return selectors.some(s => document.querySelector(s));
  }

  function isGroupChat() {
    if (document.querySelector('[data-testid="default-group"]')) return true;
    if (document.querySelector('[data-testid="group-subject-input"]')) return true;

    const main = document.querySelector('#main');
    if (!main) return false;
    const header = main.querySelector('header');
    if (!header) return false;

    const spans = header.querySelectorAll('span[dir="auto"], span[title]');
    let foundFirst = false;
    for (const span of spans) {
      const text = (span.getAttribute('title') || span.textContent || '').trim();
      if (!text) continue;
      if (!foundFirst) { foundFirst = true; continue; }
      if (text.includes(',')) return true;
      if (/\d+\s*(participante|membro|member|participant)/i.test(text)) return true;
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
  // ============================================================
  function findDrawer() {
    return document.querySelector('[data-testid="contact-info-drawer"]')
        || document.querySelector('section[data-testid="contact-info"]')
        || document.querySelector('[data-animate-drawer-open="true"]')
        || document.querySelector('[data-testid="panel-right"]')
        || document.querySelector('#app aside');
  }

  // ============================================================
  // Open the drawer by clicking the header
  // ============================================================
  async function openDrawer(header) {
    const clickTarget = header.querySelector('[data-testid="conversation-header-contact-info"]')
                     || header.querySelector('[role="button"]')
                     || header.querySelector('div[tabindex="-1"]')
                     || header.querySelector('span[title]')?.closest('[role="button"]')
                     || header;

    console.log('[MeMude] Clicking header to open contact drawer...');
    clickTarget.click();

    // Wait for the drawer to appear (business profiles may take longer)
    await waitMs(1200);

    let drawer = findDrawer();
    if (!drawer) {
      // Retry with a MutationObserver
      drawer = await waitForElement(
        '[data-testid="contact-info-drawer"], [data-testid="panel-right"], #app aside, section',
        document.body,
        3000
      );
    }

    if (drawer) {
      // Wait extra for drawer content to fully render
      // Business profiles load additional sections asynchronously
      await waitMs(1500);
      console.log('[MeMude] Drawer opened and content loaded');
    }

    return drawer;
  }

  // ============================================================
  // MAIN EXTRACTION (async)
  // ============================================================
  async function extractActiveContact() {
    console.log('[MeMude] === Starting extraction ===');

    if (!isChatOpen()) {
      console.log('[MeMude] No chat open');
      return { error: 'NO_CHAT_OPEN', contact: null };
    }

    if (isGroupChat()) {
      console.log('[MeMude] Group chat detected');
      return { error: 'GROUP_CHAT', contact: null };
    }

    let name = '';
    let phone = '';

    const main = document.querySelector('#main');
    const header = main ? main.querySelector('header') : null;

    // =====================================================
    // STEP 1: Read the header title
    // =====================================================
    if (header) {
      console.log('[MeMude] Found #main > header');

      const headerSpans = header.querySelectorAll('span[title]');
      for (const span of headerSpans) {
        const titleVal = span.getAttribute('title');
        if (!titleVal || titleVal.length < 2) continue;

        if (looksLikePhone(titleVal)) {
          phone = normalizePhone(titleVal);
          console.log(`[MeMude] Header title is a PHONE: ${phone}`);
        } else if (!isWhatsAppUIText(titleVal)) {
          name = titleVal.trim();
          console.log(`[MeMude] Header title is a NAME: "${name}"`);
        }
        break;
      }

      if (!phone && !name) {
        const autoSpans = header.querySelectorAll('span[dir="auto"]');
        for (const span of autoSpans) {
          const text = span.textContent.trim();
          if (!text || text.length < 2) continue;
          if (looksLikePhone(text)) {
            phone = normalizePhone(text);
            console.log(`[MeMude] Header span[dir=auto] is a PHONE: ${phone}`);
          } else if (!isWhatsAppUIText(text)) {
            name = text;
            console.log(`[MeMude] Header span[dir=auto] is a NAME: "${name}"`);
          }
          break;
        }
      }
    }

    // =====================================================
    // STEP 2: If we have NAME but no PHONE — need to find phone
    // This is the critical path for saved contacts & Business accounts
    // =====================================================
    if (name && !phone) {
      console.log('[MeMude] Have name but no phone. Starting multi-strategy search...');

      // --- Strategy 2A: Message data-id JIDs (MOST RELIABLE, no drawer needed) ---
      phone = getPhoneFromMessageJids();

      // --- Strategy 2B: Data attributes in #main ---
      if (!phone) {
        phone = getPhoneFromConversationAttributes();
      }

      // --- Strategy 2C: Open contact drawer ---
      if (!phone && header) {
        phone = await getPhoneFromContactDrawer(header);
      }

      // --- Strategy 2D: Full DOM scan for any JID in #main ---
      if (!phone) {
        phone = getPhoneFromFullDomScan();
      }

      // --- Strategy 2E: JID cache (last intercepted) ---
      if (!phone && jidCache.size > 0) {
        const entries = Array.from(jidCache.entries());
        const lastPhone = entries[entries.length - 1][1];
        phone = normalizePhone(lastPhone);
        console.log(`[MeMude] Using phone from JID cache (last entry): ${phone}`);
      }

      // --- Strategy 2F: Regex on header text ---
      if (!phone && header) {
        const headerText = header.textContent || '';
        const match = headerText.match(PHONE_PATTERN);
        if (match) {
          phone = normalizePhone(match[0]);
          console.log(`[MeMude] Found phone via header regex: ${phone}`);
        }
      }
    }

    // =====================================================
    // STEP 3: If header was a phone, try to find name
    // =====================================================
    if (phone && !name) {
      const drawerName = await getNameFromContactDrawer(header);
      if (drawerName) {
        name = drawerName;
        console.log(`[MeMude] Got name from drawer: "${name}"`);
      }
    }

    // =====================================================
    // CLEANUP: Strip ~ prefix from pushnames
    // =====================================================
    if (name) {
      name = name.replace(/^~\s*/, '').trim();
    }

    // =====================================================
    // RESULT
    // =====================================================
    console.log(`[MeMude] === Result: name="${name}", phone="${phone}" ===`);

    if (phone) {
      return {
        error: null,
        contact: { name: name || '', phone, source: 'active-chat' }
      };
    }

    if (name) {
      return {
        error: null,
        contact: { name, phone: '', source: 'active-chat' }
      };
    }

    return { error: 'EXTRACTION_FAILED', contact: null };
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
      console.log('[MeMude] No JIDs found in message data-id attributes');
      return '';
    }

    // If there's only one JID, use it directly
    if (jidCount.size === 1) {
      const num = jidCount.keys().next().value;
      const phone = normalizePhone(num);
      console.log(`[MeMude] Found phone from message JIDs (single): ${phone}`);
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
          console.log(`[MeMude] Found phone from incoming message JID: ${contactPhone}`);
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
      console.log(`[MeMude] Found phone from message JIDs (most frequent): ${phone}`);
      return phone;
    }

    return '';
  }

  // ============================================================
  // Get phone by opening the contact details drawer
  // Enhanced for WhatsApp Business profiles
  // ============================================================
  async function getPhoneFromContactDrawer(header) {
    if (!header) return '';

    try {
      let drawer = findDrawer();
      const drawerWasAlreadyOpen = !!drawer;

      if (!drawer) {
        drawer = await openDrawer(header);
      } else {
        // Drawer already open, wait for content
        await waitMs(500);
      }

      if (!drawer) {
        console.log('[MeMude] Contact drawer not found after click');
        return '';
      }

      console.log('[MeMude] Searching for phone in drawer...');

      // Search for phone number inside the drawer
      const phone = extractPhoneFromDrawerContent(drawer);

      // Close the drawer if we opened it
      if (!drawerWasAlreadyOpen) {
        closeDrawer(drawer);
      }

      return phone;
    } catch (err) {
      console.error('[MeMude] Error opening contact drawer:', err);
      return '';
    }
  }

  // ============================================================
  // Get name from the contact details drawer (for unsaved contacts)
  // ============================================================
  async function getNameFromContactDrawer(header) {
    if (!header) return '';

    try {
      let drawer = findDrawer();
      const drawerWasAlreadyOpen = !!drawer;

      if (!drawer) {
        drawer = await openDrawer(header);
      } else {
        await waitMs(500);
      }

      if (!drawer) return '';

      const nameSelectors = [
        '[data-testid="contact-info-subtitle"]',
        '[data-testid="section-about"] span[dir="auto"]',
        '[data-testid="business-profile-name"]'
      ];

      for (const sel of nameSelectors) {
        const el = drawer.querySelector(sel);
        if (el) {
          const text = el.textContent.trim();
          if (text && text.length > 1 && !looksLikePhone(text) && text.length < 60) {
            if (!drawerWasAlreadyOpen) closeDrawer(drawer);
            return text;
          }
        }
      }

      const spans = drawer.querySelectorAll('span[dir="auto"]');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (!text || text.length < 2 || text.length > 60) continue;
        if (looksLikePhone(text)) continue;
        if (isWhatsAppUIText(text)) continue;
        if (!drawerWasAlreadyOpen) closeDrawer(drawer);
        return text;
      }

      if (!drawerWasAlreadyOpen) closeDrawer(drawer);
      return '';
    } catch (err) {
      console.error('[MeMude] Error getting name from drawer:', err);
      return '';
    }
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
          console.log(`[MeMude] Found phone via drawer selector ${sel}: ${text}`);
          return normalizePhone(text);
        }
      }
    }

    // 2. Spans with title attribute containing phone
    const titledSpans = drawer.querySelectorAll('span[title]');
    for (const span of titledSpans) {
      const title = span.getAttribute('title');
      if (title && looksLikePhone(title)) {
        console.log(`[MeMude] Found phone in drawer span[title]: ${title}`);
        return normalizePhone(title);
      }
    }

    // 3. Spans with dir="ltr" (phone numbers are LTR)
    const ltrSpans = drawer.querySelectorAll('span[dir="ltr"]');
    for (const span of ltrSpans) {
      const text = span.textContent.trim();
      if (looksLikePhone(text)) {
        console.log(`[MeMude] Found phone in drawer span[dir=ltr]: ${text}`);
        return normalizePhone(text);
      }
    }

    // 4. Spans with dir="auto" containing phone
    const autoSpans = drawer.querySelectorAll('span[dir="auto"]');
    for (const span of autoSpans) {
      const text = span.textContent.trim();
      if (looksLikePhone(text)) {
        console.log(`[MeMude] Found phone in drawer span[dir=auto]: ${text}`);
        return normalizePhone(text);
      }
    }

    // 5. Search in copyable-area elements (business profiles may use these)
    const copyableAreas = drawer.querySelectorAll('[data-testid="copyable-area"], [copyable-area], .copyable-area, [role="button"]');
    for (const area of copyableAreas) {
      const text = area.textContent.trim();
      if (looksLikePhone(text)) {
        console.log(`[MeMude] Found phone in drawer copyable area: ${text}`);
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
            console.log(`[MeMude] Found phone in labeled section: ${text}`);
            return normalizePhone(text);
          }
        }
      }
    }

    // 7. Regex on entire drawer text
    const allText = drawer.textContent || '';
    const phoneMatch = allText.match(PHONE_PATTERN);
    if (phoneMatch) {
      console.log(`[MeMude] Found phone via drawer regex: ${phoneMatch[0]}`);
      return normalizePhone(phoneMatch[0]);
    }

    // 8. Check data attributes for JIDs within drawer
    const jidEls = drawer.querySelectorAll('*');
    for (const el of jidEls) {
      for (const attr of el.attributes) {
        if (attr.value && attr.value.length > 10) {
          JID_REGEX.lastIndex = 0;
          const match = JID_REGEX.exec(attr.value);
          if (match) {
            const phone = normalizePhone(match[1]);
            console.log(`[MeMude] Found phone in drawer attr [${attr.name}]: ${phone}`);
            return phone;
          }
        }
      }
    }

    console.log('[MeMude] No phone found in drawer content');
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
        console.log('[MeMude] Closing drawer...');
        closeBtn.click();
      } else {
        console.log('[MeMude] No close button found, pressing Escape...');
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
        }));
      }
    } catch (err) {
      console.error('[MeMude] Error closing drawer:', err);
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
            console.log(`[MeMude] Found phone in data attribute [${attr.name}]: ${phone}`);
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

    // Get the entire HTML of #main and regex for JIDs
    const mainHtml = main.innerHTML || '';
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
      console.log(`[MeMude] Found phone from full DOM scan (single JID): ${phone}`);
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
      console.log(`[MeMude] Found phone from full DOM scan (most frequent): ${phone}`);
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
    isChatOpen,
    isGroupChat,
    normalizePhone,
    add9thDigit,
    getJidCacheSize: () => jidCache.size
  };

  startNetworkInterceptor();
})();
