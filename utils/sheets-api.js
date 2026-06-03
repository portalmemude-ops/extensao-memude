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
   * @param {string} colName - Column letter for Name
   * @param {string} colPhone - Column letter for Phone
   * @param {Array<{name: string, phone: string}>} contacts
   * @param {string} token - OAuth access token
   * @returns {Promise<{success: boolean, exported?: number, errors?: number, error?: string}>}
   */
  async appendContacts(spreadsheetId, sheetName, colName, colPhone, contacts, token) {
    try {
      const nameIdx = this.colLetterToIndex(colName);
      const phoneIdx = this.colLetterToIndex(colPhone);
      const maxIdx = Math.max(nameIdx, phoneIdx);

      // Build rows: each row is an array where name and phone are at the right indices
      const rows = contacts.map(contact => {
        const row = new Array(maxIdx + 1).fill('');
        row[nameIdx] = contact.name || '';
        row[phoneIdx] = contact.phone || '';
        return row;
      });

      // Build range
      const range = this.buildRange(sheetName, colName, colPhone);

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
            // Normalize the phone for comparison
            const phone = row[0].toString().replace(/\D/g, '');
            if (phone) phones.add(phone);
          }
        });
      }

      return phones;
    } catch (err) {
      console.error('[MeMude] Error reading existing phones:', err);
      return new Set();
    }
  }
};

// Make available globally
if (typeof globalThis !== 'undefined') {
  globalThis.SheetsAPI = SheetsAPI;
}
