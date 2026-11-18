/* ============================================================
   MeMude Connect · Cliente da API da extensão (leads-api)
   Roda no service worker. Renova o login uma vez em caso de 401.
   ============================================================ */
(function (root) {
  'use strict';

  const cfg = () => root.MEMUDE_CONFIG;

  class ErroApi extends Error {
    constructor(mensagem, status, code) { super(mensagem); this.status = status; this.code = code; }
  }

  async function chamar(metodo, query = '', corpo, tentouRenovar = false) {
    const token = await root.MemudeAuth.token(tentouRenovar);
    let r;
    try {
      r = await fetch(`${cfg().API_URL}${query}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, apikey: cfg().ANON_KEY, 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch (e) {
      throw new ErroApi('Sem conexão com o MeMude Connect', 0, 'OFFLINE');
    }
    if (r.status === 401 && !tentouRenovar) return chamar(metodo, query, corpo, true);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new ErroApi('Sua sessão expirou. Entre novamente.', 401, 'NEEDS_LOGIN');
    if (!r.ok && r.status !== 409) throw new ErroApi(j.erro || `Erro ${r.status}`, r.status, r.status >= 500 ? 'SERVIDOR' : 'RECUSADO');
    return { status: r.status, ...j };
  }

  const q = (params) => '?' + new URLSearchParams(params).toString();

  const Api = {
    ErroApi,
    opcoes: () => chamar('GET', q({ recurso: 'opcoes' })),
    resumo: () => chamar('GET', q({ recurso: 'resumo' })),
    buscar: (telefone) => chamar('GET', q({ telefone })),
    corretores: (empreendimento_id, data, hora) => chamar('GET', q({ recurso: 'corretores', empreendimento_id, data, hora })),
    criarLead: (dados) => chamar('POST', '', dados),
    atualizarLead: (dados) => chamar('PATCH', '', dados),
    agendarVisita: (dados) => chamar('POST', q({ recurso: 'visita' }), dados),
    lembrete: (dados) => chamar('POST', q({ recurso: 'lembrete' }), dados),
  };

  root.MemudeApi = Api;
})(globalThis);
