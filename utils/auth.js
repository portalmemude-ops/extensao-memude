/* ============================================================
   MeMude - Auth Module (OAuth por usuário)
   Usa chrome.identity.launchWebAuthFlow com um OAuth client do
   tipo "Aplicativo da Web". Funciona com QUALQUER conta Google,
   independente do login do Chrome.

   O token de acesso (válido ~1h) é guardado em chrome.storage.local.
   Não há refresh token no fluxo implícito: quando expira, o usuário
   reconecta pelo popup.
   ============================================================ */

const AUTH = {
  // OAuth client tipo "Aplicativo da Web" (Google Cloud Console)
  CLIENT_ID: '44849090581-qan2f7bkqdh6vj3l4617fvnlemh0a8cg.apps.googleusercontent.com',
  SCOPES: ['https://www.googleapis.com/auth/spreadsheets'],
  STORAGE_KEY: 'memude_auth',
  // margem de segurança antes da expiração (ms)
  EXPIRY_BUFFER_MS: 2 * 60 * 1000,

  /**
   * Retorna um access token válido.
   * @param {boolean} interactive - se true, abre a tela de login quando necessário
   * @returns {Promise<string>}
   */
  async getToken(interactive = false) {
    const stored = await this._getStored();
    if (stored && stored.accessToken && stored.expiresAt - this.EXPIRY_BUFFER_MS > Date.now()) {
      return stored.accessToken;
    }
    if (!interactive) {
      throw new Error('NOT_AUTHENTICATED');
    }
    return this._interactiveLogin();
  },

  /**
   * Existe um token válido em cache (sem abrir login)?
   * @returns {Promise<boolean>}
   */
  async hasValidToken() {
    const stored = await this._getStored();
    return !!(stored && stored.accessToken && stored.expiresAt - this.EXPIRY_BUFFER_MS > Date.now());
  },

  /**
   * Confirma que o token ainda é válido junto ao Google (não foi
   * revogado nem expirou). Faz uma chamada leve a tokeninfo.
   * Em caso de falha, invalida o cache e devolve false.
   * @returns {Promise<boolean>}
   */
  async validateLive() {
    const stored = await this._getStored();
    if (!stored || !stored.accessToken) return false;
    try {
      const resp = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(stored.accessToken));
      if (!resp.ok) {
        await this.invalidate();
        return false;
      }
      const info = await resp.json();
      // Atualiza expiresAt com o valor autoritativo do Google
      if (info && info.expires_in) {
        const expiresAt = Date.now() + parseInt(info.expires_in, 10) * 1000;
        await this._setStored({ accessToken: stored.accessToken, expiresAt });
      }
      return true;
    } catch (e) {
      // Sem rede: assume válido localmente, não invalida
      return !!(stored.expiresAt - this.EXPIRY_BUFFER_MS > Date.now());
    }
  },

  /**
   * Abre a janela de login do Google e guarda o token.
   * @returns {Promise<string>} access token
   */
  async _interactiveLogin() {
    const redirectUri = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/

    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      '?client_id=' + encodeURIComponent(this.CLIENT_ID) +
      '&response_type=token' +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&scope=' + encodeURIComponent(this.SCOPES.join(' ')) +
      // select_account: o usuário escolhe a conta a cada login (mas
      // o consentimento já dado é lembrado — sem fricção repetida).
      '&prompt=' + encodeURIComponent('select_account');

    const redirectResponse = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!resp) {
          reject(new Error('Login cancelado'));
        } else {
          resolve(resp);
        }
      });
    });

    const tokenMatch = redirectResponse.match(/[#&]access_token=([^&]+)/);
    if (!tokenMatch) {
      const errMatch = redirectResponse.match(/[#&]error=([^&]+)/);
      throw new Error('Falha no login: ' + (errMatch ? decodeURIComponent(errMatch[1]) : 'token não retornado'));
    }

    const accessToken = decodeURIComponent(tokenMatch[1]);
    const expiresMatch = redirectResponse.match(/[#&]expires_in=([^&]+)/);
    const expiresInSec = expiresMatch ? parseInt(expiresMatch[1], 10) : 3600;
    const expiresAt = Date.now() + expiresInSec * 1000;

    await this._setStored({ accessToken, expiresAt });
    return accessToken;
  },

  /**
   * Invalida o token em cache (ex.: após um 401). Não revoga no Google.
   */
  async invalidate() {
    await this._removeStored();
  },

  /**
   * Logout completo: revoga o token no Google e limpa o cache.
   */
  async logout() {
    const stored = await this._getStored();
    if (stored && stored.accessToken) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(stored.accessToken), {
          method: 'POST'
        });
      } catch (e) { /* ignora erro de rede ao revogar */ }
    }
    await this._removeStored();
  },

  // ---- storage helpers ----
  _getStored() {
    return new Promise((resolve) => {
      chrome.storage.local.get(this.STORAGE_KEY, (data) => resolve(data[this.STORAGE_KEY] || null));
    });
  },
  _setStored(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: value }, resolve);
    });
  },
  _removeStored() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(this.STORAGE_KEY, resolve);
    });
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.AUTH = AUTH;
}
