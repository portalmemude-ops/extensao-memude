/* ============================================================
   MeMude Connect · Configuração
   Endereços públicos do sistema. A chave abaixo é a chave pública
   (anon) do Supabase, a mesma usada pelo site: não é segredo.
   Quem autoriza cada ação é o login do usuário (JWT) + regras do banco.
   ============================================================ */
(function (root) {
  'use strict';

  const SUPABASE_URL = 'https://oxybasvtphosdmlmrfnb.supabase.co';
  const CONFIG = Object.freeze({
    SUPABASE_URL,
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94eWJhc3Z0cGhvc2RtbG1yZm5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3NTU4MTUsImV4cCI6MjA3MzMzMTgxNX0.Je-WNYEO9LEpBNjT1hNs1Qw_uoo8ErNh53Ipm5XSOFk',
    API_URL: `${SUPABASE_URL}/functions/v1/leads-api`,
    APP_URL: 'https://core.memudecore.com.br',
    // Etiquetas do WhatsApp procuradas na conversa para preencher a Fonte.
    ETIQUETAS: ['Google', 'Meta', 'Facebook', 'Instagram', 'Tráfego', 'Cadastro', 'Site', 'Follow', 'Indicação', 'Orgânico', 'OLX'],
  });

  root.MEMUDE_CONFIG = CONFIG;
})(globalThis);
