/* ============================================================
   MeMude Connect · Painel no WhatsApp Web
   Ao abrir uma conversa, mostra se o contato já é lead no sistema.
   Se for: ficha com status, visitas, qualificação, anotações, lembretes
   e agendamento. Se não for: cadastro em um clique.
   A extensão nunca envia mensagem sozinha: ela só coloca o texto no
   campo do WhatsApp para o SDR revisar e enviar.
   ============================================================ */
(function () {
  'use strict';

  if (window.__MEMUDE_PAINEL) return;

  const CFG = window.MEMUDE_CONFIG;
  const PU = window.PhoneUtils;
  const FONTES = window.MemudeFontes;
  const log = window.Logger || { debug() {}, info() {}, warn: console.warn, error: console.error };

  const RENDAS = ['Até R$ 3 mil', 'R$ 3 a 5 mil', 'R$ 5 a 8 mil', 'R$ 8 a 12 mil', 'Acima de R$ 12 mil'];
  const ENTRADAS = ['Tem entrada', 'Entrada + FGTS', 'Só FGTS', 'Ainda não tem'];
  const PRAZOS = ['Imediato', 'Até 3 meses', '3 a 6 meses', 'Mais de 6 meses'];
  const FINALIDADES = ['Moradia', 'Investimento'];
  const ROTULO_VISITA = {
    aguardando_corretor: 'Aguardando corretor', agendada: 'Agendada', confirmada: 'Confirmada', realizada: 'Realizada',
    no_show: 'No-show', reagendada: 'Reagendada', cancelada: 'Cancelada',
  };

  const est = {
    sessao: null, opcoes: null, aberto: false, tela: 'contato',
    contato: null, ficha: null, carregando: false, erro: null, mensagem: null,
    corretores: null, buscandoCorretores: false, resumo: null, fila: 0, ultimoCabecalho: null,
  };
  const cacheFicha = new Map(); // chave do telefone → { em, ficha }

  // ============================================================
  // Utilidades
  // ============================================================
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(`#mmc-raiz ${sel}`);
  const iniciais = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
  const diaSemana = (iso) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  const moeda = (v) => (v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : null);
  const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());

  function enviar(acao, dados) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ acao, dados }, (r) => {
          if (chrome.runtime.lastError) return reject(new Error('Extensão atualizada: recarregue o WhatsApp (F5)'));
          if (!r || !r.ok) {
            const e = new Error((r && r.erro) || 'Falha inesperada');
            e.code = r && r.code;
            if (e.code === 'NEEDS_LOGIN') { est.sessao = null; render(); }
            return reject(e);
          }
          resolve(r.dados);
        });
      } catch (e) {
        reject(new Error('Extensão atualizada: recarregue o WhatsApp (F5)'));
      }
    });
  }

  function toast(texto, tipo = 'info') {
    const t = document.createElement('div');
    t.className = `mmc-toast mmc-toast-${tipo}`;
    t.textContent = texto;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('mmc-toast-sai'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  /** Coloca o texto no campo de mensagem do WhatsApp (sem enviar). */
  function inserirNaConversa(texto) {
    const campo = document.querySelector('footer div[contenteditable="true"]')
      || document.querySelector('#main div[contenteditable="true"][role="textbox"]');
    if (!campo) return false;
    campo.focus();
    const linhas = texto.split('\n');
    linhas.forEach((linha, i) => {
      if (i > 0) document.execCommand('insertLineBreak');
      if (linha) document.execCommand('insertText', false, linha);
    });
    return true;
  }

  const empPorNome = (nome) => {
    const n = String(nome || '').trim().toLowerCase();
    return (est.opcoes?.empreendimentos || []).find((e) => e.nome.toLowerCase() === n) || null;
  };
  const empPorId = (id) => (est.opcoes?.empreendimentos || []).find((e) => e.id === id) || null;

  // ============================================================
  // Montagem
  // ============================================================
  function montar() {
    if (document.getElementById('mmc-raiz')) return;
    const raiz = document.createElement('div');
    raiz.id = 'mmc-raiz';
    raiz.innerHTML = `
      <button type="button" class="mmc-fab" id="mmc-fab" title="MeMude Connect (Alt+Shift+M)" aria-label="Abrir painel MeMude Connect">
        <img src="${chrome.runtime.getURL('icons/icon128.png')}" alt="" draggable="false">
        <span class="mmc-fab-ponto" id="mmc-fab-ponto" hidden></span>
      </button>
      <section class="mmc-painel" id="mmc-painel" hidden aria-label="MeMude Connect">
        <header class="mmc-topo">
          <div class="mmc-marca"><img src="${chrome.runtime.getURL('icons/icon48.png')}" alt=""><span>MeMude <b>Connect</b></span></div>
          <div class="mmc-topo-acoes">
            <button type="button" class="mmc-icone" data-acao="atualizar" title="Atualizar">⟳</button>
            <button type="button" class="mmc-icone" data-acao="fechar" title="Fechar (Esc)">✕</button>
          </div>
        </header>
        <div class="mmc-corpo" id="mmc-corpo"></div>
        <footer class="mmc-rodape" id="mmc-rodape"></footer>
      </section>
      <datalist id="mmc-lista-emp"></datalist>`;
    document.body.appendChild(raiz);
    raiz.addEventListener('click', aoClicar);
    raiz.addEventListener('change', aoMudar);
    raiz.addEventListener('submit', aoEnviar);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && est.aberto) fechar(); });
    iniciar();
  }

  async function iniciar() {
    try { est.sessao = await enviar('SESSAO'); } catch (e) { est.sessao = null; }
    if (est.sessao) await carregarOpcoes();
    render();
    setInterval(vigiarConversa, 1200);
    setInterval(atualizarRodape, 60_000);
  }

  async function carregarOpcoes(forcar) {
    try {
      est.opcoes = await enviar('OPCOES', { forcar: !!forcar });
      const lista = document.getElementById('mmc-lista-emp');
      if (lista) lista.innerHTML = est.opcoes.empreendimentos.map((e) => `<option value="${esc(e.nome)}">${esc(e.bairro || '')}</option>`).join('');
    } catch (e) {
      est.erro = e.message;
    }
  }

  function abrir() { est.aberto = true; $('#mmc-painel').hidden = false; render(); atualizarRodape(); }
  function fechar() { est.aberto = false; $('#mmc-painel').hidden = true; }

  // ============================================================
  // Conversa aberta → ficha do lead
  // ============================================================
  function cabecalhoAtual() {
    const h = document.querySelector('#main header');
    return h ? (h.innerText || '').split('\n')[0].trim() : null;
  }

  function vigiarConversa() {
    const atual = cabecalhoAtual();
    if (atual === est.ultimoCabecalho) return;
    est.ultimoCabecalho = atual;
    if (!est.sessao) return;
    identificar(false);
  }

  async function identificar(completo) {
    const ex = window.__MEMUDE_EXTRACTOR;
    est.erro = null; est.mensagem = null; est.corretores = null;
    if (!ex || !ex.isChatOpen()) { est.contato = null; est.ficha = null; est.tela = 'contato'; render(); return; }
    if (ex.isGroupChat()) { est.contato = { grupo: true }; est.ficha = null; render(); return; }
    est.carregando = true; est.tela = 'contato'; render();
    try {
      const r = await ex.extractActiveContact({ knownSources: CFG.ETIQUETAS, semGaveta: !completo });
      const c = r.contact || { name: '', phone: '', source: '' };
      let telefone = c.phone || '';
      if (telefone && PU) telefone = PU.add9thDigit(telefone);
      est.contato = { nome: (c.name || '').replace(/^~\s*/, '').trim(), telefone, etiqueta: c.source || '', fonte: FONTES.fonteDaEtiqueta(c.source) };
      if (!telefone) { est.ficha = null; return; }
      const chave = PU ? PU.phoneKey(telefone) : telefone;
      const cache = cacheFicha.get(chave);
      est.ficha = cache && Date.now() - cache.em < 120_000 ? cache.ficha : await enviar('BUSCAR', { telefone });
      cacheFicha.set(chave, { em: Date.now(), ficha: est.ficha });
    } catch (e) {
      est.erro = e.message;
    } finally {
      est.carregando = false;
      atualizarPonto();
      render();
    }
  }

  function atualizarPonto() {
    const p = document.getElementById('mmc-fab-ponto');
    if (!p) return;
    if (!est.sessao || !est.ficha) { p.hidden = true; return; }
    p.hidden = false;
    p.className = `mmc-fab-ponto ${est.ficha.existe ? 'mmc-ponto-lead' : 'mmc-ponto-novo'}`;
    p.title = est.ficha.existe ? 'Já é lead no Connect' : 'Contato novo: cadastre';
  }

  function guardarFicha(lead, contexto) {
    est.ficha = { ...(est.ficha || {}), existe: true, lead, contexto: contexto ?? est.ficha?.contexto ?? null };
    if (est.contato?.telefone && PU) cacheFicha.set(PU.phoneKey(est.contato.telefone), { em: Date.now(), ficha: est.ficha });
    atualizarPonto();
  }

  // ============================================================
  // Renderização
  // ============================================================
  function render() {
    const corpo = $('#mmc-corpo');
    if (!corpo) return;
    if (!est.sessao) { corpo.innerHTML = telaLogin(); renderRodape(); return; }
    const telas = { contato: telaContato, visita: telaVisita, qualificacao: telaQualificacao, anotar: telaAnotar, mensagem: telaMensagem };
    corpo.innerHTML = (est.erro ? `<div class="mmc-alerta">${esc(est.erro)}</div>` : '') + (telas[est.tela] || telaContato)();
    renderRodape();
  }

  function telaLogin() {
    return `
      <form class="mmc-form" data-form="login">
        <h2 class="mmc-titulo">Entre com sua conta do Connect</h2>
        <p class="mmc-sub">Mesmo e-mail e senha do core.memudecore.com.br. Os leads entram direto no sistema.</p>
        <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
        <label>Senha<input type="password" name="senha" required autocomplete="current-password"></label>
        <button type="submit" class="mmc-btn mmc-btn-primario">Entrar</button>
      </form>`;
  }

  function cartaoContato() {
    const c = est.contato;
    const lead = est.ficha?.lead;
    const nome = lead?.nome || c?.nome || 'Contato sem nome';
    const tel = lead?.telefone_exibicao || est.ficha?.telefone_exibicao || c?.telefone || 'telefone não identificado';
    return `
      <div class="mmc-contato">
        <div class="mmc-avatar">${esc(iniciais(nome))}</div>
        <div class="mmc-contato-info">
          <p class="mmc-nome">${esc(nome)}</p>
          <p class="mmc-tel">${esc(tel)}</p>
        </div>
        ${c?.etiqueta ? `<span class="mmc-etiqueta">${esc(c.etiqueta)}</span>` : ''}
      </div>`;
  }

  function telaContato() {
    if (est.carregando) return `<div class="mmc-carregando"><span></span><span></span><span></span></div>`;
    if (!est.contato) return vazio('Abra uma conversa', 'A ficha do contato aparece aqui sozinha.');
    if (est.contato.grupo) return vazio('Conversa em grupo', 'Abra a conversa individual do cliente.');
    if (!est.contato.telefone) {
      return `${cartaoContato()}
        <div class="mmc-alerta mmc-alerta-suave">Não achei o telefone desta conversa de forma rápida.</div>
        <button type="button" class="mmc-btn mmc-btn-primario" data-acao="identificar-completo">Identificar contato</button>`;
    }
    return est.ficha?.existe ? telaFicha() : telaCadastro();
  }

  function vazio(t, s) { return `<div class="mmc-vazio"><p class="mmc-titulo">${esc(t)}</p><p class="mmc-sub">${esc(s)}</p></div>`; }

  function opcoesSelect(lista, atual, vazioRotulo) {
    return (vazioRotulo ? `<option value="">${esc(vazioRotulo)}</option>` : '')
      + lista.map((v) => `<option value="${esc(v)}" ${v === atual ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }

  function telaCadastro() {
    const c = est.contato;
    const o = est.opcoes || { fontes: FONTES.FONTES, status: ['NOVO'] };
    return `
      ${cartaoContato()}
      <div class="mmc-selo mmc-selo-novo">Contato novo · ainda não está no Connect</div>
      <form class="mmc-form" data-form="cadastro">
        <label>Nome<input name="nome" value="${esc(c.nome)}" required minlength="2" maxlength="120"></label>
        <label>WhatsApp<input name="telefone" value="${esc(PU ? PU.formatPhoneBR(c.telefone) : c.telefone)}" required></label>
        <div class="mmc-duas">
          <label>Fonte<select name="fonte">${opcoesSelect(o.fontes, c.fonte, 'Escolha')}</select></label>
          <label>Status<select name="status">${opcoesSelect(o.status, 'NOVO')}</select></label>
        </div>
        <label>Empreendimento de interesse<input name="empreendimento" list="mmc-lista-emp" placeholder="Digite para buscar" autocomplete="off"></label>
        <label>Observação<textarea name="observacao" rows="2" maxlength="1000" placeholder="O que o cliente procura, renda, região…"></textarea></label>
        <button type="submit" class="mmc-btn mmc-btn-primario">Cadastrar no Connect</button>
      </form>`;
  }

  function linhaVisita(rotulo, v) {
    if (!v) return '';
    return `<div class="mmc-linha"><span>${rotulo}</span><b>${esc(dataBR(v.data))} ${esc(v.hora || '')} · ${esc(ROTULO_VISITA[v.status] || v.status)}</b>
      <small>${esc([v.empreendimento, v.corretor].filter(Boolean).join(' · '))}</small></div>`;
  }

  function telaFicha() {
    const l = est.ficha.lead;
    const ctx = est.ficha.contexto || {};
    const q = l.qualificacao || {};
    const qual = [q.renda, q.entrada_fgts, q.prazo, q.finalidade, q.regiao].filter(Boolean);
    return `
      ${cartaoContato()}
      <div class="mmc-selo mmc-selo-lead">Já é lead · entrou em ${esc(dataBR(l.data_entrada))}</div>
      <label class="mmc-status">Status
        <select data-campo="status">${opcoesSelect(est.opcoes?.status || [l.status_atendimento], l.status_atendimento)}</select>
      </label>
      <div class="mmc-ficha">
        <div class="mmc-linha"><span>Empreendimento</span><b>${esc(l.empreendimento || '—')}</b></div>
        <div class="mmc-linha"><span>Responsável</span><b>${esc(l.responsavel || '—')}</b></div>
        <div class="mmc-linha"><span>Fonte</span><b>${esc(l.fonte || '—')}</b></div>
        ${linhaVisita('Próxima visita', ctx.proxima_visita)}
        ${linhaVisita('Última visita', ctx.ultima_visita)}
        <div class="mmc-linha"><span>Qualificação</span><b>${qual.length ? esc(qual.join(' · ')) : '<em>não preenchida</em>'}</b></div>
        ${l.observacoes ? `<div class="mmc-obs">${esc(l.observacoes.split('\n').slice(0, 3).join('\n'))}</div>` : ''}
      </div>
      <div class="mmc-acoes">
        <button type="button" class="mmc-btn mmc-btn-primario" data-acao="ir" data-tela="visita">Agendar visita</button>
        <button type="button" class="mmc-btn" data-acao="ir" data-tela="qualificacao">Qualificar</button>
        <button type="button" class="mmc-btn" data-acao="ir" data-tela="anotar">Anotar</button>
      </div>
      <div class="mmc-lembrete">
        <span>Retomar contato:</span>
        <button type="button" class="mmc-chip" data-acao="lembrete" data-dias="1">amanhã</button>
        <button type="button" class="mmc-chip" data-acao="lembrete" data-dias="3">3 dias</button>
        <button type="button" class="mmc-chip" data-acao="lembrete" data-dias="7">7 dias</button>
      </div>
      <a class="mmc-link" href="${esc(l.url)}" target="_blank" rel="noopener">Abrir no Connect ↗</a>`;
  }

  function telaVisita() {
    const l = est.ficha.lead;
    const emp = empPorId(l.empreendimento_id);
    const q = l.qualificacao || {};
    const perfil = [q.renda && `Renda ${q.renda}`, q.entrada_fgts, q.prazo && `Prazo ${q.prazo}`, q.finalidade, q.regiao && `Região ${q.regiao}`].filter(Boolean).join(' · ');
    const lista = est.corretores;
    return `
      <button type="button" class="mmc-voltar" data-acao="ir" data-tela="contato">← ${esc(l.nome)}</button>
      <form class="mmc-form" data-form="visita">
        <h2 class="mmc-titulo">Agendar visita</h2>
        <label>Empreendimento<input name="empreendimento" list="mmc-lista-emp" value="${esc(emp?.nome || '')}" required autocomplete="off"></label>
        <div class="mmc-duas">
          <label>Data<input type="date" name="data" min="${hojeISO()}" required></label>
          <label>Horário<input type="time" name="hora" step="900" required></label>
        </div>
        <label>Local<select name="local_nome">${opcoesSelect(est.opcoes?.tipos_local || ['Stand de vendas'], 'Stand de vendas')}</select></label>
        <label>Endereço<input name="endereco" value="${esc(emp?.endereco || '')}" required minlength="5" maxlength="300"></label>
        <label>Bairro<input name="bairro" value="${esc(emp?.bairro || '')}" required minlength="2" maxlength="120"></label>
        <label>Perfil do cliente<textarea name="perfil" rows="2" maxlength="2000">${esc(perfil)}</textarea></label>
        <fieldset class="mmc-corretores">
          <legend>Corretor</legend>
          ${est.buscandoCorretores ? '<p class="mmc-sub">Buscando os mais indicados…</p>'
            : !lista ? '<p class="mmc-sub">Preencha empreendimento, data e horário para ver os corretores sugeridos.</p>'
            : !lista.length ? '<p class="mmc-sub">Nenhum corretor encontrado.</p>'
            : lista.map((c, i) => `
              <label class="mmc-corretor ${c.disponivel ? '' : 'mmc-indisponivel'}">
                <input type="radio" name="corretor_id" value="${esc(c.corretor_id)}" ${c.disponivel ? '' : 'disabled'} ${i === 0 && c.disponivel ? 'checked' : ''} required>
                <span><b>${esc(c.nome)}</b><small>${c.disponivel ? `nota ${Math.round(c.score)} · ${esc(c.motivo || '')}` : 'ocupado neste horário'}</small></span>
              </label>`).join('')}
        </fieldset>
        <button type="submit" class="mmc-btn mmc-btn-primario">Agendar visita</button>
      </form>`;
  }

  function telaQualificacao() {
    const l = est.ficha.lead;
    const q = l.qualificacao || {};
    return `
      <button type="button" class="mmc-voltar" data-acao="ir" data-tela="contato">← ${esc(l.nome)}</button>
      <form class="mmc-form" data-form="qualificacao">
        <h2 class="mmc-titulo">Qualificação</h2>
        <label>Renda familiar<select name="renda">${opcoesSelect(RENDAS, q.renda, 'Não informada')}</select></label>
        <label>Entrada / FGTS<select name="entrada_fgts">${opcoesSelect(ENTRADAS, q.entrada_fgts, 'Não informado')}</select></label>
        <div class="mmc-duas">
          <label>Prazo<select name="prazo">${opcoesSelect(PRAZOS, q.prazo, '—')}</select></label>
          <label>Finalidade<select name="finalidade">${opcoesSelect(FINALIDADES, q.finalidade, '—')}</select></label>
        </div>
        <label>Região de interesse<input name="regiao" value="${esc(q.regiao || '')}" maxlength="120" placeholder="Ex.: Aldeota, Meireles"></label>
        <button type="submit" class="mmc-btn mmc-btn-primario">Salvar qualificação</button>
      </form>`;
  }

  function telaAnotar() {
    const l = est.ficha.lead;
    return `
      <button type="button" class="mmc-voltar" data-acao="ir" data-tela="contato">← ${esc(l.nome)}</button>
      <form class="mmc-form" data-form="anotar">
        <h2 class="mmc-titulo">Nova anotação</h2>
        <p class="mmc-sub">Entra no topo das observações do lead, com data e seu nome.</p>
        <textarea name="anotacao" rows="4" maxlength="1000" required placeholder="O que aconteceu nesta conversa?"></textarea>
        <button type="submit" class="mmc-btn mmc-btn-primario">Salvar anotação</button>
      </form>`;
  }

  function telaMensagem() {
    return `
      <div class="mmc-selo mmc-selo-lead">Visita agendada · o card foi para "Visita Agendada" no CRM</div>
      <p class="mmc-sub">Mensagem pronta para o cliente. Ela vai para o campo do WhatsApp; revise e envie.</p>
      <pre class="mmc-mensagem">${esc(est.mensagem)}</pre>
      <div class="mmc-acoes">
        <button type="button" class="mmc-btn mmc-btn-primario" data-acao="inserir">Colocar na conversa</button>
        <button type="button" class="mmc-btn" data-acao="copiar">Copiar</button>
        <button type="button" class="mmc-btn" data-acao="ir" data-tela="contato">Voltar</button>
      </div>`;
  }

  function renderRodape() {
    const r = $('#mmc-rodape');
    if (!r) return;
    if (!est.sessao) { r.innerHTML = ''; return; }
    const s = est.resumo;
    r.innerHTML = `
      ${s ? `<span title="Leads seus cadastrados hoje"><b>${s.leads_hoje}</b> leads</span>
             <span title="Visitas que você agendou hoje"><b>${s.visitas_agendadas_hoje}</b> visitas</span>
             <span title="Tarefas e lembretes para hoje na tela Hoje"><b>${s.tarefas_pendentes}</b> tarefas</span>` : '<span>Seu dia</span>'}
      ${est.fila ? `<button type="button" class="mmc-chip mmc-chip-alerta" data-acao="enviar-fila" title="Cadastros guardados sem conexão">${est.fila} na fila · enviar</button>` : ''}`;
  }

  async function atualizarRodape() {
    if (!est.sessao || !est.aberto) return;
    try {
      const [resumo, fila] = await Promise.all([enviar('RESUMO'), enviar('FILA')]);
      est.resumo = resumo; est.fila = fila.length;
      renderRodape();
    } catch (e) { /* rodapé é informativo */ }
  }

  // ============================================================
  // Corretores sugeridos (visita)
  // ============================================================
  let timerCorretores = null;
  function pedirCorretores(form) {
    clearTimeout(timerCorretores);
    timerCorretores = setTimeout(async () => {
      const emp = empPorNome(form.empreendimento.value);
      const data = form.data.value;
      const hora = form.hora.value;
      if (!emp || !data || !hora) return;
      const valores = Object.fromEntries(new FormData(form));
      est.buscandoCorretores = true; render(); restaurar(valores);
      try {
        const r = await enviar('CORRETORES', { empreendimento_id: emp.id, data, hora });
        est.corretores = r.corretores || [];
      } catch (e) {
        est.erro = e.message;
      } finally {
        est.buscandoCorretores = false;
        render(); restaurar(valores);
      }
    }, 400);
  }

  /** Mantém o que o usuário já digitou quando o formulário é redesenhado. */
  function restaurar(valores) {
    const f = $('form[data-form="visita"]');
    if (!f) return;
    for (const [k, v] of Object.entries(valores)) {
      if (k === 'corretor_id') continue;
      if (f.elements[k]) f.elements[k].value = v;
    }
  }

  // ============================================================
  // Eventos
  // ============================================================
  async function aoClicar(e) {
    const alvo = e.target.closest('[data-acao]');
    if (e.target.closest('#mmc-fab')) { est.aberto ? fechar() : abrir(); return; }
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === 'fechar') return fechar();
    if (acao === 'ir') { est.tela = alvo.dataset.tela; est.erro = null; est.corretores = null; render(); return; }
    if (acao === 'atualizar') {
      if (est.contato?.telefone && PU) cacheFicha.delete(PU.phoneKey(est.contato.telefone));
      await carregarOpcoes(true);
      identificar(false); atualizarRodape(); return;
    }
    if (acao === 'identificar-completo') return identificar(true);
    if (acao === 'inserir') {
      if (inserirNaConversa(est.mensagem)) toast('Mensagem colocada na conversa. Revise e envie.', 'sucesso');
      else toast('Não achei o campo de mensagem. Use Copiar.', 'erro');
      return;
    }
    if (acao === 'copiar') { await navigator.clipboard.writeText(est.mensagem); toast('Copiado', 'sucesso'); return; }
    if (acao === 'enviar-fila') {
      try { const r = await enviar('ENVIAR_FILA'); toast(`${r.enviados} enviado(s) · ${r.restantes} na fila`, r.restantes ? 'info' : 'sucesso'); } catch (er) { toast(er.message, 'erro'); }
      atualizarRodape(); return;
    }
    if (acao === 'lembrete') {
      const dias = Number(alvo.dataset.dias);
      try {
        await enviar('LEMBRETE', { lead_id: est.ficha.lead.id, dias });
        toast(dias === 1 ? 'Lembrete para amanhã na tela Hoje' : `Lembrete em ${dias} dias na tela Hoje`, 'sucesso');
      } catch (er) { toast(er.message, 'erro'); }
    }
  }

  async function aoMudar(e) {
    if (e.target.matches('select[data-campo="status"]')) {
      const status = e.target.value;
      try {
        const r = await enviar('ATUALIZAR_LEAD', { lead_id: est.ficha.lead.id, status });
        guardarFicha(r.lead);
        toast(`Status: ${status}`, 'sucesso');
      } catch (er) { toast(er.message, 'erro'); render(); }
      return;
    }
    const form = e.target.closest('form[data-form="visita"]');
    if (form) {
      if (e.target.name === 'empreendimento') {
        const emp = empPorNome(e.target.value);
        if (emp) {
          if (emp.endereco && !form.endereco.value) form.endereco.value = emp.endereco;
          if (emp.bairro && !form.bairro.value) form.bairro.value = emp.bairro;
        }
      }
      if (['empreendimento', 'data', 'hora'].includes(e.target.name)) pedirCorretores(form);
    }
  }

  async function aoEnviar(e) {
    e.preventDefault();
    const form = e.target;
    const tipo = form.dataset.form;
    const v = Object.fromEntries(new FormData(form));
    const botao = form.querySelector('button[type="submit"]');
    if (botao) { botao.disabled = true; botao.dataset.rotulo = botao.textContent; botao.textContent = 'Aguarde…'; }
    est.erro = null;
    try {
      if (tipo === 'login') {
        await enviar('ENTRAR', { email: v.email, senha: v.senha });
        est.sessao = await enviar('SESSAO');
        await carregarOpcoes(true);
        toast('Conectado ao MeMude Connect', 'sucesso');
        est.ultimoCabecalho = null; // força ler a conversa aberta
        render(); atualizarRodape();
        return;
      }
      if (tipo === 'cadastro') {
        const emp = v.empreendimento ? empPorNome(v.empreendimento) : null;
        const r = await enviar('CRIAR_LEAD', {
          nome: v.nome, telefone: v.telefone, fonte: v.fonte || null, status: v.status,
          empreendimento_id: emp ? emp.id : null, empreendimento: emp ? undefined : v.empreendimento, observacao: v.observacao || null,
        });
        if (r.na_fila) { toast(r.aviso, 'info'); atualizarRodape(); return; }
        toast(r.duplicado ? 'Este telefone já era lead: abrindo a ficha' : 'Lead cadastrado no Connect', 'sucesso');
        guardarFicha(r.lead, null);
        cacheFicha.delete(PU.phoneKey(est.contato.telefone));
        await identificar(false);
        atualizarRodape();
        return;
      }
      if (tipo === 'qualificacao') {
        const qualificacao = { renda: v.renda || null, entrada_fgts: v.entrada_fgts || null, prazo: v.prazo || null, finalidade: v.finalidade || null, regiao: v.regiao.trim() || null };
        const r = await enviar('ATUALIZAR_LEAD', { lead_id: est.ficha.lead.id, qualificacao });
        guardarFicha(r.lead); est.tela = 'contato'; toast('Qualificação salva', 'sucesso'); render();
        return;
      }
      if (tipo === 'anotar') {
        const r = await enviar('ATUALIZAR_LEAD', { lead_id: est.ficha.lead.id, anotacao: v.anotacao });
        guardarFicha(r.lead); est.tela = 'contato'; toast('Anotação salva', 'sucesso'); render();
        return;
      }
      if (tipo === 'visita') {
        const emp = empPorNome(v.empreendimento);
        if (!emp) throw new Error('Escolha um empreendimento da lista');
        if (!v.corretor_id) throw new Error('Escolha o corretor');
        await enviar('AGENDAR_VISITA', {
          lead_id: est.ficha.lead.id, empreendimento_id: emp.id, data: v.data, hora: v.hora, local_nome: v.local_nome,
          endereco: v.endereco, bairro: v.bairro, corretor_id: v.corretor_id, perfil: v.perfil || null,
        });
        const modelo = est.opcoes?.mensagem_visita
          || 'Só confirmando os dados:\nData: [DATA]\nHorário: [HORÁRIO]\nLocal: Stand do empreendimento [EMPREENDIMENTO] ([ENDEREÇO])\n\nFico no aguardo da sua confirmação!';
        const endereco = v.bairro && !v.endereco.toLowerCase().includes(v.bairro.toLowerCase()) ? `${v.endereco} – ${v.bairro}` : v.endereco;
        est.mensagem = modelo
          .replace(/\[DATA\]/g, `${dataBR(v.data)} (${diaSemana(v.data)})`)
          .replace(/\[HOR[ÁA]RIO\]/g, v.hora)
          .replace(/\[EMPREENDIMENTO\]/g, emp.nome)
          .replace(/\[ENDERE[ÇC]O\]/g, endereco);
        cacheFicha.delete(PU.phoneKey(est.contato.telefone));
        est.tela = 'mensagem'; render(); atualizarRodape();
        enviar('BUSCAR', { telefone: est.contato.telefone }).then((f) => { est.ficha = f; atualizarPonto(); }).catch(() => undefined);
      }
    } catch (er) {
      est.erro = er.message;
      const valores = tipo === 'visita' ? v : null;
      render();
      if (valores) restaurar(valores);
    } finally {
      if (botao && document.body.contains(botao)) { botao.disabled = false; botao.textContent = botao.dataset.rotulo; }
    }
  }

  // ============================================================
  // API para o content script (atalhos)
  // ============================================================
  async function cadastroRapido() {
    abrir();
    await identificar(false);
    if (est.ficha && !est.ficha.existe && est.contato?.telefone) {
      const f = $('form[data-form="cadastro"]');
      if (f) f.requestSubmit();
    } else if (est.ficha?.existe) {
      toast('Este contato já é lead', 'info');
    }
  }

  window.__MEMUDE_PAINEL = { abrir, fechar, cadastroRapido, inserirNaConversa };

  function aguardarWhatsApp() {
    const t = setInterval(() => {
      if (document.querySelector('#app') && document.body) { clearInterval(t); montar(); }
    }, 800);
  }
  aguardarWhatsApp();
})();
