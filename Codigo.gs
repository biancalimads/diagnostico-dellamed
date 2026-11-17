/************************************************************
 * DIAGNÓSTICO DELLAMED — backend (Google Apps Script)
 * Script vinculado à planilha (Extensões > Apps Script).
 * Nenhum dado, ID de planilha ou senha fica no HTML:
 * tudo passa por aqui, só depois de sessão válida.
 ************************************************************/

const ADMIN_EMAIL      = 'bianca.lima@dellamed.com.br';
const DOMINIOS_LIVRES  = ['dellamed.com.br'];   // ÚNICO domínio aceito: qualquer outro é recusado no código, no PIN, no login e em cada consulta
function dominioPermitido_(email) { return DOMINIOS_LIVRES.indexOf(String(email || '').split('@')[1] || '') >= 0; }
const MSG_DOMINIO = 'Acesso permitido apenas para e-mails @dellamed.com.br.';
const SELLERS_OFICIAIS = ['DELLAMED', 'DELLAMED OFICIAL', 'LOJA OFICIAL DELLAMED'];
const MKS_FORA = ['Carrefour', 'Casas Bahia'];   // marketplaces retirados: não aparecem no painel nem no simulador
function mkAtivo_(r) { return MKS_FORA.indexOf(str_(r.marketplace)) < 0; }
const TOLERANCIA_PRECO = 0.03;   // anúncio 3% ou mais abaixo do preço base = violação
const SESSAO_SEG       = 21600;  // 6 h (limite do CacheService)
const CODIGO_SEG       = 600;    // código de e-mail vale 10 min
const REENVIO_SEG      = 60;
const MAX_TENTATIVAS   = 5;
const BLOQUEIO_MIN     = 15;

// Itens Dellamed (planilha "Pasta1" do marketing, out/2026). A aba ITENS da planilha é a fonte: pode editar lá.
const ITENS_PADRAO = [
  'ALIMENTADOR PARA BEBES', 'ALMOFADA AIR BASIC', 'ALMOFADA AIR CELL', 'ANDADOR D10',
  'ANDADOR D10 POP', 'ANDADOR D11', 'ANDADOR D12', 'ANDADOR D14',
  'ANDADOR D15', 'ASPIRAMED', 'BALANCA DE BIOIMPEDANCIA', 'BALANCA DIGITAL',
  'BANDAGEM ELASTICA TORNOZELO AJUSTAVEL', 'BANQUETA D1', 'BANQUETA D2', 'BANQUETA D3',
  'BENGALA 4 PONTAS D9', 'BENGALA TIPO T D8', 'BOLSA AGUA QUENTE', 'BOLSA DE GELO',
  'BOLSA TERMICA GEL', 'BOMBA TIRA LEITE ELETRICA', 'BOMBA TIRA LEITE MANUAL', 'BOTA CURTA PLASTICO',
  'BOTA CURTA SUPORTE ALUMINIO', 'BOTA LONGA PLASTICO', 'BOTA LONGA SUPORTE ALUMINIO', 'BOTA PNEUMATICA AIR RECOVERY',
  'BOTA PNEUMATICA AIR RECOVERY LIGHT', 'CADEIRA DE HIG D75', 'CADEIRA DE RODAS D100', 'CADEIRA DE RODAS D100 LIGHT',
  'CADEIRA DE RODAS D100 POP', 'CADEIRA DE RODAS D400', 'CADEIRA DE RODAS D500', 'CADEIRA DE RODAS D600',
  'CADEIRA DE RODAS D600 POP T44', 'CADEIRA DE RODAS D700', 'CADEIRA DE RODAS D700 LIGHT', 'CADEIRA DE RODAS MONOBLOCO',
  'CADEIRA DE TRANSFERENCIA D80', 'CADEIRA DE TRANSPORTE D90', 'CADEIRA HIG CONCHA INFANTIL', 'CADEIRA HIG D30',
  'CADEIRA HIG D35', 'CADEIRA HIG D40', 'CADEIRA HIG D45', 'CADEIRA HIG D50',
  'CADEIRA HIG D55', 'CADEIRA HIG D60', 'CADEIRA HIG D65', 'CADEIRA HIG D70',
  'CADEIRA MOTORIZADA D1000', 'CADEIRA MOTORIZADA D1000 POWER FORCE', 'CADEIRA MOTORIZADA D3000 SUPER LIGHT', 'CADEIRA MOTORIZADA D750',
  'CADEIRA MOTORIZADA D800', 'CADEIRA MOTORIZADA D900', 'CADEIRA MOTORIZADA OPTIMUSMED', 'CADEIRA MOTORIZADA PRIME',
  'CADEIRA MOTORIZADA SPACEMED', 'CAMA 2 MOVIMENTOS DX', 'CAMA 2 MOVIMENTOS DX2', 'CAMA 3 MOVIMENTOS DX3',
  'CINTA LOMBAR COM HASTES FLEXIVEIS', 'COLAR CERVICAL', 'COLCHAO AIR PLUS', 'COLCHAO AIR PLUS LIGHT',
  'COLCHAO AIR TUBE', 'COLETE MAX PUTTI CINZA ESCURO ALTO', 'COLETE MAX PUTTI CINZA ESCURO BAIXO', 'COLETE PUTTI COR NORMAL ALTO',
  'COLETE PUTTI COR NORMAL BAIXO', 'CORRETOR POSTURAL', 'CORRETOR POSTURAL ERGONOMICO', 'COTOVELEIRA AJUSTAVEL',
  'COTOVELEIRA ELASTICA', 'ESPACADOR DELLAMED', 'ESTETOSCOPIO DUPLO', 'ESTETOSCOPIO RAPPAPORT',
  'ESTETOSCOPIO SIMPLES', 'FAIXA 3 PAINEIS', 'FAIXA 4 PAINEIS', 'FAIXA 5 PAINEIS',
  'FAIXA ELASTICA DE PULSO', 'FAIXA SUB PATELAR', 'FITA KO', 'GUINCHO D5000',
  'IMOBILIZADOR', 'JOELHEIRA AJUSTAVEL C/ REFORCO PATELAR', 'JOELHEIRA ARTICULADA AJUSTAVEL', 'JOELHEIRA ARTICULADA COM CINTAS CRUZADAS',
  'JOELHEIRA COM ORIFICIO E HASTES FLEXIVEIS', 'JOELHEIRA ELASTICA', 'JOELHEIRA KNIT', 'JOELHEIRA COM ORIFICIO E REFORCO PATELAR',
  'MACA MALETA', 'MASSAGEADOR ALMOFADA', 'MASSAGEADOR ESTEIRA', 'MASSAGEADOR HAMMER',
  'MASSAGEADOR HUGMED', 'MASSAGEADOR ORBITAL', 'MASSAGEADOR PISTOLA', 'MASSAGEADOR SHIATSU PES',
  'MONITOR DE BRACO COM VOZ SUPER', 'MONITOR DE BRACO COM VOZ ULTRA', 'MONITOR DE PULSO ULTRA MAX', 'MONITOR DE PULSO KF-75C',
  'MULETA AXILAR D7', 'MULETA CANADENSE D6', 'MUNHEQUEIRA AJUSTAVEL', 'NEBULIZADOR COMPRESSOR',
  'NEBULIZADOR MESH', 'ORTESE LONGA COM POLEGAR', 'ORTESE LONGA SEM POLEGAR', 'OXIMETRO COM ALARME',
  'OXIMETRO PEDIATRICO', 'OXIMETRO SEM ALARME', 'PALMILHA', 'POLTRONA ELEVAMED',
  'PROTETOR DE PUNHO', 'RESERVATORIO DE LEITE', 'SCOOTER CS', 'SCOOTER LB',
  'SCOOTER MED MAX', 'TALA LONGA BILATERAL DE PUNHO', 'TERMOMETRO CLINICO', 'TERMOMETRO INFRAVERMELHO',
  'TIPOIA SIMPLES', 'TIPOIA VELPEAU', 'TORNOZELEIRA AJUSTAVEL NEOPRENE', 'TORNOZELEIRA CURTA NEOPRENE',
  'TORNOZELEIRA ELASTICA', 'TORNOZELEIRA LONGA NEOPRENE', 'UMIDIFICADOR POP', 'UMIDIFICADOR STAR',
  'UMIDIFICADOR ULTRA', 'UMIDIFICADOR UMI LIGHT', 'TENIS ELBOW'
];
// Lista de itens: aba ITENS (se preenchida) ou a padrão acima.
function itensLista_() {
  let l = [];
  try { l = lerAba_('ITENS').map(function (r) { return str_(r.item).toUpperCase(); }).filter(function (x) { return x && x !== 'SEM SUBFAMILIA'; }); } catch (e) {}
  if (!l.length) {                                                      // aba vazia ou inexistente: cria com a lista padrão
    l = ITENS_PADRAO.slice();
    try { const sh = aba_('ITENS'); if (sh.getLastRow() < 2) sh.getRange(2, 1, l.length, 2).setValues(l.map(function (m) { return [m, '']; })); } catch (e) {}
  }
  const vistos = {}; return l.filter(function (x) { if (vistos[x]) return false; vistos[x] = 1; return true; });
}
const ABAS = {
  USUARIOS:      ['email','status','pin_hash','salt','criado_em','pin_gerado_em','ultimo_acesso','tentativas','bloqueado_ate'],
  LOG:           ['data','email','evento','detalhe'],
  PRODUTOS_BASE: ['sku','produto','categoria','linha','preco_base','link_oficial','origem','foto','mlb_id','categoria_id','catalogo_id','item'],
  ITENS:         ['item','observacao'],
  VINCULO_ITEM:  ['link_ou_codigo','item','foto','titulo','sugestao_ia','observacao'],
  ITEM_AUTO:     ['anuncio','item','fonte','titulo','link','data'],
  ANUNCIOS:      ['data_captura','marketplace','seller','sku','titulo','preco','link','reputacao_0a5','avaliacoes','vendidos','ganha_buybox','origem','foto','item_id','preco_cheio'],
  CONCORRENTES:  ['categoria','marca','produto','marketplace','preco','nota_0a5','avaliacoes','vendidos','link','pontos_fortes','pontos_fracos','origem','foto','item_id','preco_cheio','data_captura'],
  AVALIACOES:    ['review_id','data','marketplace','marca','categoria','sku','produto','nota_1a5','titulo','texto','link','foto','item_id','origem'],
  OFERTAS_CONC:  ['data_captura','chave','marketplace','seller','preco','link','item_id','foto','origem','preco_cheio'],
  PRECO_ANTERIOR: ['coleta','marketplace','chave','sku','vendedor_ou_marca','preco','preco_cheio'],
  OCORRENCIAS:   ['review_id','status','tratado_por','tratado_em','observacao'],
  VENDEDORES:    ['codigo','nome','marketplace','observacao'],
  PRIORITARIOS:  ['marca','observacao'],
  MARCAS_FORA:   ['marca','observacao'],
  HISTORICO:     ['coleta','tipo','marketplace','vendedor_ou_marca','sku','categoria','produto','preco','nota','avaliacoes','vendidos','link','item_id','preco_cheio'],
  TAXAS:         ['marketplace','modalidade','preco_min','preco_max','comissao_pct','fixo_rs','frete_vendedor','observacao']
};

/* ============ WEB APP ============ */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Painel')
    .setTitle('Diagnóstico — Dellamed')
    .addMetaTag('viewport', 'width=1320')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ============ MARCAS FORA DO SEGMENTO ============ */
// Apaga de CONCORRENTES e AVALIACOES as linhas das marcas listadas na aba MARCAS_FORA.
// O painel já esconde essas marcas sozinho; esta rotina só limpa a base. O HISTORICO fica intacto.
function removerMarcasFora() {
  MARCAS_FORA_CACHE = null;
  const res = [];
  ['CONCORRENTES', 'AVALIACOES'].forEach(function (nome) {
    const sh = aba_(nome), v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    const col = v[0].map(function (h) { return String(h).trim().toLowerCase(); }).indexOf('marca');
    if (col < 0) return;
    const manter = [v[0]].concat(v.slice(1).filter(function (r) { return !marcaFora_(r[col]); }));
    const tirou = v.length - manter.length;
    if (!tirou) return;
    sh.clearContents();
    sh.getRange(1, 1, manter.length, manter[0].length).setValues(manter);
    res.push(nome + ': ' + tirou);
  });
  invalidarDados_();
  log_('sistema', 'marcas_fora_removidas', res.join(' | ') || 'nada a remover');
  SpreadsheetApp.getActive().toast(res.length ? 'Removido — ' + res.join(', ') : 'Nenhuma linha de marca fora do segmento.');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Diagnóstico')
    .addItem('1. Configurar planilha', 'configurarPlanilha')
    .addItem('Carregar base de exemplo', 'carregarExemplo')
    .addItem('Remover base de exemplo', 'limparExemplo')
    .addSeparator()
    .addItem('Coleta: testar marketplaces', 'testarColeta')
    .addItem('Coleta: coletar agora', 'coletarMarketplaces')
    .addItem('Coleta: recomeçar do zero', 'recomecarColeta')
    .addItem('Coleta: cancelar coleta em andamento', 'cancelarColeta')
    .addItem('Coleta: concluir última coleta (histórico)', 'concluirUltimaColeta')
    .addItem('Coleta: diagnosticar preço anterior', 'diagnosticarPrecoAnterior')
    .addItem('Coleta: testar leitura do Buy Box', 'testarBuyBox')
    .addItem('Coleta: agendar todos os dias à meia-noite', 'instalarGatilhoColeta')
    .addItem('Arquivar dados com mais de 6 meses agora', 'arquivarAgora')
    .addItem('Histórico: salvar coletas no Drive agora', 'histSalvarTudoNoDrive')
    .addItem('Histórico: preparar gráficos de preço agora', 'prepararGraficosPrecosAgora')
    .addItem('Histórico: reconstruir gráficos de preço (30 dias)', 'reconstruirGraficosPrecos')
    .addItem('PMV: conferir ligação com os ITENS', 'conferirPMV')
    .addItem('Relatório gerencial: enviar teste para o admin', 'relatorioTesteAdmin')
    .addItem('Relatório gerencial: agendar dias 15 e último dia', 'instalarGatilhoRelatorio')
    .addItem('Remover Carrefour e Casas Bahia da planilha', 'removerMarketplacesFora')
    .addItem('Remover marcas fora do segmento (aba MARCAS_FORA)', 'removerMarcasFora')
    .addSeparator()
    .addItem('Mercado Livre: conectar conta', 'mlMostrarLinkAutorizacao')
    .addItem('Mercado Livre: testar acesso', 'mlTestarAcesso')
    .addItem('Mercado Livre: sincronizar agora', 'sincronizarMercadoLivre')
    .addItem('Mercado Livre: agendar sincronização diária', 'instalarGatilhoML')
    .addSeparator()
    .addItem('Shopee: buscar comentários agora (Voz do cliente)', 'testarShopeeComentarios')
    .addItem('Shopee: testar leitura', 'testarShopee')
    .addToUi();
}

/* ============ ACESSO: CÓDIGO POR E-MAIL ============ */
function solicitarCodigo(email) {
  email = normEmail_(email);
  if (!emailValido_(email)) return { ok: false, msg: 'Digite um e-mail válido.' };
  if (!dominioPermitido_(email)) { log_(email, 'codigo_negado', 'domínio não permitido'); return { ok: false, msg: MSG_DOMINIO }; }
  const cache = CacheService.getScriptCache();
  if (cache.get('cd_' + email)) return { ok: false, msg: 'Aguarde 1 minuto para pedir um novo código.' };

  const u = acharUsuario_(email);
  if (u && u.data.status === 'bloqueado') {
    log_(email, 'codigo_negado', 'usuário bloqueado');
    return { ok: false, msg: 'Acesso indisponível para este e-mail. Fale com a administradora.' };
  }
  const codigo = rand6_();
  cache.put('cod_' + email, JSON.stringify({ h: hash_(codigo + email), t: 0 }), CODIGO_SEG);
  cache.put('cd_' + email, '1', REENVIO_SEG);

  MailApp.sendEmail({
    to: email,
    subject: 'Seu código de acesso — Diagnóstico Dellamed',
    htmlBody: emailHtml_('Seu código de confirmação',
      '<p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#0F3C6E;margin:16px 0">' + codigo + '</p>' +
      '<p>Ele vale por 10 minutos. Se você não pediu este código, ignore este e-mail.</p>')
  });
  log_(email, 'codigo_enviado', '');
  return { ok: true };
}

function validarCodigo(email, codigo) {
  email = normEmail_(email);
  codigo = String(codigo || '').replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('cod_' + email);
  if (!raw) return { ok: false, msg: 'Código expirado. Peça um novo.' };
  const reg = JSON.parse(raw);
  if (reg.t >= MAX_TENTATIVAS) { cache.remove('cod_' + email); return { ok: false, msg: 'Muitas tentativas. Peça um novo código.' }; }
  if (hash_(codigo + email) !== reg.h) {
    reg.t++; cache.put('cod_' + email, JSON.stringify(reg), CODIGO_SEG);
    return { ok: false, msg: 'Código incorreto. Restam ' + (MAX_TENTATIVAS - reg.t) + ' tentativas.' };
  }
  cache.remove('cod_' + email);
  const setup = token_();
  cache.put('setup_' + setup, email, CODIGO_SEG);
  return { ok: true, setup: setup };
}

/* ============ ACESSO: GERAR PIN ============ */
function gerarPin(setup, pin) {
  const cache = CacheService.getScriptCache();
  const email = cache.get('setup_' + String(setup || ''));
  if (!email) return { ok: false, msg: 'A confirmação expirou. Comece de novo.' };
  pin = String(pin || '');
  const erro = pinInvalido_(pin);
  if (erro) return { ok: false, msg: erro };

  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, msg: 'O sistema está ocupado. Tente de novo em alguns segundos.' };
  try {
    const sh = aba_('USUARIOS');
    const u = acharUsuario_(email);
    const salt = token_().slice(0, 16);
    const agora = new Date();
    let status;
    if (u) {
      if (u.data.status === 'bloqueado') return { ok: false, msg: 'Acesso indisponível para este e-mail.' };
      status = u.data.status;
      const d = u.data;
      d.pin_hash = hashPin_(pin, salt); d.salt = salt; d.pin_gerado_em = agora; d.tentativas = 0; d.bloqueado_ate = '';
      gravarUsuario_(sh, u.row, d);
    } else {
      if (!dominioPermitido_(email)) return { ok: false, msg: MSG_DOMINIO };
      status = 'ativo';
      const d = { email: email, status: status, pin_hash: hashPin_(pin, salt), salt: salt, criado_em: agora,
                  pin_gerado_em: agora, ultimo_acesso: '', tentativas: 0, bloqueado_ate: '' };
      sh.appendRow(ABAS.USUARIOS.map(function (k) { return d[k]; }));
    }
    cache.remove('setup_' + setup);
    log_(email, u ? 'pin_redefinido' : 'pin_gerado', status);
    avisarAdmin_(email, u ? 'redefiniu o PIN' : 'gerou um PIN', status);
    return { ok: true, status: status };
  } finally { lock.releaseLock(); }
}

/* ============ LOGIN / SESSÃO ============ */
function entrar(email, pin) {
  email = normEmail_(email);
  if (!dominioPermitido_(email)) return { ok: false, msg: MSG_DOMINIO };
  const generico = { ok: false, msg: 'E-mail ou PIN incorretos.' };
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, msg: 'O sistema está ocupado. Tente de novo em alguns segundos.' };
  try {
    const u = acharUsuario_(email);
    if (!u || !u.data.pin_hash) return generico;
    const d = u.data;
    if (d.status === 'bloqueado') return { ok: false, msg: 'Acesso bloqueado. Fale com a administradora.' };
    if (d.status === 'pendente') return { ok: false, msg: 'Seu acesso ainda aguarda aprovação da administradora.' };
    if (d.bloqueado_ate && new Date(d.bloqueado_ate) > new Date())
      return { ok: false, msg: 'Muitas tentativas. Tente de novo em alguns minutos.' };

    if (hashPin_(String(pin || ''), d.salt) !== d.pin_hash) {
      d.tentativas = (Number(d.tentativas) || 0) + 1;
      if (d.tentativas >= MAX_TENTATIVAS) {
        d.bloqueado_ate = new Date(Date.now() + BLOQUEIO_MIN * 60000); d.tentativas = 0;
        log_(email, 'pin_travado', BLOQUEIO_MIN + ' min');
      }
      gravarUsuario_(aba_('USUARIOS'), u.row, d);
      return generico;
    }
    d.tentativas = 0; d.bloqueado_ate = ''; d.ultimo_acesso = new Date();
    gravarUsuario_(aba_('USUARIOS'), u.row, d);
    const tk = token_();
    CacheService.getScriptCache().put('ses_' + tk, email, SESSAO_SEG);
    log_(email, 'login', '');
    return { ok: true, token: tk, email: email, admin: email === ADMIN_EMAIL };
  } finally { lock.releaseLock(); }
}

function sair(token) {
  CacheService.getScriptCache().remove('ses_' + String(token || ''));
  return { ok: true };
}

// Valida sessão a cada chamada: bloqueio/exclusão tem efeito imediato.
function sessao_(token) {
  const email = CacheService.getScriptCache().get('ses_' + String(token || ''));
  if (!email) return null;
  const u = acharUsuario_(email);
  if (!u || u.data.status !== 'ativo' || !dominioPermitido_(email)) { sair(token); return null; }   // fora do domínio: desconecta
  return email;
}

/* ============ DADOS ============ */
// Concorrentes prioritários: sempre buscados e mostrados primeiro. A lista fica editável na aba PRIORITARIOS.
const PRIORITARIOS_PADRAO = ["HIDROLIGHT", "MERCUR", "WINNER", "POWERLITE", "SUPERMEDY", "MOBIL", "PROLIFE", "ORTOBRAS", "ORTOMOBIL", "MOBIFREE", "OTTOBOCK", "PRAXIS", "MEDICINAL LIVE WELL", "ZIMEDICAL", "VANZETTI", "INDAIA", "MOVILIFE", "HEALTH CLEAN", "PROCIRURGICA", "G-TECH", "INFINITO SAUDE", "SUPRA STEEL", "MULTILASER", "BIC", "OMRON", "RELAXMEDIC", "ELGIN", "FISCHER", "FISCHER PRICE", "MEDICATE", "TAKE CARE", "ORTHO PAUHER", "CHANTAL", "ARTIPE", "KENDALL", "SALVAPÉ", "MEDIC AIR", "DILEPE", "MONTSERRAT", "BIOLAND", "MEDLEVENSOHN", "FREEDOM"];
// Marcas fora do segmento saúde (ex.: Karcher): não entram na coleta nem aparecem no painel.
// A lista fica editável na aba MARCAS_FORA; basta escrever a marca na coluna A.
const MARCAS_FORA_PADRAO = ['KARCHER', 'WAP', 'TRAMONTINA', 'VONDER', 'BLACK+DECKER'];
let MARCAS_FORA_CACHE = null;
function marcasFora_() {
  if (MARCAS_FORA_CACHE) return MARCAS_FORA_CACHE;
  let l = [];
  try { l = lerAba_('MARCAS_FORA').map(function (r) { return str_(r.marca); }).filter(String); } catch (e) {}
  if (!l.length) l = MARCAS_FORA_PADRAO.slice();
  MARCAS_FORA_CACHE = l.map(function (m) { return normMarca_(m); }).filter(String);
  return MARCAS_FORA_CACHE;
}
// Compara por palavra inteira, sem acento e sem pontuação: "Kärcher", "KARCHER BRASIL" e "karcher" caem; "Mobil" não derruba "Ortomobil".
function normMarca_(m) { return String(m || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
function marcaFora_(marca) {
  const t = ' ' + normMarca_(marca) + ' ';
  if (!t.trim()) return false;
  return marcasFora_().some(function (m) { return t.indexOf(' ' + m + ' ') >= 0; });
}

function prioritarios_() {
  const l = lerAba_('PRIORITARIOS').map(function (r) { return str_(r.marca); }).filter(String);
  return l.length ? l : PRIORITARIOS_PADRAO.slice();
}

// Nomes corretos de vendedores: alguns marketplaces (ex.: Magalu) mostram só o código da loja na busca.
// A aba VENDEDORES corrige isso; os nomes abaixo valem mesmo se a aba ainda não existir.
const VENDEDORES_PADRAO = { 'dermomix': 'Dermomed' };
function mapaVendedores_() {
  const m = {};
  Object.keys(VENDEDORES_PADRAO).forEach(function (k) { m[normVend_(k)] = VENDEDORES_PADRAO[k]; });
  lerAba_('VENDEDORES').forEach(function (r) {
    const cod = normVend_(r.codigo), nome = str_(r.nome);
    if (cod && nome) m[(str_(r.marketplace) ? normVend_(r.marketplace) + '|' : '') + cod] = nome;
  });
  return m;
}
function normVend_(s) { return str_(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }
function nomeVendedor_(mapa, seller, marketplace) {
  const k = normVend_(seller);
  return mapa[normVend_(marketplace) + '|' + k] || mapa[k] || str_(seller);
}

// Dados do painel com cache: a montagem (ler todas as abas) só acontece quando algo mudou.
// O cache guarda os dados compactados, em pedaços (limite de 100 KB por item do CacheService), por até 6 horas,
// e é renovado quando a versão muda (fim da coleta, ocorrência marcada, edição manual da planilha).
function carregarDados(token) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  const dados = dadosComCache_();
  dados.ok = true; dados.email = email; dados.admin = email === ADMIN_EMAIL;
  try { dados.agenda = agendaColeta_(); } catch (e) { dados.agenda = null; }   // fora do cache: mostra coleta em andamento na hora
  return dados;
}
// Consulta leve para o botão Atualizar: coleta em andamento e data da última, sem carregar os dados.
function statusColeta(token) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  let ag = null; try { ag = agendaColeta_(); } catch (e) {}
  return { ok: true, agenda: ag, ultimaColeta: ultimaColeta_() };
}
function invalidarDados_() { PropertiesService.getScriptProperties().setProperty('DADOS_VER', String(Date.now())); }
function onEdit() { try { invalidarDados_(); } catch (e) {} }        // edição manual da planilha (aba VENDEDORES, TAXAS etc.)
function dadosComCache_() {
  const cache = CacheService.getScriptCache();
  const ver = PropertiesService.getScriptProperties().getProperty('DADOS_VER') || '0';
  const chave = 'dados_' + ver;
  try {
    const n = Number(cache.get(chave + '_n') || 0);
    if (n) {
      const ks = []; for (let i = 0; i < n; i++) ks.push(chave + '_' + i);
      const partes = cache.getAll(ks);
      if (ks.every(function (k) { return partes[k]; })) {
        const b64 = ks.map(function (k) { return partes[k]; }).join('');
        const json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString();
        return JSON.parse(json);
      }
    }
  } catch (e) {}
  const dados = montarDados_();
  try {
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(dados), 'application/json')).getBytes());
    const tam = 95000, mapa = {}, n = Math.ceil(b64.length / tam);
    if (n <= 200) {
      for (let i = 0; i < n; i++) mapa[chave + '_' + i] = b64.slice(i * tam, (i + 1) * tam);
      mapa[chave + '_n'] = String(n);
      cache.putAll(mapa, 21600);
    }
  } catch (e) {}
  return dados;
}
// Preço da coleta anterior: para cada anúncio, o preço dele na última coleta concluída ANTES da captura atual
// (aba PRECO_ANTERIOR, montada no fim de cada coleta a partir do HISTORICO).
// Diagnóstico de 1 clique: por que a coluna "Preço coleta anterior" está vazia.
function diagnosticarPrecoAnterior() {
  const ui = SpreadsheetApp.getUi(), L = [];
  const dia = function (x) { return x instanceof Date ? Utilities.formatDate(x, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : String(x).slice(0, 16); };
  // coletas distintas no HISTORICO
  let labelsH = [];
  try {
    const v = aba_('HISTORICO').getDataRange().getValues();
    const ic = v[0].map(function (x) { return String(x).trim().toLowerCase(); }).indexOf('coleta');
    const set = {}; for (let i = 1; i < v.length; i++) set[dia(v[i][ic])] = 1;
    labelsH = Object.keys(set).sort();
    L.push('HISTORICO: ' + labelsH.length + ' coleta(s). Últimas: ' + labelsH.slice(-4).join('  |  '));
  } catch (e) { L.push('HISTORICO: não encontrado.'); }
  // PRECO_ANTERIOR
  let labelsP = [], linhasP = 0;
  try {
    const v = aba_('PRECO_ANTERIOR').getDataRange().getValues();
    linhasP = Math.max(0, v.length - 1);
    const ic = v[0].map(function (x) { return String(x).trim().toLowerCase(); }).indexOf('coleta');
    const set = {}; for (let i = 1; i < v.length; i++) set[dia(v[i][ic])] = 1;
    labelsP = Object.keys(set).sort();
    L.push('PRECO_ANTERIOR: ' + linhasP + ' linhas em ' + labelsP.length + ' coleta(s). ' + labelsP.join('  |  '));
  } catch (e) { L.push('PRECO_ANTERIOR: aba não existe ainda.'); }
  // conclusão
  L.push('');
  if (labelsH.length < 2 || labelsP.length < 2) {
    L.push('CAUSA: só há 1 coleta para comparar. O "Preço coleta anterior" começa a aparecer a partir da 2ª coleta concluída (com coleta_ok). Na 1ª, tudo fica como "novo".');
    L.push('O quê fazer: deixe a próxima coleta das 5h rodar, ou rode "Coleta: recomeçar do zero", e confira de novo depois.');
  } else {
    // há 2+ coletas: testa um anúncio real
    let achou = 0, testados = 0;
    try {
      const pa = precoAnteriorIdx_();
      const ans = lerAba_('ANUNCIOS').filter(function (r) { return str_(r.origem) === 'COLETA' && str_(r.seller) !== 'DELLAMED' && num_(r.preco) > 0; }).slice(0, 30);
      ans.forEach(function (r) { testados++; const x = pa.buscar(str_(r.marketplace), str_(r.link), str_(r.item_id), str_(r.seller), str_(r.sku), r.data_captura); if (x && x.p > 0) achou++; });
    } catch (e) { L.push('Erro ao testar: ' + e.message); }
    L.push('TESTE: de ' + testados + ' anúncios, ' + achou + ' encontraram preço na coleta anterior.');
    L.push(achou > 0 ? 'A coluna deve estar preenchendo. Se não aparece no painel, publique a versão nova do Codigo.gs e do Painel.html e recarregue o painel.'
                     : 'Nenhum casou com a coleta anterior (anúncios podem ter mudado de link entre coletas). Me mande este texto.');
  }
  ui.alert('Diagnóstico — Preço coleta anterior', L.join('\n'), ui.ButtonSet.OK);
}
function precoAnteriorIdx_() {
  let rows = [];
  try { rows = lerAba_('PRECO_ANTERIOR'); } catch (e) {}
  if (!rows.length) { try { colAtualizarPrecoAnterior_(); rows = lerAba_('PRECO_ANTERIOR'); } catch (e) {} }
  const ts = function (s) { s = s instanceof Date ? Utilities.formatDate(s, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : String(s).slice(0, 16); const d = new Date(s.replace(' ', 'T') + ':00-03:00'); return isNaN(d) ? 0 : d.getTime(); };
  const snaps = {};
  rows.forEach(function (r) {
    const t = ts(r.coleta); if (!t) return;
    const s = snaps[t] || (snaps[t] = { t: t, rotulo: Utilities.formatDate(new Date(t), 'America/Sao_Paulo', 'dd/MM HH:mm'), k: {}, a: {} });
    const p = num_(r.preco); if (!(p > 0)) return;
    const de = num_(r.preco_cheio) > p ? num_(r.preco_cheio) : 0;
    s.k[str_(r.chave)] = { p: p, de: de };
    s.a[normVend_(r.marketplace) + '|' + normVend_(r.vendedor_ou_marca) + '|' + str_(r.sku)] = { p: p, de: de };
  });
  const lista = Object.keys(snaps).map(function (k) { return snaps[k]; }).sort(function (a, b) { return a.t - b.t; });
  let rodando = false; try { rodando = !!PropertiesService.getScriptProperties().getProperty('COL_FASE'); } catch (e) {}
  return {
    rotulo: lista.length ? lista[lista.length > 1 && !rodando ? lista.length - 2 : lista.length - 1].rotulo : '',
    buscar: function (mk, link, item, seller, sku, captura) {
      if (!lista.length) return null;
      let s = null;
      const t = captura instanceof Date ? captura.getTime() : 0;
      if (t) { for (let i = lista.length - 1; i >= 0; i--) if (lista[i].t < t - 60000) { s = lista[i]; break; } }
      else s = lista[lista.length > 1 && !rodando ? lista.length - 2 : lista.length - 1];
      if (!s) return null;
      const k = typeof colChaveAnuncio_ === 'function' ? colChaveAnuncio_(mk, link, item) : String(link || '').split(/[?#]/)[0];
      return s.k[k] || (seller ? s.a[normVend_(mk) + '|' + normVend_(seller) + '|' + str_(sku)] : null) || { p: 0, novo: true, rotulo: s.rotulo };
    }
  };
}
function montarDados_() {
  const vend = mapaVendedores_();
  const pa = precoAnteriorIdx_();
  const ant = function (mk, link, item, seller, sku, cap) { const x = pa.buscar(mk, link, item, seller, sku, cap); return x ? (x.novo ? -1 : x.p) : ''; };   // -1 = anúncio novo
  const antDe = function (mk, link, item, seller, sku, cap) { const x = pa.buscar(mk, link, item, seller, sku, cap); return x && x.de ? x.de : 0; };      // "De" da coleta anterior

  const vincItem = {};
  try { const ok = {}; itensLista_().forEach(function (x) { ok[x] = 1; });
    lerAba_('VINCULO_ITEM').forEach(function (r) { const it = str_(r.item).toUpperCase(), k = str_(r.link_ou_codigo); if (!it || !k || !ok[it]) return;
      vincItem[colChaveVinculo_(k)] = it; }); } catch (e) {}
  // Decisões automáticas (ficha, descrição ou foto) da aba ITEM_AUTO valem até a próxima coleta; o vínculo manual manda
  const autoItem = {};
  try { const ok = {}; itensLista_().forEach(function (x) { ok[x] = 1; });
    lerAba_('ITEM_AUTO').forEach(function (r) { const it = str_(r.item).toUpperCase(); if (it && ok[it]) autoItem[colChaveVinculo_(str_(r.anuncio))] = it; }); } catch (e) {}
  const itemDoAnuncio = function (id, link) {
    const cat = (String(link || '').match(/\/p\/(MLB\d+)/i) || [])[1];
    const kid = colChaveVinculo_(id), kl = colChaveVinculo_(link);
    return vincItem[kid] || (cat && vincItem[cat.toUpperCase()]) || vincItem[kl] || vincItem[String(link || '')] || autoItem[kid] || autoItem[kl] || '';
  };
  const produtos = lerAba_('PRODUTOS_BASE').filter(function (r) { return r.sku; }).map(function (r) {
    const item = str_(r.item) || vincItem[str_(r.mlb_id).toUpperCase()] || vincItem[str_(r.link_oficial)] || '', pb = precoBase_(item, r.preco_base);
    return { sku: str_(r.sku), produto: str_(r.produto), categoria: str_(r.categoria), linha: str_(r.linha),
             preco_base: pb.preco, base_fonte: pb.fonte, preco_loja: num_(r.preco_base), link: url_(r.link_oficial), foto: url_(r.foto), exemplo: ehExemplo_(r), item: item };
  });
  const skuDoItem = {};                                                           // item → SKU do produto da loja
  produtos.forEach(function (p) { if (p.item && (!skuDoItem[p.item] || p.sku === p.item)) skuDoItem[p.item] = p.sku; });
  const anuncios = lerAba_('ANUNCIOS').filter(function (r) { return r.sku && r.seller && mkAtivo_(r); }).map(function (r) {
    const vi = str_(r.seller) === 'DELLAMED' ? '' : itemDoAnuncio(str_(r.item_id), str_(r.link));   // anúncio vinculado a outro item: vai para o produto certo
    if (vi && skuDoItem[vi]) r.sku = skuDoItem[vi];
    else if (vi) r._fora = true;                                                   // vinculado a item que a loja não vende: sai da tabela
    return { data: dataStr_(r.data_captura), marketplace: str_(r.marketplace), seller: nomeVendedor_(vend, r.seller, r.marketplace), sku: str_(r.sku),
             titulo: str_(r.titulo), preco: num_(r.preco), link: url_(r.link), reputacao: num_(r.reputacao_0a5),
             avaliacoes: num_(r.avaliacoes), vendidos: num_(r.vendidos), buybox: sim_(r.ganha_buybox), foto: url_(r.foto), exemplo: ehExemplo_(r),
             item: str_(r.item_id), precoCheio: num_(r.preco_cheio), hk: colChaveAnuncio_(str_(r.marketplace), str_(r.link), str_(r.item_id)),
             precoAnt: ant(str_(r.marketplace), str_(r.link), str_(r.item_id), str_(r.seller), str_(r.sku), r.data_captura),
             precoAntCheio: antDe(str_(r.marketplace), str_(r.link), str_(r.item_id), str_(r.seller), str_(r.sku), r.data_captura), _fora: !!r._fora };
  }).filter(function (a) { const f = a._fora; delete a._fora; return !f; });
  // Item sem anúncio na loja oficial (origem ITEM) não tem foto própria: usa a foto de um anúncio do mesmo item (loja Dellamed primeiro)
  const fotoAd = {};
  anuncios.forEach(function (a) { if (a.foto && (!fotoAd[a.sku] || a.seller === 'DELLAMED')) fotoAd[a.sku] = a.foto; });
  produtos.forEach(function (p) { if (!p.foto && fotoAd[p.sku]) p.foto = fotoAd[p.sku]; });
  // Quem vende cada produto concorrente (chave = link do anúncio na aba CONCORRENTES)
  let ofertasConc = [];
  try {
    ofertasConc = lerAba_('OFERTAS_CONC').filter(function (r) { return r.chave && num_(r.preco) > 0 && mkAtivo_(r); }).map(function (r) {
      return { chave: url_(r.chave), marketplace: str_(r.marketplace), seller: nomeVendedor_(vend, r.seller, r.marketplace), preco: num_(r.preco),
               link: url_(r.link), item: str_(r.item_id), data: dataStr_(r.data_captura), precoCheio: num_(r.preco_cheio),
               precoAnt: ant(str_(r.marketplace), str_(r.link), str_(r.item_id), str_(r.seller), '', r.data_captura),
               precoAntCheio: antDe(str_(r.marketplace), str_(r.link), str_(r.item_id), str_(r.seller), '', r.data_captura) };
    });
  } catch (e) {}
  const concorrentes = lerAba_('CONCORRENTES').filter(function (r) { return r.marca && r.categoria && mkAtivo_(r) && !marcaFora_(r.marca); }).map(function (r) {
    return { categoria: str_(r.categoria), marca: str_(r.marca), produto: str_(r.produto), marketplace: str_(r.marketplace),
             preco: num_(r.preco), nota: num_(r.nota_0a5), avaliacoes: num_(r.avaliacoes), vendidos: num_(r.vendidos),
             link: url_(r.link), fortes: str_(r.pontos_fortes), fracos: str_(r.pontos_fracos), foto: url_(r.foto), exemplo: ehExemplo_(r),
             precoCheio: num_(r.preco_cheio), data: dataStr_(r.data_captura), hk: colChaveAnuncio_(str_(r.marketplace), str_(r.link), str_(r.item_id)), precoAnt: ant(str_(r.marketplace), str_(r.link), str_(r.item_id), '', '', null),
             precoAntCheio: antDe(str_(r.marketplace), str_(r.link), str_(r.item_id), '', '', null) };
  });
  const taxas = lerAba_('TAXAS').filter(function (r) { return r.marketplace && mkAtivo_(r); }).map(function (r) {
    return { marketplace: str_(r.marketplace), modalidade: str_(r.modalidade), min: num_(r.preco_min),
             max: r.preco_max === '' ? 1e9 : num_(r.preco_max), comissao: num_(r.comissao_pct), fixo: num_(r.fixo_rs),
             frete: sim_(r.frete_vendedor), obs: str_(r.observacao) };
  });
  const st = {};
  lerAba_('OCORRENCIAS').forEach(function (r) { st[str_(r.review_id)] = r; });
  // item de cada avaliação Dellamed: pelo SKU do produto (exato) ou, em avaliações antigas, pelo nome do produto
  const itemPorSku = {}; produtos.forEach(function (p) { if (p.item) itemPorSku[p.sku] = p.item; });
  let ixItens = null; try { ixItens = itmIndice(itensLista_()); } catch (e) {}
  const itemDe = function (r) { if (!/dellamed/i.test(str_(r.marca))) return ''; return itemPorSku[str_(r.sku)] || (ixItens ? itmIdentificar(ixItens, str_(r.produto)) : ''); };
  const avaliacoes = lerAba_('AVALIACOES').filter(function (r) { return r.review_id && r.nota_1a5 !== '' && mkAtivo_(r) && !marcaFora_(r.marca); }).map(function (r) {
    const o = st[str_(r.review_id)] || {};
    return { id: str_(r.review_id), data: dataStr_(r.data).slice(0, 10), marketplace: str_(r.marketplace), marca: str_(r.marca),
             categoria: str_(r.categoria), sku: str_(r.sku), produto: str_(r.produto), nota: Math.max(1, Math.min(5, Math.round(num_(r.nota_1a5)))),
             titulo: str_(r.titulo), texto: str_(r.texto).slice(0, 2000), link: url_(r.link), foto: url_(r.foto),
             status: str_(o.status) === 'tratada' ? 'tratada' : 'aberta', por: str_(o.tratado_por), em: dataStr_(o.tratado_em),
             obs: str_(o.observacao), exemplo: ehExemplo_(r), item: itemDe(r) };
  });
  const exemplo = [produtos, anuncios, concorrentes, avaliacoes].some(function (l) { return l.some(function (x) { return x.exemplo; }); });
  const datas = anuncios.map(function (a) { return a.data; }).filter(String).sort();
  return {
    exemplo: exemplo,
    ultimaCaptura: datas.length ? datas[datas.length - 1] : '',
    ultimaColeta: ultimaColeta_(),
    coletaAnterior: pa.rotulo,
    config: { tolerancia: TOLERANCIA_PRECO, oficiais: SELLERS_OFICIAIS, prioritarios: prioritarios_() },
    itens: itensLista_(),
    produtos: produtos, anuncios: anuncios, concorrentes: concorrentes, ofertasConc: ofertasConc, taxas: taxas, avaliacoes: avaliacoes
  };
}

// Data da última coleta concluída (linha "coleta_ok" mais recente do LOG)
function ultimaColeta_() {
  const guardada = PropertiesService.getScriptProperties().getProperty('COL_ULTIMA');   // gravada no fim de cada coleta
  if (guardada) return guardada;
  const v = aba_('LOG').getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][2]) === 'coleta_ok') return dataStr_(v[i][0]);
  return '';
}

/* ============ HISTÓRICO DE COLETAS ============ */
function listarHistorico(token) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  return { ok: true, coletas: listaColetas_() };
}
// Todas as coletas guardadas, da mais nova para a mais antiga. Fonte rápida: o índice do Drive (_indice.json),
// que recebe toda coleta no mesmo dia em que ela termina. Fica em cache e só é refeito quando o índice muda.
function listaColetas_() {
  const cache = CacheService.getScriptCache(), c = cache.get('hist_lista2');
  if (c) return JSON.parse(c);
  const corte = Utilities.formatDate(new Date(Date.now() - COL_HIST_DIAS * 86400000), 'America/Sao_Paulo', 'yyyy-MM-dd');
  let lista = [];
  try {
    const ix = histIndice_();
    lista = Object.keys(ix).sort().reverse().map(function (k) { const x = ix[k];
      return { coleta: k, produtos: x.p || 0, anuncios: x.a || 0, concorrentes: x.c || 0, drive: k.slice(0, 10) < corte }; });
  } catch (e) { log_('sistema', 'historico_drive_erro', 'índice: ' + String(e.message || e).slice(0, 200)); }
  if (!lista.length) lista = listaColetasPlanilha_();                              // sem índice ainda: lê a aba (lento, só nessa situação)
  try { cache.put('hist_lista2', JSON.stringify(lista), 21600); } catch (e) {}
  return lista;
}
function listaColetasPlanilha_() {
  const cont = {}, sh = aba_('HISTORICO'), nl = sh.getLastRow();
  if (nl > 1) {
    const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
    const ic = h.indexOf('coleta'), it = h.indexOf('tipo');
    const cs = sh.getRange(2, ic + 1, nl - 1, 1).getValues(), ts = sh.getRange(2, it + 1, nl - 1, 1).getValues();
    for (let i = 0; i < cs.length; i++) {
      if (cs[i][0] === '' || cs[i][0] === null) continue;
      const k = dataStr_(cs[i][0]), t = str_(ts[i][0]);
      const o = cont[k] || (cont[k] = { coleta: k, produtos: 0, anuncios: 0, concorrentes: 0 });
      if (t === 'Produto Dellamed') o.produtos++; else if (t === 'Concorrente') o.concorrentes++; else o.anuncios++;
    }
  }
  return Object.keys(cont).sort().reverse().map(function (k) { return cont[k]; });
}
// Linhas de uma coleta: da aba HISTORICO (só o trecho daquela coleta) ou do CSV no Drive.
function linhasColeta_(coleta) {
  try { const x = histIndice_()[coleta]; if (x && x.id) { const l = histLerDrive_(x.id); if (l.length) return l; } } catch (e) {}
  const sh = aba_('HISTORICO'), nl = sh.getLastRow();
  if (nl > 1) {
    const nc = sh.getLastColumn(), h = sh.getRange(1, 1, 1, nc).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
    const ic = h.indexOf('coleta'), cs = sh.getRange(2, ic + 1, nl - 1, 1).getValues();
    let ini = -1, fim = -1;
    for (let i = 0; i < cs.length; i++) if (dataStr_(cs[i][0]) === coleta) { if (ini < 0) ini = i; fim = i; }
    if (ini >= 0) {
      return sh.getRange(ini + 2, 1, fim - ini + 1, nc).getValues().filter(function (r) { return dataStr_(r[ic]) === coleta; })
        .map(function (r) { const o = {}; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
    }
  }
  const d = histListarDrive_().filter(function (x) { return x.coleta === coleta; })[0];
  return d ? histLerDrive_(d.id) : [];
}
function baixarHistorico(token, coleta) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  coleta = str_(coleta);
  let fonte = lerAba_('HISTORICO').filter(function (r) { return dataStr_(r.coleta) === coleta; });
  if (!fonte.length) {                                                              // coleta antiga: lê o CSV salvo no Drive
    const d = histListarDrive_().filter(function (x) { return x.coleta === coleta; })[0];
    if (d) fonte = histLerDrive_(d.id).map(function (r) { r.preco = String(r.preco || '').replace(',', '.'); return r; });
  }
  const linhas = fonte.map(function (r) {
    return { tipo: str_(r.tipo), marketplace: str_(r.marketplace), vendedor_ou_marca: str_(r.vendedor_ou_marca), sku: str_(r.sku), categoria: str_(r.categoria),
             produto: str_(r.produto), preco: num_(r.preco), nota: str_(r.nota), avaliacoes: str_(r.avaliacoes), vendidos: str_(r.vendidos), link: url_(r.link) };
  });
  log_(email, 'baixou_historico', coleta);
  return { ok: true, coleta: coleta, linhas: linhas };
}

/* ============ PAINEL NUMA COLETA ANTERIOR ============ */
// O painel inteiro (abas Dellamed, Concorrentes e Simulador) passa a mostrar a coleta escolhida no calendário.
// Preço anterior = a coleta guardada imediatamente antes dela. Foto, reputação, Buy Box e pontos fortes/fracos
// não ficam no histórico: vêm do mesmo anúncio na coleta atual, quando ele ainda existe.
function carregarDadosColeta(token, coleta) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  coleta = str_(coleta);
  const ck = 'dcol_' + coleta.replace(/[^0-9]/g, '');
  let dados = cacheLerJson_(ck);
  if (!dados) {
    dados = montarDadosColeta_(coleta);
    if (!dados) return { ok: false, msg: 'Coleta não encontrada.' };
    cacheGravarJson_(ck, dados);
  }
  dados.ok = true; dados.email = email; dados.admin = email === ADMIN_EMAIL;
  try { dados.agenda = agendaColeta_(); } catch (e) { dados.agenda = null; }
  return dados;
}
function montarDadosColeta_(coleta) {
  const rows = linhasColeta_(coleta);
  if (!rows.length) return null;
  const atual = dadosComCache_(), vend = mapaVendedores_();
  const chave = function (mk, link, item) { return colChaveAnuncio_(mk, link, item); };
  // coleta anterior a esta, para "Preço coleta anterior"
  const todas = listaColetas_().map(function (x) { return x.coleta; }).sort();
  const pos = todas.indexOf(coleta), prev = pos > 0 ? todas[pos - 1] : '';
  const ant = {}, antA = {};
  if (prev) linhasColeta_(prev).forEach(function (r) {
    const p = num_(r.preco); if (!(p > 0)) return;
    const o = { p: p, de: num_(r.preco_cheio) > p ? num_(r.preco_cheio) : 0 };
    ant[chave(str_(r.marketplace), str_(r.link), str_(r.item_id))] = o;
    antA[normVend_(r.marketplace) + '|' + normVend_(r.vendedor_ou_marca) + '|' + str_(r.sku)] = o;
  });
  const busca = function (mk, link, item, seller, sku) {
    if (!prev) return null;
    return ant[chave(mk, link, item)] || (seller ? antA[normVend_(mk) + '|' + normVend_(seller) + '|' + str_(sku)] : null) || { p: 0, novo: true };
  };
  const pAnt = function (x) { return x ? (x.novo ? -1 : x.p) : ''; };
  // dados de apoio da coleta atual, pelo mesmo anúncio
  const prodAt = {}; atual.produtos.forEach(function (p) { prodAt[p.sku] = p; });
  const adAt = {}; atual.anuncios.forEach(function (a) { adAt[chave(a.marketplace, a.link, a.item)] = a; });
  const ccAt = {}; atual.concorrentes.forEach(function (x) { ccAt[chave(x.marketplace, x.link, '')] = x; });
  const produtos = [], anuncios = [], concorrentes = [];
  rows.forEach(function (r) {
    const t = str_(r.tipo), mk = str_(r.marketplace), link = url_(r.link), item = str_(r.item_id), preco = num_(r.preco);
    if (mk && !mkAtivo_(r)) return;
    if (t === 'Produto Dellamed') {
      const b = prodAt[str_(r.sku)] || {};
      const pb = precoBase_(b.item || '', preco);
      produtos.push({ sku: str_(r.sku), produto: str_(r.produto), categoria: str_(r.categoria) || b.categoria || '', linha: b.linha || '',
                      preco_base: pb.preco, base_fonte: pb.fonte, preco_loja: preco, link: link || b.link || '', foto: b.foto || '', exemplo: false, item: b.item || '' });
    } else if (t === 'Anúncio loja oficial' || t === 'Anúncio revendedor') {
      const b = adAt[chave(mk, link, item)] || {}, x = busca(mk, link, item, str_(r.vendedor_ou_marca), str_(r.sku));
      anuncios.push({ data: coleta, marketplace: mk, seller: nomeVendedor_(vend, r.vendedor_ou_marca, mk), sku: str_(r.sku), titulo: str_(r.produto),
                      preco: preco, link: link, reputacao: b.reputacao || 0, avaliacoes: num_(r.avaliacoes), vendidos: num_(r.vendidos),
                      buybox: !!b.buybox, foto: b.foto || '', exemplo: false, item: item, precoCheio: num_(r.preco_cheio),
                      precoAnt: pAnt(x), precoAntCheio: x && x.de ? x.de : 0 });
    } else if (t === 'Concorrente') {
      if (marcaFora_(r.vendedor_ou_marca)) return;
      const b = ccAt[chave(mk, link, '')] || {}, x = busca(mk, link, item, '', '');
      concorrentes.push({ categoria: str_(r.categoria), marca: str_(r.vendedor_ou_marca), produto: str_(r.produto), marketplace: mk, preco: preco,
                          nota: num_(r.nota), avaliacoes: num_(r.avaliacoes), vendidos: num_(r.vendidos), link: link,
                          fortes: b.fortes || '', fracos: b.fracos || '', foto: b.foto || '', exemplo: false,
                          precoCheio: num_(r.preco_cheio), precoAnt: pAnt(x), precoAntCheio: x && x.de ? x.de : 0 });
    }
  });
  return {
    exemplo: false, historico: coleta,
    ultimaCaptura: coleta, ultimaColeta: coleta,
    coletaAnterior: prev ? Utilities.formatDate(new Date(prev.replace(' ', 'T') + ':00-03:00'), 'America/Sao_Paulo', 'dd/MM HH:mm') : '',
    config: atual.config, itens: atual.itens,
    produtos: produtos.filter(function (p) { return p.sku; }), anuncios: anuncios.filter(function (a) { return a.sku && a.seller; }),
    concorrentes: concorrentes.filter(function (x) { return x.marca && x.categoria; }),
    ofertasConc: [],                                                               // sellers dos concorrentes não ficam no histórico
    taxas: atual.taxas, avaliacoes: atual.avaliacoes                               // Voz do cliente tem o próprio filtro de período
  };
}
// Cache de objetos grandes: JSON compactado em pedaços (limite de 100 KB por item do CacheService), por 6 horas.
function cacheLerJson_(chave) {
  try {
    const cache = CacheService.getScriptCache(), n = Number(cache.get(chave + '_n') || 0);
    if (!n) return null;
    const ks = []; for (let i = 0; i < n; i++) ks.push(chave + '_' + i);
    const partes = cache.getAll(ks);
    if (!ks.every(function (k) { return partes[k]; })) return null;
    const b64 = ks.map(function (k) { return partes[k]; }).join('');
    return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString());
  } catch (e) { return null; }
}
function cacheGravarJson_(chave, obj) {
  try {
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
    const tam = 95000, mapa = {}, n = Math.ceil(b64.length / tam);
    if (n > 200) return;
    for (let i = 0; i < n; i++) mapa[chave + '_' + i] = b64.slice(i * tam, (i + 1) * tam);
    mapa[chave + '_n'] = String(n);
    CacheService.getScriptCache().putAll(mapa, 21600);
  } catch (e) {}
}

function registrarExportacao(token, tipo) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  log_(email, 'exportou_excel', str_(tipo).slice(0, 60));
  return { ok: true };
}

/* ============ VOZ DO CLIENTE ============ */
function marcarOcorrencia(token, reviewId, status, obs, dataTrat) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  reviewId = str_(reviewId); status = status === 'tratada' ? 'tratada' : 'aberta'; obs = str_(obs).slice(0, 500);
  if (!reviewId) return { ok: false, msg: 'Avaliação inválida.' };
  // data do tratamento: obrigatória para marcar como tratada, nunca no futuro
  dataTrat = str_(dataTrat);
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  if (status === 'tratada') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataTrat)) return { ok: false, msg: 'Informe a data em que o tratamento foi feito.' };
    if (dataTrat > hoje) return { ok: false, msg: 'A data do tratamento não pode ser no futuro.' };
  }
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, msg: 'O sistema está ocupado. Tente de novo em alguns segundos.' };
  try {
    const sh = aba_('OCORRENCIAS'), v = sh.getDataRange().getValues();
    const quando = status === 'tratada' ? new Date(dataTrat + 'T12:00:00-03:00') : '';   // data informada pelo usuário
    const linha = [reviewId, status, status === 'tratada' ? email : '', quando, obs];
    let row = 0;
    for (let i = 1; i < v.length; i++) if (str_(v[i][0]) === reviewId) { row = i + 1; break; }
    if (row) sh.getRange(row, 1, 1, linha.length).setValues([linha]); else sh.appendRow(linha);
    log_(email, status === 'tratada' ? 'ocorrencia_tratada' : 'ocorrencia_reaberta', reviewId + (status === 'tratada' ? ' · tratado em ' + dataTrat : ''));
    invalidarDados_();
    return { ok: true, status: status, por: linha[2], em: status === 'tratada' ? dataTrat : '', obs: obs };
  } finally { lock.releaseLock(); }
}

/* ============ ADMIN ============ */
function adminListar(token) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  if (email !== ADMIN_EMAIL) return { ok: false, msg: 'Sem permissão.' };
  const usuarios = lerAba_('USUARIOS').map(function (r) {
    return { email: str_(r.email), status: str_(r.status), criado: dataStr_(r.criado_em),
             pin: dataStr_(r.pin_gerado_em), ultimo: dataStr_(r.ultimo_acesso) };
  });
  const log = lerAba_('LOG').slice(-80).reverse().map(function (r) {
    return { data: dataStr_(r.data), email: str_(r.email), evento: str_(r.evento), detalhe: str_(r.detalhe) };
  });
  return { ok: true, usuarios: usuarios, log: log };
}

function adminAcao(token, alvo, acao) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  if (email !== ADMIN_EMAIL) return { ok: false, msg: 'Sem permissão.' };
  alvo = normEmail_(alvo);
  if (alvo === ADMIN_EMAIL) return { ok: false, msg: 'A conta administradora não pode ser alterada aqui.' };
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, msg: 'O sistema está ocupado. Tente de novo em alguns segundos.' };
  try {
    const sh = aba_('USUARIOS');
    const u = acharUsuario_(alvo);
    if (!u) return { ok: false, msg: 'Usuário não encontrado.' };
    if (acao === 'excluir') { sh.deleteRow(u.row); }
    else {
      const novo = { aprovar: 'ativo', desbloquear: 'ativo', bloquear: 'bloqueado' }[acao];
      if (!novo) return { ok: false, msg: 'Ação inválida.' };
      u.data.status = novo; u.data.tentativas = 0; u.data.bloqueado_ate = '';
      gravarUsuario_(sh, u.row, u.data);
      if (acao === 'aprovar') {
        MailApp.sendEmail({ to: alvo, subject: 'Acesso liberado — Diagnóstico Dellamed',
          htmlBody: emailHtml_('Seu acesso foi liberado', '<p>Já é possível entrar com seu e-mail e o PIN que você gerou.</p>' + linkApp_()) });
      }
    }
    log_(email, 'admin_' + acao, alvo);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ============ SETUP ============ */
function configurarPlanilha() {
  Object.keys(ABAS).forEach(function (nome) {
    const sh = aba_(nome);
    const h = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
    ABAS[nome].forEach(function (col) {
      if (h.indexOf(col) < 0) { h.push(col); sh.getRange(1, h.length).setValue(col).setFontWeight('bold').setBackground('#0F3C6E').setFontColor('#FFFFFF'); }
    });
  });
  pepper_();
  const tx = aba_('TAXAS');
  if (tx.getLastRow() < 2) {
    const ref = 'Referência 2026 — validar na central do vendedor';
    const L = [
      ['Mercado Livre', 'Clássico', 0, 78.99, 13, 6.5, 'Não', ref + '; custo por unidade varia por peso'],
      ['Mercado Livre', 'Clássico', 79, '', 13, 0, 'Sim', ref],
      ['Mercado Livre', 'Premium', 0, 78.99, 18, 6.5, 'Não', ref + '; custo por unidade varia por peso'],
      ['Mercado Livre', 'Premium', 79, '', 18, 0, 'Sim', ref],
      ['Shopee', 'CNPJ', 0, 79.99, 20, 4, 'Não', ref],
      ['Shopee', 'CNPJ', 80, 99.99, 14, 16, 'Não', ref],
      ['Shopee', 'CNPJ', 100, 199.99, 14, 20, 'Não', ref],
      ['Shopee', 'CNPJ', 200, '', 14, 26, 'Não', ref],
      ['Amazon', 'Profissional', 0, '', 12, 0, 'Sim', ref + '; somar 1,5% se usar parcelamento sem juros'],
      ['Magazine Luiza', 'Padrão', 0, '', 16, 0, 'Sim', 'VALIDAR — valor de referência, confirmar no contrato']
    ];
    tx.getRange(2, 1, L.length, L[0].length).setValues(L);
  }
  const it = aba_('ITENS');
  if (it.getLastRow() < 2) it.getRange(2, 1, ITENS_PADRAO.length, 2).setValues(ITENS_PADRAO.map(function (m) { return [m, '']; }));
  const pr = aba_('PRIORITARIOS');
  if (pr.getLastRow() < 2) pr.getRange(2, 1, PRIORITARIOS_PADRAO.length, 2).setValues(PRIORITARIOS_PADRAO.map(function (m) { return [m, '']; }));
  const mf = aba_('MARCAS_FORA');
  if (mf.getLastRow() < 2) mf.getRange(2, 1, MARCAS_FORA_PADRAO.length, 2).setValues(MARCAS_FORA_PADRAO.map(function (m) { return [m, 'fora do segmento saúde']; }));
  const vd = aba_('VENDEDORES');
  if (vd.getLastRow() < 2) vd.getRange(2, 1, 1, 4).setValues([['dermomix', 'Dermomed', '', 'código que aparece na busca → nome correto']]);
  const u = aba_('USUARIOS');
  u.hideSheet();
  SpreadsheetApp.getActive().toast('Planilha configurada.');
}

/* ============ AUXILIARES ============ */
function aba_(nome) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, ABAS[nome].length).setValues([ABAS[nome]]).setFontWeight('bold').setBackground('#0F3C6E').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
/* ---------- PREÇO BASE = PMV (aba PMV da planilha: ITEM + preço) ----------
 * Lê a aba PMV procurando a coluna do item e a do preço pelo nome do cabeçalho (ITEM; PMV, PREÇO, VALOR ou BASE).
 * Produto sem PMV cadastrado continua com o preço da loja oficial, marcado como "loja" para o painel avisar.
 * Item que está na aba PMV sem número (ex.: "Em processo") fica SEM preço base: as comparações com o PMV mostram "—". */
let PMV_CACHE_ = null;
function pmvChave_(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }   // D 600 = D600 = D-600
// Lê a aba PMV e liga cada linha a um ITEM da aba ITENS:
//   1) coluna "ITEM PAINEL" (opcional), se você preencher à mão — manda em tudo;
//   2) nome igual ao da aba ITENS (ignorando espaço, hífen e acento);
//   3) reconhecimento pelo nome (o mesmo usado para identificar o item nos anúncios: código do modelo + palavras).
function pmvLinhas_() {
  const out = [];
  const sh = SpreadsheetApp.getActive().getSheetByName('PMV');
  if (!sh || sh.getLastRow() < 2) return out;
  const v = sh.getDataRange().getValues();
  let hr = 0;
  for (let i = 0; i < Math.min(v.length, 10); i++) if (v[i].some(function (c) { return /item/i.test(String(c)); })) { hr = i; break; }
  const h = v[hr].map(function (c) { return pmvChave_(c); });
  const iMan = h.findIndex(function (c) { return /^ITEM(PAINEL|ITENS|DIAGNOSTICO)$/.test(c); });
  const iI = h.findIndex(function (c, j) { return j !== iMan && /ITEM/.test(c); });
  let iP = h.findIndex(function (c, j) { return j !== iI && j !== iMan && /PMV/.test(c); });
  if (iP < 0) iP = h.findIndex(function (c, j) { return j !== iI && j !== iMan && /PRECO|VALOR|BASE/.test(c); });
  if (iI < 0 || iP < 0) return out;
  const itens = itensLista_(), porChave = {};
  itens.forEach(function (x) { porChave[pmvChave_(x)] = x; });
  let ix = null; try { ix = itmIndice(itens); } catch (e) {}
  for (let r = hr + 1; r < v.length; r++) {
    const nome = String(v[r][iI] || '').trim(); let pr = v[r][iP];
    if (typeof pr !== 'number') pr = Number(String(pr).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!nome) continue;
    const pend = !(pr > 0);                                                            // sem número (ex.: "Em processo"): PMV pendente
    let item = '', como = '';
    const man = iMan >= 0 ? String(v[r][iMan] || '').trim() : '';
    if (man && porChave[pmvChave_(man)]) { item = porChave[pmvChave_(man)]; como = 'manual (ITEM PAINEL)'; }
    else if (porChave[pmvChave_(nome)]) { item = porChave[pmvChave_(nome)]; como = 'nome igual'; }
    else if (ix) { const d = itmDetalhe(ix, nome); if (d.nome) { item = d.nome; como = 'reconhecido pelo nome'; } else if (d.cands.length) como = 'ambíguo: ' + d.cands.slice(0, 4).join(', '); }
    out.push({ linha: r + 1, nome: nome, preco: pend ? 0 : Math.round(pr * 100) / 100, item: item, como: como || 'não reconhecido',
               pendente: pend, status: pend ? (String(v[r][iP] || '').trim() || 'sem valor') : '' });
  }
  return out;
}
function pmvMapa_() {
  if (PMV_CACHE_) return PMV_CACHE_;
  const m = {};
  try {
    const ls = pmvLinhas_();
    // manual e nome igual primeiro; reconhecimento só preenche o que faltar
    ls.filter(function (l) { return l.item && !l.pendente && !/reconhecido/.test(l.como); }).forEach(function (l) { const k = pmvChave_(l.item); if (!m[k]) m[k] = l.preco; });
    ls.filter(function (l) { return l.item && !l.pendente && /reconhecido/.test(l.como); }).forEach(function (l) { const k = pmvChave_(l.item); if (!m[k]) m[k] = l.preco; });
    // item na aba PMV ainda sem valor (ex.: "Em processo"): -1 = pendente, sem preço base (só se não tiver valor em outra linha)
    ls.filter(function (l) { return l.item && l.pendente; }).forEach(function (l) { const k = pmvChave_(l.item); if (!m[k]) m[k] = -1; });
  } catch (e) {}
  PMV_CACHE_ = m;
  return m;
}
// Menu: mostra como cada linha do PMV foi ligada a um ITEM e quais itens ficaram sem PMV (aba PMV_CONFERENCIA)
function conferirPMV() {
  const ls = pmvLinhas_(), usados = {};
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('PMV_CONFERENCIA') || ss.insertSheet('PMV_CONFERENCIA');
  sh.clear();
  const rows = [['Linha na aba PMV', 'Item no PMV', 'PMV (R$)', 'ITEM do painel (aba ITENS)', 'Como foi ligado']];
  ls.forEach(function (l) {
    const k = pmvChave_(l.item);
    const conflito = l.item && !l.pendente && typeof usados[k] === 'number' && usados[k] !== l.preco;
    if (l.item && !l.pendente && typeof usados[k] !== 'number') usados[k] = l.preco;
    if (l.item && l.pendente && !usados[k]) usados[k] = 'pendente';
    rows.push([l.linha, l.nome, l.pendente ? l.status : l.preco, l.item || '—', (conflito ? l.como + ' · CONFLITO: outro preço já usado para este item' : l.como) + (l.pendente && l.item ? ' · PMV pendente: comparações mostram —' : '')]);
  });
  const prods = lerAba_('PRODUTOS_BASE').filter(function (r) { return r.sku; });
  const semPmv = {};
  prods.forEach(function (r) { const it = itemProdutoBase_(r); if (it && !usados[pmvChave_(it)]) semPmv[it] = (semPmv[it] || 0) + 1; });
  rows.push(['', '', '', '', '']);
  rows.push(['', 'Itens da loja SEM PMV (usam o preço da loja oficial)', '', 'Anúncios da loja', '']);
  Object.keys(semPmv).sort().forEach(function (it) { rows.push(['', it, '', semPmv[it], 'adicione na aba PMV (ou preencha ITEM PAINEL)']); });
  sh.getRange(1, 1, rows.length, 5).setValues(rows);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold'); sh.setFrozenRows(1); sh.autoResizeColumns(1, 5);
  const nok = ls.filter(function (l) { return !l.item; }).length;
  invalidarDados_();
  SpreadsheetApp.getUi().alert('PMV', ls.length + ' linhas lidas na aba PMV: ' + (ls.length - nok) + ' ligadas a um ITEM, ' + nok + ' não reconhecidas.\n' +
    Object.keys(semPmv).length + ' itens da loja sem PMV.\nDetalhes na aba PMV_CONFERENCIA. Para corrigir uma linha, crie na aba PMV a coluna "ITEM PAINEL" e escreva o nome do item como está na aba ITENS.', SpreadsheetApp.getUi().ButtonSet.OK);
}
// item de uma linha da PRODUTOS_BASE (coluna item ou vínculo manual da aba VINCULO_ITEM), igual ao painel
let VINC_CACHE_ = null;
function itemProdutoBase_(r) {
  if (str_(r.item)) return str_(r.item);
  if (!VINC_CACHE_) { VINC_CACHE_ = {}; try { const ok = {}; itensLista_().forEach(function (x) { ok[x] = 1; });
    lerAba_('VINCULO_ITEM').forEach(function (v) { const it = str_(v.item).toUpperCase(), k = str_(v.link_ou_codigo); if (it && k && ok[it]) VINC_CACHE_[colChaveVinculo_(k)] = it; }); } catch (e) {} }
  return VINC_CACHE_[str_(r.mlb_id).toUpperCase()] || VINC_CACHE_[str_(r.link_oficial)] || '';
}
function precoBase_(item, precoLoja) {
  const v = pmvMapa_()[pmvChave_(item)];
  if (v > 0) return { preco: v, fonte: 'PMV' };
  if (v === -1) return { preco: 0, fonte: 'pendente' };                             // PMV "Em processo": sem preço base, sem usar a loja
  return { preco: num_(precoLoja), fonte: 'loja' };
}
function lerAba_(nome) {
  const v = aba_(nome).getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
  return v.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); })
    .map(function (r) { const o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
}
function acharUsuario_(email) {
  const v = aba_('USUARIOS').getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (normEmail_(v[i][0]) === email) {
      const d = {}; ABAS.USUARIOS.forEach(function (k, j) { d[k] = v[i][j]; });
      d.status = String(d.status || '').toLowerCase();
      return { row: i + 1, data: d };
    }
  }
  return null;
}
function gravarUsuario_(sh, row, d) {
  sh.getRange(row, 1, 1, ABAS.USUARIOS.length).setValues([ABAS.USUARIOS.map(function (k) { return d[k] === undefined ? '' : d[k]; })]);
}
function appendObjs_(nome, objs) {
  if (!objs.length) return;
  const sh = aba_(nome);
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
  const rows = objs.map(function (o) { return h.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; }); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, h.length).setValues(rows);
}
/* ============ ARQUIVO SEMESTRAL ============ */
// A cada 6 meses (ao fim de uma coleta), LOG e AVALIACOES com mais de 6 meses saem desta planilha e vão para
// a planilha "Diagnóstico Dellamed — arquivo" no Drive. Nada é apagado: só muda de planilha, para esta continuar leve.
const ARQ_MESES = 6;
function arquivarAgora() {
  const r = arquivarAntigos_(true);
  SpreadsheetApp.getActive().toast(r.msg, 'Arquivo', 15);
}
function arquivarAntigos_(forcar) {
  const p = PropertiesService.getScriptProperties();
  const ult = Number(p.getProperty('ARQ_ULTIMA') || 0);
  if (!ult && !forcar) { p.setProperty('ARQ_ULTIMA', String(Date.now())); return { msg: 'Primeira contagem iniciada.' }; }   // começa a contar os 6 meses
  if (!forcar && Date.now() - ult < 182 * 86400000) return { msg: 'Ainda não completou 6 meses.' };
  const corte = new Date(); corte.setMonth(corte.getMonth() - ARQ_MESES);
  const corteTxt = Utilities.formatDate(corte, 'America/Sao_Paulo', 'yyyy-MM-dd').slice(0, 10);
  let arq = null;
  const id = p.getProperty('ARQ_ID');
  if (id) { try { arq = SpreadsheetApp.openById(id); } catch (e) { arq = null; } }
  const movidos = {};
  const antiga = function (v) {
    const t = (v instanceof Date ? Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd') : String(v || '')).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) && t < corteTxt;                      // sem data: fica
  };
  const mover = function (nome, filtro) {
    const sh = aba_(nome), v = sh.getDataRange().getValues();
    if (v.length < 2) return 0;
    const fica = [v[0]], sai = [];
    v.slice(1).forEach(function (r) { (filtro(r, v[0]) ? sai : fica).push(r); });
    if (!sai.length) return 0;
    if (!arq) { arq = SpreadsheetApp.create('Diagnóstico Dellamed — arquivo'); p.setProperty('ARQ_ID', arq.getId()); }
    let dest = arq.getSheetByName(nome);
    if (!dest) { dest = arq.insertSheet(nome); dest.getRange(1, 1, 1, v[0].length).setValues([v[0]]).setFontWeight('bold'); dest.setFrozenRows(1); }
    dest.getRange(dest.getLastRow() + 1, 1, sai.length, sai[0].length).setValues(sai);
    sh.clearContents();
    sh.getRange(1, 1, fica.length, fica[0].length).setValues(fica);
    return sai.length;
  };
  const col = function (h, nome) { return h.map(function (x) { return String(x).trim().toLowerCase(); }).indexOf(nome); };
  const idsAntigos = {};
  movidos.AVALIACOES = mover('AVALIACOES', function (r, h) {
    const sai = antiga(r[col(h, 'data')]);
    if (sai) idsAntigos[String(r[col(h, 'review_id')])] = 1;
    return sai;
  });
  movidos.OCORRENCIAS = mover('OCORRENCIAS', function (r, h) { return !!idsAntigos[String(r[col(h, 'review_id')])]; });   // status acompanha o comentário
  movidos.LOG = mover('LOG', function (r, h) { return antiga(r[col(h, 'data')]); });
  p.setProperty('ARQ_ULTIMA', String(Date.now()));
  const total = movidos.AVALIACOES + movidos.OCORRENCIAS + movidos.LOG;
  const msg = total
    ? 'Arquivados (mais de ' + ARQ_MESES + ' meses): ' + movidos.AVALIACOES + ' comentários, ' + movidos.OCORRENCIAS + ' status de ocorrência, ' + movidos.LOG + ' linhas de LOG. Planilha de arquivo: ' + arq.getUrl()
    : 'Nada com mais de ' + ARQ_MESES + ' meses para arquivar.';
  log_('sistema', 'arquivamento', msg.slice(0, 480));
  invalidarDados_();
  return { msg: msg };
}

function log_(email, evento, detalhe) {
  try { aba_('LOG').appendRow([new Date(), email, evento, detalhe]); } catch (e) {}
}
function avisarAdmin_(email, acao, status) {
  const pend = status === 'pendente';
  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: (pend ? '[Aprovação pendente] ' : '') + email + ' ' + acao + ' — Diagnóstico Dellamed',
    htmlBody: emailHtml_('Solicitação de PIN',
      '<p><b>' + email + '</b> ' + acao + ' em ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') + '.</p>' +
      '<p>Status atual: <b>' + status + '</b>.' + (pend ? ' Esse e-mail é de fora do domínio Dellamed e só entra depois da sua aprovação.' : '') + '</p>' +
      '<p>Para aprovar, bloquear ou excluir, entre no painel e abra a aba Administração.</p>' + linkApp_())
  });
}
function linkApp_() {
  const url = PropertiesService.getScriptProperties().getProperty('APP_URL');
  return url ? '<p><a href="' + url + '" style="color:#36B0C9">Abrir o Diagnóstico</a></p>' : '';
}
function emailHtml_(titulo, corpo) {
  return '<div style="font-family:Montserrat,Arial,sans-serif;max-width:520px;color:#13243A">' +
    '<div style="background:#0F3C6E;color:#fff;padding:18px 22px;font-size:20px;font-weight:700">dellamed <span style="font-weight:300">diagnóstico</span></div>' +
    '<div style="padding:22px;border:1px solid #DCE3EA;border-top:0"><h2 style="font-size:17px;margin:0 0 8px">' + titulo + '</h2>' + corpo + '</div></div>';
}
function pepper_() {
  const p = PropertiesService.getScriptProperties();
  let v = p.getProperty('PEPPER');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('PEPPER', v); }
  return v;
}
function hash_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}
function hashPin_(pin, salt) {
  let h = pin + '|' + salt + '|' + pepper_();
  for (let i = 0; i < 800; i++) h = hash_(h + salt);
  return h;
}
function rand6_() {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random());
  const n = (((b[0] & 255) << 16) | ((b[1] & 255) << 8) | (b[2] & 255)) % 1000000;
  return ('000000' + n).slice(-6);
}
// PIN: 6 a 20 caracteres, sem espaço, com pelo menos uma letra (diferencia maiúsculas).
function pinInvalido_(pin) {
  if (!/^\S{6,20}$/.test(pin)) return 'O PIN precisa ter de 6 a 20 caracteres, sem espaços.';
  if (!/[A-Za-zÀ-ÿ]/.test(pin)) return 'O PIN precisa ter pelo menos uma letra.';
  if (/^(.)\1+$/.test(pin)) return 'PIN fácil demais. Evite repetir o mesmo caractere.';
  if (/^(123456|abcdef|qwerty|senha1|dellamed)/i.test(pin)) return 'PIN fácil demais. Escolha outra combinação.';
  return '';
}
function token_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function emailValido_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length < 120; }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num_(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/[R$\s%]/g, '');
  if (!s) return 0;
  const n = parseFloat(s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s);
  return isNaN(n) ? 0 : n;
}
function sim_(v) { return v === true || /^(s|sim|y|yes|true|1|x)$/i.test(String(v).trim()); }
function url_(v) { const s = str_(v); return /^https?:\/\//i.test(s) ? s : ''; }
function ehExemplo_(r) { return String(r.origem || '').toUpperCase() === 'EXEMPLO'; }
function dataStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
  return str_(v);
}

/* ============ MARKETPLACES RETIRADOS ============ */
// Apaga das abas de trabalho as linhas de Carrefour e Casas Bahia. O HISTORICO fica intacto (registro das coletas antigas).
function removerMarketplacesFora() {
  const res = [];
  ['ANUNCIOS', 'CONCORRENTES', 'AVALIACOES', 'TAXAS'].forEach(function (nome) {
    const sh = aba_(nome), v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    const col = v[0].map(function (h) { return String(h).trim().toLowerCase(); }).indexOf('marketplace');
    if (col < 0) return;
    const manter = [v[0]].concat(v.slice(1).filter(function (r) { return MKS_FORA.indexOf(String(r[col]).trim()) < 0; }));
    const tirou = v.length - manter.length;
    if (!tirou) return;
    sh.clearContents();
    sh.getRange(1, 1, manter.length, manter[0].length).setValues(manter);
    res.push(nome + ': ' + tirou);
  });
  invalidarDados_();
  log_('sistema', 'marketplaces_removidos', res.join(' | ') || 'nada a remover');
  SpreadsheetApp.getActive().toast(res.length ? 'Removido — ' + res.join(', ') : 'Nenhuma linha de Carrefour ou Casas Bahia.');
}


/* ============ HISTÓRICO DE PREÇOS (gráficos de linha do painel) ============
 * Últimos 30 dias da aba HISTORICO, uma coleta por dia (a última do dia).
 *   an[chave do anúncio] = preço em cada dia (0 = anúncio não apareceu naquela coleta)
 *   sk[sku] = { b: preço base da loja oficial por dia, p: por dia, lista de [marketplace, preço] dos revendedores }
 * Montado uma vez por coleta e guardado em cache.
 */
function historicoPrecos(token) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  const ult = hpVersao_(), ck = 'hprec_' + ult.replace(/[^0-9]/g, '');
  const d = hpDados_(); d.ok = true; return d;
}
// O painel pede só o que vai desenhar (um anúncio ou os SKUs do ITEM escolhido): resposta pequena e rápida.
function hpDados_() {
  const ult = hpVersao_(), ck = 'hprec_' + ult.replace(/[^0-9]/g, '');
  let d = cacheLerJson_(ck);
  if (!d) { d = hpLerDrive_(); if (d) cacheGravarJson_(ck, d); }                 // arquivo pronto no Drive (montado pela coleta)
  return d || hpVazio_();                                                          // nunca monta na hora: o painel não pode travar
}
function hpVazio_() { return { dias: [], mks: HP_MKS, an: {}, sk: {} }; }
function historicoPrecoAnuncios(token, chaves) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  try {
    const d = hpDados_(), dados = {};
    [].concat(chaves || []).slice(0, 50).forEach(function (k) { k = str_(k); if (d.an[k]) dados[k] = d.an[k]; });
    return { ok: true, dias: d.dias, mks: d.mks, dados: dados };
  } catch (e) { return { ok: false, msg: String(e.message || e).slice(0, 200) }; }
}
function historicoPrecoSkus(token, skus) {
  const email = sessao_(token);
  if (!email) return { ok: false, sessao: false };
  try {
    const d = hpDados_(), dados = {};
    [].concat(skus || []).slice(0, 300).forEach(function (k) { k = str_(k); if (d.sk[k]) dados[k] = d.sk[k]; });
    return { ok: true, dias: d.dias, mks: d.mks, dados: dados };
  } catch (e) { return { ok: false, msg: String(e.message || e).slice(0, 200) }; }
}
// Atualizado no fim de cada coleta (passo final) de forma INCREMENTAL: só a coleta do dia entra no arquivo
// (lida das abas atuais, poucos segundos); os dias com mais de 30 dias saem. Nunca relê o HISTORICO inteiro.
const HP_MKS = ['Mercado Livre', 'Amazon', 'Magazine Luiza', 'Shopee'];
function hpLinhasAtuais_() {
  const l = [];
  lerAba_('PRODUTOS_BASE').forEach(function (r) { l.push({ tipo: 'Produto Dellamed', marketplace: 'Mercado Livre', sku: str_(r.sku), preco: precoBase_(itemProdutoBase_(r), r.preco_base).preco, link: str_(r.link_oficial), item_id: '' }); });
  lerAba_('ANUNCIOS').forEach(function (r) { l.push({ tipo: str_(r.seller) === 'DELLAMED' ? 'Anúncio loja oficial' : 'Anúncio revendedor', marketplace: str_(r.marketplace), sku: str_(r.sku), preco: r.preco, link: str_(r.link), item_id: str_(r.item_id) }); });
  try { lerAba_('OFERTAS_CONC').forEach(function (r) { l.push({ tipo: 'Oferta concorrente', marketplace: str_(r.marketplace), sku: '', preco: r.preco, link: str_(r.link), item_id: str_(r.item_id) }); }); } catch (e) {}
  lerAba_('CONCORRENTES').forEach(function (r) { l.push({ tipo: 'Concorrente', marketplace: str_(r.marketplace), sku: '', preco: r.preco, link: str_(r.link), item_id: str_(r.item_id) }); });
  return l;
}
// Encaixa um dia (linhas no formato do HISTORICO) no arquivo de gráficos; substitui o dia se ele já existir.
function hpAplicarDia_(d, dia, linhas) {
  let i = d.dias.indexOf(dia);
  const novo = i < 0;
  if (novo) { d.dias.push(dia); d.dias.sort(); i = d.dias.indexOf(dia); }
  const ins = function (arr, v) { if (novo) arr.splice(i, 0, v); else arr[i] = v; };
  Object.keys(d.an).forEach(function (k) { ins(d.an[k], 0); });
  Object.keys(d.sk).forEach(function (k) { ins(d.sk[k].b, 0); ins(d.sk[k].p, []); });
  const n = d.dias.length, zeros = function () { const a = []; for (let x = 0; x < n; x++) a.push(0); return a; };
  const listas = function () { const a = []; for (let x = 0; x < n; x++) a.push([]); return a; };
  linhas.forEach(function (r) {
    const preco = Math.round(num_(r.preco) * 100) / 100; if (!(preco > 0)) return;
    const tipo = str_(r.tipo), sku = str_(r.sku), mk = str_(r.marketplace);
    if (tipo === 'Produto Dellamed') { if (!sku) return; const o = d.sk[sku] || (d.sk[sku] = { b: zeros(), p: listas() }); o.b[i] = preco; return; }
    const k = colChaveAnuncio_(mk, str_(r.link), str_(r.item_id));
    if (k) { const a = d.an[k] || (d.an[k] = zeros()); a[i] = a[i] ? Math.min(a[i], preco) : preco; }
    if (tipo === 'Anúncio revendedor' && sku) { const o = d.sk[sku] || (d.sk[sku] = { b: zeros(), p: listas() }); o.p[i].push([Math.max(0, HP_MKS.indexOf(mk)), preco]); }
  });
  // mantém só os últimos 30 dias e tira anúncios que não aparecem em nenhum deles
  while (d.dias.length > 30) {
    d.dias.shift();
    Object.keys(d.an).forEach(function (k) { d.an[k].shift(); });
    Object.keys(d.sk).forEach(function (k) { d.sk[k].b.shift(); d.sk[k].p.shift(); });
  }
  Object.keys(d.an).forEach(function (k) { if (!d.an[k].some(function (v) { return v > 0; })) delete d.an[k]; });
}
function prepararGraficosPrecos_() {
  const quando = hpVersao_(), dia = (quando || Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd')).slice(0, 10);
  const d = hpLerDrive_() || hpVazio_();
  d.mks = HP_MKS;
  hpAplicarDia_(d, dia, hpLinhasAtuais_());
  d.ult = quando;
  hpSalvarDrive_(d);
  cacheGravarJson_('hprec_' + String(quando).replace(/[^0-9]/g, ''), d);
  return d;
}
function prepararGraficosPrecosAgora() {
  const t = Date.now(), d = prepararGraficosPrecos_();
  SpreadsheetApp.getUi().alert('Gráficos de preço', 'Pronto em ' + Math.round((Date.now() - t) / 1000) + 's: ' + d.dias.length + ' dia(s) e ' + Object.keys(d.an).length + ' anúncios com histórico.\nPara trazer também os dias anteriores, use Histórico: reconstruir gráficos de preço (30 dias).', SpreadsheetApp.getUi().ButtonSet.OK);
}
// Reconstrói os dias anteriores a partir das coletas guardadas (uma coleta por dia, a última do dia).
// Faz o que couber em ~4 minutos e guarda; se faltar, é só rodar de novo (continua de onde parou).
function reconstruirGraficosPrecos() {
  const t0 = Date.now(), d = hpLerDrive_() || hpVazio_();
  d.mks = HP_MKS;
  const corte = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const ultDoDia = {};
  listaColetas_().forEach(function (c) { const dia = String(c.coleta).slice(0, 10); if (dia >= corte && (!ultDoDia[dia] || c.coleta > ultDoDia[dia])) ultDoDia[dia] = c.coleta; });
  const faltam = Object.keys(ultDoDia).sort().filter(function (dia) { return d.dias.indexOf(dia) < 0; });
  let feitos = 0;
  for (let k = 0; k < faltam.length; k++) {
    if (Date.now() - t0 > 4 * 60 * 1000) break;
    const linhas = linhasColeta_(ultDoDia[faltam[k]]);
    if (linhas.length) hpAplicarDia_(d, faltam[k], linhas);
    feitos++;
  }
  hpSalvarDrive_(d);
  try { CacheService.getScriptCache().remove('hprec_' + hpVersao_().replace(/[^0-9]/g, '') + '_n'); } catch (e) {}
  const resto = faltam.length - feitos;
  log_('sistema', 'graficos_reconstruidos', feitos + ' dia(s) incluídos; faltam ' + resto);
  try { SpreadsheetApp.getUi().alert('Gráficos de preço', feitos + ' dia(s) incluídos agora. ' + (resto ? 'Faltam ' + resto + ': rode de novo para continuar.' : 'Pronto: os gráficos têm todos os dias disponíveis (até 30).'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}
const HP_ARQ = 'graficos_precos.json';
// versão = horário da última foto gravada no HISTORICO (muda a cada coleta, já no passo final)
function hpVersao_() { return String(PropertiesService.getScriptProperties().getProperty('COL_HIST_QUANDO') || ultimaColeta_() || ''); }
function hpSalvarDrive_(d) {
  try {
    const pasta = histPasta_(), it = pasta.getFilesByName(HP_ARQ), txt = JSON.stringify(d);
    if (it.hasNext()) it.next().setContent(txt); else pasta.createFile(HP_ARQ, txt, 'application/json');
  } catch (e) { log_('sistema', 'graficos_precos_erro', String(e.message || e).slice(0, 200)); }
}
function hpLerDrive_() {
  try { const it = histPasta_().getFilesByName(HP_ARQ); if (it.hasNext()) return JSON.parse(it.next().getBlob().getDataAsString()); } catch (e) {}
  return null;
}
