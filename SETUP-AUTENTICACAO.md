# Configuração da Autenticação (OAuth por usuário)

A extensão agora usa `chrome.identity.launchWebAuthFlow` com um OAuth client
do tipo **"Aplicativo da Web"**. Assim qualquer pessoa, com qualquer conta
Google, consegue conectar — não depende mais do login do Chrome.

## Dados desta instalação

| Item | Valor |
|---|---|
| **ID fixo da extensão** | `ncbcpgikkcljfgonclcegmehbmpnlncd` |
| **Redirect URI** | `https://ncbcpgikkcljfgonclcegmehbmpnlncd.chromiumapp.org/` |
| **Client ID (Web)** | `44849090581-qan2f7bkqdh6vj3l4617fvnlemh0a8cg.apps.googleusercontent.com` |

> O ID é fixo porque o `manifest.json` tem o campo `"key"`. A chave privada
> está em `key.pem` — **guarde com segurança e não versione** (já está no
> `.gitignore`). É ela que mantém o mesmo ID em qualquer máquina.

## O que VOCÊ precisa fazer no Google Cloud Console

1. Acesse **APIs e Serviços → Credenciais**.
2. Abra o OAuth client **"Aplicativo da Web"** (`44849090581-...`).
3. Em **URIs de redirecionamento autorizados**, adicione **exatamente**:
   ```
   https://ncbcpgikkcljfgonclcegmehbmpnlncd.chromiumapp.org/
   ```
   Salve.
4. Em **APIs e Serviços → Biblioteca**, confirme que a **Google Sheets API**
   está **ativada**.
5. Em **APIs e Serviços → Tela de permissão OAuth**:
   - Escopo necessário: `https://www.googleapis.com/auth/spreadsheets` (sensível).
   - **Para liberar qualquer e-mail:** publique a tela ("Em produção").
     Como o escopo é "sensível", o Google pode pedir **verificação do app**.
   - **Alternativa sem verificação:** mantenha em "Teste" e adicione cada
     pessoa em **Usuários de teste** (limite de 100). Aí funciona na hora,
     com qualquer conta cadastrada.

## Como instalar a extensão (em qualquer PC)

1. Chrome → `chrome://extensions` → ative **Modo do desenvolvedor**.
2. **Carregar sem compactação** → selecione a pasta da extensão.
3. Confirme que o ID que aparece é `ncbcpgikkcljfgonclcegmehbmpnlncd`
   (se for outro, o `key` não está no manifest).
4. No popup: **Conectar Google** → escolha a conta → autorize.

## Como funciona agora (resumo técnico)

- O popup **não** chama mais `chrome.identity` direto. Ele manda mensagens
  ao service worker (`GET_AUTH_TOKEN`, `CHECK_AUTH`, `EXPORT_TO_SHEETS`).
- O login roda no service worker (`utils/auth.js`), que abre a janela do
  Google e guarda o **access token** em `chrome.storage.local`.
- O token do fluxo implícito dura ~1h e **não** tem refresh token. Quando
  expira, o envio retorna `NEEDS_AUTH` e o popup pede para reconectar.
- Ao clicar em "Conectar Google", a janela do Google pode **fechar o popup**.
  Isso é normal: conclua o login e **reabra a extensão** — o status já
  aparecerá como "Conectado".

## Trocar o Client ID no futuro

Edite `CLIENT_ID` em `utils/auth.js`.
