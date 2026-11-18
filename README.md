# MeMude Connect · WhatsApp

Extensão do Chrome para o SDR atender leads no WhatsApp Web com o MeMude Connect ao lado.
Os leads entram **direto no sistema** (a planilha recebe o espelho às 17h30).

## O que ela faz

- **Login pelo Connect.** Com o Connect logado no navegador, a extensão entra sozinha (sem senha). E-mail e senha ficam como alternativa; a sessão renova sozinha.
- **Capturar → lista → enviar.** O botão **Capturar contato desta conversa** lê nome, telefone (com o 9º dígito corrigido) e a fonte pela etiqueta, e põe o contato numa lista.
  - Na lista: **Enviar** manda um contato para o Connect; **Enviar todos** manda a lista inteira.
  - A fonte pode ser trocada em cada item; quem já é lead aparece marcado e não é reenviado.
  - A lista fica guardada no navegador até ser enviada; o número de pendentes aparece no botão flutuante.
- **Ficha de quem já é lead** (botão **Ver ficha**):
  - status, empreendimento, responsável, próxima e última visita, qualificação e últimas anotações;
  - o ponto no botão flutuante fica **verde** quando o contato já é lead e **rosa** quando é contato novo.
- **Sem duplicados.** O telefone já cadastrado nunca vira lead duplicado.
- **Agendar visita sem sair do WhatsApp:**
  - endereço e bairro do empreendimento e perfil do cliente já vêm preenchidos;
  - os corretores sugeridos aparecem pela nota, e o ocupado no horário fica bloqueado;
  - o card do CRM vai sozinho para "Visita Agendada";
  - a mensagem de confirmação pronta vai para o campo da conversa.
- **Status, qualificação e anotações.** A qualificação registra renda, entrada/FGTS, prazo, finalidade e região.
- **Lembrete de retomada** (amanhã, 3 ou 7 dias): vira tarefa na tela **Hoje** do Connect.
- **Fila de segurança.** Sem internet, o cadastro fica guardado e é enviado sozinho a cada minuto. O número aparece no ícone da extensão.
- **Números do dia** no rodapé e no popup: leads cadastrados, visitas agendadas e tarefas de hoje.

A extensão **nunca envia mensagens sozinha**: ela só coloca o texto no campo do WhatsApp para você revisar e enviar.

## Atalhos

| Atalho | Ação |
| --- | --- |
| `Alt+Shift+M` | Abre o painel no WhatsApp |
| `Ctrl+Shift+S` | Captura o contato da conversa aberta para a lista |

## Instalação

1. Em `chrome://extensions`, ative o **Modo do desenvolvedor**.
2. Se a versão antiga (planilha) estiver instalada, clique em **Remover**.
3. Clique em **Carregar sem compactação** e escolha esta pasta (ou a pasta descompactada do .zip).
4. O ID continua `ncbcpgikkcljfgonclcegmehbmpnlncd`.
5. Com o Connect aberto e logado no navegador, a extensão entra sozinha.

## Estrutura

```
manifest.json
background/service-worker.js   login, chamadas ao sistema, cache e fila de segurança
content/overlay.js|css         painel no WhatsApp (captura, lista, ficha, visita)
content/content.js             atalhos de teclado
popup/                         login, números do dia, ajuda
utils/config.js                endereços do sistema (chave pública)
utils/auth.js                  login Supabase (sessão no chrome.storage.local)
utils/api.js                   cliente da API leads-api
utils/fontes.js                etiqueta do WhatsApp → fonte do sistema
utils/phone-extractor.js       leitura do contato aberto no WhatsApp
utils/phone-utils.js           normalização de telefone e 9º dígito
```

A API usada fica no repositório do Connect (`supabase/functions/leads-api`).

## Testes

```
npm test
```
