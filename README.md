# MeMude — WhatsApp Web → Google Sheets

Extensão Chrome para SDRs: captura nome e telefone do contato ativo no
WhatsApp Web e grava direto numa planilha Google Sheets usada como CRM.
Funciona com qualquer conta Google em qualquer computador.

## Funcionalidades

- **Captura inteligente** do chat aberto (nome + telefone), com múltiplas
  estratégias e fallbacks para contatos salvos, não salvos e WhatsApp Business.
- **Painel flutuante** dentro do WhatsApp Web com botão de captura, fila de
  envio em lote e contador diário.
- **Fila staged**: abre vários chats, captura cada um, envia tudo de uma vez.
- **Campos extras configuráveis**: status, origem, observação e timestamp.
- **Histórico local** das últimas capturas, com dedup canônico que tolera o
  9º dígito brasileiro.
- **Atalhos de teclado**: `Ctrl+Shift+S` (capturar + enviar), `Alt+Shift+M`
  (abrir painel).
- **Auth por usuário** via `chrome.identity.launchWebAuthFlow` — qualquer
  pessoa usa a própria conta Google, sem precisar ser o dono.

## Instalação

1. Baixe ou clone este repositório.
2. No Chrome, vá em `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e aponte para a pasta deste projeto.
4. Confirme que o ID que aparece é `ncbcpgikkcljfgonclcegmehbmpnlncd`.
5. Siga os passos de [SETUP-AUTENTICACAO.md](SETUP-AUTENTICACAO.md) para
   configurar o OAuth no Google Cloud (uma vez por equipe).
6. Abra `https://web.whatsapp.com` — o botão flutuante verde aparece no canto.

## Configuração padrão da equipe

Edite `utils/settings.js` (constante `TEAM_DEFAULTS`) para que toda nova
instalação já venha com a planilha, colunas e defaults da sua equipe.
Cada SDR pode personalizar pelo popup; o botão *"Restaurar padrão da equipe"*
volta tudo ao default.

## Estrutura

```
.
├── manifest.json
├── background/service-worker.js   # Roteador + handlers + comandos
├── content/
│   ├── content.js                 # Listener pro popup
│   ├── overlay.js                 # Painel flutuante + fila staged
│   └── overlay.css
├── popup/popup.{html,js,css}      # UI principal de configuração e captura
└── utils/
    ├── auth.js                    # OAuth via launchWebAuthFlow
    ├── history.js                 # Histórico + contador diário
    ├── logger.js                  # Log com níveis
    ├── phone-extractor.js         # Estratégias de extração
    ├── phone-utils.js             # Normalização e chave canônica
    ├── settings.js                # TEAM_DEFAULTS + overrides
    └── sheets-api.js              # Google Sheets API v4
```

## Privacidade

Tudo roda localmente. O único tráfego externo é:
- `accounts.google.com` / `oauth2.googleapis.com` — login e validação de token.
- `sheets.googleapis.com` — gravação na planilha que você configurar.

Os dados extraídos do WhatsApp **não passam por servidor algum** — vão direto
do seu Chrome para a planilha.

## Licença

Uso interno da equipe. Adapte como quiser.
