/* ============================================================
   MeMude - Google Sheets API Module
   Handles all interactions with Google Sheets API v4
   ============================================================ */

const SheetsAPI = {
  BASE_URL: 'https://sheets.googleapis.com/v4/spreadsheets',

  /**
   * Parse the spreadsheet ID from a Google Sheets URL
   * @param {string} url - Full Google Sheets URL
   * @returns {string|null} Spreadsheet ID or null
   */
  parseSpreadsheetUrl(url) {
    if (!url) return null;
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  },

  /**
   * Chave canônica de telefone. Delega para PhoneUtils.phoneKey.
   * Mantido como atalho para callers existentes (SheetsAPI.phoneKey).
   */
  phoneKey(raw) {
    return (typeof PhoneUtils !== 'undefined' ? PhoneUtils.phoneKey(raw) : String(raw || '').replace(/\D/g, ''));
  },

  /**
   * Convert column letter to index (A=0, B=1, ..., Z=25, AA=26, etc.)
   * @param {string} col - Column letter(s)
   * @returns {number} Zero-based column index
   */
  colLetterToIndex(col) {
    col = col.toUpperCase();
    let index = 0;
    for (let i = 0; i < col.length; i++) {
      index = index * 26 + (col.charCodeAt(i) - 64);
    }
    return index - 1;
  },

  /**
   * Converte índice 0-based em letra(s) de coluna (0->A, 25->Z, 26->AA).
   */
  _indexToColLetter(idx) {
    if (idx < 0) return 'A';
    let s = '';
    let n = idx;
    while (true) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
      if (n < 0) break;
    }
    return s;
  },

  /**
   * Build the range string for the API request
   * @param {string} sheetName - Sheet tab name
   * @param {string} colName - Column letter for Name
   * @param {string} colPhone - Column letter for Phone
   * @returns {string} Range in A1 notation
   */
  buildRange(sheetName, colName, colPhone) {
    // Determine the leftmost and rightmost columns
    const cols = [colName, colPhone].sort();
    const range = `${cols[0]}:${cols[1]}`;
    return sheetName ? `'${sheetName}'!${range}` : range;
  },

  /**
   * Test connection to a spreadsheet
   * @param {string} spreadsheetId
   * @param {string} token - OAuth access token
   * @returns {Promise<{success: boolean, title?: string, error?: string}>}
   */
  async testConnection(spreadsheetId, token) {
    try {
      const response = await fetch(
        `${this.BASE_URL}/${spreadsheetId}?fields=properties.title`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        const err = await response.json();
        return {
          success: false,
          error: err.error?.message || `HTTP ${response.status}`
        };
      }

      const data = await response.json();
      return {
        success: true,
        title: data.properties?.title || 'Sheet'
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Append contacts as rows to the spreadsheet
   * @param {string} spreadsheetId
   * @param {string} sheetName - Tab name
   * @param {object} cols - mapa de colunas: { name, phone, status?, source?, notes?, timestamp? }
   *                       colunas vazias/null não são gravadas.
   * @param {Array<{name: string, phone: string, status?: string, source?: string, notes?: string, timestamp?: string}>} contacts
   * @param {string} token - OAuth access token
   * @returns {Promise<{success: boolean, exported?: number, errors?: number, error?: string}>}
   */
  async appendContacts(spreadsheetId, sheetName, cols, contacts, token) {
    try {
      // Mapa de campo -> índice da coluna (somente colunas configuradas)
      const fieldIdx = {};
      let maxIdx = -1;
      for (const field of ['name', 'phone', 'status', 'source', 'notes', 'timestamp']) {
        const letter = (cols && cols[field]) ? String(cols[field]).trim() : '';
        if (letter) {
          const idx = this.colLetterToIndex(letter);
          if (idx >= 0) {
            fieldIdx[field] = idx;
            if (idx > maxIdx) maxIdx = idx;
          }
        }
      }
      if (fieldIdx.name === undefined && fieldIdx.phone === undefined) {
        return { success: false, error: 'Configure ao menos a coluna do Nome ou do Telefone' };
      }

      // Constrói as linhas
      const rows = contacts.map(contact => {
        const row = new Array(maxIdx + 1).fill('');
        for (const [field, idx] of Object.entries(fieldIdx)) {
          row[idx] = contact[field] != null ? contact[field] : '';
        }
        return row;
      });

      // Range: do menor letter ao maior. Calcula a partir de fieldIdx.
      const minLetter = this._indexToColLetter(Math.min(...Object.values(fieldIdx)));
      const maxLetter = this._indexToColLetter(maxIdx);
      const range = sheetName ? `'${sheetName}'!${minLetter}:${maxLetter}` : `${minLetter}:${maxLetter}`;

      // API request - append values
      const url = `${this.BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          range: range,
          majorDimension: 'ROWS',
          values: rows
        })
      });

      if (!response.ok) {
        const err = await response.json();
        return {
          success: false,
          error: err.error?.message || `HTTP ${response.status}`,
          exported: 0,
          errors: contacts.length
        };
      }

      const result = await response.json();
      const updatedRows = result.updates?.updatedRows || contacts.length;

      return {
        success: true,
        exported: updatedRows,
        errors: contacts.length - updatedRows
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        exported: 0,
        errors: contacts.length
      };
    }
  },

  /**
   * Read existing data from the spreadsheet to avoid duplicates
   * @param {string} spreadsheetId
   * @param {string} sheetName
   * @param {string} colPhone - Column with phone numbers
   * @param {string} token
   * @returns {Promise<Set<string>>} Set of existing phone numbers
   */
  async getExistingPhones(spreadsheetId, sheetName, colPhone, token) {
    try {
      const range = sheetName ? `'${sheetName}'!${colPhone}:${colPhone}` : `${colPhone}:${colPhone}`;
      const url = `${this.BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        return new Set();
      }

      const data = await response.json();
      const phones = new Set();

      if (data.values) {
        data.values.forEach(row => {
          if (row[0]) {
            // Canonical key: tolerates formatting and the optional 9th digit
            const key = this.phoneKey(row[0]);
            if (key) phones.add(key);
          }
        });
      }

      return phones;
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.error('Error reading existing phones:', err);
      else console.error('[MeMude] Error reading existing phones:', err);
      return new Set();
    }
  }
};

// Make available globally
if (typeof globalThis !== 'undefined') {
  globalThis.SheetsAPI = SheetsAPI;
}
