/************************************************************
 * COLETA — anúncios pelas páginas públicas, sem developer e sem custo
 * Mercado Livre, Amazon, Magazine Luiza e Shopee, todos os dias, à meia-noite.
 *
 *   1. base          loja oficial Dellamed no ML (preço base, foto, categoria)
 *   2. sellers       "Dellamed + modelo" nos 3 marketplaces, qualquer vendedor
 *   3. repescagem    tenta de novo as buscas que falharam na fase 2
 *   4. concorrentes  até 100 anúncios por marca prioritária (somando os 3 marketplaces)
 *                    + outras marcas relevantes nas mesmas categorias
 *
 * REGRA: todo produto da loja oficial é buscado em todos os marketplaces, em toda
 * coleta, sem exceção. Peças e acessórios da loja ficam fora (não são monitorados). Não há cota
 * de anúncios ou vendedores que interrompa a busca de um produto. Se a busca de um
 * produto falhar duas vezes, os dados anteriores dele naquele marketplace ficam na
 * planilha e o LOG registra o SKU (evento coleta_nao_monitorados).
 *
 * Linhas gravadas com origem = COLETA. Se um marketplace bloquear, as linhas
 * anteriores dele são mantidas e o motivo vai para a aba LOG.
 * Propriedades opcionais: COLETA_LOJA_ML (padrão dellamed),
 * COLETA_CONC_POR_BUSCA (padrão 20), COLETA_MARCAS (lista separada por vírgula).
 ************************************************************/

const COL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const COL_LIMITE_MS = 5 * 60 * 1000;   // pausa com folga antes do limite de 6 min do Google
const COL_FASES = ['base', 'sellers', 'varredura', 'repescagem', 'concorrentes', 'conc_ofertas', 'detalhes', 'avaliacoes', 'final'];
const COL_FASES_NOME = { base: 'loja oficial', sellers: 'revendedores', varredura: 'varredura da marca', repescagem: 'repescagem', concorrentes: 'concorrentes',
                         conc_ofertas: 'sellers dos concorrentes', detalhes: 'nomes e números', avaliacoes: 'comentários', final: 'histórico' };
const COL_PAGINAS_DETALHE = 400;   // páginas de produto abertas para completar vendedor, nota, avaliações e vendidos
// Sellers: TODOS os itens da aba ITENS (com ou sem anúncio na loja oficial) são buscados em todos os marketplaces, toda coleta.
// Cada item: busca pelo nome e, quando tem código (D30, DBP-6177…), também pelo código; até COL_PAGINAS_ITEM páginas de cada busca.
// Depois, a varredura da marca lê todas as páginas da busca "Dellamed" de cada marketplace e pega o que as buscas por item não trouxeram.
const COL_ADS_POR_BUSCA = 200;      // teto de anúncios por item e marketplace (as ofertas de catálogo entram todas)
const COL_PAGINAS_ITEM = 3;         // páginas lidas por busca de item (para antes, quando a página não traz anúncio Dellamed novo)
const COL_VARREDURA_PAGINAS = { 'Mercado Livre': 42, 'Amazon': 20, 'Magazine Luiza': 20, 'Shopee': 5 };   // busca "Dellamed": páginas por marketplace
const COL_QUEDA_ALERTA = 0.30;      // marketplace com 30% menos anúncios de revenda que a coleta anterior: as buscas dele são refeitas na repescagem
const COL_BASE_MAX_PAGINAS = 40;    // páginas da loja oficial (48 produtos cada); a leitura para antes, quando a loja acaba
const COL_MAX_CONCORRENTES = 200;   // referência antiga; prioritárias agora seguem COL_ANUNCIOS_POR_MARCA
// Comentários: a página oficial de TODO produto da loja, mais estas páginas extras
const COL_AVAL_REVENDA = 10;        // anúncios de revendedores com mais avaliações
const COL_AVAL_CONC = 10;           // anúncios de concorrentes
// Concorrentes: todo dia, busca dedicada a TODAS as marcas prioritárias + outras marcas relevantes das categorias
// Marcas prioritárias: até 100 anúncios por marca em cada coleta, somando os 3 marketplaces.
// A cota é dividida entre os marketplaces na ordem de COL_MKS; o que um marketplace não preencher passa para o seguinte.
const COL_ANUNCIOS_POR_MARCA = 100;
const COL_PAGINAS_MARCA = { 'Mercado Livre': 3, 'Amazon': 6, 'Magazine Luiza': 3, 'Shopee': 3 };   // páginas de busca lidas por marca (para quando a cota enche ou a busca acaba)
const COL_CONC_OFERTAS_MAX = 600;   // anúncios de concorrentes com sellers conferidos por coleta (os de mais vendidos e avaliações primeiro)
const COL_MAX_CONC_OUTRAS = 50;     // referência para a cota por categoria de outras marcas (toda categoria da loja recebe a sua)
const COL_TOPO_RELEVANCIA = 10;     // só os primeiros resultados da busca do marketplace contam como relevantes
const COL_MKS = ['Mercado Livre', 'Amazon', 'Magazine Luiza', 'Shopee'];   // Carrefour e Casas Bahia retirados (out/2026); TikTok Shop fora
// Shopee: leitura sem cadastro e sem chave (ver bloco SHOPEE no fim do arquivo). Se a Shopee bloquear num dia,
// o marketplace é pausado só naquela coleta e os outros três seguem normalmente.
// Shopee fica fora da coleta automática enquanto o site não entregar os produtos fora do navegador (teste em 15/10/2026).
// O menu Diagnóstico › Shopee: testar leitura continua disponível; se um dia ele der OK, troque false por true abaixo.
const COL_SHOPEE_ATIVA = false;
function colMks_() { return COL_MKS.filter(function (mk) { return mk !== 'Shopee' || COL_SHOPEE_ATIVA; }); }
const COL_CACHE = {};   // cache de buscas e páginas dentro de uma mesma execução
const COL_CATEGORIAS = ['cadeira de banho', 'cadeira de rodas motorizada', 'cadeira de rodas', 'cadeira de transferência', 'andador',
  'bengala', 'muleta', 'scooter', 'cama hospitalar', 'colchão', 'almofada', 'oxímetro', 'monitor de pressão', 'aparelho de pressão',
  'nebulizador', 'inalador', 'termômetro', 'balança', 'umidificador', 'massageador', 'pistola massageadora', 'bota de compressão',
  'joelheira', 'tornozeleira', 'munhequeira', 'colar cervical', 'bota imobilizadora', 'cinta', 'bolsa térmica', 'assento sanitário', 'banqueta'];
const COL_MARCAS_PADRAO = ['Mercur', 'Ortobras', 'Jaguaribe', 'Prolife', 'Carci', 'Multilaser', 'G-Tech', 'Omron', 'Bioland', 'Incoterm',
  'Premium', 'Mebuki', 'Salvapé', 'Chantal', 'Hidrolight', 'Movilife', 'Dilepé', 'Freedom', 'Ottobock', 'Mobil', 'Relaxmedic',
  'Philips', 'Techline', 'Supermedy', 'Bic', 'Hidrofit', 'Kestal', 'Vitalitá', 'Ortho Pauher', 'Tensoflex', 'Mercur'];

/* ---------- menu ---------- */
// Agenda: todos os dias, à meia-noite (horário de Brasília). O Google dispara dentro da hora (0h00 a 0h59).
const COL_DIAS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];   // todos os dias
const COL_HORA = 0;   // meia-noite
// Agenda mostrada no topo do painel: sai daqui, então mudar COL_DIAS/COL_HORA atualiza o painel junto.
function agendaColeta_() {
  const p = PropertiesService.getScriptProperties();
  const mapa = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
  const fase = p.getProperty('COL_FASE') || '';
  const passo = Number(p.getProperty('COL_PASSO') || 0);
  const ativa = !!fase && Date.now() - passo < 15 * 60 * 1000;                     // coleta parada há 15 min não conta como em andamento
  return { dias: COL_DIAS.map(function (d) { return mapa[d]; }), hora: COL_HORA, emAndamento: ativa,
           fase: ativa ? (COL_FASES_NOME[fase] || fase) : '', faseN: ativa ? COL_FASES.indexOf(fase) + 1 : 0, fases: COL_FASES.length,
           tipo: ativa ? (p.getProperty('COL_TIPO') || '') : '', ultimaTipo: p.getProperty('COL_ULTIMA_TIPO') || '' };
}
// Coleta disparada pelo agendamento (dia e hora da agenda) ou fora dele (menu, ou acionador em outro horário).
function colGarantirColunas_(nomes) {
  nomes.forEach(function (nome) {
    const sh = aba_(nome);
    const h = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
    (ABAS[nome] || []).forEach(function (col) {
      if (h.indexOf(col) < 0) { h.push(col); sh.getRange(1, h.length).setValue(col).setFontWeight('bold').setBackground('#0F3C6E').setFontColor('#FFFFFF'); }
    });
  });
}
function colTipoExecucao_(e) {
  if (!e || !e.triggerUid) return 'extra';
  const agora = new Date();
  const dia = Number(Utilities.formatDate(agora, 'America/Sao_Paulo', 'u')) % 7;    // 1 = segunda … 7 = domingo
  const hora = Number(Utilities.formatDate(agora, 'America/Sao_Paulo', 'H'));
  const mapa = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
  const dias = COL_DIAS.map(function (d) { return mapa[d]; });
  return dias.indexOf(dia) >= 0 && hora === COL_HORA ? 'agendada' : 'extra';
}
function instalarGatilhoColeta() {
  const p = PropertiesService.getScriptProperties(), manter = [p.getProperty('COL_CONT_TRIGGER'), p.getProperty('COL_GUARD')];
  ScriptApp.getProjectTriggers().forEach(function (g) {
    const f = g.getHandlerFunction();
    if (manter.indexOf(g.getUniqueId()) >= 0) return;                                   // não apaga a continuação de uma coleta em andamento
    if (f === 'coletarMarketplaces' || f === 'sincronizarMercadoLivre') ScriptApp.deleteTrigger(g);
  });
  if (COL_DIAS.length === 7) ScriptApp.newTrigger('coletarMarketplaces').timeBased().everyDays(1).atHour(COL_HORA).inTimezone('America/Sao_Paulo').create();
  else COL_DIAS.forEach(function (d) {
    ScriptApp.newTrigger('coletarMarketplaces').timeBased().onWeekDay(ScriptApp.WeekDay[d]).atHour(COL_HORA).inTimezone('America/Sao_Paulo').create();
  });
  if (COL_DIAS.length === 7) { SpreadsheetApp.getActive().toast('Coleta agendada para todos os dias ' + (COL_HORA === 0 ? 'à meia-noite' : 'às ' + COL_HORA + 'h') + ' (horário de Brasília).'); return; }
  SpreadsheetApp.getActive().toast('Coleta agendada para ' + COL_DIAS.map(function (d) { return { SUNDAY: 'domingo', MONDAY: 'segunda', TUESDAY: 'terça', WEDNESDAY: 'quarta', THURSDAY: 'quinta', FRIDAY: 'sexta', SATURDAY: 'sábado' }[d]; }).join(', ') + ' às ' + COL_HORA + 'h (horário de Brasília).');
}

function testarColeta() {
  const q = 'dellamed cadeira de banho';
  const linhas = colMks_().map(function (mk) {
    const r = colBuscar_(mk, q);
    return (r.ok ? 'OK  ' + r.itens.length + ' anúncios' : 'FALHOU ' + r.motivo) + ' — ' + mk +
           (r.itens[0] ? ' (ex.: ' + String(r.itens[0].titulo).slice(0, 40) + ' · ' + r.itens[0].preco + ')' : '');
  });
  const loja = colLojaOficial_(1);
  // comentários: abre a página do 1º produto da loja oficial no ML
  if (loja.itens[0]) {
    const hp = colFetch_(loja.itens[0].link);
    const rv = hp.ok ? colReviewsML_(hp.texto) : [];
    linhas.push((rv.length ? 'OK  ' + rv.length + ' comentários' : 'FALHOU ' + (hp.ok ? 'página do produto sem comentários reconhecíveis' : hp.motivo)) + ' — Comentários (1º produto da loja no ML)');
  }
  linhas.push((loja.itens.length ? 'OK  ' + loja.itens.length + ' produtos' : 'FALHOU ' + loja.motivo) + ' — Loja oficial Dellamed (1ª página)');
  const comCat = loja.itens.filter(function (x) { return x.catalogo; })[0];
  if (comCat) {
    const of = colOfertasML_(comCat.catalogo, {});
    linhas.push((of.ok ? 'OK  ' + of.itens.length + ' vendedores' : 'FALHOU ' + of.motivo) + ' — Todos os vendedores do catálogo no ML (' + (colApiML_() ? 'API conectada' : 'SEM API: conecte em Mercado Livre: conectar conta') + ')');
  }
  log_('sistema', 'coleta_teste', linhas.join(' | ').slice(0, 480));
  SpreadsheetApp.getUi().alert('Teste da coleta', linhas.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---------- execução em fases, retomável ---------- */
function coletarMarketplaces(e) {
  const inicio = Date.now(), p = PropertiesService.getScriptProperties();
  COL_CACHE.inicio = inicio;
  // uma coleta por vez: se outra execução estiver rodando, esta sai sem fazer nada
  // A coleta NÃO segura o LockService do script (ele é o mesmo do login): com ele preso por minutos,
  // entrar, gerar PIN e validar código falhavam com "Falha na conexão". A trava da coleta é própria.
  const trava = colTravar_();
  if (!trava) {
    const pr = PropertiesService.getScriptProperties(), ini = Number(String(pr.getProperty('COL_RODANDO') || '0').split('|')[0]);
    const msg = 'Já existe uma coleta rodando (fase ' + (COL_FASES_NOME[pr.getProperty('COL_FASE')] || pr.getProperty('COL_FASE') || '?') +
                ', execução iniciada às ' + (ini ? Utilities.formatDate(new Date(ini), 'America/Sao_Paulo', 'HH:mm') : '?') +
                '). Ela continua sozinha; esta foi ignorada. Para começar do zero: Diagnóstico › Coleta: recomeçar do zero.';
    log_('sistema', 'coleta_ja_rodando', msg);
    if (!e || !e.triggerUid) { try { SpreadsheetApp.getUi().alert('Coleta', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (x) {} }
    return;
  }
  try {
  // apaga gatilhos de continuação e de segurança da execução anterior
  ['COL_CONT_TRIGGER', 'COL_GUARD'].forEach(function (k) {
    const id = p.getProperty(k);
    if (id) { ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getUniqueId() === id) ScriptApp.deleteTrigger(g); }); p.deleteProperty(k); }
  });
  // rede de segurança: se esta execução for encerrada pelo limite de 6 min do Google, este gatilho retoma de onde parou
  const guarda = ScriptApp.newTrigger('coletarMarketplaces').timeBased().after(8 * 60 * 1000).create();
  p.setProperty('COL_GUARD', guarda.getUniqueId());
  let fase = p.getProperty('COL_FASE') || 'base';
  let cursor = Number(p.getProperty('COL_CURSOR') || 0);
  if (!p.getProperty('COL_FASE')) {                                               // nova coleta: nova identificação e contadores zerados
    p.setProperty('COL_RUN', String(Date.now()));
    p.setProperty('COL_TIPO', colTipoExecucao_(e));
    colGarantirColunas_(['PRODUTOS_BASE', 'ANUNCIOS', 'CONCORRENTES', 'OFERTAS_CONC', 'VENDEDORES', 'HISTORICO']);   // colunas novas sem precisar rodar Configurar planilha
    ['COL_N_ADS', 'COL_N_CONC', 'COL_N_CONC_P', 'COL_N_MARCA', 'COL_N_CONC_O', 'COL_VEND', 'COL_FALHAS', 'COL_REP_INI', 'COL_BASE_INFO', 'COL_N_BUSCAS', 'COL_AOD_FALHAS', 'COL_N_NOTAS_OF', 'COL_N_VERIF', 'COL_N_VERIF_ERRO', 'COL_VARR_FIM', 'COL_VARR_ULT', 'COL_N_VARR', 'COL_QUEDA'].forEach(function (k) { p.deleteProperty(k); });
    colListaLimpar_('COL_PEND'); colListaLimpar_('COL_FALHOU'); colListaLimpar_('COL_DET_FEITOS');
  }
  let feitos = 0;
  const ctx = { bloqueados: JSON.parse(p.getProperty('COL_BLOQ') || '{}') };

  while (fase) {
    if (fase === 'repescagem' && !p.getProperty('COL_REP_INI')) {
      // nova chance para as buscas que falharam: o bloqueio do dia vale só para a fase anterior
      ctx.falhas = JSON.parse(p.getProperty('COL_FALHAS') || '{}');
      COL_MKS.forEach(function (mk) { delete ctx.bloqueados[mk]; ctx.falhas[mk] = 0; });
      p.setProperty('COL_FALHAS', JSON.stringify(ctx.falhas)); p.setProperty('COL_BLOQ', JSON.stringify(ctx.bloqueados));
      p.setProperty('COL_REP_INI', '1');
      if (colListaLer_('COL_PEND').length) Utilities.sleep(20000);
    }
    const tarefas = colTarefas_(fase);
    ctx.nTarefas = tarefas.length;
    ctx.nTarefasCat = tarefas.filter(function (x) { return x && x.categoria; }).length || tarefas.length;   // cota dos concorrentes: só buscas por categoria
    for (let i = cursor; i < tarefas.length; i++) {
      // a fase final (histórico) só começa com a execução quase inteira pela frente
      if (feitos > 0 && Date.now() - inicio > (fase === 'final' ? 60 * 1000 : COL_LIMITE_MS)) {
        const feitosRodada = i - cursor;
        if (fase === 'detalhes') colListaGravar_('COL_DET_FEITOS', Object.keys(ctx.detFeitos || {}).concat(colListaLer_('COL_DET_FEITOS')));
        p.setProperty('COL_FASE', fase); p.setProperty('COL_CURSOR', fase === 'detalhes' ? '0' : String(i)); p.setProperty('COL_BLOQ', JSON.stringify(ctx.bloqueados));
        colTirarGuarda_(p);
        const g = ScriptApp.newTrigger('coletarMarketplaces').timeBased().after(60 * 1000).create();
        p.setProperty('COL_CONT_TRIGGER', g.getUniqueId());
        log_('sistema', 'coleta_pausa', fase === 'detalhes'
          ? 'detalhes: ' + feitosRodada + ' completados nesta rodada, ' + (tarefas.length - feitosRodada) + ' anúncios ainda sem nome/números'
          : fase + ' ' + i + ' de ' + tarefas.length);
        return;
      }
      p.setProperty('COL_PASSO', String(Date.now()));
      try { colExecutar_(fase, tarefas[i], i, ctx); }
      catch (e) {                                                   // erro numa tarefa não derruba a coleta
        log_('sistema', 'coleta_erro_tarefa', fase + ' ' + i + ': ' + String(e.message || e).slice(0, 200));
        const ti = tarefas[i];
        if ((fase === 'sellers' || fase === 'repescagem') && ti && ti.sku) colMarcarPendente_(ti, fase === 'repescagem', 'erro: ' + String(e.message || e).slice(0, 60));
      }
      feitos++;
      if (fase === 'detalhes') {
        ctx.detFeitos = ctx.detFeitos || {};
        ctx.detFeitos[colHash_(tarefas[i].aba + '|' + tarefas[i].link).slice(0, 10)] = 1;
        if (feitos % 25 === 0) { colListaGravar_('COL_DET_FEITOS', Object.keys(ctx.detFeitos).concat(colListaLer_('COL_DET_FEITOS'))); ctx.detFeitos = {}; }
      }
      if (p.getProperty('COL_RODANDO') !== trava) {                // cancelada pelo menu durante esta execução: para aqui
        try { colTirarGuarda_(p); } catch (x) {}
        log_('sistema', 'coleta_cancelada', 'execução em andamento parou em ' + fase + ' ' + (i + 1) + ' de ' + tarefas.length);
        return;
      }
      // salva a posição a cada tarefa: se a execução cair, a próxima continua daqui, sem repetir nada
      p.setProperty('COL_FASE', fase); p.setProperty('COL_CURSOR', fase === 'detalhes' ? '0' : String(i + 1)); p.setProperty('COL_BLOQ', JSON.stringify(ctx.bloqueados));
    }
    log_('sistema', 'coleta_fase_ok', fase + ' (' + tarefas.length + ')');
    fase = COL_FASES[COL_FASES.indexOf(fase) + 1] || '';
    cursor = 0;
    p.setProperty('COL_FASE', fase); p.setProperty('COL_CURSOR', '0');
  }
  try { colCobertura_(); } catch (e) { log_('sistema', 'coleta_cobertura_erro', String(e.message || e).slice(0, 200)); }
  const naoMon = colListaLer_('COL_FALHOU');
  const nBase = lerAba_('PRODUTOS_BASE').filter(function (r) { return r.sku && r.produto; }).length;
  if (naoMon.length) log_('sistema', 'coleta_nao_monitorados', naoMon.length + ' buscas sem resposta (dados anteriores mantidos): ' + naoMon.map(function (x) { return x.mk + ' ' + x.sku + ' (' + x.motivo + ')'; }).join('; ').slice(0, 1800));
  const resumoLim = ' Produtos monitorados (loja oficial + itens da aba ITENS): ' + nBase + ' (' + (p.getProperty('COL_N_BUSCAS') || 0) + ' buscas' + (naoMon.length ? ', ' + naoMon.length + ' sem resposta, ver coleta_nao_monitorados' : '') + ').' +
                    (p.getProperty('COL_BASE_INFO') ? ' Loja oficial: ' + p.getProperty('COL_BASE_INFO') + '.' : '') +
                    ' Anúncios revendidos: ' + (p.getProperty('COL_N_ADS') || 0) + ', vendedores: ' + JSON.parse(p.getProperty('COL_VEND') || '[]').length +
                    ', concorrentes: ' + (p.getProperty('COL_N_CONC') || 0) + ' (' + (p.getProperty('COL_N_CONC_P') || 0) + ' de marcas prioritárias, ' +
                    (p.getProperty('COL_N_CONC_O') || 0) + ' de outras marcas).';
  ['COL_FASE', 'COL_CURSOR', 'COL_BLOQ', 'COL_FALHAS', 'COL_REP_INI'].forEach(function (k) { p.deleteProperty(k); });
  const bl = Object.keys(ctx.bloqueados);
  const msg = (bl.length ? 'Coleta concluída. Bloqueados hoje: ' + bl.map(function (k) { return k.replace(/^aval_/, 'comentários em ') + ' (' + ctx.bloqueados[k] + ')'; }).join(', ') + '. Dados anteriores desses marketplaces mantidos.'
                         : 'Coleta concluída em todos os marketplaces.') + resumoLim;
  colTirarGuarda_(p);
  colListaLimpar_('COL_DET_FEITOS');
  p.setProperty('COL_ULTIMA', Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'));   // data mostrada no painel = fim da coleta   // data mostrada no painel
  p.setProperty('COL_ULTIMA_TIPO', p.getProperty('COL_TIPO') || 'extra');
  invalidarDados_();                                                                                        // painel passa a mostrar a coleta nova
  log_('sistema', 'coleta_ok', msg);
  try { SpreadsheetApp.getActive().toast(msg, 'Coleta', 15); } catch (e) {}
  } finally { colDestravar_(trava); }
}
// Trava própria da coleta: uma marca nas propriedades com a hora de início. Execução do Google dura no máximo 6 min,
// então marca com mais de 7 min é de uma execução que morreu e pode ser ignorada.
// Menu: interrompe a coleta em andamento (inclusive uma começada com a versão anterior do código) e começa uma nova.
function recomecarColeta() {
  const p = PropertiesService.getScriptProperties();
  ['COL_CONT_TRIGGER', 'COL_GUARD'].forEach(function (k) {
    const id = p.getProperty(k);
    if (id) ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getUniqueId() === id) ScriptApp.deleteTrigger(g); });
  });
  ['COL_FASE', 'COL_CURSOR', 'COL_BLOQ', 'COL_FALHAS', 'COL_REP_INI', 'COL_RODANDO', 'COL_CONT_TRIGGER', 'COL_GUARD', 'COL_PASSO'].forEach(function (k) { p.deleteProperty(k); });
  log_('sistema', 'coleta_recomecada', 'coleta anterior interrompida pelo menu');
  coletarMarketplaces();
}
// Menu: cancela a coleta em andamento sem começar outra. Os dados já gravados ficam; o agendamento semanal continua.
function cancelarColeta() {
  const p = PropertiesService.getScriptProperties();
  let n = 0;
  ['COL_CONT_TRIGGER', 'COL_GUARD'].forEach(function (k) {
    const id = p.getProperty(k);
    if (id) ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getUniqueId() === id) { ScriptApp.deleteTrigger(g); n++; } });
  });
  const fase = p.getProperty('COL_FASE');
  ['COL_FASE', 'COL_CURSOR', 'COL_BLOQ', 'COL_FALHAS', 'COL_REP_INI', 'COL_RODANDO', 'COL_CONT_TRIGGER', 'COL_GUARD', 'COL_PASSO', 'COL_TIPO'].forEach(function (k) { p.deleteProperty(k); });
  log_('sistema', 'coleta_cancelada', fase ? 'coleta cancelada pelo menu na fase ' + (COL_FASES_NOME[fase] || fase) : 'nenhuma coleta em andamento');
  try { SpreadsheetApp.getUi().alert('Coleta', fase ? 'Coleta cancelada (estava em: ' + (COL_FASES_NOME[fase] || fase) + '). Se uma execução estiver rodando agora, ela termina a etapa atual em até 5 minutos e para. O agendamento de terça, quinta e sábado continua.' : 'Não há coleta em andamento.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}
function colTravar_() {
  const p = PropertiesService.getScriptProperties(), lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return '';                                               // segura só por um instante
  try {
    const atual = p.getProperty('COL_RODANDO');
    if (atual && Date.now() - Number(atual.split('|')[0]) < 7 * 60 * 1000) return '';
    const id = Date.now() + '|' + Math.random().toString(36).slice(2, 8);
    p.setProperty('COL_RODANDO', id);
    return id;
  } finally { lock.releaseLock(); }
}
function colDestravar_(id) {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('COL_RODANDO') === id) p.deleteProperty('COL_RODANDO');
}
// Um erro isolado (503, captcha passageiro) não tira o marketplace da coleta: só depois de 3 falhas seguidas.
// Entre uma falha e a próxima tentativa, espera um pouco mais a cada vez.
const COL_FALHAS_MAX = 3;
function colFalha_(ctx, mk, motivo) {
  ctx.falhas = ctx.falhas || JSON.parse(PropertiesService.getScriptProperties().getProperty('COL_FALHAS') || '{}');
  ctx.falhas[mk] = (ctx.falhas[mk] || 0) + 1;
  if (ctx.falhas[mk] >= COL_FALHAS_MAX) ctx.bloqueados[mk] = motivo + ' (' + COL_FALHAS_MAX + ' falhas seguidas)';
  else Utilities.sleep(4000 * ctx.falhas[mk]);
  PropertiesService.getScriptProperties().setProperty('COL_FALHAS', JSON.stringify(ctx.falhas));
}
function colSucesso_(ctx, mk) {
  ctx.falhas = ctx.falhas || JSON.parse(PropertiesService.getScriptProperties().getProperty('COL_FALHAS') || '{}');
  if (ctx.falhas[mk]) { ctx.falhas[mk] = 0; PropertiesService.getScriptProperties().setProperty('COL_FALHAS', JSON.stringify(ctx.falhas)); }
}
// Histórico: no fim de cada coleta, guarda uma foto dos produtos, anúncios e concorrentes com a data.
// Mantém os últimos COL_HIST_DIAS dias; o painel lista as coletas e baixa o Excel de qualquer uma delas.
const COL_HIST_DIAS = 30;   // a aba HISTORICO guarda 30 dias; toda coleta também fica salva em CSV no Drive e nunca é apagada
// Fase final em 5 passos, cada um na sua própria execução (antes era um bloco só e estourava as 6 min do Google;
// ao ser cortado no meio, recomeçava do zero e repetia a foto do dia no HISTORICO).
const COL_FINAL_PASSOS = ['hist_foto', 'hist_drive', 'hist_podar', 'preco_ant', 'graf_precos', 'arquivo'];
const COL_FINAL_NOMES = { hist_foto: 'foto do dia no HISTORICO', hist_drive: 'cópia no Drive', hist_podar: 'limpeza dos 30 dias', preco_ant: 'preço anterior', graf_precos: 'gráficos de preço (30 dias)', arquivo: 'arquivo semestral' };
function colHistCol_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); }); }
function colDiaTxt_(x) { return x instanceof Date ? Utilities.formatDate(x, 'America/Sao_Paulo', 'yyyy-MM-dd') : String(x).slice(0, 10); }
function colFinalPasso_(passo) {
  const p = PropertiesService.getScriptProperties(), run = p.getProperty('COL_RUN') || ('manual_' + Date.now());
  const ini = Date.now();
  try {
    if (passo === 'hist_foto') colHistFoto_(p, run);
    else if (passo === 'hist_drive') colHistDrive_(p);
    else if (passo === 'hist_podar') colHistPodar_();
    else if (passo === 'preco_ant') colAtualizarPrecoAnterior_();
    else if (passo === 'graf_precos') prepararGraficosPrecos_();
    else if (passo === 'arquivo') arquivarAntigos_(false);                        // só age a cada 6 meses
    log_('sistema', 'coleta_final_ok', COL_FINAL_NOMES[passo] + ' (' + Math.round((Date.now() - ini) / 1000) + 's)');
  } catch (e) { log_('sistema', 'coleta_final_erro', COL_FINAL_NOMES[passo] + ': ' + String(e.message || e).slice(0, 250)); }
}
// 1) Foto do dia: grava uma única vez por coleta (se a execução cair e voltar, não duplica).
function colHistFoto_(p, run) {
  if (p.getProperty('COL_HIST_RUN') === run) return;
  if (colHistFotoJaFeita_(p, run)) return;
  const quando = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
  const linhas = [];
  lerAba_('PRODUTOS_BASE').forEach(function (r) {
    linhas.push({ coleta: quando, tipo: 'Produto Dellamed', marketplace: 'Mercado Livre', vendedor_ou_marca: 'Dellamed', sku: str_(r.sku), categoria: str_(r.categoria),
                  produto: str_(r.produto), preco: precoBase_(itemProdutoBase_(r), r.preco_base).preco, /* preço base = PMV do item (aba PMV) */ nota: '', avaliacoes: '', vendidos: '', link: str_(r.link_oficial) });
  });
  lerAba_('ANUNCIOS').forEach(function (r) {
    linhas.push({ coleta: quando, tipo: str_(r.seller) === 'DELLAMED' ? 'Anúncio loja oficial' : 'Anúncio revendedor', marketplace: str_(r.marketplace),
                  vendedor_ou_marca: str_(r.seller), sku: str_(r.sku), categoria: '', produto: str_(r.titulo), preco: num_(r.preco), nota: '',
                  avaliacoes: str_(r.avaliacoes), vendidos: str_(r.vendidos), link: str_(r.link), item_id: str_(r.item_id), preco_cheio: str_(r.preco_cheio) });
  });
  lerAba_('OFERTAS_CONC').forEach(function (r) {
    linhas.push({ coleta: quando, tipo: 'Oferta concorrente', marketplace: str_(r.marketplace), vendedor_ou_marca: str_(r.seller), sku: '', categoria: '',
                  produto: '', preco: num_(r.preco), nota: '', avaliacoes: '', vendidos: '', link: str_(r.link), item_id: str_(r.item_id), preco_cheio: str_(r.preco_cheio) });
  });
  lerAba_('CONCORRENTES').forEach(function (r) {
    linhas.push({ coleta: quando, tipo: 'Concorrente', marketplace: str_(r.marketplace), vendedor_ou_marca: str_(r.marca), sku: '', categoria: str_(r.categoria),
                  produto: str_(r.produto), preco: num_(r.preco), nota: str_(r.nota_0a5), avaliacoes: str_(r.avaliacoes), vendidos: str_(r.vendidos), link: str_(r.link),
                  item_id: str_(r.item_id), preco_cheio: str_(r.preco_cheio) });
  });
  linhas.forEach(function (l) { l.item_id = colChaveAnuncio_(l.marketplace, l.link, l.item_id); });
  const sh = aba_('HISTORICO'), linhaIni = sh.getLastRow() + 1;
  appendObjs_('HISTORICO', linhas);
  p.setProperty('COL_HIST_RUN', run); p.setProperty('COL_HIST_QUANDO', quando);
  p.setProperty('COL_HIST_LINHA', String(linhaIni)); p.setProperty('COL_HIST_N', String(linhas.length));
  log_('sistema', 'coleta_historico_ok', linhas.length + ' linhas guardadas no histórico');
}
// Coleta interrompida pela versão antiga: a foto pode já ter sido gravada (até mais de uma vez) depois do início desta coleta.
// Mantém só a última, apaga as repetidas e segue sem gravar de novo.
function colHistFotoJaFeita_(p, run) {
  const t0 = Number(run); if (!(t0 > 0)) return false;
  const sh = aba_('HISTORICO'), nl = sh.getLastRow(); if (nl < 2) return false;
  const ic = colHistCol_(sh).indexOf('coleta'), cs = sh.getRange(2, ic + 1, nl - 1, 1).getValues();
  const tempo = function (k) { const d = new Date(String(k).replace(' ', 'T') + ':00-03:00'); return isNaN(d) ? 0 : d.getTime(); };
  let i = cs.length - 1; const blocos = [];
  while (i >= 0) { const k = histChave_(cs[i][0]); if (tempo(k) < t0 - 60000) break; if (!blocos.length || blocos[blocos.length - 1].k !== k) blocos.push({ k: k, fim: i, ini: i }); blocos[blocos.length - 1].ini = i; i--; }
  if (!blocos.length) return false;
  const ult = blocos[0];                                                         // o mais recente (no fim da aba)
  if (blocos.length > 1) { const iniRep = blocos[blocos.length - 1].ini; sh.deleteRows(iniRep + 2, ult.ini - iniRep); log_('sistema', 'historico_duplicado_removido', (blocos.length - 1) + ' foto(s) repetida(s) desta coleta removida(s)'); }
  const linhaIni = (blocos.length > 1 ? blocos[blocos.length - 1].ini : ult.ini) + 2;
  p.setProperty('COL_HIST_RUN', run); p.setProperty('COL_HIST_QUANDO', ult.k);
  p.setProperty('COL_HIST_LINHA', String(linhaIni)); p.setProperty('COL_HIST_N', String(ult.fim - ult.ini + 1));
  return true;
}
// 2) Cópia permanente da coleta de hoje no Drive (lê só o trecho recém-gravado).
function colHistDrive_(p) {
  const quando = p.getProperty('COL_HIST_QUANDO'), ini = Number(p.getProperty('COL_HIST_LINHA') || 0), n = Number(p.getProperty('COL_HIST_N') || 0);
  if (!quando || !ini || !n || histExiste_(quando)) return;
  const sh = aba_('HISTORICO'), cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  histSalvarColeta_(quando, cab, sh.getRange(ini, 1, n, cab.length).getValues());
}
// 3) Tira da aba as coletas com mais de COL_HIST_DIAS dias. Elas ficam no topo (a aba cresce por baixo):
//    salva no Drive as que ainda não estão lá e apaga o bloco de linhas de uma vez (deleteRows, sem reescrever a aba).
function colHistPodar_() {
  const sh = aba_('HISTORICO'), nl = sh.getLastRow();
  if (nl < 2) return;
  const h = colHistCol_(sh), ic = h.indexOf('coleta');
  const corte = Utilities.formatDate(new Date(Date.now() - COL_HIST_DIAS * 86400000), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const cs = sh.getRange(2, ic + 1, nl - 1, 1).getValues();
  let n = 0;
  while (n < cs.length && colDiaTxt_(cs[n][0]) < corte) n++;
  if (!n) return;
  // coletas do bloco, em ordem; para na primeira que não conseguir salvar no Drive
  const blocos = [];
  for (let i = 0; i < n; i++) { const k = histChave_(cs[i][0]); if (!blocos.length || blocos[blocos.length - 1].k !== k) blocos.push({ k: k, i: i, n: 0 }); blocos[blocos.length - 1].n++; }
  const cab = sh.getRange(1, 1, 1, h.length).getValues()[0];
  let apagar = 0;
  for (let b = 0; b < blocos.length; b++) {
    const bl = blocos[b];
    try { if (!histExiste_(bl.k)) histSalvarColeta_(bl.k, cab, sh.getRange(bl.i + 2, 1, bl.n, h.length).getValues()); }
    catch (e) { log_('sistema', 'historico_drive_erro', bl.k + ': ' + String(e.message || e).slice(0, 200)); break; }
    apagar = bl.i + bl.n;
  }
  if (apagar) { sh.deleteRows(2, apagar); log_('sistema', 'historico_podado', apagar + ' linhas com mais de ' + COL_HIST_DIAS + ' dias saíram da aba (salvas no Drive)'); }
}
// Fase final completa de uma vez (menu "concluir última coleta").
function colFinalizar_() { COL_FINAL_PASSOS.forEach(colFinalPasso_); }
// Menu: conclui uma coleta que terminou as fases mas parou antes do "coleta_ok" (histórico, data da última coleta e painel).
function concluirUltimaColeta() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('COL_FASE')) { try { SpreadsheetApp.getUi().alert('Coleta', 'Há uma coleta em andamento; ela conclui sozinha.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {} return; }
  colFinalizar_();
  p.setProperty('COL_ULTIMA', Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'));   // data mostrada no painel = fim da coleta
  p.setProperty('COL_ULTIMA_TIPO', p.getProperty('COL_TIPO') || 'extra');
  invalidarDados_();
  log_('sistema', 'coleta_ok', 'Coleta concluída pelo menu (histórico e preço anterior gravados).');
  try { SpreadsheetApp.getUi().alert('Coleta', 'Coleta concluída: histórico gravado e painel atualizado.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}
function colChaveAnuncio_(mk, link, item) {
  link = String(link || ''); item = String(item || '');
  if (/mercado/i.test(mk)) {
    const id = (item.match(/^MLB-?\d+$/i) || [])[0] || colMatch_(link, /item_id:(MLB\d+)/i) || colMatch_(link, /\/(MLB-?\d+)(?:-|$|[?#])/i) || colMatch_(link, /\/p\/(MLB\d+)/i);
    if (id) return 'ML:' + id.replace('-', '').toUpperCase();
  }
  if (/amazon/i.test(mk)) {
    const a = colMatch_(link, /\/dp\/([A-Z0-9]{10})/) || (item.match(/^[A-Z0-9]{10}/) || [])[0];
    const sm = colMatch_(link, /[?&]smid=([A-Z0-9]+)/) || (item.split(':')[1] || '');
    if (a) return 'AMZ:' + a + (sm ? ':' + sm : '');
  }
  return link.split(/[?#]/)[0] || item;
}
// Aba PRECO_ANTERIOR: as duas últimas coletas do HISTORICO (o painel escolhe, para cada anúncio, a coleta anterior à dele).
function colAtualizarPrecoAnterior_() {
  const shH = aba_('HISTORICO'), nl = shH.getLastRow();
  if (nl < 2) return;
  const hh = colHistCol_(shH), icc = hh.indexOf('coleta');
  const cs = shH.getRange(2, icc + 1, nl - 1, 1).getValues(), vistas = {};
  let ini = cs.length;                                                            // sobe a partir do fim até achar a 3ª coleta diferente
  for (let i = cs.length - 1; i >= 0; i--) { const k = histChave_(cs[i][0]); if (!vistas[k] && Object.keys(vistas).length >= 2) break; vistas[k] = 1; ini = i; }
  const v = [shH.getRange(1, 1, 1, hh.length).getValues()[0]].concat(shH.getRange(ini + 2, 1, cs.length - ini, hh.length).getValues());
  if (v.length < 2) return;
  const h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
  const ix = function (k) { return h.indexOf(k); };
  const iC = ix('coleta'), iT = ix('tipo'), iM = ix('marketplace'), iV = ix('vendedor_ou_marca'), iS = ix('sku'), iP = ix('preco'), iL = ix('link'), iI = ix('item_id'), iPr = ix('preco_cheio');
  const txt = function (x) { return x instanceof Date ? Utilities.formatDate(x, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : String(x).slice(0, 16); };
  const coletas = {};
  for (let i = 1; i < v.length; i++) coletas[txt(v[i][iC])] = 1;
  const ult = Object.keys(coletas).sort().slice(-2);
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const c = txt(v[i][iC]);
    if (ult.indexOf(c) < 0 || /^Produto Dellamed$/.test(String(v[i][iT]))) continue;
    const mk = String(v[i][iM]);
    out.push([c, mk, colChaveAnuncio_(mk, v[i][iL], iI >= 0 ? v[i][iI] : ''), String(v[i][iS]), String(v[i][iV]), Number(v[i][iP]) || 0, iPr >= 0 ? (Number(v[i][iPr]) || '') : '']);
  }
  const sh = aba_('PRECO_ANTERIOR');
  sh.clearContents();
  const cab = ABAS.PRECO_ANTERIOR;
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#0F3C6E').setFontColor('#FFFFFF');
  if (out.length) sh.getRange(2, 1, out.length, cab.length).setNumberFormat('@').setValues(out.map(function (r) { return r.map(String); }));
}
function colTirarGuarda_(p) {
  const id = p.getProperty('COL_GUARD');
  if (id) { ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getUniqueId() === id) ScriptApp.deleteTrigger(g); }); p.deleteProperty('COL_GUARD'); }
}

function colTarefas_(fase) {
  if (fase === 'base') return ['base'];
  const base = lerAba_('PRODUTOS_BASE').filter(function (r) { return r.sku && r.produto; });
  if (fase === 'sellers') {
    const t = [];
    base.filter(function (r) { return str_(r.item) || !colEhAcessorio_(r.produto); }).forEach(function (r) {   // todos os produtos da loja (itens da lista sempre; peças fora)
      colMks_().forEach(function (mk) { t.push({ mk: mk, sku: str_(r.sku), produto: str_(r.produto), categoria: str_(r.categoria), preco: num_(r.preco_base),
                                                catalogo: mk === 'Mercado Livre' ? str_(r.catalogo_id) : '', item: str_(r.item) }); });
    });
    return t;
  }
  if (fase === 'varredura') {
    const t = [];
    colMks_().forEach(function (mk) { for (let pg = 1; pg <= (COL_VARREDURA_PAGINAS[mk] || 5); pg++) t.push({ mk: mk, varredura: true, pg: pg }); });
    t.push({ cobertura: true });                                                    // última: confere se algum marketplace trouxe bem menos que ontem
    return t;
  }
  if (fase === 'repescagem') {
    const porSku = {};
    base.forEach(function (r) { porSku[str_(r.sku)] = r; });
    const t = colListaLer_('COL_PEND').filter(function (x) { return porSku[x.sku]; }).map(function (x) {
      const r = porSku[x.sku];
      return { mk: x.mk, sku: x.sku, produto: str_(r.produto), categoria: str_(r.categoria), preco: num_(r.preco_base),
               catalogo: x.mk === 'Mercado Livre' ? str_(r.catalogo_id) : '', item: str_(r.item) };
    });
    t.push({ limpeza: true });                                                      // última tarefa: tira os anúncios antigos já substituídos
    return t;
  }
  if (fase === 'avaliacoes') return colAlvosAvaliacao_().concat([{ shopeePortal: true }]);   // por último: comentários da Shopee do portal Voz do cliente
  if (fase === 'conc_ofertas') {
    const t = lerAba_('CONCORRENTES').filter(function (r) { return str_(r.origem) === 'COLETA' && str_(r.link) && COL_MKS.indexOf(str_(r.marketplace)) >= 0; })
      .sort(function (a, b) { return (num_(b.vendidos) + num_(b.avaliacoes)) - (num_(a.vendidos) + num_(a.avaliacoes)); })
      .slice(0, COL_CONC_OFERTAS_MAX)
      .map(function (r) { return { mk: str_(r.marketplace), chave: str_(r.link), marca: str_(r.marca), produto: str_(r.produto), preco: num_(r.preco), item: str_(r.item_id), foto: str_(r.foto) }; });
    return [{ limparOfertasConc: true }].concat(t);
  }
  if (fase === 'final') return COL_FINAL_PASSOS.slice();
  if (fase === 'detalhes') {
    // a lista encolhe conforme os anúncios são completados: em vez de posição, guarda o que já foi tentado nesta coleta
    const feitos = {}; colListaLer_('COL_DET_FEITOS').forEach(function (k) { feitos[k] = 1; });
    return colAlvosDetalhe_().filter(function (a) { return !feitos[colHash_(a.aba + '|' + a.link).slice(0, 10)]; });
  }
  if (fase === 'concorrentes') {
    const cats = {};
    base.forEach(function (r) { const c = str_(r.categoria); if (c && c !== 'Outros') cats[c] = 1; });
    const t = [];
    const prio = colPrioritarias_();
    prio.forEach(function (m) { colMks_().forEach(function (mk) { t.push({ mk: mk, marca: m }); }); });   // todas as prioritárias, todo dia, marca por marca
    Object.keys(cats).sort().forEach(function (c) { colMks_().forEach(function (mk) { t.push({ mk: mk, categoria: c }); }); });
    return t;
  }
  return [];
}

function colExecutar_(fase, t, i, ctx) {
  if (fase === 'base') return colFaseBase_();
  if (fase === 'avaliacoes') return t.shopeePortal ? colShopeePortal_(ctx) : colAvaliacoesDaPagina_(t, ctx);
  if (fase === 'final') return colFinalPasso_(t);
  if (fase === 'detalhes') return colDetalheDaPagina_(t, ctx);
  if (fase === 'conc_ofertas') return colOfertasConcorrente_(t, ctx);
  if (fase === 'varredura') return t.cobertura ? colConferirQueda_(ctx) : colVarredura_(t, ctx);
  if (fase === 'sellers' || fase === 'repescagem') {
    if (t.limpeza) return colLimparAnunciosSubstituidos_();
    return colSellersBusca_(t, ctx, fase === 'repescagem');
  }
  if (ctx.bloqueados[t.mk]) return;                                   // marketplace bloqueado hoje: não insiste
  if (fase === 'concorrentes') {
    const pp2 = PropertiesService.getScriptProperties();
    let nP = Number(pp2.getProperty('COL_N_CONC_P') || 0), nO = Number(pp2.getProperty('COL_N_CONC_O') || 0);
    const catsBase = colCategoriasBase_(ctx), vistosC = colVistosConc_(ctx);
    const candidatos = function (itens, topo) {
      return colRelevantes_(itens, topo).filter(function (it) { return !/dellamed/i.test(it.titulo + ' ' + (it.marca || '') + ' ' + (it.seller || '')) && !colEhAcessorio_(it.titulo); })
        .map(function (it) {
          it._marca = colMarcaReconhecida_(it.marca, it.titulo);
          it._cat = t.categoria || colCategoria_(it.titulo);                  // busca por marca: categoria vem do título
          it._prio = colEhPrioritaria_(it._marca) ? 1 : 0;
          return it;
        })
        .filter(function (it) { return catsBase.indexOf(it._cat) >= 0 && !marcaFora_(it._marca) && !vistosC[t.mk + '|' + (it.id || it.link)]; });   // marcas da aba MARCAS_FORA não entram
    };
    let escolhidos = [];
    if (t.marca) {
      // busca dedicada: até COL_ANUNCIOS_POR_MARCA anúncios da marca, somando os marketplaces; lê várias páginas da busca
      const mapa = JSON.parse(pp2.getProperty('COL_N_MARCA') || '{}'), km = colNorm_(t.marca);
      const mksAt = colMks_(), restantes = mksAt.length - mksAt.indexOf(t.mk);
      const cota = Math.ceil(Math.max(0, COL_ANUNCIOS_POR_MARCA - (mapa[km] || 0)) / Math.max(1, restantes));
      if (cota <= 0) return;
      const ja = {};
      for (let pg = 1; pg <= (COL_PAGINAS_MARCA[t.mk] || 3) && escolhidos.length < cota; pg++) {
        const r = colBuscar_(t.mk, t.marca.toLowerCase(), pg);
        if (!r.ok) { if (pg === 1) { if (!r.vazio) colFalha_(ctx, t.mk, r.motivo); return; } break; }
        if (pg === 1) { colSucesso_(ctx, t.mk); colLimparUmaVez_('CONCORRENTES', t.mk, ctx); }
        const itens = r.itens || [];
        if (!itens.length) break;
        let novosPg = 0;
        candidatos(itens, itens.length).forEach(function (it) {
          const k = it.id || it.link;
          if (ja[k] || escolhidos.length >= cota || colNorm_(it._marca) !== km) return;
          ja[k] = 1; novosPg++; escolhidos.push(it);
        });
        if (itens.length < 12) break;                                      // última página da busca
        if (pg > 1 && !novosPg) break;                                     // página sem nada novo da marca
      }
      mapa[km] = (mapa[km] || 0) + escolhidos.length;
      pp2.setProperty('COL_N_MARCA', JSON.stringify(mapa));
    } else {
      // busca por categoria: outras marcas relevantes (não prioritárias), identificadas e com mais avaliações primeiro
      const r = colBuscar_(t.mk, t.categoria.toLowerCase());
      if (!r.ok) { if (!r.vazio) colFalha_(ctx, t.mk, r.motivo); return; }
      colSucesso_(ctx, t.mk);
      colLimparUmaVez_('CONCORRENTES', t.mk, ctx);
      const nCat = Math.max(1, ctx.nTarefasCat || 1);
      const cota = Math.max(2, Math.ceil(COL_MAX_CONC_OUTRAS / nCat));
      escolhidos = candidatos(r.itens).filter(function (it) { return !it._prio; })
        .filter(function (it) { return it._marca !== 'Não identificada'; })   // outras marcas: só as identificadas; a ordem de relevância já vem de colRelevantes_
        .slice(0, cota);
    }
    const linhas = escolhidos.map(function (it) {
      vistosC[t.mk + '|' + (it.id || it.link)] = 1;
      return { categoria: it._cat, marca: it._marca, produto: it.titulo, marketplace: t.mk, preco: it.preco,
               nota_0a5: it.nota || '', avaliacoes: it.avaliacoes || '', vendidos: it.vendidos || '', link: it.link,
               pontos_fortes: '', pontos_fracos: '', origem: 'COLETA', foto: it.foto, item_id: it.id || '',
               preco_cheio: it.precoOriginal > it.preco ? it.precoOriginal : '', data_captura: new Date() };
    });
    if (t.marca) nP += linhas.length; else nO += linhas.length;
    pp2.setProperty('COL_N_CONC_P', String(nP)); pp2.setProperty('COL_N_CONC_O', String(nO)); pp2.setProperty('COL_N_CONC', String(nP + nO));
    if (linhas.length) appendObjs_('CONCORRENTES', linhas);
  }
}


/* ---------- fase sellers: um produto da loja oficial num marketplace ---------- */
function colSellersBusca_(t, ctx, repescagem) {
  if (ctx.bloqueados[t.mk]) { colMarcarPendente_(t, repescagem, 'marketplace bloqueado hoje: ' + ctx.bloqueados[t.mk]); return; }
  const baseAcess = !!t.item || colEhAcessorio_(t.produto);   // item da lista ou peça vendida na loja: não aplica o filtro de peças
  const codModelo = colCodigoModelo_(t.item || t.sku) || colCodigoModelo_(t.produto);
  const catSku = colCatalogoSku_();                    // catálogo do ML → SKU do produto da loja (vínculo exato pelo link)
  const aceita = function (it) {
    const tt = colNorm_(it.titulo + ' ' + (it.marca || ''));
    const cat = String(it.catalogo || '').toUpperCase();
    const precoOk = !t.preco || (it.preco >= t.preco * 0.4 && it.preco <= t.preco * 2.5);
    const vin = t.item ? colVinculoDe_(it.id, it.link || (cat ? '/p/' + cat : '')) : '';
    if (vin) return vin === t.item && precoOk;                                       // vínculo manual manda em tudo
    if (cat && catSku[cat] && catSku[cat] !== t.sku) return false;                   // anúncio de catálogo de OUTRO produto da loja
    if (cat && t.catalogo && cat === String(t.catalogo).toUpperCase()) return precoOk;   // mesmo catálogo: é o produto
    if (!baseAcess && colEhAcessorio_(it.titulo)) return false;                      // peça de um produto ≠ o produto
    if (!precoOk) return false;                                                       // kit, peça ou outro produto
    if (t.item) { if (colItemConfirmado_(it, t.item).item !== t.item) return false; }   // mesmo ITEM (D100 ≠ D100 Pop): título, ficha, descrição ou foto
    else {
      if (!colCasaProduto_(t, it.titulo)) return false;                              // produto da loja sem item: regra antiga
      if (ixpMelhor(colIndiceProdutos_(), it.titulo, it.preco) !== t.sku) return false;
    }
    if (tt.indexOf('DELLAMED') >= 0 || /dellamed/i.test(it.seller || '')) return true;
    // Revendedor que não escreve "Dellamed" no título: aceito só com o código do modelo, marca vazia ou Dellamed
    // e a mesma categoria do produto (evita o "D30" de outra marca)
    const marca = colNorm_(it.marca || '');
    return !!codModelo && (!marca || marca.indexOf('DELLAMED') >= 0) &&
           (!t.categoria || t.categoria === 'Outros' || colCategoria_(it.titulo) === t.categoria);
  };
  // Buscas do item: pelo nome exato do item e, se ele tem código (D30, DBP-6177…), também por "dellamed + código".
  // Cada busca lê até COL_PAGINAS_ITEM páginas e para quando a página não traz anúncio Dellamed novo.
  const consultas = colConsultasItem_(t);
  const vistosB = {}, aceitosB = {}, encontrados = [];
  let respondeu = false;
  for (let qi = 0; qi < consultas.length; qi++) {
    for (let pg = 1; pg <= COL_PAGINAS_ITEM; pg++) {
      const r = colBuscarDm_(t.mk, consultas[qi], pg);
      if (!r.ok) {
        if (qi === 0 && pg === 1) {                                                   // a busca principal não respondeu
          if (!r.vazio) colFalha_(ctx, t.mk, r.motivo);     // página vazia sem aviso de "nenhum resultado" não conta para bloquear o marketplace
          colMarcarPendente_(t, repescagem, r.motivo);
          return;
        }
        break;
      }
      if (!respondeu) { respondeu = true; colSucesso_(ctx, t.mk); }
      const pp0 = PropertiesService.getScriptProperties();
      pp0.setProperty('COL_N_BUSCAS', String(Number(pp0.getProperty('COL_N_BUSCAS') || 0) + 1));
      const itensPg = r.itens || [];
      let doItem = 0;                                                                 // anúncios do item nesta página (novos ou já vistos na outra busca)
      itensPg.forEach(function (it) {
        const k = it.id || it.link; if (!k) return;
        if (vistosB[k]) { if (aceitosB[k]) doItem++; return; }
        vistosB[k] = 1;
        if (aceita(it)) { aceitosB[k] = 1; encontrados.push(it); doItem++; }
      });
      if (!doItem || itensPg.length < 12) break;                                      // acabou a busca ou a página já não tem o item
    }
  }
  const pp = PropertiesService.getScriptProperties();
  const aceitos = encontrados;
  let linhas = aceitos.map(function (it) {
    const oficial = /dellamed/i.test(it.seller || '');                              // loja da própria Dellamed em qualquer marketplace
    return { data_captura: new Date(), marketplace: t.mk, seller: oficial ? 'DELLAMED' : (it.seller || 'Não identificado'), sku: t.sku,
             titulo: it.titulo, preco: it.preco, link: it.link, reputacao_0a5: '', avaliacoes: it.avaliacoes || '', vendidos: it.vendidos || '',
             ganha_buybox: 'Não', origem: 'COLETA', foto: it.foto, item_id: it.id || '',
             preco_cheio: it.precoOriginal > it.preco ? it.precoOriginal : '' };
  });
  // O card da busca mostra só UM vendedor por produto de catálogo (ML) ou por ASIN (Amazon): quem ganha a compra.
  // Os outros revendedores do mesmo produto ficam escondidos ali dentro; aqui eles são lidos um a um.
  const extras = colOfertasDoProduto_(t, aceitos, ctx).filter(function (o) { const v = t.item ? colVinculoDe_(o.id, o.link) : ''; return !v || v === t.item; });
  if (extras.length && t.mk === 'Amazon') {                                          // as ofertas do ASIN já incluem quem aparecia na busca
    const comOferta = {};
    extras.forEach(function (o) { comOferta[String(o.id).split(':')[0]] = 1; });
    linhas = linhas.filter(function (l) { return !comOferta[l.item_id]; });
  }
  if (extras.length) {
    const porId = {};
    linhas.forEach(function (l) { if (l.item_id) porId[l.item_id] = l; });
    extras.forEach(function (o) {
      const k = o.id, ja = k && porId[k];
      if (ja) { if (o.seller && /^n[aã]o identificado$/i.test(ja.seller)) ja.seller = o.seller; if (!ja.preco_cheio && o.precoOriginal > ja.preco) ja.preco_cheio = o.precoOriginal; if (o.buybox) ja.ganha_buybox = 'Sim'; return; }
      const oficial = /dellamed/i.test(o.seller || '');
      const l = { data_captura: new Date(), marketplace: t.mk, seller: oficial ? 'DELLAMED' : (o.seller || 'Não identificado'), sku: t.sku,
                  titulo: o.titulo || t.produto, preco: o.preco, link: o.link, reputacao_0a5: '', avaliacoes: '', vendidos: '',
                  ganha_buybox: o.buybox ? 'Sim' : 'Não', origem: 'COLETA', foto: o.foto || '', item_id: o.id || '',
                  preco_cheio: o.precoOriginal > o.preco ? o.precoOriginal : '' };
      if (k) porId[k] = l;
      linhas.push(l);
    });
  }
  const jaRun = colChavesRun_(ctx);
  linhas = linhas.filter(function (l) { return !colJaGravado_(jaRun, t.mk, l.item_id, l.link); }).slice(0, COL_ADS_POR_BUSCA + extras.length);
  linhas.forEach(function (l) { colMarcarGravado_(jaRun, t.mk, l.item_id, l.link); });
  let nAds = Number(pp.getProperty('COL_N_ADS') || 0);
  const vend = JSON.parse(pp.getProperty('COL_VEND') || '[]');
  linhas.forEach(function (l) {
    if (l.seller === 'DELLAMED') return;
    nAds++;
    const chave = t.mk + '|' + colNorm_(l.seller);
    if (vend.indexOf(chave) < 0) vend.push(chave);
  });
  pp.setProperty('COL_N_ADS', String(nAds));
  try { pp.setProperty('COL_VEND', JSON.stringify(vend)); } catch (e) {}           // só alimenta o resumo do LOG
  appendObjs_('ANUNCIOS', linhas);
}


// Buscas de um item: o nome exato do item (HIG → HIGIENICA) e, quando ele tem código, "dellamed + código"
// (pega o revendedor que escreve "Cadeira de Banho D30 Dellamed" em vez de "Cadeira Higiênica D30").
function colConsultasItem_(t) {
  const cod = colCodigo_(t.item || t.sku, t.produto);
  const q1 = 'dellamed ' + (t.item ? t.item.replace(/\bHIG\b/g, 'HIGIENICA').replace(/\bC\//g, 'COM ').toLowerCase() : (cod || colTermosBusca_(t.produto)));
  const l = [q1], cm = colCodigoModelo_(t.item || t.sku) || colCodigoModelo_(t.produto);
  if (cm) { const q2 = 'dellamed ' + cm.toLowerCase(); if (colNorm_(q2) !== colNorm_(q1)) l.push(q2); }
  return l;
}
// Busca de anúncios DELLAMED: no Mercado Livre sem a trava da categoria Saúde (massageador está em Beleza, bomba tira-leite
// em Bebês, joelheira em Esportes). A identificação do item já garante que é produto Dellamed. Concorrentes seguem só em Saúde.
function colBuscarDm_(mk, q, pg) {
  if (mk !== 'Mercado Livre') return colBuscar_(mk, q, pg);
  pg = pg > 1 ? pg : 1;
  const ck = 'bdm_' + q + '|' + pg;
  if (COL_CACHE[ck]) return COL_CACHE[ck];
  const desde = pg > 1 ? '_Desde_' + ((pg - 1) * 48 + 1) : '';
  const h = colFetch_('https://lista.mercadolivre.com.br/' + colSlug_(q) + desde + '_NoIndex_True');
  if (!h.ok) return { ok: false, motivo: h.motivo, itens: [] };
  const itens = colParseML_(h.texto);
  if (!itens.length) return colSemResultado_(h.texto) ? { ok: true, itens: [] } : { ok: false, vazio: true, itens: [],
    motivo: 'página sem produtos reconhecíveis — título "' + colTituloPagina_(h.texto) + '", ' + Math.round(h.texto.length / 1024) + ' KB' };
  const r = { ok: true, itens: itens };
  COL_CACHE[ck] = r;
  return r;
}

// Anúncios já gravados NESTA coleta (marketplace + código ou link): nenhuma busca grava o mesmo anúncio duas vezes.
function colChavesRun_(ctx) {
  if (ctx.jaRun) return ctx.jaRun;
  const run = Number(PropertiesService.getScriptProperties().getProperty('COL_RUN') || 0), m = {};
  lerAba_('ANUNCIOS').forEach(function (r) {
    const d = r.data_captura instanceof Date ? r.data_captura.getTime() : new Date(r.data_captura).getTime();
    if (run && d && d >= run) colMarcarGravado_(m, str_(r.marketplace), str_(r.item_id), str_(r.link));
  });
  ctx.jaRun = m;
  return m;
}
function colChaveLink_(link) { return String(link || '').split(/[?#]/)[0].replace(/\/+$/, ''); }
function colMarcarGravado_(m, mk, id, link) { if (id) m[mk + '|' + id] = 1; const l = colChaveLink_(link); if (l) m[mk + '|' + l] = 1; }
function colJaGravado_(m, mk, id, link) { const l = colChaveLink_(link); return !!((id && m[mk + '|' + id]) || (l && m[mk + '|' + l])); }

/* ---------- fase varredura: busca "Dellamed" em cada marketplace, página por página ----------
   Pega todo anúncio com Dellamed no título que as buscas por item não trouxeram (título escrito de outro jeito,
   outra categoria, página mais funda). O item de cada anúncio é identificado pela mesma regra das buscas por item. */
function colVarredura_(t, ctx) {
  const p = PropertiesService.getScriptProperties();
  const fim = JSON.parse(p.getProperty('COL_VARR_FIM') || '{}');
  if (fim[t.mk] || ctx.bloqueados[t.mk]) return;                                   // a busca deste marketplace já acabou
  const r = colBuscarDm_(t.mk, 'dellamed', t.pg);
  const encerrar = function (motivo) { fim[t.mk] = motivo || 'fim'; p.setProperty('COL_VARR_FIM', JSON.stringify(fim)); };
  if (!r.ok) { if (t.pg === 1 && !r.vazio) colFalha_(ctx, t.mk, r.motivo); encerrar(r.motivo); return; }
  const itens = r.itens || [];
  if (!itens.length) { encerrar('fim'); return; }
  // site que devolve a última página de novo quando a busca acaba: mesma página = fim
  const ult = JSON.parse(p.getProperty('COL_VARR_ULT') || '{}'), assin = itens.slice(0, 3).map(function (x) { return x.id || x.link; }).join('|');
  if (t.pg > 1 && ult[t.mk] === assin) { encerrar('fim'); return; }
  ult[t.mk] = assin; p.setProperty('COL_VARR_ULT', JSON.stringify(ult));
  if (!ctx.skuDoItem) {                                                             // item → produto da base (SKU e preço base)
    ctx.skuDoItem = {};
    lerAba_('PRODUTOS_BASE').forEach(function (b) {
      const it = str_(b.item).toUpperCase(); if (!it || !str_(b.sku)) return;
      const ja = ctx.skuDoItem[it];
      if (!ja || str_(b.origem) !== 'ITEM') ctx.skuDoItem[it] = { sku: str_(b.sku), preco: precoBase_(it, b.preco_base).preco };
    });
  }
  const jaRun = colChavesRun_(ctx), linhas = [];
  itens.forEach(function (it) {
    if (!/dellamed/i.test(it.titulo + ' ' + (it.marca || '') + ' ' + (it.seller || ''))) return;   // só anúncio Dellamed
    if (colJaGravado_(jaRun, t.mk, it.id, it.link)) return;
    const item = colItemConfirmado_(it, '').item;
    const base = item && ctx.skuDoItem[item];
    if (!base) return;                                                              // não é um item da lista
    if (colEhAcessorio_(it.titulo) && !colEhAcessorio_(item)) return;               // peça de um produto ≠ o produto
    if (base.preco && (it.preco < base.preco * 0.4 || it.preco > base.preco * 2.5)) return;   // kit, peça ou outro produto
    const oficial = /dellamed/i.test(it.seller || '');
    colMarcarGravado_(jaRun, t.mk, it.id, it.link);
    linhas.push({ data_captura: new Date(), marketplace: t.mk, seller: oficial ? 'DELLAMED' : (it.seller || 'Não identificado'), sku: base.sku,
                  titulo: it.titulo, preco: it.preco, link: it.link, reputacao_0a5: '', avaliacoes: it.avaliacoes || '', vendidos: it.vendidos || '',
                  ganha_buybox: 'Não', origem: 'COLETA', foto: it.foto, item_id: it.id || '',
                  preco_cheio: it.precoOriginal > it.preco ? it.precoOriginal : '' });
  });
  colSucesso_(ctx, t.mk);
  if (linhas.length) {
    appendObjs_('ANUNCIOS', linhas);
    let nAds = Number(p.getProperty('COL_N_ADS') || 0), nV = Number(p.getProperty('COL_N_VARR') || 0);
    const vend = JSON.parse(p.getProperty('COL_VEND') || '[]');
    linhas.forEach(function (l) { if (l.seller === 'DELLAMED') return; nAds++; nV++; const k = t.mk + '|' + colNorm_(l.seller); if (vend.indexOf(k) < 0) vend.push(k); });
    p.setProperty('COL_N_ADS', String(nAds)); p.setProperty('COL_N_VARR', String(nV));
    try { p.setProperty('COL_VEND', JSON.stringify(vend)); } catch (e) {}
  }
  if (itens.length < 12) encerrar('fim');                                           // última página da busca
}

// Contagem de anúncios de revenda por marketplace e por item (planilha ANUNCIOS; só desta coleta quando somenteRun)
function colContagem_(somenteRun) {
  const run = Number(PropertiesService.getScriptProperties().getProperty('COL_RUN') || 0);
  const itemDoSku = {}; lerAba_('PRODUTOS_BASE').forEach(function (b) { if (str_(b.sku)) itemDoSku[str_(b.sku)] = str_(b.item).toUpperCase(); });
  const porMk = {}, porItem = {};
  lerAba_('ANUNCIOS').forEach(function (r) {
    if (str_(r.seller) === 'DELLAMED' || str_(r.origem) !== 'COLETA') return;
    if (somenteRun) { const d = r.data_captura instanceof Date ? r.data_captura.getTime() : new Date(r.data_captura).getTime(); if (!(d >= run)) return; }
    const mk = str_(r.marketplace), it = itemDoSku[str_(r.sku)] || '';
    porMk[mk] = (porMk[mk] || 0) + 1;
    if (it) { porItem[it] = porItem[it] || {}; porItem[it][mk] = 1; }
  });
  return { porMk: porMk, porItem: porItem };
}
// Fim da varredura: marketplace que trouxe muito menos anúncios que a coleta anterior (sinal de bloqueio parcial)
// tem todas as buscas de item refeitas na repescagem, depois de uma pausa.
function colConferirQueda_(ctx) {
  const p = PropertiesService.getScriptProperties();
  const ant = JSON.parse(p.getProperty('COL_COBERTURA') || '{}').porMk || {};
  const hoje = colContagem_(true).porMk, quedas = [];
  colMks_().forEach(function (mk) {
    const a = ant[mk] || 0, h = hoje[mk] || 0;
    if (a >= 30 && h < a * (1 - COL_QUEDA_ALERTA)) quedas.push(mk + ' ' + h + ' (anterior ' + a + ')');
  });
  if (!quedas.length) return;
  p.setProperty('COL_QUEDA', quedas.join('; '));
  const mks = quedas.map(function (q) { return q.replace(/ \d.*$/, ''); });
  lerAba_('PRODUTOS_BASE').filter(function (r) { return r.sku && r.produto && (str_(r.item) || !colEhAcessorio_(r.produto)); }).forEach(function (r) {
    mks.forEach(function (mk) { if (colMks_().indexOf(mk) >= 0) colMarcarPendente_({ mk: mk, sku: str_(r.sku) }, false, 'queda de anúncios'); });
  });
  log_('sistema', 'coleta_queda', 'Bem menos anúncios de revenda que na coleta anterior: ' + quedas.join('; ') + '. As buscas desses marketplaces serão refeitas na repescagem.');
}
// Fim da coleta: quantos itens da aba ITENS têm anúncio de revenda, por marketplace, comparado com a coleta anterior.
function colCobertura_() {
  const p = PropertiesService.getScriptProperties();
  const ant = JSON.parse(p.getProperty('COL_COBERTURA') || '{}');
  const c = colContagem_(false), itens = itensLista_();
  const com = itens.filter(function (it) { return c.porItem[it]; }), sem = itens.filter(function (it) { return !c.porItem[it]; });
  const sumiram = (ant.itens || []).filter(function (it) { return !c.porItem[it] && itens.indexOf(it) >= 0; });
  const total = Object.keys(c.porMk).reduce(function (s, k) { return s + c.porMk[k]; }, 0);
  const mkTxt = colMks_().map(function (mk) { return mk + ' ' + (c.porMk[mk] || 0) + (ant.porMk ? ' (anterior ' + (ant.porMk[mk] || 0) + ')' : ''); }).join(', ');
  const msg = 'Itens com anúncio de revenda: ' + com.length + ' de ' + itens.length + (ant.itens ? ' (anterior ' + ant.itens.length + ')' : '') +
              '. Anúncios de revenda: ' + total + ' — ' + mkTxt + '.' +
              (p.getProperty('COL_N_VARR') ? ' Achados só pela varredura da marca: ' + p.getProperty('COL_N_VARR') + '.' : '') +
              (sumiram.length ? ' Sumiram desde a coleta anterior: ' + sumiram.join(', ') + '.' : '') +
              (sem.length ? ' Sem anúncio de revenda: ' + sem.join(', ') + '.' : '');
  log_('sistema', 'coleta_cobertura', msg.slice(0, 4000));
  try { p.setProperty('COL_COBERTURA', JSON.stringify({ porMk: c.porMk, itens: com })); }
  catch (e) { p.setProperty('COL_COBERTURA', JSON.stringify({ porMk: c.porMk })); }
}

/* ---------- ofertas escondidas: todos os vendedores de um produto de catálogo (ML) ou de um ASIN (Amazon) ---------- */
function colOfertasDoProduto_(t, aceitos, ctx) {
  const out = [];
  if (t.mk === 'Mercado Livre') {
    const cats = {};
    if (t.catalogo) cats[t.catalogo] = 1;
    aceitos.forEach(function (it) { if (it.catalogo) cats[it.catalogo] = 1; });
    Object.keys(cats).forEach(function (c) {
      const r = colOfertasML_(c, ctx);
      if (r.ok) Array.prototype.push.apply(out, r.itens); else colNotaOfertas_(ctx, 'ML ' + c + ': ' + r.motivo);
    });
  }
  if (t.mk === 'Amazon' && COL_AMAZON_OFERTAS) {
    const asins = {};
    aceitos.forEach(function (it) { if (it.id) asins[it.id] = 1; });
    Object.keys(asins).slice(0, 2).forEach(function (a) {
      const r = colOfertasAmazon_(a);
      if (r.ok) Array.prototype.push.apply(out, r.itens); else if (!r.desligado) colNotaOfertas_(ctx, 'Amazon ' + a + ': ' + r.motivo);
    });
  }
  return out;
}
function colNotaOfertas_(ctx, txt) {
  const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty('COL_N_NOTAS_OF') || 0) + 1;
  p.setProperty('COL_N_NOTAS_OF', String(n));
  if (n <= 2) log_('sistema', 'coleta_ofertas_falha', String(txt).slice(0, 400));
}

// Mercado Livre: com a conta conectada (menu Mercado Livre: conectar conta) usa a API oficial, que lista todos os
// vendedores do catálogo com preço e o apelido do vendedor (o mesmo que extensões como o Mercado Turbo mostram).
// Sem a conta conectada, lê a página "Outras opções de compra" (plano B: depende do formato do site).
function colOfertasML_(cat, ctx) {
  const k = 'of_' + cat;
  if (COL_CACHE[k]) return COL_CACHE[k];
  let r = colOfertasMLApi_(cat, ctx);
  if (!r.ok) { const h = colOfertasMLHtml_(cat); if (h.ok || !r.motivo) r = h; else r.motivo += ' · página: ' + h.motivo; }
  if (r.ok && r.itens && !r.itens.some(function (o) { return o.buybox; })) {       // API sem o vencedor: lê o Buy Box pela página do produto
    const bb = colBuyBoxML_(cat, ctx);
    if (bb) r.itens.forEach(function (o) { o.buybox = colEhVencedorML_(o, bb); });
  }
  COL_CACHE[k] = r;
  return r;
}
function colApiML_() {
  if (COL_CACHE.apiML !== undefined) return COL_CACHE.apiML;
  let ok = false;
  try { if (PropertiesService.getScriptProperties().getProperty('ML_REFRESH_TOKEN')) { mlToken_(); ok = true; } } catch (e) {}
  COL_CACHE.apiML = ok;
  return ok;
}
function colOfertasMLApi_(cat, ctx) {
  if (!colApiML_()) return { ok: false, motivo: '' };
  const out = [];
  let off = 0;
  for (let pg = 0; pg < 6; pg++) {
    const j = mlGet_('/products/' + cat + '/items?offset=' + off);
    if (!j) return out.length ? { ok: true, itens: out } : { ok: false, motivo: 'API sem resposta para o catálogo' };
    const res = j.results || [];
    res.forEach(function (x) {
      out.push({ id: String(x.item_id || ''), sellerId: String(x.seller_id || ''), preco: Number(x.price) || 0, precoOriginal: Number(x.original_price) || 0,
                 link: 'https://www.mercadolivre.com.br/p/' + cat + '?pdp_filters=item_id:' + x.item_id });
    });
    const tot = (j.paging && j.paging.total) || 0, lim = (j.paging && j.paging.limit) || res.length;
    off += lim;
    if (!res.length || off >= tot) break;
  }
  const pr = mlGet_('/products/' + cat);
  const bb = pr && pr.buy_box_winner ? String(pr.buy_box_winner.item_id || '') : '';
  out.forEach(function (o) { o.seller = colNomeSellerML_(o.sellerId, ctx); o.buybox = !!bb && o.id === bb; if (pr) { o.titulo = pr.name; o.foto = pr.pictures && pr.pictures[0] ? pr.pictures[0].url : ''; } });
  return { ok: true, itens: out.filter(function (o) { return o.preco > 0; }) };
}
function colOfertasMLHtml_(cat) {
  const h = colFetch_('https://www.mercadolivre.com.br/p/' + cat + '/s');
  if (!h.ok) return { ok: false, motivo: h.motivo };
  const html = h.texto, vistos = {}, out = [];
  const rx = /(?:item_id(?::|%3A|"\s*:\s*")|wid=)(MLB-?\d{6,})/gi;
  let m;
  while ((m = rx.exec(html))) {
    const id = m[1].replace('-', '').toUpperCase();
    if (vistos[id] || id === cat) continue;
    const janela = html.slice(Math.max(0, m.index - 4000), m.index + 4000);
    const preco = colPrecoML_(janela);
    if (!preco) continue;
    vistos[id] = 1;
    const seller = colTexto_(colMatch_(janela, /Vendido por\s*(?:<[^>]+>\s*)*([^<]{2,60})</i)).replace(/^Vendido por\s*/i, '');
    out.push({ id: id, sellerId: '', seller: seller, preco: preco, link: 'https://www.mercadolivre.com.br/p/' + cat + '?pdp_filters=item_id:' + id });
  }
  return out.length ? { ok: true, itens: out } : { ok: false, motivo: 'página de ofertas sem itens reconhecíveis — título "' + colTituloPagina_(html) + '"' };
}
// Apelido do vendedor do ML pelo ID. Guarda na aba VENDEDORES (observação "automático") para não consultar de novo.
function colNomeSellerML_(id, ctx) {
  if (!id) return '';
  if (!ctx.nomesML) {
    ctx.nomesML = {};
    lerAba_('VENDEDORES').forEach(function (r) { if (/mercado livre/i.test(str_(r.marketplace)) && str_(r.codigo)) ctx.nomesML[str_(r.codigo)] = str_(r.nome); });
  }
  if (ctx.nomesML[id]) return ctx.nomesML[id];
  const u = colApiML_() ? mlGet_('/users/' + id) : null;
  const nome = u && u.nickname ? String(u.nickname) : '';
  if (nome) { ctx.nomesML[id] = nome; appendObjs_('VENDEDORES', [{ codigo: id, nome: nome, marketplace: 'Mercado Livre', observacao: 'automático (API do Mercado Livre)' }]); }
  return nome;
}

// Amazon: todos os vendedores do mesmo ASIN (janela "Outras ofertas"), com preço e nome.
// Amazon: todos os vendedores do mesmo ASIN (janela "Outras ofertas"), com preço e nome.
// Se a Amazon não liberar essa janela 4 vezes seguidas, a coleta para de pedir pelo resto do dia (só a busca segue),
// para não gastar tempo: cada pedido recusado custa vários segundos.
const COL_AOD_MAX_FALHAS = 4;
// Desligado (out/2026): a Amazon responde 404 à lista de "outros vendedores" pedida pelo servidor do Google.
// A Amazon segue pela busca: revendedores com anúncio (ASIN) próprio e quem ganha a compra em cada ASIN.
const COL_AMAZON_OFERTAS = false;
function colOfertasAmazon_(asin) {
  const k = 'aod_' + asin;
  if (COL_CACHE[k]) return COL_CACHE[k];
  const p = PropertiesService.getScriptProperties();
  const falhas = Number(p.getProperty('COL_AOD_FALHAS') || 0);
  if (falhas >= COL_AOD_MAX_FALHAS) return (COL_CACHE[k] = { ok: false, desligado: true, motivo: 'janela de ofertas desligada hoje' });
  const urls = ['https://www.amazon.com.br/gp/product/ajax/aodAjaxMain/ref=dp_aod_ALL_mbc?asin=' + asin + '&pc=dp&experienceId=aodAjaxMain',
                'https://www.amazon.com.br/gp/aod/ajax/ref=auto_load_aod?asin=' + asin + '&pc=dp'];
  let res = { ok: false, motivo: '' };
  for (let t = 0; t < urls.length && !res.ok; t++) {
    const h = t === 0 ? colFetchSimples_(urls[t], { Referer: 'https://www.amazon.com.br/dp/' + asin, 'X-Requested-With': 'XMLHttpRequest' }) : colFetch_(urls[t]);
    if (!h.ok) { res = { ok: false, motivo: h.motivo }; continue; }
    const out = colParseAOD_(h.texto, asin);
    res = out.length ? { ok: true, itens: out }
        : { ok: false, motivo: 'janela de ofertas sem itens reconhecíveis — ' + Math.round(h.texto.length / 1024) + ' KB, título "' + colTituloPagina_(h.texto) +
                                '", blocos aod-offer: ' + (h.texto.match(/aod-offer/g) || []).length + ', preços: ' + (h.texto.match(/a-offscreen/g) || []).length };
  }
  if (res.ok) p.deleteProperty('COL_AOD_FALHAS');
  else {
    p.setProperty('COL_AOD_FALHAS', String(falhas + 1));
    if (falhas + 1 === COL_AOD_MAX_FALHAS) log_('sistema', 'coleta_amazon_ofertas_off', 'A Amazon não liberou a lista de outros vendedores ' + COL_AOD_MAX_FALHAS + ' vezes seguidas. Nesta coleta a Amazon segue só pela busca. Último motivo: ' + res.motivo);
  }
  COL_CACHE[k] = res;
  return res;
}
function colParseAOD_(html, asin) {
  const out = [];
  const nb = '(?:\\s|&nbsp;|\\u00a0)*';
  const rxPreco = new RegExp('a-offscreen"?[^>]*>' + nb + 'R\\$' + nb + '([\\d.,]+)');
  html.split(/id="aod-pinned-offer"|id="aod-offer"(?!-)|id='aod-offer'/).slice(1).forEach(function (b, i) {
    b = b.slice(0, 15000);
    let preco = colNum_(colMatch_(b, rxPreco));
    if (!preco) { const w = colMatch_(b, /a-price-whole">([\d.]+)/), f = colMatch_(b, /a-price-fraction">(\d+)/); if (w) preco = colNum_(w) + (f ? Number(f) / 100 : 0); }
    const bloco = colMatch_(b, /id="aod-offer-soldBy"([\s\S]{0,3000}?)(?:id="aod-offer-|$)/) || '';
    let seller = colTexto_(colMatch_(bloco, /<a[^>]*>\s*([^<]{2,80}?)\s*<\/a>/));
    if (!seller) seller = colTexto_(colMatch_(bloco, /<span[^>]*class="[^"]*a-color-base[^"]*"[^>]*>\s*([^<]{2,80}?)\s*<\/span>/));
    if (/^vendido por$/i.test(seller)) seller = '';
    const sid = colMatch_(b, /[?&](?:seller|smid)=([A-Z0-9]{8,20})/);
    if (preco > 0 && seller) out.push({ id: asin + ':' + (sid || colSlug_(seller)), seller: seller, preco: preco, buybox: i === 0,
                                        link: 'https://www.amazon.com.br/dp/' + asin + (sid ? '?smid=' + sid : '') });
  });
  return out;
}

/* ---------- fase conc_ofertas: quem vende cada produto concorrente e por quanto ---------- */
function colOfertasConcorrente_(t, ctx) {
  if (t.limparOfertasConc) { removerOrigem_('OFERTAS_CONC', 'COLETA'); return; }
  if (ctx.bloqueados['of_' + t.mk]) return;
  let itens = [];
  const cat = t.mk === 'Mercado Livre' ? (colMatch_(t.chave, /\/p\/(MLB\d+)/i) || '').toUpperCase() : '';
  const asin = t.mk === 'Amazon' && COL_AMAZON_OFERTAS ? (t.item || colMatch_(t.chave, /\/dp\/([A-Z0-9]{10})/)) : '';
  if (cat) { const r = colOfertasML_(cat, ctx); if (r.ok) itens = r.itens; }
  else if (asin) { const r = colOfertasAmazon_(asin); if (r.ok) itens = r.itens; }
  if (!itens.length) {
    // anúncio comum (sem catálogo) ou Magalu: procura o mesmo produto, da mesma marca, nos resultados da busca
    const q = (t.marca && !/^n[aã]o identificada$/i.test(t.marca) ? t.marca + ' ' : '') + colPalavrasChave_(t.produto, 5);
    const r = colBuscar_(t.mk, q);
    if (!r.ok) { if (!r.vazio) colFalha_(ctx, 'of_' + t.mk, r.motivo); return; }
    colSucesso_(ctx, 'of_' + t.mk);
    itens = (r.itens || []).filter(function (it) { return colMesmoProdutoConc_(t, it); }).map(function (it) {
      return { id: it.id || '', seller: it.seller || '', preco: it.preco, link: it.link, foto: it.foto, precoOriginal: it.precoOriginal, selos: it.selos };
    });
  }
  const vistos = {};
  const linhas = itens.filter(function (o) { const k = o.id || o.link; if (!k || vistos[k]) return false; vistos[k] = 1; return o.preco > 0; })
    .slice(0, 40).map(function (o) {
      return { data_captura: new Date(), chave: t.chave, marketplace: t.mk, seller: o.seller || 'Não identificado', preco: o.preco,
               link: o.link, item_id: o.id || '', foto: o.foto || t.foto, origem: 'COLETA', preco_cheio: o.precoOriginal > o.preco ? o.precoOriginal : '' };
    });
  appendObjs_('OFERTAS_CONC', linhas);
}
// Mesmo produto concorrente: mesma marca, mesmo código de modelo (se houver) ou 70% das palavras do nome, preço na faixa.
function colMesmoProdutoConc_(t, it) {
  if (/dellamed/i.test(it.titulo + ' ' + (it.marca || ''))) return false;
  if (colEhAcessorio_(it.titulo) && !colEhAcessorio_(t.produto)) return false;
  if (t.preco && (it.preco < t.preco * 0.5 || it.preco > t.preco * 2)) return false;
  const marca = colNorm_(t.marca);
  if (marca && !/^NAO IDENTIFICADA$/.test(marca)) {
    const m2 = colNorm_(colMarcaReconhecida_(it.marca, it.titulo));
    if (m2 !== marca && colNorm_(it.titulo).indexOf(marca) < 0) return false;
  }
  const rx = /\b([A-Z]{1,4}-?\d{2,5}[A-Z]?)\b/;
  const c1 = (colNorm_(t.produto).match(rx) || [])[1];
  const tn = ' ' + colNorm_(it.titulo).replace(/[^A-Z0-9]+/g, ' ') + ' ';
  if (c1) return tn.indexOf(' ' + c1.replace('-', '') + ' ') >= 0 || tn.indexOf(' ' + c1 + ' ') >= 0 || colNorm_(it.titulo).indexOf(c1) >= 0;
  const ws = colNorm_(t.produto).split(/[^A-Z0-9]+/).filter(function (w) { return w.length > 2 && !COL_STOP_P[w]; });
  if (!ws.length) return false;
  return ws.filter(function (w) { return tn.indexOf(' ' + w + ' ') >= 0; }).length / ws.length >= 0.7;
}
function colPalavrasChave_(titulo, n) {
  return colNorm_(titulo).split(/[^A-Z0-9]+/).filter(function (w) { return w.length > 2 && !COL_STOP_P[w]; }).slice(0, n).join(' ').toLowerCase();
}

// Busca que falhou: na fase sellers vai para a repescagem; na repescagem fica registrada como não monitorada hoje.
function colMarcarPendente_(t, repescagem, motivo) {
  const k = repescagem ? 'COL_FALHOU' : 'COL_PEND';
  const l = colListaLer_(k);
  if (l.some(function (x) { return x.mk === t.mk && x.sku === t.sku; })) return;
  l.push({ mk: t.mk, sku: t.sku, motivo: String(motivo || '').slice(0, 50) });
  colListaGravar_(k, l);
}

// Fim da repescagem: tira os anúncios de revendedores das coletas anteriores, menos os das buscas que não responderam hoje
// (esses ficam até a próxima coleta conseguir ler o produto). Anúncios de produtos que saíram da loja também saem.
function colLimparAnunciosSubstituidos_() {
  const run = Number(PropertiesService.getScriptProperties().getProperty('COL_RUN') || 0);
  if (!run) return;
  const manter = {};
  colListaLer_('COL_FALHOU').forEach(function (x) { manter[x.mk + '|' + x.sku] = 1; });
  const naBase = {};
  lerAba_('PRODUTOS_BASE').forEach(function (r) { if (r.sku) naBase[str_(r.sku)] = 1; });
  removerOrigem_('ANUNCIOS', 'COLETA', function (r) {
    if (str_(r.seller) === 'DELLAMED') return false;                                 // loja oficial: tratada na fase base
    const d = r.data_captura instanceof Date ? r.data_captura.getTime() : new Date(r.data_captura).getTime();
    if (d && d >= run) return false;                                                 // anúncio desta coleta
    if (!naBase[str_(r.sku)]) return true;                                           // produto saiu da loja
    return !manter[str_(r.marketplace) + '|' + str_(r.sku)];
  });
}

// Listas guardadas nas propriedades do script em partes de até 8 KB (o limite por propriedade é 9 KB).
function colListaLer_(k) {
  const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty(k + '_N') || 0);
  let txt = '';
  for (let i = 0; i < n; i++) txt += p.getProperty(k + '_' + i) || '';
  try { return txt ? JSON.parse(txt) : []; } catch (e) { return []; }
}
function colListaGravar_(k, lista) {
  const p = PropertiesService.getScriptProperties(), txt = JSON.stringify(lista), tam = 8000, mapa = {};
  const n = Math.ceil(txt.length / tam), antes = Number(p.getProperty(k + '_N') || 0);
  for (let i = 0; i < n; i++) mapa[k + '_' + i] = txt.slice(i * tam, (i + 1) * tam);
  mapa[k + '_N'] = String(n);
  p.setProperties(mapa);
  for (let i = n; i < antes; i++) p.deleteProperty(k + '_' + i);
}
function colListaLimpar_(k) {
  const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty(k + '_N') || 0);
  for (let i = 0; i < n; i++) p.deleteProperty(k + '_' + i);
  p.deleteProperty(k + '_N');
}

/* ---------- fase base: loja oficial Dellamed no Mercado Livre ---------- */
function colFaseBase_() {
  // Lê TODAS as páginas da loja oficial. Página que falha é tentada 3 vezes; se ainda assim faltar alguma,
  // a leitura é parcial e nenhum produto já cadastrado sai da base (só os lidos hoje são atualizados).
  const todos = [], vistos = {}, falhas = [];
  let total = 0;
  for (let pg = 1; pg <= COL_BASE_MAX_PAGINAS; pg++) {
    if (total && pg > Math.ceil(total / 48)) break;                                  // a loja acabou
    let r = null;
    for (let t = 0; t < 3; t++) {
      if (t) Utilities.sleep(3000 * t);
      r = colLojaOficial_(pg);
      if (r.total && !total) total = r.total;
      if (r.ok && r.itens.length) break;
      if (r.ok && !total && pg > 1) break;                                           // sem contagem: página vazia = fim da loja
    }
    if (!r.ok || (!r.itens.length && (pg === 1 || (total && pg <= Math.ceil(total / 48))))) { falhas.push(pg + ' (' + (r.motivo || 'vazia') + ')'); continue; }
    const novos = r.itens.filter(function (it) { const k = it.id || it.link; if (vistos[k]) return false; vistos[k] = 1; return true; });
    if (!novos.length) break;
    Array.prototype.push.apply(todos, novos);
  }
  const pp = PropertiesService.getScriptProperties();
  if (!todos.length) {
    colBaseItens_();                                                                 // itens da aba ITENS continuam monitorados
    pp.setProperty('COL_BASE_INFO', 'não respondeu, base anterior mantida');
    log_('sistema', 'coleta_base_vazia', 'nenhum produto lido; base anterior mantida. ' + falhas.join('; ').slice(0, 300));
    return;
  }
  const completa = !falhas.length && (!total || todos.length + 2 >= total);
  // Um SKU por produto. Mesmo produto em 2 anúncios: fica o menor preço. Peça/acessório nunca se junta ao produto
  // principal (a bateria da D1000 não pode virar a D1000): ganha SKU próprio pelo código do anúncio.
  // SKU = ITEM da lista Dellamed (aba ITENS), identificado pelo anúncio da loja oficial (vínculo manual pelo link ou título).
  // Mesmo item em 2 anúncios: fica o menor preço. Anúncio que não corresponde a nenhum item fica com o código do anúncio
  // como SKU (não se mistura com nada) e aparece no LOG para conferência.
  const porSku = {}, baseSemItem = [];
  todos.forEach(function (it) {
    const item = colItemConfirmado_(it, '', { semFoto: true }).item;
    if (!item && colEhAcessorio_(it.titulo)) return;                                 // peça/acessório que não está na lista de itens
    const sku = item || it.id;
    if (!sku) return;
    if (!item && !baseSemItem.some(function (x) { return x.id === it.id; })) baseSemItem.push(it);
    if (!porSku[sku] || it.preco < porSku[sku].preco) porSku[sku] = Object.assign({ sku: sku, item: item }, it);
  });
  if (baseSemItem.length) {
    log_('sistema', 'coleta_base_sem_item', baseSemItem.length + ' anúncios da loja sem ITEM: conferir pela foto na aba VINCULO_ITEM. ' + baseSemItem.map(function (x) { return x.titulo; }).join('; ').slice(0, 1200));
    try { colFilaConferencia_(baseSemItem); } catch (e) { log_('sistema', 'vinculo_item_erro', String(e.message || e).slice(0, 200)); }
  }
  const todosSku = Object.keys(porSku).map(function (k) { return porSku[k]; });
  const acessML = colAcessoriosPorCategoriaML_(todosSku.filter(function (x) { return !x.item; }));   // itens da lista nunca são tratados como acessório
  const lista = todosSku.filter(function (x) { return x.item || (!colEhAcessorio_(x.titulo) && !acessML[x.id]); });
  const nFora = todosSku.length - lista.length;
  const sdBase = colEmSaudeML_(lista.map(function (x) { return x.id; }));
  const foraSaude = lista.filter(function (x) { return sdBase[x.id] === false && !x.item; });   // item da aba ITENS fica sempre, em qualquer categoria
  if (foraSaude.length) {
    log_('sistema', 'coleta_base_fora_saude', foraSaude.length + ' produtos da loja fora da categoria Saúde no ML, fora do monitoramento: ' + foraSaude.map(function (x) { return x.titulo; }).join('; ').slice(0, 800));
    for (let i = lista.length - 1; i >= 0; i--) if (sdBase[lista[i].id] === false && !lista[i].item) lista.splice(i, 1);   // fora de Saúde e fora da lista de itens: sai
  }
  if (nFora) log_('sistema', 'coleta_base_acessorios', nFora + ' peças/acessórios da loja fora do monitoramento' + (Object.keys(acessML).length ? ' (' + Object.keys(acessML).length + ' pela categoria do Mercado Livre)' : ''));
  const lidos = {}; lista.forEach(function (x) { lidos[x.sku] = 1; });
  // Sem o anúncio exato no card, o link de catálogo pode abrir em outro vendedor: usa a busca dentro da loja oficial.
  const loja = mlPropSeguro_('COLETA_LOJA_ML') || 'dellamed';
  let semItem = 0;
  lista.forEach(function (x) {
    if (!x.semItem) return;
    semItem++;
    x.link = 'https://lista.mercadolivre.com.br/loja/' + loja + '/' + colSlug_(colCodigo_('', x.titulo) || x.titulo.split(' ').slice(0, 6).join(' '));
  });
  if (semItem) log_('sistema', 'coleta_base_link_loja', semItem + ' produtos sem o código do anúncio no card: link aponta para a busca dentro da loja oficial');
  removerOrigem_('PRODUTOS_BASE', 'COLETA', completa ? null : function (r) { return !!lidos[str_(r.sku)] || (!str_(r.item) && colEhAcessorio_(r.produto)); });
  appendObjs_('PRODUTOS_BASE', lista.map(function (x) {
    return { sku: x.sku, produto: x.titulo, categoria: colCategoria_(x.titulo), linha: '', preco_base: x.precoOriginal || x.preco,
             link_oficial: x.link, origem: 'COLETA', foto: x.foto, mlb_id: x.id || '', catalogo_id: x.catalogo || '', item: x.item || '' };
  }));
  removerOrigem_('ANUNCIOS', 'COLETA', function (r) { return str_(r.seller) === 'DELLAMED' && (completa || !!lidos[str_(r.sku)]); });
  appendObjs_('ANUNCIOS', lista.map(function (x) {
    return { data_captura: new Date(), marketplace: 'Mercado Livre', seller: 'DELLAMED', sku: x.sku, titulo: x.titulo, preco: x.preco,
             link: x.link, reputacao_0a5: 5, avaliacoes: x.avaliacoes || '', vendidos: x.vendidos || '', ganha_buybox: 'Não',
             origem: 'COLETA', foto: x.foto, item_id: x.id || '',
             preco_cheio: x.precoOriginal > x.preco ? x.precoOriginal : '' };
  }));
  const nItensFora = colBaseItens_();
  const info = lista.length + ' produtos de ' + todos.length + ' anúncios' + (total ? ' (a loja informa ' + total + ')' : '') +
               (nItensFora ? ' + ' + nItensFora + ' itens da aba ITENS sem anúncio na loja (preço base = PMV)' : '') +
               (completa ? '' : ', leitura parcial: produtos não lidos hoje mantidos com o preço anterior');
  pp.setProperty('COL_BASE_INFO', info);
  log_('sistema', completa ? 'coleta_base_ok' : 'coleta_base_parcial', info + (falhas.length ? '. Páginas com falha: ' + falhas.join('; ').slice(0, 300) : ''));
}

// Itens da aba ITENS que não têm anúncio na loja oficial: entram na base com origem ITEM (SKU = nome do item, preço base = PMV),
// para serem buscados em todos os marketplaces como os demais. Devolve quantos itens entraram assim.
function colBaseItens_() {
  const naLoja = {};
  lerAba_('PRODUTOS_BASE').forEach(function (r) { if (str_(r.origem) !== 'ITEM' && str_(r.item)) naLoja[str_(r.item).toUpperCase()] = 1; });
  const fora = itensLista_().filter(function (it) { return !naLoja[it]; });
  removerOrigem_('PRODUTOS_BASE', 'ITEM');
  appendObjs_('PRODUTOS_BASE', fora.map(function (it) {
    const pb = precoBase_(it, 0);
    return { sku: it, produto: it, categoria: colCategoria_(it), linha: '', preco_base: pb.preco > 0 ? pb.preco : '', link_oficial: '',
             origem: 'ITEM', foto: '', mlb_id: '', catalogo_id: '', item: it };
  }));
  return fora.length;
}

function colLojaOficial_(pg) {
  const loja = mlPropSeguro_('COLETA_LOJA_ML') || 'dellamed';
  const url = 'https://lista.mercadolivre.com.br/loja/' + loja + '/' + (pg > 1 ? '_Desde_' + ((pg - 1) * 48 + 1) + '_NoIndex_True' : '');
  const h = colFetch_(url);
  if (!h.ok) return { ok: false, itens: [], motivo: h.motivo, total: 0 };
  const itens = colParseML_(h.texto);
  const tm = colTexto_(h.texto.slice(0, 600000)).match(/([\d.]+)\s+resultados?\b/i);
  return { ok: true, itens: itens, total: tm ? colNum_(tm[1]) : 0,
           motivo: itens.length ? '' : 'página sem produtos reconhecíveis — título "' + colTituloPagina_(h.texto) + '", ' + Math.round(h.texto.length / 1024) + ' KB' };
}

// Com a conta do ML conectada: o anúncio cuja categoria oficial no Mercado Livre é de peças, acessórios ou reposição
// (ex.: "Cadeiras de Rodas > Acessórios") fica fora, mesmo que o título não diga. Devolve { MLBid: true }.
const COL_RX_CAT_ACESS = /pe[cç]as|acess[oó]rios|reposi[cç][aã]o|refis|refil|insumos|suprimentos|baterias|carregadores|eletrodos|lancetas|tiras/i;
function colAcessoriosPorCategoriaML_(itens) {
  const out = {};
  if (!colApiML_()) return out;
  const ids = itens.map(function (x) { return x.id; }).filter(function (id) { return /^MLB\d+$/.test(id || ''); });
  const catDe = {}, cats = {};
  for (let i = 0; i < ids.length; i += 20) {
    const r = mlGet_('/items?ids=' + ids.slice(i, i + 20).join(',') + '&attributes=id,category_id');
    (r || []).forEach(function (x) { const b = x && x.body; if (b && b.id && b.category_id) { catDe[b.id] = b.category_id; cats[b.category_id] = 1; } });
  }
  const ehAcess = {};
  Object.keys(cats).forEach(function (c) {
    const k = 'cat_' + c;
    if (COL_CACHE[k] === undefined) {
      const j = mlGet_('/categories/' + c);
      const nomes = j ? (j.path_from_root || []).map(function (n) { return n.name; }).concat([j.name || '']) : [];
      COL_CACHE[k] = nomes.some(function (n) { return COL_RX_CAT_ACESS.test(n); });
    }
    ehAcess[c] = COL_CACHE[k];
  });
  Object.keys(catDe).forEach(function (id) { if (ehAcess[catDe[id]]) out[id] = true; });
  return out;
}

/* ---------- busca por marketplace ---------- */
function colBuscar_(mk, q, pg) {
  pg = pg > 1 ? pg : 1;
  const ck = 'b_' + mk + '|' + q + '|' + pg;
  if (COL_CACHE[ck]) return COL_CACHE[ck];
  const r = colBuscarSemCache_(mk, q, pg);
  if (r.ok) COL_CACHE[ck] = r;
  return r;
}
function colBuscarSemCache_(mk, q, pg) {
  let url, h;
  pg = pg > 1 ? pg : 1;
  if (mk === 'Mercado Livre') url = 'https://lista.mercadolivre.com.br/' + colSlug_(q);
  if (mk === 'Amazon') url = 'https://www.amazon.com.br/s?k=' + encodeURIComponent(q) + (pg > 1 ? '&page=' + pg : '');
  if (mk === 'Magazine Luiza') url = 'https://www.magazineluiza.com.br/busca/' + encodeURIComponent(q) + '/' + (pg > 1 ? '?page=' + pg : '');
  if (mk === 'Shopee') return colBuscaShopee_(q, pg);
  if (mk === 'Amazon') {
    // A Amazon responde melhor à busca simples (sem cookies); se vier a página vazia de desconfiança, tenta de novo.
    let itensA = [], motivoA = '';
    for (let t = 0; t < 3 && !itensA.length; t++) {
      if (t) Utilities.sleep(2500 * t);
      const hs = t < 2 ? colFetchSimples_(url) : colFetch_(url);
      if (!hs.ok) { motivoA = hs.motivo; continue; }
      itensA = colParseAmazon_(hs.texto);
      if (!itensA.length && colSemResultado_(hs.texto)) return { ok: true, itens: [] };
      if (!itensA.length) motivoA = 'página sem produtos reconhecíveis — título "' + colTituloPagina_(hs.texto) + '", ' + Math.round(hs.texto.length / 1024) + ' KB';
    }
    if (itensA.length) return { ok: true, itens: itensA };
    return { ok: false, vazio: /sem produtos reconhec/.test(motivoA), motivo: motivoA + ' (3 tentativas)', itens: [] };
  }
  if (mk === 'Mercado Livre') return colBuscaMLSaude_(q, pg);
  h = colFetch_(url);
  if (!h.ok) return { ok: false, motivo: h.motivo, itens: [] };
  const itens = mk === 'Mercado Livre' ? colParseML_(h.texto) : mk === 'Amazon' ? colParseAmazon_(h.texto) : colParseMagalu_(h.texto);
  if (itens.length) return { ok: true, itens: itens };
  if (colSemResultado_(h.texto)) return { ok: true, itens: [] };                   // a busca respondeu: nenhum anúncio para o produto
  return { ok: false, vazio: true, itens: [],                                       // vazio: não bloqueia o marketplace, só refaz depois
    motivo: 'página sem produtos reconhecíveis — título "' + colTituloPagina_(h.texto) + '", ' + Math.round(h.texto.length / 1024) + ' KB' };
}

// Mercado Livre: toda busca é feita dentro da categoria Saúde. Duas camadas:
// 1) a busca já abre filtrada em Saúde (lista.mercadolivre.com.br/saude/…);
// 2) com a conta do ML conectada, cada anúncio encontrado é conferido pela categoria oficial dele na API,
//    e o que não estiver em Saúde sai, mesmo que a busca filtrada deixe passar.
const COL_ML_CATEGORIA_RAIZ = 'Saúde';
function colBuscaMLSaude_(q, pg) {
  const slug = colSlug_(q), desde = pg > 1 ? '_Desde_' + ((pg - 1) * 48 + 1) : '';   // 48 por página; sobreposição eventual é descartada
  let h = colFetch_('https://lista.mercadolivre.com.br/saude/' + slug + desde + '_NoIndex_True');
  let itens = h.ok ? colParseML_(h.texto) : [];
  if (h.ok && !itens.length && colSemResultado_(h.texto)) return { ok: true, itens: [] };
  if (!itens.length) {                                                              // filtro de categoria não respondeu: busca geral + conferência pela API
    h = colFetch_('https://lista.mercadolivre.com.br/' + slug + desde);
    if (!h.ok) return { ok: false, motivo: h.motivo, itens: [] };
    itens = colParseML_(h.texto);
    if (!itens.length) return colSemResultado_(h.texto) ? { ok: true, itens: [] } : { ok: false, vazio: true, itens: [],
      motivo: 'página sem produtos reconhecíveis — título "' + colTituloPagina_(h.texto) + '", ' + Math.round(h.texto.length / 1024) + ' KB' };
  }
  const saude = colEmSaudeML_(itens.map(function (it) { return it.id; }));
  return { ok: true, itens: itens.filter(function (it) { return saude[it.id] !== false; }) };   // false = fora de Saúde; sem dado = fica
}
// { MLBid: true (em Saúde) | false (fora) }; ids sem resposta da API ficam de fora do objeto.
function colEmSaudeML_(ids) {
  const out = {};
  ids = ids.filter(function (id) { return /^MLB\d+$/.test(id || '') && COL_CACHE['sd_' + id] === undefined; });
  if (colApiML_()) {
    for (let i = 0; i < ids.length; i += 20) {
      const r = mlGet_('/items?ids=' + ids.slice(i, i + 20).join(',') + '&attributes=id,category_id');
      (r || []).forEach(function (x) {
        const b = x && x.body;
        if (b && b.id && b.category_id) COL_CACHE['sd_' + b.id] = colRaizCategoriaML_(b.category_id) === colNorm_(COL_ML_CATEGORIA_RAIZ);
      });
    }
  }
  Object.keys(COL_CACHE).forEach(function (k) { if (k.indexOf('sd_') === 0) out[k.slice(3)] = COL_CACHE[k]; });
  return out;
}
function colRaizCategoriaML_(cat) {
  const k = 'raiz_' + cat;
  if (COL_CACHE[k] === undefined) {
    const j = mlGet_('/categories/' + cat);
    COL_CACHE[k] = j && j.path_from_root && j.path_from_root[0] ? colNorm_(j.path_from_root[0].name) : '';
  }
  return COL_CACHE[k];
}

// Aviso de busca sem resultado (texto comum aos 3 marketplaces). Sem esse aviso, a página vazia é tratada como falha leve.
function colSemResultado_(html) {
  const t = colTexto_(String(html || '').slice(0, 400000));
  return /n[ãa]o h[áa] an[úu]ncios que correspond|nenhum resultado (para|encontrado)|n[ãa]o encontr(ou|amos)[^.]{0,60}(resultado|produto)|sua busca[^.]{0,60}n[ãa]o (encontrou|retornou)|0 resultados/i.test(t);
}
// Busca a página como um navegador: segue redirecionamentos guardando os cookies que o site entrega.
function colFetch_(url, extra) {
  Utilities.sleep(700);
  const jar = {};
  let atual = url;
  try {
    for (let salto = 0; salto < 8; salto++) {
      const cookie = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
      const res = UrlFetchApp.fetch(atual, { muteHttpExceptions: true, followRedirects: false,
        headers: Object.assign({ 'User-Agent': COL_UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Upgrade-Insecure-Requests': '1' },
          cookie ? { Cookie: cookie } : {}, extra || {}) });
      const cod = res.getResponseCode(), hd = res.getAllHeaders();
      [].concat(hd['Set-Cookie'] || hd['set-cookie'] || []).forEach(function (c) {
        const m = String(c).match(/^([^=;\s]+)=([^;]*)/); if (m) jar[m[1]] = m[2];
      });
      if (cod >= 300 && cod < 400) {
        const loc = hd['Location'] || hd['location'];
        if (!loc) return { ok: false, motivo: 'HTTP ' + cod + ' sem destino' };
        const prox = /^https?:/.test(loc) ? loc : atual.replace(/^(https?:\/\/[^\/]+).*$/, '$1') + (loc.charAt(0) === '/' ? '' : '/') + loc;
        if (/captcha|account-verification|negative_traffic|login|registration/i.test(prox))
          return { ok: false, motivo: 'redirecionado para verificação anti-robô (' + prox.replace(/\?.*$/, '').slice(0, 70) + ')' };
        atual = prox; continue;
      }
      const txt = res.getContentText();
      if (cod !== 200) return { ok: false, motivo: 'HTTP ' + cod };
      if (/captcha|account-verification|robot check|validatecaptcha|are you a human/i.test(txt.slice(0, 20000)) && txt.length < 60000)
        return { ok: false, motivo: 'captcha / verificação anti-robô' };
      return { ok: true, texto: txt, final: atual };
    }
    return { ok: false, motivo: 'redirecionamentos demais (' + atual.replace(/\?.*$/, '').slice(0, 70) + ')' };
  } catch (e) { return { ok: false, motivo: String(e.message || e).slice(0, 80) }; }
}
// Busca simples, deixando o próprio Apps Script seguir os redirecionamentos (como na 1ª versão, que funcionou na Amazon).
function colFetchSimples_(url, extra) {
  Utilities.sleep(700);
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: Object.assign({ 'User-Agent': COL_UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }, extra || {}) });
    const cod = res.getResponseCode(), txt = res.getContentText();
    if (cod !== 200) return { ok: false, motivo: 'HTTP ' + cod };
    return { ok: true, texto: txt };
  } catch (e) { return { ok: false, motivo: String(e.message || e).slice(0, 80) }; }
}
function colTituloPagina_(html) { return colTexto_(colMatch_(html, /<title[^>]*>([\s\S]*?)<\/title>/i)).slice(0, 60); }

/* ---------- parsers ---------- */
function colParseML_(html) {
  const out = [];
  const blocos = html.split(/<li[^>]+class="[^"]*ui-search-layout__item/).slice(1);
  (blocos.length ? blocos : html.split(/<div[^>]+class="[^"]*poly-card[ "]/).slice(1)).forEach(function (b) {
    b = b.slice(0, 12000);
    const lk = colLinkML_(b), link = lk.link;
    const titulo = colTexto_(colMatch_(b, /class="[^"]*poly-component__title[^"]*"[^>]*>([\s\S]*?)<\/(?:a|h[23])>/) ||
                             colMatch_(b, /class="[^"]*ui-search-item__title[^"]*"[^>]*>([\s\S]*?)<\/(?:a|h[23])>/));
    if (!link || !titulo) return;
    const atual = b.split(/poly-price__current|ui-search-price__second-line/)[1] || b;
    const preco = colPrecoML_(atual);
    const antes = colMatch_(b, /<s[^>]*andes-money-amount--previous[\s\S]*?andes-money-amount__fraction[^>]*>([\d.]+)/);
    const selos = colSelosML_(b);
    out.push({ titulo: titulo, preco: preco, precoOriginal: antes ? colNum_(antes) : 0, link: link, selos: selos,
               id: lk.id, catalogo: lk.catalogo || '', semItem: !!lk.semItem,
               foto: colMatch_(b, /(?:data-src|src)="(https:\/\/http2\.mlstatic\.com\/[^"]+)"/) || '',
               seller: colTexto_(colMatch_(b, /class="[^"]*poly-component__seller[^"]*"[^>]*>([\s\S]*?)<\/(?:span|p|div)>/)).replace(/^(Por|Vendido por)\s+/i, '').replace(/\s*(Loja oficial|Official store).*$/i, ''),
               marca: colTexto_(colMatch_(b, /class="[^"]*poly-component__brand[^"]*"[^>]*>([\s\S]*?)<\/span>/)),
               nota: colNum_(colMatch_(b, /poly-reviews__rating[^>]*>([\d.,]+)/)),
               avaliacoes: colNum_(colMatch_(b, /poly-reviews__total[^>]*>\(?([\d.]+)/)), vendidos: '' });
  });
  return out.filter(function (x) { return x.preco > 0; });
}
// Link do anúncio no Mercado Livre. Card de catálogo aponta para /p/MLB… (página do produto), que abre no
// vendedor que está ganhando a compra naquele momento, nem sempre quem anunciou. Por isso o link guarda o
// anúncio exato (pdp_filters=item_id:…), e o id é o do anúncio, não o do catálogo.
function colLinkML_(b) {
  let href = (colMatch_(b, /href="(https:\/\/(?:produto\.|www\.)?mercadolivre\.com\.br\/[^"]+)"/) || '').replace(/&amp;/g, '&');
  if (!href) return { link: '', id: '' };
  let dec = href; try { dec = decodeURIComponent(href); } catch (e) {}
  const base = href.split(/[?#]/)[0];
  const cat = (colMatch_(base, /\/p\/(MLB\d+)/i) || '').toUpperCase();
  if (!cat) return { link: base, id: (colMatch_(base, /(MLB-?\d+)/i) || '').replace('-', '').toUpperCase() };   // já é a página do anúncio
  let item = colMatch_(dec, /(?:wid=|item_id[:=])(MLB-?\d+)/i) || colMatch_(b, /(?:wid=|item_id(?::|%3A))(MLB-?\d+)/i);
  item = String(item || '').replace('-', '').toUpperCase();
  if (item && item !== cat) return { link: base + '?pdp_filters=item_id:' + item, id: item, catalogo: cat };
  const loja = colMatch_(dec, /official_store[:=](\d+)/i);
  return { link: base + (loja ? '?pdp_filters=official_store:' + loja : ''), id: cat, catalogo: cat, semItem: !loja };
}
// Promoção/campanha do anúncio: desconto sobre o preço cheio e selos do marketplace (Oferta do dia, Relâmpago, cupom…).
// Devolve um texto curto ("−15% · Oferta do dia") ou '' quando o anúncio não está em promoção.
const COL_RX_PROMO = /% *off|oferta|promo|rel[aâ]mpago|black|cupom|cup[oõ]es|desconto|liquida|campanha|esquenta|semana|dia do|outlet|cashback|prime day|economize|tempo limitado/i;
function colPromo_(preco, cheio, selos) {
  const p = [];
  if (cheio > 0 && preco > 0 && cheio > preco * 1.01) p.push('−' + Math.round((1 - preco / cheio) * 100) + '%');
  (selos || []).map(function (x) { return colTexto_(x).replace(/\s+/g, ' ').trim(); })
    .filter(function (x) { return x && x.length <= 60 && COL_RX_PROMO.test(x); })
    .forEach(function (x) {
      const off = x.match(/(\d{1,2})\s*%\s*OFF/i);
      if (off) { if (!/^−/.test(p[0] || '')) p.unshift('−' + off[1] + '%'); return; }       // "13% OFF" do marketplace vira "−13%" (uma vez só)
      x = x.charAt(0).toUpperCase() + x.slice(1).toLowerCase(); if (p.indexOf(x) < 0) p.push(x);
    });
  return p.join(' · ');
}
function colSelosML_(b) {
  const sel = [];
  [/class="[^"]*poly-component__highlight[^"]*"[^>]*>([\s\S]{0,200}?)<\/span>/, /class="[^"]*poly-component__coupons?[^"]*"[^>]*>([\s\S]{0,300}?)<\/(?:span|div)>/,
   /class="[^"]*ui-search-item__highlight-label[^"]*"[^>]*>([\s\S]{0,200}?)<\/(?:span|label)>/, /class="[^"]*poly-component__deal[^"]*"[^>]*>([\s\S]{0,200}?)<\/span>/]
    .forEach(function (rx) { const m = colMatch_(b, rx); if (m) sel.push(m); });
  const off = colTexto_(colMatch_(b, /(?:andes-money-amount__discount|poly-price__disc_label)[^>]*>([\s\S]{0,40}?)<\//));
  if (off) sel.push(off + ' (desconto)');
  return sel;
}
function colPrecoML_(s) {
  const f = colMatch_(s, /andes-money-amount__fraction[^>]*>([\d.]+)/);
  const c = colMatch_(s, /andes-money-amount__cents[^>]*>(\d+)/);
  return f ? colNum_(f) + (c ? Number(c) / 100 : 0) : 0;
}

function colParseAmazon_(html) {
  const out = [];
  html.split(/data-component-type="s-search-result"/).slice(1).forEach(function (b) {
    b = b.slice(0, 15000);
    const asin = colMatch_(b, /data-asin="([A-Z0-9]{10})"/);
    const titulo = colTexto_(colMatch_(b, /<h2[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/));
    const whole = colMatch_(b, /a-price-whole">([\d.]+)/);
    if (!asin || !titulo || !whole) return;
    const frac = colMatch_(b, /a-price-fraction">(\d+)/);
    const cheio = colNum_(colMatch_(b, /a-text-price[^>]*data-a-strike="true"[^>]*>\s*<span class="a-offscreen">\s*R\$(?:\s|&nbsp;)*([\d.,]+)/) ||
                          colMatch_(b, /data-a-strike="true"[^>]*>\s*<span class="a-offscreen">\s*R\$(?:\s|&nbsp;)*([\d.,]+)/));
    const selosA = [colMatch_(b, /class="a-badge-text"[^>]*>([^<]{2,60})</), colMatch_(b, /class="[^"]*s-coupon-unclipped[^"]*"[\s\S]{0,300}?>\s*([^<]{4,80}cupom[^<]{0,40})</i),
                    colMatch_(b, /(Oferta (?:Relâmpago|relâmpago|do Dia|do dia|por tempo limitado))/)].filter(String);
    out.push({ titulo: titulo, preco: colNum_(whole) + (frac ? Number(frac) / 100 : 0), precoOriginal: cheio, selos: selosA, link: 'https://www.amazon.com.br/dp/' + asin, id: asin,
               foto: colMatch_(b, /<img[^>]+class="s-image"[^>]+src="([^"]+)"/) || colMatch_(b, /<img[^>]+src="([^"]+)"[^>]+class="s-image"/) || '',
               seller: '', marca: '', nota: colNum_((colMatch_(b, /([\d,]+) de 5 estrelas/) || '').replace(',', '.')),
               avaliacoes: colNum_(colMatch_(b, /aria-label="([\d.]+) (?:avaliações|classificações)/)), vendidos: '' });
  });
  return out;
}

function colParseMagalu_(html) {
  const out = [], vistos = {};
  const add = function (x) { if (x.link && !vistos[x.link] && x.preco > 0 && x.titulo) { vistos[x.link] = 1; out.push(x); } };
  // 0) formato atual (set/2026): __NEXT_DATA__ › props.pageProps.data.search.items[], preço em offers[0]
  const ndTxt = colMatch_(html, /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (ndTxt) {
    let nd = null; try { nd = JSON.parse(ndTxt); } catch (e) {}
    const itens = nd && nd.props && nd.props.pageProps && nd.props.pageProps.data && nd.props.pageProps.data.search && nd.props.pageProps.data.search.items;
    (itens || []).forEach(function (p) {
      if (!p || !p.title) return;
      const of = (p.offers && p.offers[0]) || (p.itemFallback && p.itemFallback.offers && p.itemFallback.offers[0]) || {};
      const sel = of.seller || {};
      const path = String(p.path || '');
      // price = à vista no cartão (comparável aos outros marketplaces); bestPrice.totalAmount = Pix (reserva)
      const preco = colNum_(String(of.price || '')) || colNum_(String((of.bestPrice && of.bestPrice.totalAmount) || (typeof of.bestPrice !== 'object' ? of.bestPrice : '') || ''));
      add({ titulo: p.title, preco: preco, precoOriginal: colNum_(String(of.listPrice || '')),
            selos: [].concat(p.tags || p.badges || of.tags || []).map(function (x) { return typeof x === 'string' ? x : (x && (x.label || x.text || x.name)) || ''; }),
            link: /^https?:/.test(path) ? path : 'https://www.magazineluiza.com.br/' + path.replace(/^\//, ''), id: p.id || p.offerId || '',
            foto: String(p.image || '').replace('{w}x{h}', '400x400'),
            seller: sel.name || sel.description || sel.label || sel.id || '', marca: (p.brand && (p.brand.label || p.brand.name)) || '',
            nota: p.reviewRating ? Math.round(p.reviewRating * 10) / 10 : '', avaliacoes: p.reviewCount || '', vendidos: '' });
    });
    if (out.length) return out;
  }
  // 1) dados estruturados para o Google (JSON-LD)
  (html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).forEach(function (tag) {
    let j; try { j = JSON.parse(tag.replace(/^<script[^>]*>|<\/script>$/gi, '')); } catch (e) { return; }
    [].concat(j).concat((j && j['@graph']) || []).forEach(function (n) {
      const itens = n && n['@type'] === 'ItemList' ? (n.itemListElement || []).map(function (e) { return e.item || e; }) : [n];
      itens.forEach(function (p) {
        if (!p || p['@type'] !== 'Product') return;
        const of = [].concat(p.offers || [])[0] || {};
        add({ titulo: p.name, preco: colNum_(String(of.price || of.lowPrice || '')), link: p.url || of.url || '', id: p.sku || '',
              foto: [].concat(p.image || [])[0] || '', seller: (of.seller && of.seller.name) || '', marca: (p.brand && (p.brand.name || p.brand)) || '',
              nota: p.aggregateRating ? Number(p.aggregateRating.ratingValue) : '', avaliacoes: p.aggregateRating ? Number(p.aggregateRating.reviewCount || p.aggregateRating.ratingCount) : '', vendidos: '' });
      });
    });
  });
  // 2) cartões de produto no HTML
  html.split(/data-testid="product-card-container"/).slice(1).forEach(function (b) {
    b = b.slice(0, 8000);
    const href = colMatch_(b, /href="([^"]+)"/);
    add({ titulo: colTexto_(colMatch_(b, /data-testid="product(?:-card)?-title"[^>]*>([\s\S]*?)<\/h\d>/)), link: href ? (/^https?:/.test(href) ? href : 'https://www.magazineluiza.com.br' + href) : '',
          preco: colNum_(colTexto_(colMatch_(b, /data-testid="price-value(?:-integer)?"[^>]*>([\s\S]*?)<\/(?:p|span)>/)).replace(/[^\d.,]/g, '')) +
                 (Number(colMatch_(b, /data-testid="price-value-split-cents-fraction"[^>]*>(\d+)/) || 0) / 100), id: '',
          foto: colMatch_(b, /<img[^>]+src="(https:[^"]+)"/) || '', seller: '', marca: '', nota: '', avaliacoes: '', vendidos: '' });
  });
  // 3) dados da página (__NEXT_DATA__ e demais JSON embutidos)
  const blocos = [];
  const nd = colMatch_(html, /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (nd) blocos.push(nd);
  (html.match(/<script[^>]+type="application\/json"[^>]*>[\s\S]*?<\/script>/gi) || []).forEach(function (t) { blocos.push(t.replace(/^<script[^>]*>|<\/script>$/gi, '')); });
  blocos.forEach(function (json) {
  let data; try { data = JSON.parse(json); } catch (e) { return; }
  (function andar(o, prof) {
    if (!o || typeof o !== 'object' || prof > 14) return;
    if (Array.isArray(o)) { o.forEach(function (x) { andar(x, prof + 1); }); return; }
    const titulo = typeof o.title === 'string' ? o.title : '';
    const pr = o.price && typeof o.price === 'object' ? (o.price.bestPrice || o.price.price || o.price.fullPrice) : (o.bestPrice || o.price);
    const path = o.url || o.path || '';
    if (titulo && pr && path && typeof path === 'string') {
      const link = /^https?:/.test(path) ? path : 'https://www.magazineluiza.com.br/' + path.replace(/^\//, '');
      if (!vistos[link]) {
        vistos[link] = 1;
        out.push({ titulo: titulo, preco: colNum_(String(pr)), link: link, id: o.id || o.sku || '',
                   foto: String(o.image || o.imageUrl || '').replace('{w}x{h}', '400x400'),
                   seller: (o.seller && (o.seller.description || o.seller.name)) || o.sellerName || '',
                   marca: (o.brand && (o.brand.label || o.brand.name)) || (typeof o.brand === 'string' ? o.brand : ''),
                   nota: o.rating && o.rating.score ? Number(o.rating.score) : '', avaliacoes: o.rating && o.rating.count ? Number(o.rating.count) : '', vendidos: '' });
      }
    }
    Object.keys(o).forEach(function (k) { andar(o[k], prof + 1); });
  })(data, 0);
  });
  return out.filter(function (x) { return x.preco > 0; });
}

// Página de produto com cache por execução (a mesma página serve para preço e comentários).
/* ---------- produto certo e peças (mesmas regras do painel) ---------- */
const COL_RX_ACESS = /\b(pe[cç]as?|reposi[cç][aã]o|acess[oó]rios?|refil|refis|kit de reparo|pneus?|c[aâ]maras? de ar|ponteiras?|borrachas? de|rod[ií]zios?|carregador|bateria de|baterias? para|joystick|manoplas?|capas? para|parafusos?|presilhas?|travas? para|pino|engrenagem|motor para|placa controladora|controle para|estofamento para|refil|refis|kit de reparo|eletrodos? (?:para|de reposi)|lancetas?|tiras? (?:para|reagentes?|de glicose)|manguitos?|bra[cç]adeiras? (?:para|de reposi)|para (?:cadeiras? de (?:rodas|banho)|andador(?:es)?|bengalas?|muletas?|nebulizador(?:es)?|inalador(?:es)?|medidor(?:es)? de press[aã]o|aparelho de press[aã]o|ox[ií]metros?|term[oô]metros?|glicos[ií]metros?|aspirador(?:es)?|concentrador(?:es)?|cadeira motorizada|scooter)|compat[ií]vel com|serve (?:no|na|em|para)|suporte para|fonte (?:para|de alimenta)|adaptador (?:para|de)|cabo (?:para|de)|sensor (?:para|de reposi)|m[aá]scaras? (?:para|de reposi)|kit (?:de )?m[aá]scaras?|copo (?:para|do|de) nebuliz|bolsas? para|sacolas? para|mesa para cadeira|cintos? para|almofada de reposi)\b/i;
const COL_RX_PECA_INICIO = /^\s*(roda|pneu|c[aâ]mara|ponteira|borracha|rod[ií]zio|carregador|bateria|joystick|controle|manopla|capa|freio|encosto|apoio de p[eé]s?|apoio de bra[cç]o|estofado|cinto|parafuso|kit roda|kit rodas|manguito|bra[cç]adeira|eletrodos?|lancetas?|tiras?|m[aá]scaras?|copo|filtros?|adaptador|fonte|cabo|sapatas?|bocal|refil|luvas? para|mangueira|traqueia|bico|pe[cç]a|kit de pe[cç]as)\b/i;
function colEhAcessorio_(t) { t = String(t || ''); return COL_RX_ACESS.test(t) || COL_RX_PECA_INICIO.test(t); }
const COL_STOP_P = { DE: 1, DA: 1, DO: 1, DAS: 1, DOS: 1, PARA: 1, COM: 1, SEM: 1, EM: 1, E: 1, A: 1, O: 1, AS: 1, OS: 1, AO: 1, UM: 1, UMA: 1, ATE: 1, KG: 1, CM: 1, POR: 1, NA: 1, NO: 1, DELLAMED: 1, KIT: 1, COR: 1, UN: 1 };
function colCodigoModelo_(t) { const m = colNorm_(t).match(/\b(D-?\d{1,4}[A-Z]*|DBP-?\d{3,5})\b/); return m ? m[1].replace('-', '') : ''; }
// Com código de modelo, ele precisa aparecer como palavra inteira (D30 ≠ D300); sem código, 60% das palavras do nome do produto.
function colCasaProduto_(p, titulo) {
  const tn = ' ' + colNorm_(titulo).replace(/[^A-Z0-9]+/g, ' ') + ' ';
  const cod = colCodigoModelo_(p.sku) || colCodigoModelo_(p.produto);
  if (cod) return tn.replace(/ (DBP|D) ?(\d)/g, ' $1$2').indexOf(' ' + cod + ' ') >= 0;
  const ws = colNorm_(p.produto).split(/[^A-Z0-9]+/).filter(function (w) { return w.length > 2 && !COL_STOP_P[w]; });
  if (!ws.length) return true;
  const achou = ws.filter(function (w) { return tn.indexOf(' ' + w + ' ') >= 0 || tn.indexOf(' ' + w.replace(/S$/, '') + ' ') >= 0; }).length;
  return achou / ws.length >= 0.6;
}


// ---- Qual produto Dellamed um anúncio é: compara o título com TODOS os produtos da loja e fica com o mais parecido.
// Palavra que só um produto tem (LIGHT, POP, 120KG) pesa muito; palavra comum a vários (CADEIRA, BANHO) pesa pouco.
// Código de modelo no título (D30, D45) decide sozinho. Empate (título genérico): vence o preço base mais próximo.
var IXP_STOP={DE:1,DA:1,DO:1,DAS:1,DOS:1,PARA:1,COM:1,SEM:1,EM:1,E:1,A:1,O:1,AS:1,OS:1,AO:1,UM:1,UMA:1,ATE:1,POR:1,NA:1,NO:1,DELLAMED:1,KIT:1,COR:1,UN:1,P:1,C:1};
function ixpTokens(nrm,t){var o={};nrm(t).replace(/(\d),(\d)/g,'$1.$2').split(/[^A-Z0-9.]+/).forEach(function(w){w=w.replace(/^\.+|\.+$/g,'');if(w.length>1&&!IXP_STOP[w])o[w.replace(/S$/,'')]=1});return o}
function ixpCodigos(nrm,t){var o={},rx=/\b(DBP|D) ?-?(\d{1,4}[A-Z]*)\b/g,m,s=nrm(t);while((m=rx.exec(s)))o[m[1]+m[2]]=1;return o}
function ixpMontar(nrm,produtos){var ps=produtos.map(function(p){return {sku:String(p.sku),preco:Number(p.preco_base||p.preco)||0,tk:ixpTokens(nrm,p.produto),cod:Object.keys(ixpCodigos(nrm,p.sku+' '+p.produto))}}),df={};
  ps.forEach(function(p){Object.keys(p.tk).forEach(function(w){df[w]=(df[w]||0)+1})});
  ps.forEach(function(p){var tot=0;Object.keys(p.tk).forEach(function(w){tot+=1/df[w]});p.tot=tot||1});
  var porCod={};ps.forEach(function(p){p.cod.forEach(function(c){(porCod[c]=porCod[c]||[]).push(p)})});
  return {ps:ps,df:df,porCod:porCod,nrm:nrm}}
// Devolve o sku do produto mais parecido com o título (ou '' se nenhum chega perto).
function ixpMelhor(ix,titulo,preco){var nrm=ix.nrm,tk=ixpTokens(nrm,titulo),cods=Object.keys(ixpCodigos(nrm,titulo)).filter(function(c){return ix.porCod[c]}),cand=ix.ps;
  if(cods.length){cand=[];cods.forEach(function(c){ix.porCod[c].forEach(function(p){if(cand.indexOf(p)<0)cand.push(p)})})}
  var best=null,bs=-1,lista=[];
  cand.forEach(function(p){var s=0;Object.keys(p.tk).forEach(function(w){if(tk[w])s+=1/ix.df[w]});s=s/p.tot;lista.push({p:p,s:s});if(s>bs){bs=s;best=p}});
  if(!best||(!cods.length&&bs<.35))return '';
  var emp=lista.filter(function(x){return x.s>=bs-.05});
  if(emp.length>1&&preco>0){emp.sort(function(a,b){var da=a.p.preco?Math.abs(Math.log(preco/a.p.preco)):9,db=b.p.preco?Math.abs(Math.log(preco/b.p.preco)):9;return (da-db)||(b.s-a.s)});best=emp[0].p}
  return best.sku}
// Catálogo do ML de cada produto da loja → SKU (para nunca colocar oferta de um catálogo em outro produto)
function colCatalogoSku_() {
  if (COL_CACHE.catSku) return COL_CACHE.catSku;
  const m = {}; lerAba_('PRODUTOS_BASE').forEach(function (r) { const c = str_(r.catalogo_id).toUpperCase(); if (c && r.sku) m[c] = str_(r.sku); });
  COL_CACHE.catSku = m; return m;
}
function colIndiceProdutos_() {
  if (!COL_CACHE.ixProd) COL_CACHE.ixProd = ixpMontar(colNorm_, lerAba_('PRODUTOS_BASE').filter(function (r) { return r.sku && r.produto && !colEhAcessorio_(r.produto); }));
  return COL_CACHE.ixProd;
}
// Termos da busca: as palavras que identificam o produto (as raras primeiro), para "Umi Light" não virar "Umidificador De Ar Umi".
function colTermosBusca_(produto) {
  const ix = colIndiceProdutos_(), tk = Object.keys(ixpTokens(colNorm_, produto));
  const raras = tk.filter(function (w) { return (ix.df[w] || 1) <= 2 && !/^\d/.test(w); });
  const comuns = colNorm_(produto).split(/[^A-Z0-9]+/).filter(function (w) { return w.length > 2 && !IXP_STOP[w] && raras.indexOf(w.replace(/S$/, '')) < 0; });
  return comuns.slice(0, 3).concat(raras.slice(0, 3)).join(' ').toLowerCase();
}

/* ---------- fase detalhes: completa vendedor, nota, avaliações e vendidos pela página do produto ---------- */
// Na busca nem todo marketplace mostra esses dados (validado em out/2026):
//   Mercado Livre: vendidos ("+1000 vendidos"), nota, nº de avaliações e "Vendido por" só na página do produto
//   Amazon: nota e nº de avaliações já vêm na busca; o vendedor só na página do produto ("Vendido por …")
//   Magazine Luiza: nota e avaliações na busca; o nome do vendedor (a busca traz só o código) na página do produto
//   Vendidos: Amazon e Magalu não publicam; ficam vazios.
function colAlvosDetalhe_() {
  const ok = ['Mercado Livre', 'Amazon', 'Magazine Luiza', 'Shopee'];
  const falta = function (r, aba) {
    const sel = str_(r.seller);
    if (aba === 'OFERTAS_CONC') return !sel || /^n[aã]o identificado$/i.test(sel) || (str_(r.marketplace) === 'Magazine Luiza' && /^[a-z0-9]+$/.test(sel));
    const semVendedor = aba === 'ANUNCIOS' && (!sel || /^n[aã]o identificado$/i.test(sel) || (str_(r.marketplace) === 'Magazine Luiza' && /^[a-z0-9]+$/.test(sel)));
    const semNumeros = !num_(r.avaliacoes) || (str_(r.marketplace) === 'Mercado Livre' && !num_(r.vendidos)) || (aba === 'CONCORRENTES' && !num_(r.nota_0a5));
    return semVendedor || semNumeros;
  };
  const vistos = {}, alvos = [];
  const add = function (r, aba, prio) {
    const link = str_(r.link), mk = str_(r.marketplace);
    if (!/^https:/.test(link) || ok.indexOf(mk) < 0 || vistos[link] || !falta(r, aba)) return;
    vistos[link] = 1; alvos.push({ aba: aba, link: link, mk: mk, prio: prio, seller: str_(r.seller), item: str_(r.item_id) });
  };
  lerAba_('ANUNCIOS').forEach(function (r) { if (str_(r.origem) === 'COLETA') add(r, 'ANUNCIOS', str_(r.seller) === 'DELLAMED' ? 4 : 3); });   // loja oficial primeiro: vendidos da própria Dellamed
  lerAba_('CONCORRENTES').forEach(function (r) { if (str_(r.origem) === 'COLETA') add(r, 'CONCORRENTES', colEhPrioritaria_(r.marca) ? 2 : 1); });
  lerAba_('OFERTAS_CONC').forEach(function (r) { if (str_(r.origem) === 'COLETA') add(r, 'OFERTAS_CONC', 1); });
  const semNome = alvos.filter(function (a) { return (a.aba === 'ANUNCIOS' || a.aba === 'OFERTAS_CONC') && (!a.seller || /^n[aã]o identificado$/i.test(a.seller) || (a.mk === 'Magazine Luiza' && /^[a-z0-9]+$/.test(a.seller))); });
  const resto = alvos.filter(function (a) { return semNome.indexOf(a) < 0; }).sort(function (a, b) { return b.prio - a.prio; });
  // Mercado Livre com a conta conectada: o nome do vendedor vem pela API (rápido, sem abrir página) — esses não contam no limite.
  // Os demais sem nome abrem a página do produto: ficam limitados a COL_PAGINAS_DETALHE por coleta, para a fase não durar horas.
  const api = colApiML_();
  const rapido = function (a) { return api && a.mk === 'Mercado Livre' && /^MLB\d+$/.test(a.item || ''); };
  const viaApi = semNome.filter(rapido);
  const viaPagina = semNome.filter(function (a) { return !rapido(a); });
  const sobra = Math.max(0, COL_PAGINAS_DETALHE - Math.min(viaPagina.length, COL_PAGINAS_DETALHE));
  return viaApi.concat(viaPagina.slice(0, COL_PAGINAS_DETALHE), resto.slice(0, sobra));   // nomes primeiro; páginas limitadas
}

function colDetalheDaPagina_(t, ctx) {
  // Mercado Livre com a conta conectada: o vendedor vem da API pelo código do anúncio (preciso e sem abrir a página)
  const semNome = !t.seller || /^n[aã]o identificado$/i.test(t.seller);
  if (t.mk === 'Mercado Livre' && semNome && /^MLB\d+$/.test(t.item || '') && colApiML_()) {
    const it = mlGet_('/items/' + t.item);
    const nome = it && it.seller_id ? colNomeSellerML_(String(it.seller_id), ctx) : '';
    if (nome) { colAtualizarLinha_(t.aba, t.link, { seller: /dellamed/i.test(nome) && t.aba === 'ANUNCIOS' ? 'DELLAMED' : nome }, ctx); if (t.aba === 'OFERTAS_CONC') return; }
  }
  if (t.aba === 'OFERTAS_CONC' && !semNome) return;
  if (ctx.bloqueados['det_' + t.mk]) return;
  if (t.mk === 'Shopee') {                                             // Shopee: loja pelo código e nota/avaliações pela página entregue a robôs de indexação
    const ids = String(t.link).match(/product\/(\d+)\/(\d+)/) || String(t.link).match(/i\.(\d+)\.(\d+)/);
    if (!ids) return;
    const cs = {}, it = [{ shopId: ids[1], seller: semNome ? '' : t.seller }];
    if (semNome) { shpCompletarLojas_(it); if (it[0].seller) cs.seller = /dellamed/i.test(it[0].seller) && t.aba === 'ANUNCIOS' ? 'DELLAMED' : it[0].seller; }
    if (t.aba !== 'OFERTAS_CONC') {
      const hp = shpGet_('https://shopee.com.br/product/' + ids[1] + '/' + ids[2], SHP_UA_BOT, false);
      const ld = hp.ok ? colLdProduto_(hp.texto) : null;
      if (!ld) { colFalha_(ctx, 'det_' + t.mk, hp.ok ? 'página da Shopee sem dados do produto' : hp.motivo); }
      else {
        colSucesso_(ctx, 'det_' + t.mk);
        if (ld.avaliacoes) cs.avaliacoes = ld.avaliacoes;
        if (ld.nota && t.aba === 'CONCORRENTES') cs.nota_0a5 = ld.nota;
        if (!cs.seller && semNome && ld.seller) cs.seller = ld.seller;
        const vd = shpVend_(colTexto_(hp.texto).slice(0, 200000)); if (vd && t.aba !== 'OFERTAS_CONC') cs.vendidos = vd;
      }
    }
    if (Object.keys(cs).length) colAtualizarLinha_(t.aba, t.link, cs, ctx);
    return;
  }
  let pg = colPaginaProduto_(t.link, t.mk === 'Amazon');
  // Amazon às vezes devolve uma página "vazia" (verificação) com status 200: tenta de novo antes de desistir
  for (let k = 0; t.mk === 'Amazon' && pg && !/id="productTitle"|id="title"/.test(pg) && k < 2; k++) {
    Utilities.sleep(2500 * (k + 1));
    delete COL_CACHE['pg_' + t.link];
    pg = colPaginaProduto_(t.link, k === 0);
  }
  if (t.mk === 'Amazon' && pg && !/id="productTitle"|id="title"/.test(pg)) pg = null;
  if (!pg) { colFalha_(ctx, 'det_' + t.mk, 'página do produto indisponível'); return; }
  colSucesso_(ctx, 'det_' + t.mk);
  const d = t.mk === 'Mercado Livre' ? colDetalheML_(pg) : t.mk === 'Amazon' ? colDetalheAmazon_(pg) : colDetalheMagalu_(pg, t.seller);
  const campos = {};
  if (d.vendidos) campos.vendidos = d.vendidos;
  if (d.avaliacoes) campos.avaliacoes = d.avaliacoes;
  if (d.nota && t.aba === 'CONCORRENTES') campos.nota_0a5 = d.nota;
  if (d.seller && (t.aba === 'ANUNCIOS' || t.aba === 'OFERTAS_CONC') && (!t.seller || /^n[aã]o identificado$/i.test(t.seller) || t.mk !== 'Mercado Livre')) campos.seller = d.seller;
  if (t.aba === 'OFERTAS_CONC') { delete campos.vendidos; delete campos.avaliacoes; }
  if (t.mk === 'Amazon' && t.aba === 'ANUNCIOS' && d.seller) campos.ganha_buybox = 'Sim';   // oferta em destaque (Buy Box) do ASIN
  if (Object.keys(campos).length) colAtualizarLinha_(t.aba, t.link, campos, ctx);
}
function colDetalheML_(html) {
  const txt = colTexto_(html.slice(0, 400000));
  // vendidos: só o subtítulo do produto ("Novo | +1000 vendidos"); a página tem outros números de vendidos
  // (produtos recomendados, outros anúncios) que não são deste anúncio
  const sub = colTexto_(colMatch_(html, /class="[^"]*ui-pdp-subtitle[^"]*"[^>]*>([\s\S]{0,300}?)<\/span>/) ||
                        colMatch_(html, /class="[^"]*ui-pdp-header__subtitle[^"]*"[^>]*>([\s\S]{0,400}?)<\/div>/));
  const v = sub.match(/\+?\s*([\d.]+)\s*(mil)?\s*vendidos?/i);
  const vendidos = v ? colNum_(v[1]) * (v[2] ? 1000 : 1) : 0;
  const nota = colNum_(colMatch_(html, /ui-pdp-review__rating[^>]*>\s*([\d.,]+)/).replace(',', '.'));
  const aval = colNum_(colMatch_(html, /ui-pdp-review__amount[^>]*>\s*\(?([\d.]+)/));
  // <div class="ui-pdp-seller__header__title"><span>Vendido por</span><button><a class="ui-pdp-seller__link"><span>NOME</span></a></button></div>
  let seller = colTexto_(colMatch_(html, /ui-pdp-seller__link[^>]*>\s*<span[^>]*>([^<]{2,60})<\/span>/)) ||
               colTexto_(colMatch_(html, /ui-pdp-seller__header__title[^>]*>([\s\S]{0,800}?)<\/div>/));
  if (!seller) seller = (txt.match(/Vendido por\s+([A-Za-z0-9À-ÿ&.'\- ]{2,40}?)(?:\s+(?:MercadoL[ií]der|\+|Loja|Ver|Vendas|\d))/) || [])[1] || '';
  seller = seller.replace(/^Vendido por\s*/i, '').trim();
  return { vendidos: vendidos, nota: nota > 0 && nota <= 5 ? nota : 0, avaliacoes: aval, seller: seller };
}
function colDetalheAmazon_(html) {
  const txt = colTexto_(html.replace(/<script[\s\S]*?<\/script>/g, ''));
  // "Enviado por / Vendido por": o nome do vendedor fica num destes lugares, conforme o layout da página
  const limpa = function (x) { return colTexto_(x || '').replace(/^vendido por\s*/i, '').replace(/\s+e entregue.*$/i, '').trim(); };
  let seller = limpa(colMatch_(html, /id="sellerProfileTriggerId"[^>]*>\s*([^<]{2,80}?)\s*</));
  if (!seller) {                                               // layout novo: bloco "Vendido por" da caixa de compra
    const bl = colMatch_(html, /offer-display-feature-name="desktop-merchant-info"([\s\S]{0,2500})/) ||
               colMatch_(html, /id="merchantInfoFeature_feature_div"([\s\S]{0,3000})/);
    seller = limpa(colMatch_(bl || '', /offer-display-feature-text-message"?[^>]*>\s*([^<]{2,80}?)\s*</) || colMatch_(bl || '', /<a[^>]*>\s*([^<]{2,80}?)\s*<\/a>/));
  }
  if (!seller) seller = limpa(colMatch_(html, /tabular-buybox-text[^>]*>\s*Vendido por[\s\S]{0,600}?tabular-buybox-text-message"?[^>]*>\s*([^<]{2,80}?)\s*</));
  if (!seller) seller = limpa(colMatch_(html, /id="merchant-info"[\s\S]{0,400}?<a[^>]*>\s*(?:<span>)?\s*([^<]{2,80}?)\s*</));
  if (!seller) seller = ((txt.match(/Vendido por\s+([^|]{2,60}?)\s+(?:Enviado|Envio|Devolu|Pagamento|Quantidade|Detalhes|Pol[ií]tica|Adicionar)/) || [])[1] || '').trim();
  if (!seller && /(?:Enviado e vendido|Vendido) por Amazon/i.test(txt)) seller = 'Amazon';
  if (/^amazon(\.com\.br)?$/i.test(seller)) seller = 'Amazon';
  if (/^(vendido por|enviado por)$/i.test(seller)) seller = '';
  const nota = colNum_(((txt.match(/([\d,]+) de 5 estrelas/) || [])[1] || '').replace(',', '.'));
  // <span id="acrCustomerReviewText" aria-label="108 Análises">(108)</span>  ou, no texto, "108 avaliações globais"
  const aval = colNum_(colMatch_(html, /id="acrCustomerReviewText"[^>]*>\s*\(?([\d.]+)/) ||
                       (txt.match(/([\d.]+) (?:avalia[çc][õo]es globais|avalia[çc][õo]es de clientes|classifica[çc][õo]es globais)/) || [])[1] || '');
  const compras = txt.match(/([\d.]+)\s*(mil)?\+?\s*compras? no m[eê]s passado/i);         // aparece só em alguns produtos
  return { seller: seller, nota: nota > 0 && nota <= 5 ? nota : 0, avaliacoes: aval, vendidos: compras ? colNum_(compras[1]) * (compras[2] ? 1000 : 1) : 0 };
}
function colDetalheMagalu_(html, sellerCodigo) {
  const nd = colMatch_(html, /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  let d = null; try { d = JSON.parse(nd); } catch (e) {}
  if (!d) return {};
  // a busca grava o código do vendedor (ex.: dermomix); a página traz o objeto do vendedor com o nome (ex.: DERMOMED)
  let seller = '';
  const cod = String(sellerCodigo || '').toLowerCase();
  if (cod) (function andar(o, prof) {
    if (seller || !o || typeof o !== 'object' || prof > 25) return;
    if (!Array.isArray(o) && String(o.id || '').toLowerCase() === cod && typeof o.description === 'string' && o.description) { seller = o.description; return; }
    Object.keys(o).forEach(function (k) { andar(o[k], prof + 1); });
  })(d, 0);
  const pr = d.props && d.props.pageProps && d.props.pageProps.data && d.props.pageProps.data.productRating;
  const g = (pr && pr.general) || {};                                   // productRating.general = { rating, reviewCount }
  return { seller: seller, nota: g.rating ? Math.round(Number(g.rating) * 10) / 10 : 0, avaliacoes: Number(g.reviewCount) || 0, vendidos: 0 };
}
// Atualiza só as colunas informadas da linha do anúncio (achada pelo link), sem regravar a aba inteira.
function colAtualizarLinha_(aba, link, campos, ctx) {
  ctx.idx = ctx.idx || {};
  if (!ctx.idx[aba]) {
    const v = aba_(aba).getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
    const iL = h.indexOf('link'), m = {};
    for (let i = 1; i < v.length; i++) { const k = String(v[i][iL]); (m[k] = m[k] || []).push(i + 1); }
    ctx.idx[aba] = { h: h, m: m };
  }
  const ix = ctx.idx[aba], sh = aba_(aba);
  (ix.m[link] || []).forEach(function (row) {
    Object.keys(campos).forEach(function (c) { const col = ix.h.indexOf(c); if (col >= 0) sh.getRange(row, col + 1).setValue(campos[c]); });
  });
}

function colPaginaProduto_(link, simples) {
  if (COL_CACHE['pg_' + link] !== undefined) return COL_CACHE['pg_' + link];
  const h = simples ? colFetchSimples_(link) : colFetch_(link);
  COL_CACHE['pg_' + link] = h.ok ? h.texto : null;
  return COL_CACHE['pg_' + link];
}
// Lê o bloco de dados estruturados (JSON-LD) do produto: preço, vendedor, marca, nota e avaliações.
function colLdProduto_(html) {
  const rx = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
  let m, prod = null;
  while ((m = rx.exec(html)) && !prod) {
    let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
    [].concat(j).concat((j && j['@graph']) || []).forEach(function (n) { if (!prod && n && (n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].indexOf('Product') >= 0))) prod = n; });
  }
  if (!prod) return null;
  const of = Array.isArray(prod.offers) ? prod.offers[0] : (prod.offers || {});
  const ofs = of && of.offers ? (Array.isArray(of.offers) ? of.offers[0] : of.offers) : of;
  const ar = prod.aggregateRating || {};
  const rv = prod.review ? [].concat(prod.review) : [];
  return { preco: colNum_(String((ofs && (ofs.price || ofs.lowPrice)) || (of && (of.price || of.lowPrice)) || '')),
           seller: (ofs && ofs.seller && ofs.seller.name) || (of && of.seller && of.seller.name) || '',
           marca: prod.brand ? (prod.brand.name || prod.brand) : '', foto: [].concat(prod.image || [])[0] || '',
           nota: ar.ratingValue ? Number(ar.ratingValue) : '', avaliacoes: ar.reviewCount || ar.ratingCount || '',
           reviews: rv.map(function (r) {
             return { nota: Number((r.reviewRating && r.reviewRating.ratingValue) || 0), texto: colTexto_(String(r.reviewBody || r.description || '')),
                      titulo: colTexto_(String(r.name || '')), data: r.datePublished ? new Date(r.datePublished) : '' };
           }) };
}

/* ---------- fase avaliações: comentários dos clientes (Voz do cliente) ---------- */
// Páginas lidas: a página oficial de TODO produto da loja (sempre), mais os anúncios de revendedores e de
// concorrentes com mais avaliações (COL_AVAL_REVENDA e COL_AVAL_CONC).
function colAlvosAvaliacao_() {
  const ok = function (mk, link) { return /^https:/.test(link) && COL_MKS.indexOf(mk) >= 0; };
  const base = {}, vistos = {};
  const produtos = lerAba_('PRODUTOS_BASE').filter(function (r) { return r.sku && r.produto; });
  produtos.forEach(function (r) { base[str_(r.sku)] = r; });
  const oficiais = produtos.filter(function (r) { return ok('Mercado Livre', str_(r.link_oficial)); })
    .filter(function (r) { const k = str_(r.link_oficial); if (vistos[k]) return false; vistos[k] = 1; return true; })
    .map(function (r) {
      return { mk: 'Mercado Livre', link: str_(r.link_oficial), marca: 'Dellamed', categoria: str_(r.categoria), sku: str_(r.sku),
               produto: str_(r.produto), foto: str_(r.foto), item: str_(r.mlb_id) };
    });
  const revenda = lerAba_('ANUNCIOS').filter(function (r) { return str_(r.origem) === 'COLETA' && str_(r.seller) !== 'DELLAMED' && base[str_(r.sku)] && ok(str_(r.marketplace), str_(r.link)); })
    .sort(function (a, b) { return num_(b.avaliacoes) - num_(a.avaliacoes); })
    .filter(function (r) { const k = str_(r.link); if (vistos[k]) return false; vistos[k] = 1; return true; })
    .slice(0, COL_AVAL_REVENDA).map(function (r) {
      const b = base[str_(r.sku)];
      return { mk: str_(r.marketplace), link: str_(r.link), marca: 'Dellamed', categoria: str_(b.categoria), sku: str_(r.sku),
               produto: str_(b.produto || r.titulo), foto: str_(r.foto), item: str_(r.item_id) };
    });
  const cc = lerAba_('CONCORRENTES').filter(function (r) { return str_(r.origem) === 'COLETA' && !marcaFora_(r.marca) && ok(str_(r.marketplace), str_(r.link)); })
    .sort(function (a, b) { return (colEhPrioritaria_(b.marca) - colEhPrioritaria_(a.marca)) || (num_(b.avaliacoes) - num_(a.avaliacoes)); })
    .filter(function (r) { const k = str_(r.link); if (vistos[k]) return false; vistos[k] = 1; return true; })
    .slice(0, COL_AVAL_CONC).map(function (r) {
      return { mk: str_(r.marketplace), link: str_(r.link), marca: str_(r.marca), categoria: str_(r.categoria), sku: '',
               produto: str_(r.produto), foto: str_(r.foto), item: str_(r.item_id) };
    });
  return oficiais.concat(revenda, cc);
}

function colAvaliacoesDaPagina_(t, ctx) {
  if (ctx.bloqueados['aval_' + t.mk]) return;
  let lista;
  if (t.mk === 'Shopee') {                                            // Shopee: comentários pela leitura pública de avaliações (pode ser bloqueada)
    const rs = colReviewsShopee_(t.link);
    if (!rs.ok) { colFalha_(ctx, 'aval_' + t.mk, rs.motivo); return; }
    colSucesso_(ctx, 'aval_' + t.mk);
    lista = rs.itens;
  } else {
  const pg = colPaginaProduto_(t.link, t.mk === 'Amazon');
  const h = pg ? { ok: true, texto: pg } : { ok: false, motivo: 'página do produto não abriu' };
  if (!h.ok) { colFalha_(ctx, 'aval_' + t.mk, h.motivo); return; }
  colSucesso_(ctx, 'aval_' + t.mk);
  lista = t.mk === 'Mercado Livre' ? colReviewsML_(h.texto) : t.mk === 'Amazon' ? colReviewsAmazon_(h.texto)
              : colReviewsMagalu_(h.texto);
  }
  if (!ctx.jaAval) { ctx.jaAval = {}; lerAba_('AVALIACOES').forEach(function (r) { ctx.jaAval[str_(r.review_id)] = 1; }); }
  const novas = [];
  lista.forEach(function (v) {
    if (!v.texto || !v.nota) return;
    const id = v.id ? colSlug_(t.mk).slice(0, 3).toUpperCase() + '-' + v.id
                    : colSlug_(t.mk).slice(0, 3).toUpperCase() + '-' + colHash_(t.link + '|' + v.texto.slice(0, 120) + '|' + v.nota);
    if (ctx.jaAval[id]) return;
    ctx.jaAval[id] = 1;
    novas.push({ review_id: id, data: v.data || '', marketplace: t.mk, marca: t.marca, categoria: t.categoria, sku: t.sku, produto: t.produto,
                 nota_1a5: v.nota, titulo: v.titulo || '', texto: v.texto.slice(0, 2000), link: t.link, foto: t.foto, item_id: t.item, origem: 'COLETA' });
  });
  appendObjs_('AVALIACOES', novas);
}

function colReviewsML_(html) {
  const out = [];
  html.split(/class="ui-review-capability-comments__comment"/).slice(1).forEach(function (b) {
    b = b.slice(0, 6000);
    const nota = Number(colMatch_(b, /Avalia[çc][ãa]o\s*(\d)\s*de\s*5/i) || colMatch_(b, /Calificaci[oó]n\s*(\d)\s*de\s*5/i) || 0);
    const texto = colTexto_(colMatch_(b, /ui-review-capability-comments__comment__content[^>]*>([\s\S]*?)<\/p>/));
    const data = colDataPT_(colTexto_(colMatch_(b, /ui-review-capability-comments__comment__date[^>]*>([\s\S]*?)<\/(?:span|p|div)>/)) + ' ' + colTexto_(b.slice(0, 2500)));
    if (nota && texto) out.push({ nota: nota, texto: texto, titulo: '', data: data });
  });
  return out;
}

function colReviewsMagalu_(html) {
  const nd = colMatch_(html, /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nd) return [];
  let d; try { d = JSON.parse(nd); } catch (e) { return []; }
  const pr = d && d.props && d.props.pageProps && d.props.pageProps.data && d.props.pageProps.data.productRating;
  const itens = (pr && pr.userReviews && pr.userReviews.items) || [];
  return itens.map(function (r) {
    return { id: r.reviewId || '', nota: Number(r.rating) || 0, titulo: r.title && r.title !== 'null' ? String(r.title) : '',
             texto: String(r.description || '').trim(), data: r.submissionDate ? new Date(r.submissionDate) : '' };
  });
}

function colReviewsAmazon_(html) {
  const out = [];
  html.split(/data-hook="review"/).slice(1).forEach(function (b) {
    b = b.slice(0, 15000);
    const nota = Number((colMatch_(b, /(\d)(?:[,.]\d)?\s*de\s*5\s*estrelas/) || '0'));
    const texto = colTexto_(colMatch_(b, /data-hook="reviewText"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/) ||
                            colMatch_(b, /data-hook="review-body"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/)).replace(/Brief content visible[^.]*\.\s*/gi, '').replace(/Full content visible[^.]*\.\s*/gi, '')
      .replace(/Conte[úu]do (?:resumido|completo) vis[íi]vel[^.]*\.\s*/gi, '').replace(/(\s*(Ler mais|Ler menos|Leia mais|Read more|Read less))+\s*$/i, '').trim();
    const titulo = colTexto_(colMatch_(b, /data-hook="(?:reviewTitle|review-title)"[^>]*>([\s\S]*?)<\/(?:a|h5)>/)).replace(/[\d,.]+\s*de\s*5\s*estrelas/i, '').trim();
    const data = colDataPT_(colTexto_(colMatch_(b, /data-hook="review-date"[^>]*>([^<]+)/)));
    if (nota && texto) out.push({ nota: nota, texto: texto, titulo: titulo, data: data });
  });
  return out;
}

// Lê datas em português: "12 de março de 2025", "12 mar. 2025", "12/03/2025".
function colDataPT_(s) {
  const meses = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
  s = colNorm_(s).toLowerCase();
  let m = s.match(/(\d{1,2})\s*(?:de\s*)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s*(?:de\s*)?(\d{4})/);
  if (m) return new Date(Number(m[3]), meses[m[2]], Number(m[1]));
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  // datas relativas do Mercado Livre: "hoje", "ontem", "há 3 dias", "há mais de 1 ano"
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (/\bhoje\b/.test(s)) return d;
  if (/\bontem\b/.test(s)) { d.setDate(d.getDate() - 1); return d; }
  m = s.match(/ha\s*(?:mais de\s*)?(\d+|um|uma)\s*(dia|semana|mes|meses|ano)/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
    if (m[2] === 'dia') d.setDate(d.getDate() - n);
    else if (m[2] === 'semana') d.setDate(d.getDate() - 7 * n);
    else if (m[2] === 'ano') d.setFullYear(d.getFullYear() - n);
    else d.setMonth(d.getMonth() - n);
    return d;
  }
  return '';
}
function colHash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 16);
}

/* ---------- auxiliares ---------- */
// Apaga as linhas antigas de um marketplace uma única vez por coleta (mesmo que ela retome em várias execuções),
// e só depois de o marketplace responder — se ele bloquear, os dados anteriores ficam.
function colLimparUmaVez_(aba, mk, ctx) {
  const p = PropertiesService.getScriptProperties();
  const k = 'COL_LIMPO_' + aba + '_' + colSlug_(mk), run = p.getProperty('COL_RUN') || '';
  if (p.getProperty(k) === run) return;
  removerOrigem_(aba, 'COLETA', function (r) { return str_(r.marketplace) === mk && !(aba === 'ANUNCIOS' && str_(r.seller) === 'DELLAMED'); });
  p.setProperty(k, run);
}
/* ===== Identificação de ITEM Dellamed (mesmo código no Apps Script e no painel) ===== */
var ITM_STOP={DE:1,DA:1,DO:1,DAS:1,DOS:1,PARA:1,E:1,A:1,O:1,EM:1,NA:1,NO:1,AO:1,UM:1,UMA:1,POR:1,DELLAMED:1,KIT:1,UN:1,P:1,C:1,ATE:1,AS:1,OS:1,X:1};
var ITM_SIN={HIGIENICA:'HIG',HIGIENICO:'HIG',HIGIENICAS:'HIG',INFANTIL:'PEDIAT',PEDIATRICO:'PEDIAT',PEDIATRICA:'PEDIAT',TENNIS:'TENIS',
  MEDIDOR:'MONITO',BANHO:'HIG',APARELHO:'MONITO',ESFIGMOMANOMETRO:'MONITO',INALADOR:'NEBULI',CINTO:'CINTA'};
var ITM_FRACO={DIGITA:1,ELETRI:1,PORTAT:1,AUTOMA:1,ADULTO:1,PROFIS:1,DOBRAV:1,ORIGIN:1,NOVO:1,NOVA:1,PRETO:1,PRETA:1,BRANCO:1,BRANCA:1,AZUL:1,CINZA:1};
function itmNorm(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase()}
function itmCodigo(t){return /^(DX\d*|D\d{1,5}|DBP\d+|KF\d+[A-Z]?)$/.test(t)}
function itmTokens(txt){
  var s=itmNorm(txt).replace(/\bC\/\s*/g,' COM ').replace(/\bS\/\s*/g,' SEM ').replace(/\bD[\s-]+(\d{1,5})\b/g,'D$1').replace(/\bKF[\s-]+(\d+[A-Z]?)\b/g,'KF$1').replace(/\bDBP[\s-]+(\d+)\b/g,'DBP$1');
  var raw=s.split(/[^A-Z0-9]+/).filter(Boolean),out=[];
  for(var i=0;i<raw.length;i++){var w=raw[i];
    if(itmCodigo(w)){out.push(w);continue}
    if(w==='COM'||w==='SEM'){var nx=raw[i+1];if(nx&&!ITM_STOP[nx]){out.push(w+'_'+itmStem(nx));i++}continue}
    if(ITM_STOP[w]||(w.length<2&&!/^\d$/.test(w)))continue;   // números de 1 dígito contam (Faixa 3 painéis ≠ 4 painéis)
    out.push(itmStem(w))}
  return out}
function itmStem(w){if(/^\d/.test(w))return w;w=ITM_SIN[w]||w;if(w.length>3)w=w.replace(/S$/,'');w=ITM_SIN[w]||w;return w.length>=6?w.slice(0,6):w}
// Índice a partir da lista de itens (nome exato da planilha)
function itmIndice(nomes){
  var its=nomes.map(function(n){var tk=itmTokens(n),u={};tk.forEach(function(t){u[t]=1});var tks=Object.keys(u);
    return {nome:n,tk:tks,cod:tks.filter(itmCodigo),head:tks.filter(function(t){return !itmCodigo(t)})[0]||''}});
  var fam={};
  its.forEach(function(I){var nc=I.tk.filter(function(t){return !itmCodigo(t)});
    I.fam=I.cod.length?'C:'+I.cod.slice().sort().join('+'):'N:'+nc.slice(0,2).join('+');(fam[I.fam]=fam[I.fam]||[]).push(I)});
  var df={};its.forEach(function(I){I.tk.forEach(function(t){df[t]=(df[t]||0)+1})});
  its.forEach(function(I){var irm=fam[I.fam],nc=I.tk.filter(function(t){return !itmCodigo(t)});
    var comum=I.tk.filter(function(t){return irm.every(function(J){return J.tk.indexOf(t)>=0})});
    I.core=I.cod.length?I.cod:nc.slice(0,2);                              // com código: o código basta; sem código: os 2 primeiros termos do nome
    I.v=I.cod.length?I.tk.filter(function(t){return comum.indexOf(t)<0&&I.cod.indexOf(t)<0})   // o que distingue dos irmãos (POP, LIGHT…)
                    :nc.slice(2);
    I.raros=I.tk.filter(function(t){return !itmCodigo(t)&&df[t]<=2&&!ITM_FRACO[t]})});   // termos quase exclusivos (BIOIMPEDANCIA, MONOBLOCO…)
  var codigos={};its.forEach(function(I){I.cod.forEach(function(c){codigos[c]=1})});
  return {its:its,fam:fam,codigos:codigos}}
// Devolve o nome do ITEM ou '' quando o título não permite identificar com segurança.
function itmIdentificar(ix,titulo){return itmDetalhe(ix,titulo).nome}
// Detalhe da identificação: nome, se é FORTE (o título traz o que distingue o modelo dos irmãos) e os candidatos.
// Fraco = o título serve para mais de um modelo da família (ex.: só "D100", que pode ser D100, D100 POP ou D100 LIGHT).
function itmDetalhe(ix,titulo){
  var T={};itmTokens(titulo).forEach(function(t){T[t]=1});
  var codT=Object.keys(T).filter(function(t){return ix.codigos[t]});
  var cands=ix.its.filter(function(I){if(codT.length){if(!I.cod.length)return false;return I.cod.every(function(c){return T[c]})}
    return !I.cod.length&&I.core.length>0&&I.core.every(function(t){return T[t]})});
  if(!cands.length)return {nome:'',forte:false,cands:[]};
  var res=cands.map(function(I){var m=0,u=0;I.v.forEach(function(t){if(T[t])m++;else u++});
    var pen=0,irm=I.cod.length?ix.fam[I.fam]:ix.its.filter(function(J){return !J.cod.length&&J.head===I.head});
    irm.forEach(function(J){if(J===I)return;(I.cod.length?J.v:J.raros.filter(function(t){return J.core.indexOf(t)>=0})).forEach(function(t){if(T[t]&&I.tk.indexOf(t)<0&&!ITM_FRACO[t])pen++})});
    return {I:I,s:m-0.5*u-pen+0.01*I.core.length,m:m,ok:(m>0||!I.v.length)&&pen===0}});
  res.sort(function(a,b){return b.s-a.s});
  var nomes=cands.map(function(I){return I.nome}),b=res[0];
  if(!b.ok||b.s<0)return {nome:'',forte:false,cands:nomes};
  if(res[1]&&Math.abs(res[1].s-b.s)<1e-6)return {nome:'',forte:false,cands:nomes};   // empate: ambíguo, não chuta
  return {nome:b.I.nome,forte:cands.length===1||b.m>0,cands:nomes}}
// Família do item (D100 → D100, D100 POP, D100 LIGHT): os modelos que podem ser confundidos com ele
function itmFamilia(ix,nome){
  var I=ix.its.filter(function(J){return J.nome===nome})[0];if(!I)return [];
  var irm=I.cod.length?ix.fam[I.fam]:ix.its.filter(function(J){return !J.cod.length&&J.head===I.head});
  return irm.map(function(J){return J.nome})}

// Índice dos itens (aba ITENS) e vínculos manuais link → item (aba VINCULO_ITEM), por execução
function colIndiceItens_() { if (!COL_CACHE.ixItens) COL_CACHE.ixItens = itmIndice(itensLista_()); return COL_CACHE.ixItens; }
function colVinculosItem_() {
  if (COL_CACHE.vinc) return COL_CACHE.vinc;
  const v = {}, validos = {}; itensLista_().forEach(function (x) { validos[x] = 1; });
  try { lerAba_('VINCULO_ITEM').forEach(function (r) {
    const it = str_(r.item).toUpperCase(), k = str_(r.link_ou_codigo);
    if (!it || !k || !validos[it]) return;
    v[colChaveVinculo_(k)] = it;
  }); } catch (e) {}
  COL_CACHE.vinc = v; return v;
}
// Chave de um link/código: código MLB (anúncio ou catálogo), ASIN da Amazon ou o próprio texto
function colChaveVinculo_(k) {
  k = String(k || '').trim();
  const mlb = (k.match(/MLB-?\d+/i) || [''])[0].replace('-', '').toUpperCase();
  if (mlb) return mlb;
  const asin = (k.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
  if (asin) return asin.toUpperCase();
  if (/^[A-Z0-9]{10}$/i.test(k)) return k.toUpperCase();
  return k;
}
// Vínculo manual (aba VINCULO_ITEM) de um anúncio: pelo código do anúncio, pelo catálogo ou pelo link
function colVinculoDe_(id, link) {
  const v = colVinculosItem_();
  const cat = (String(link || '').match(/\/p\/(MLB\d+)/i) || [])[1];
  return v[colChaveVinculo_(id)] || (cat && v[cat.toUpperCase()]) || v[colChaveVinculo_(link)] || v[String(link || '')] || '';
}
// ITEM de um anúncio: vínculo manual pelo link/código (exato) ou identificação pelo título com a lista de itens
function colItemDe_(titulo, id, link) {
  return colVinculoDe_(id, link) || itmIdentificar(colIndiceItens_(), titulo);
}

/* ---------- Conferência do modelo quando o título não basta ----------
   Ordem: 1) vínculo manual (VINCULO_ITEM)  2) decisão já tomada (aba ITEM_AUTO)  3) título, quando ele traz o que
   distingue o modelo  4) ficha do anúncio no ML (atributos Modelo/Linha) e descrição  5) foto do anúncio comparada
   com a foto da loja oficial de cada modelo da família (Gemini). Cada decisão de 4/5 fica gravada na aba ITEM_AUTO
   (não repete a consulta nas próximas coletas e você pode corrigir ali). */
const COL_VERIF_MAX_POR_COLETA = 150;            // consultas de foto por coleta (o restante fica para a próxima)
const COL_VERIF_REFAZER_DIAS = 7;                // inconclusivo: tenta de novo depois de 7 dias
function colItemAuto_() {
  if (COL_CACHE.auto) return COL_CACHE.auto;
  const m = {}, ok = {}; itensLista_().forEach(function (x) { ok[x] = 1; });
  try { lerAba_('ITEM_AUTO').forEach(function (r) {
    const k = colChaveVinculo_(str_(r.anuncio)); if (!k) return;
    const it = str_(r.item).toUpperCase();
    m[k] = { item: ok[it] ? it : '', fonte: str_(r.fonte), data: r.data instanceof Date ? r.data.getTime() : 0 };
  }); } catch (e) {}
  COL_CACHE.auto = m; return m;
}
function colItemAutoGravar_(chave, item, fonte, titulo, link) {
  colItemAuto_()[chave] = { item: item, fonte: fonte, data: Date.now() };
  try { appendObjs_('ITEM_AUTO', [{ anuncio: chave, item: item, fonte: fonte, titulo: String(titulo || '').slice(0, 200), link: link || '', data: new Date() }]); } catch (e) {}
}
// it = { titulo, id, link, foto }; dica = item procurado (define a família quando o título não traz o modelo)
// opts.semFoto: não compara fotos (loja oficial: ela é a própria referência)
function colItemConfirmado_(it, dica, opts) {
  opts = opts || {};
  const vin = colVinculoDe_(it.id, it.link);
  if (vin) return { item: vin, fonte: 'vínculo' };
  const chave = colChaveVinculo_(it.id || it.link);
  const auto = colItemAuto_()[chave];
  if (auto && auto.item) return { item: auto.item, fonte: auto.fonte };
  const ix = colIndiceItens_(), d = itmDetalhe(ix, it.titulo);
  if (d.forte) return { item: d.nome, fonte: 'título' };
  const fam = {};
  (d.cands.length ? d.cands : (dica ? [dica] : [])).forEach(function (n) { itmFamilia(ix, n).forEach(function (x) { fam[x] = 1; }); });
  const cands = Object.keys(fam);
  if (cands.length < 2 && !(cands.length === 1 && !d.nome)) return { item: d.nome, fonte: 'título' };
  if (auto && !auto.item && Date.now() - auto.data < COL_VERIF_REFAZER_DIAS * 864e5) return { item: d.nome, fonte: 'título' };
  let r = colItemPorFicha_(it, cands);
  if (!r && !opts.semFoto) r = colItemPorFoto_(it, cands);
  if (r === null) return { item: d.nome, fonte: 'título' };                       // nada para consultar agora (sem API/foto/limite)
  colItemAutoGravar_(chave, r ? r.item : '', r ? r.fonte : 'inconclusivo', it.titulo, it.link);
  return r || { item: d.nome, fonte: 'título' };
}
// Ficha do anúncio no Mercado Livre: atributos Modelo/Linha e, se não bastar, a descrição. false = consultou e não decidiu.
function colItemPorFicha_(it, cands) {
  const mlb = (String(it.id || '').match(/^MLB\d+$/i) || String(it.link || '').match(/MLB-?\d+/i) || [''])[0].replace('-', '').toUpperCase();
  if (!mlb || /\/p\/MLB/i.test(String(it.link || '')) && !/^MLB\d+$/i.test(String(it.id || '')) || !colApiML_()) return null;
  const ix = colIndiceItens_();
  const tenta = function (txt, fonte) { const d = itmDetalhe(ix, txt); return d.nome && d.forte && cands.indexOf(d.nome) >= 0 ? { item: d.nome, fonte: fonte } : null; };
  let j = null; try { j = mlGet_('/items/' + mlb + '?attributes=title,attributes'); } catch (e) {}
  const at = j ? (j.attributes || []).filter(function (a) { return /^(MODEL|LINE|ALPHANUMERIC_MODEL|SELLER_SKU)$/.test(a.id); })
                   .map(function (a) { return a.value_name || ''; }).join(' ') : '';
  let r = at ? tenta(it.titulo + ' ' + at, 'ficha do anúncio (modelo)') : null;
  if (r) return r;
  let ds = null; try { ds = mlGet_('/items/' + mlb + '/description'); } catch (e) {}
  const txt = ds ? String(ds.plain_text || ds.text || '').slice(0, 900) : '';
  if (txt) r = tenta(it.titulo + ' ' + at + ' ' + txt, 'descrição do anúncio');
  return r || (j || ds ? false : null);
}
// Foto do anúncio x fotos da loja oficial dos modelos da família (Gemini). false = comparou e não teve certeza.
function colItemPorFoto_(it, cands) {
  if (!it.foto || !mlPropSeguro_('GEMINI_API_KEY')) return null;
  if (COL_CACHE.inicio && Date.now() - COL_CACHE.inicio > COL_LIMITE_MS - 40000) return null;   // sem tempo nesta execução
  const p = PropertiesService.getScriptProperties(), n = Number(p.getProperty('COL_N_VERIF') || 0);
  if (n >= COL_VERIF_MAX_POR_COLETA) return null;
  const refs = colFotosItens_();
  const ops = cands.slice(0, 6), letras = 'ABCDEF';
  if (!ops.some(function (x) { return refs[x]; })) return null;                    // nenhum modelo com foto de referência
  const ad = colImagem_(it.foto); if (!ad) return null;
  p.setProperty('COL_N_VERIF', String(n + 1));
  const parts = [{ text: 'Você confere anúncios de revendedores de produtos Dellamed (equipamentos médicos). Modelos da mesma família são muito parecidos ' +
    '(ex.: D100, D100 POP e D100 LIGHT): compare estrutura, rodas, apoios, encosto, assento, cor, acabamento e detalhes.\nTítulo do anúncio: "' + it.titulo + '".\nFOTO DO ANÚNCIO:' },
    { inline_data: ad }];
  ops.forEach(function (nome, i) {
    const img = refs[nome] ? colImagem_(refs[nome]) : null;
    parts.push({ text: 'Referência ' + letras[i] + ' = ' + nome + (img ? ' (foto da loja oficial):' : ' (sem foto de referência)') });
    if (img) parts.push({ inline_data: img });
  });
  parts.push({ text: 'Qual referência é EXATAMENTE o mesmo modelo da foto do anúncio? Responda só a letra (' + letras.slice(0, ops.length).split('').join(', ') +
    ') ou NENHUM se não tiver certeza.' });
  const modelo = mlPropSeguro_('GEMINI_MODELO') || 'gemini-2.5-flash';
  let res = null;
  try { res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent?key=' + encodeURIComponent(mlPropSeguro_('GEMINI_API_KEY')), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: parts }], generationConfig: { temperature: 0 } }) }); } catch (e) { return null; }
  if (res.getResponseCode() !== 200) { if (Number(p.getProperty('COL_N_VERIF_ERRO') || 0) < 1) { p.setProperty('COL_N_VERIF_ERRO', '1'); log_('sistema', 'item_foto_erro', 'Gemini HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200)); } return null; }
  const j = JSON.parse(res.getContentText() || '{}');
  const txt = String((((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (x) { return x.text || ''; }).join(' ')).trim().toUpperCase();
  const m = txt.match(/^\W*([A-F])\b/);
  const i = m ? letras.indexOf(m[1]) : -1;
  return i >= 0 && i < ops.length ? { item: ops[i], fonte: 'foto do anúncio' } : false;
}
// Foto de referência de cada item: a do anúncio da loja oficial (PRODUTOS_BASE)
function colFotosItens_() {
  if (COL_CACHE.fotosItens) return COL_CACHE.fotosItens;
  const m = {};
  try { lerAba_('PRODUTOS_BASE').forEach(function (r) { const it = str_(r.item).toUpperCase(), f = str_(r.foto); if (it && f && !m[it]) m[it] = f; }); } catch (e) {}
  COL_CACHE.fotosItens = m; return m;
}
function colImagem_(url) {
  const k = 'img_' + url; if (COL_CACHE[k] !== undefined) return COL_CACHE[k];
  let out = null;
  const tenta = [String(url).replace(/-[IVSTN]\.(jpg|jpeg|webp|png)$/i, '-O.$1'), String(url)].filter(function (x, i, a) { return a.indexOf(x) === i; });
  for (let i = 0; i < tenta.length && !out; i++) {
    try { const r = UrlFetchApp.fetch(tenta[i], { muteHttpExceptions: true });
      if (r.getResponseCode() === 200) { const b = r.getBlob(); const tipo = b.getContentType() || 'image/jpeg';
        if (/^image\//.test(tipo) && b.getBytes().length < 4e6) out = { mime_type: tipo, data: Utilities.base64Encode(b.getBytes()) }; } } catch (e) {}
  }
  COL_CACHE[k] = out; return out;
}

// Fila de conferência pela FOTO: cada anúncio da loja sem item vira uma linha na aba VINCULO_ITEM, com a foto,
// o título, o link e uma lista para escolher o item. Quando você escolhe o item, a próxima leitura já usa.
// Com a propriedade GEMINI_API_KEY, a IA olha a foto e preenche uma SUGESTÃO (não é aplicada sozinha: você confirma).
const COL_IA_MAX_POR_COLETA = 30;
function colFilaConferencia_(lista) {
  const sh = aba_('VINCULO_ITEM'), v = sh.getDataRange().getValues();
  const h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
  const iK = h.indexOf('link_ou_codigo');
  const ja = {};
  for (let i = 1; i < v.length; i++) { const k = String(v[i][iK] || ''); const id = (k.match(/MLB-?\d+/i) || [''])[0].replace('-', '').toUpperCase(); ja[id || k] = 1; }
  const itens = itensLista_(), novos = lista.filter(function (x) { return x.id && !ja[String(x.id).toUpperCase()]; });
  if (!novos.length) return;
  const temIA = !!mlPropSeguro_('GEMINI_API_KEY');
  let nIA = 0;
  const linhas = novos.map(function (x) {
    let sug = '';
    if (temIA && x.foto && nIA < COL_IA_MAX_POR_COLETA) { nIA++; try { sug = colSugestaoIA_(x.foto, x.titulo, itens); } catch (e) { sug = ''; } }
    return { link_ou_codigo: x.link || x.id, item: '', foto: x.foto ? '=IMAGE("' + String(x.foto).replace(/"/g, '') + '")' : '', titulo: x.titulo,
             sugestao_ia: sug, observacao: 'automático ' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy') + ' · código ' + x.id };
  });
  const ini = sh.getLastRow() + 1;
  appendObjs_('VINCULO_ITEM', linhas);
  try {
    const iItem = h.indexOf('item') + 1, iFoto = h.indexOf('foto') + 1;
    const regra = SpreadsheetApp.newDataValidation().requireValueInRange(aba_('ITENS').getRange('A2:A'), true).setAllowInvalid(false).build();
    if (iItem > 0) sh.getRange(ini, iItem, linhas.length, 1).setDataValidation(regra);
    if (iFoto > 0) { sh.setRowHeights(ini, linhas.length, 90); sh.setColumnWidth(iFoto, 110); }
  } catch (e) {}
}
// Sugestão de item pela foto (Google Gemini). Devolve um nome da lista ou ''.
function colSugestaoIA_(fotoUrl, titulo, itens) {
  const chave = mlPropSeguro_('GEMINI_API_KEY'), modelo = mlPropSeguro_('GEMINI_MODELO') || 'gemini-2.5-flash';
  const img = UrlFetchApp.fetch(fotoUrl, { muteHttpExceptions: true });
  if (img.getResponseCode() !== 200) return '';
  const blob = img.getBlob();
  const pedido = 'Você identifica produtos da marca Dellamed (equipamentos médicos) pela foto. Título do anúncio: "' + titulo + '".\n' +
    'Responda APENAS com um nome EXATO desta lista, ou NENHUM se não tiver certeza (modelos parecidos, como D100 e D100 POP, só se a foto ou o título deixarem claro):\n' + itens.join('\n');
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent?key=' + encodeURIComponent(chave), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: pedido }, { inline_data: { mime_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } }] }],
                              generationConfig: { temperature: 0 } })
  });
  if (res.getResponseCode() !== 200) return '';
  const j = JSON.parse(res.getContentText() || '{}');
  const txt = String((((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (p) { return p.text || ''; }).join(' ')).trim().toUpperCase();
  return itens.indexOf(txt) >= 0 ? txt : '';                          // só aceita nome idêntico ao da lista
}

// Variantes de um mesmo modelo (Pop, Light, Max…): mantêm o SKU separado (D100 ≠ D100 Pop ≠ D100 Light).
// Ampliável pela propriedade COLETA_VARIANTES (lista separada por vírgula).
const COL_VARIANTES_PADRAO = ['POP', 'LIGHT', 'MAX', 'PLUS', 'PRO', 'MINI', 'SLIM', 'PREMIUM', 'ULTRA', 'ULTRALEVE',
  'COMPACT', 'COMPACTA', 'ECO', 'NEO', 'DUO', 'SMART', 'GOLD', 'SILVER', 'XL', 'XXL', 'INFANTIL', 'JUVENIL',
  'BARIATRICA', 'BARIATRICO', 'OBESO', 'OBESOS', 'CONFORT', 'COMFORT', 'PCD', 'STEEL', 'ADVANCE', 'CLASSIC'];
function colVariantes_() {
  if (COL_CACHE.variantes) return COL_CACHE.variantes;
  const extra = mlPropSeguro_('COLETA_VARIANTES') ? mlPropSeguro_('COLETA_VARIANTES').split(',') : [];
  COL_CACHE.variantes = COL_VARIANTES_PADRAO.concat(extra).map(function (v) { return colNorm_(v).replace(/[^A-Z0-9]/g, ''); }).filter(String);
  return COL_CACHE.variantes;
}
// Variante(s) presentes no título, para compor o SKU; '' quando não há.
function colVarianteTitulo_(titulo) {
  const t = ' ' + colNorm_(titulo).replace(/[^A-Z0-9]+/g, ' ') + ' ';
  const achadas = [];
  colVariantes_().forEach(function (v) { if (t.indexOf(' ' + v + ' ') >= 0 && achadas.indexOf(v) < 0) achadas.push(v); });
  return achadas.join(' ');
}
// SKU do produto da loja: código do modelo + variante (ex.: D100, D100 POP, D100 LIGHT).
function colSkuProduto_(titulo) {
  const cod = colCodigo_('', titulo);
  if (!cod) return '';
  const v = colVarianteTitulo_(titulo);
  return v ? cod + ' ' + v : cod;
}
function colCodigo_(sku, titulo) {
  const rx = /\b(D\d{1,4}[A-Z]*|DBP-?\d{3,5}|[A-Z]{1,3}-?\d{2,5})\b/;
  const a = String(sku || '').toUpperCase().match(rx);
  if (a && !/^MLB/.test(a[1])) return a[1];                       // o SKU pode trazer a variante ("D100 POP"); o código é só D100
  const b = String(titulo || '').toUpperCase().match(rx);
  return b ? b[1] : '';
}
function colCategoria_(titulo) {
  const t = colNorm_(titulo);
  for (let i = 0; i < COL_CATEGORIAS.length; i++) {
    if (t.indexOf(colNorm_(COL_CATEGORIAS[i])) >= 0) { const c = COL_CATEGORIAS[i]; return c.charAt(0).toUpperCase() + c.slice(1); }
  }
  return 'Outros';
}
// Lista de marcas conhecidas: prioritárias (aba PRIORITARIOS) + as da lista padrão.
// Compara palavra inteira e testa nomes mais longos primeiro ("FISCHER PRICE" antes de "FISCHER"; "MOBIL" não casa com "ORTOMOBIL").
function colListaMarcas_() {
  if (COL_CACHE.marcas) return COL_CACHE.marcas;
  const extra = mlPropSeguro_('COLETA_MARCAS') ? mlPropSeguro_('COLETA_MARCAS').split(',') : [];
  const todas = colPrioritarias_().concat(COL_MARCAS_PADRAO, extra).map(function (m) { return String(m).trim(); }).filter(String);
  const vistos = {}, lista = [];
  todas.forEach(function (m) { const k = colNorm_(m); if (!vistos[k]) { vistos[k] = 1; lista.push(m); } });
  lista.sort(function (a, b) { return b.length - a.length; });
  COL_CACHE.marcas = lista;
  return lista;
}
function colMarca_(titulo) {
  const t = ' ' + colNorm_(titulo).replace(/[^A-Z0-9]+/g, ' ') + ' ';
  const lista = colListaMarcas_();
  for (let i = 0; i < lista.length; i++) {
    const m = ' ' + colNorm_(lista[i]).replace(/[^A-Z0-9]+/g, ' ').trim() + ' ';
    if (m.trim() && t.indexOf(m) >= 0) return colNomeMarca_(lista[i]);
  }
  return 'Não identificada';
}
// Marca vinda do marketplace, se houver; senão, reconhecida pelo título. Prioritárias ganham a grafia da lista.
function colMarcaReconhecida_(marcaSite, titulo) {
  const m = String(marcaSite || '').trim();
  if (m && !/^(gen[eé]rica?|n[aã]o informado|sem marca)$/i.test(m)) return colNomeMarca_(m);
  return colMarca_(titulo);
}
function colNomeMarca_(m) {
  const k = colNorm_(m);
  const p = colPrioritarias_().filter(function (x) { return colNorm_(x) === k; })[0];
  return p || m;
}
function colPrioritarias_() {
  if (COL_CACHE.prio) return COL_CACHE.prio;
  let l = [];
  try { l = lerAba_('PRIORITARIOS').map(function (r) { return str_(r.marca); }).filter(String); } catch (e) {}
  if (!l.length && typeof PRIORITARIOS_PADRAO !== 'undefined') l = PRIORITARIOS_PADRAO.slice();
  COL_CACHE.prio = l;
  return l;
}
function colEhPrioritaria_(m) { const k = colNorm_(m); return colPrioritarias_().some(function (x) { return colNorm_(x) === k; }) ? 1 : 0; }
function colCategoriasBase_(ctx) {
  if (!ctx.catsBase) ctx.catsBase = lerAba_('PRODUTOS_BASE').map(function (r) { return str_(r.categoria); }).filter(function (c) { return c && c !== 'Outros'; });
  return ctx.catsBase;
}
// Anúncios relevantes: só os primeiros resultados da busca (ordem de relevância do próprio marketplace) e,
// entre eles, primeiro os que têm mais avaliações e vendas; a posição original desempata.
function colRelevantes_(itens, topo) {
  return (itens || []).slice(0, topo || COL_TOPO_RELEVANCIA).map(function (it, i) { it._pos = i; return it; })
    .sort(function (a, b) {
      const sa = (Number(a.avaliacoes) || 0) + (Number(a.vendidos) || 0), sb = (Number(b.avaliacoes) || 0) + (Number(b.vendidos) || 0);
      return ((sb > 0) - (sa > 0)) || (sb - sa) || (a._pos - b._pos);
    });
}
// evita o mesmo anúncio duas vezes na mesma coleta (achado pela busca da marca e pela da categoria)
function colVistosConc_(ctx) { return ctx.vistosConc || (ctx.vistosConc = {}); }
function mlPropSeguro_(k) { try { return mlProp_(k); } catch (e) { return ''; } }
function colMatch_(s, rx) { const m = String(s || '').match(rx); return m ? m[1] : ''; }
function colTexto_(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function colNum_(s) {
  s = String(s || '').trim(); if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');          // 1.299,90
  else if (/^\d+\.\d{1,2}$/.test(s)) { /* 429.90: ponto já é decimal */ }
  else s = s.replace(/\./g, '');                                                   // 1.299
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function colNorm_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function colSlug_(q) { return colNorm_(q).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }


/* ============ ARQUIVO DE COLETAS NO DRIVE ============ */
// Cada coleta é salva em CSV (separador ;, abre direto no Excel) numa pasta do Drive, com uma subpasta por mês.
// A aba HISTORICO guarda só os últimos COL_HIST_DIAS dias; os arquivos do Drive nunca são apagados pelo script.
// Pasta: propriedade COLETA_PASTA_ID (ID de uma pasta, por exemplo num Drive compartilhado). Se vazia, o script cria
// "Diagnóstico Dellamed — histórico de coletas" na mesma pasta da planilha e grava o ID.
const HIST_PASTA_NOME = 'Diagnóstico Dellamed — histórico de coletas';
function histPasta_() {
  const p = PropertiesService.getScriptProperties();
  const id = mlPropSeguro_('COLETA_PASTA_ID') || p.getProperty('HIST_PASTA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { log_('sistema', 'historico_drive_pasta', 'Pasta ' + id + ' inacessível: ' + String(e.message || e).slice(0, 150)); } }
  let pai = null;
  try { const it = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents(); if (it.hasNext()) pai = it.next(); } catch (e) {}
  if (!pai) pai = DriveApp.getRootFolder();
  const ex = pai.getFoldersByName(HIST_PASTA_NOME);
  const pasta = ex.hasNext() ? ex.next() : pai.createFolder(HIST_PASTA_NOME);
  p.setProperty('HIST_PASTA_ID', pasta.getId());
  return pasta;
}
function histChave_(v) { return v instanceof Date ? Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : String(v || '').trim().slice(0, 16); }
function histNomeArquivo_(coleta) { return 'coleta_' + String(coleta).replace(' ', '_').replace(':', 'h') + '.csv'; }
function histSubpasta_(coleta, criar) {
  const mes = String(coleta).slice(0, 7), raiz = histPasta_(), it = raiz.getFoldersByName(mes);
  return it.hasNext() ? it.next() : (criar ? raiz.createFolder(mes) : null);
}
function histExiste_(coleta) {
  try { if (histIndice_()[coleta]) return true; } catch (e) {}
  const sub = histSubpasta_(coleta, false), it = sub ? sub.getFilesByName(histNomeArquivo_(coleta)) : null;
  if (!it || !it.hasNext()) return false;
  try {                                                                            // arquivo existe mas faltava no índice: inclui
    const g = it.next(); let n = {}; try { n = JSON.parse(g.getDescription() || '{}'); } catch (e) {}
    const ix = histIndice_(); ix[coleta] = { id: g.getId(), p: n.produtos || 0, a: n.anuncios || 0, c: n.concorrentes || 0 }; histGravarIndice_(ix);
  } catch (e) {}
  return true;
}
function histCelula_(v) {
  if (v instanceof Date) v = Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
  else if (typeof v === 'number') v = String(v).replace('.', ',');                // Excel em português: vírgula decimal
  v = String(v === null || v === undefined ? '' : v);
  return /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
// Grava uma coleta (cabeçalho + linhas em matriz). Não regrava se o arquivo já existir.
function histSalvarColeta_(coleta, cab, rows) {
  coleta = histChave_(coleta);
  if (!rows.length || histExiste_(coleta)) return false;
  const iTipo = cab.map(function (x) { return String(x).trim().toLowerCase(); }).indexOf('tipo');
  const n = { produtos: 0, anuncios: 0, concorrentes: 0 };
  rows.forEach(function (r) { const t = String(r[iTipo] || ''); if (t === 'Produto Dellamed') n.produtos++; else if (t === 'Concorrente') n.concorrentes++; else n.anuncios++; });
  const csv = '\uFEFF' + [cab].concat(rows).map(function (r) { return r.map(histCelula_).join(';'); }).join('\r\n');
  const f = histSubpasta_(coleta, true).createFile(histNomeArquivo_(coleta), csv, 'text/csv');
  f.setDescription(JSON.stringify(n));
  try { const ix = histIndice_(); ix[coleta] = { id: f.getId(), p: n.produtos, a: n.anuncios, c: n.concorrentes }; histGravarIndice_(ix); } catch (e) {}
  return true;
}
// Índice das coletas no Drive: um arquivo _indice.json na pasta, lido de uma vez (abrir arquivo por arquivo é lento).
function histArqIndice_() { const it = histPasta_().getFilesByName('_indice.json'); return it.hasNext() ? it.next() : null; }
function histIndice_() {
  if (COL_CACHE.histIx) return COL_CACHE.histIx;
  const f = histArqIndice_();
  let ix = null;
  if (f) { try { ix = JSON.parse(f.getBlob().getDataAsString('UTF-8') || '{}'); } catch (e) { ix = null; } }
  if (!ix) {                                                                       // primeira vez (ou índice perdido): monta varrendo as pastas
    ix = {};
    const meses = histPasta_().getFolders();
    while (meses.hasNext()) {
      const fs = meses.next().getFiles();
      while (fs.hasNext()) {
        const g = fs.next(), m = g.getName().match(/^coleta_(\d{4}-\d{2}-\d{2})_(\d{2})h(\d{2})\.csv$/);
        if (!m) continue;
        let n = {}; try { n = JSON.parse(g.getDescription() || '{}'); } catch (e) {}
        ix[m[1] + ' ' + m[2] + ':' + m[3]] = { id: g.getId(), p: n.produtos || 0, a: n.anuncios || 0, c: n.concorrentes || 0 };
      }
    }
    histGravarIndice_(ix);
  }
  COL_CACHE.histIx = ix;
  return ix;
}
function histGravarIndice_(ix) {
  COL_CACHE.histIx = ix;
  const txt = JSON.stringify(ix), f = histArqIndice_();
  if (f) f.setContent(txt); else histPasta_().createFile('_indice.json', txt, 'application/json');
  CacheService.getScriptCache().removeAll(['hist_drive', 'hist_lista2']);
}
// Salva no Drive as coletas destas linhas que ainda não estão lá. Devolve { coleta: true } das que falharam.
function histGarantirNoDrive_(cab, linhas, ic) {
  const grupos = {}, falhou = {};
  linhas.forEach(function (r) { const k = histChave_(r[ic]); (grupos[k] = grupos[k] || []).push(r); });
  Object.keys(grupos).forEach(function (k) {
    try { histSalvarColeta_(k, cab, grupos[k]); }
    catch (e) { falhou[k] = true; log_('sistema', 'historico_drive_erro', k + ': ' + String(e.message || e).slice(0, 250)); }
  });
  return falhou;
}
// Menu: salva no Drive todas as coletas que estão hoje na aba HISTORICO (também serve para autorizar o acesso ao Drive).
function histSalvarTudoNoDrive() {
  const sh = aba_('HISTORICO'), v = sh.getDataRange().getValues();
  const ic = v[0].map(function (x) { return String(x).trim().toLowerCase(); }).indexOf('coleta');
  let msg;
  if (v.length < 2 || ic < 0) msg = 'A aba HISTORICO está vazia. A pasta do Drive foi preparada: ' + histPasta_().getUrl();
  else {
    const antes = {}; v.slice(1).forEach(function (r) { antes[histChave_(r[ic])] = 1; });
    const falhou = histGarantirNoDrive_(v[0], v.slice(1), ic);
    const nF = Object.keys(falhou).length, n = Object.keys(antes).length;
    msg = (n - nF) + ' de ' + n + ' coletas conferidas no Drive' + (nF ? ' (' + nF + ' com erro, ver LOG)' : '') + '. Pasta: ' + histPasta_().getUrl();
  }
  CacheService.getScriptCache().remove('hist_drive'); invalidarDados_();
  log_('sistema', 'historico_drive', msg.slice(0, 480));
  try { SpreadsheetApp.getUi().alert('Histórico no Drive', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}
// Coletas salvas no Drive: [{ coleta, produtos, anuncios, concorrentes, id }]. Guardado em cache por 6 h.
function histListarDrive_() {
  const cache = CacheService.getScriptCache(), c = cache.get('hist_drive');
  if (c) return JSON.parse(c);
  const ix = histIndice_();
  const out = Object.keys(ix).map(function (k) { const x = ix[k]; return { coleta: k, produtos: x.p || 0, anuncios: x.a || 0, concorrentes: x.c || 0, id: x.id }; });
  try { cache.put('hist_drive', JSON.stringify(out), 21600); } catch (e) {}
  return out;
}
// Linhas de uma coleta salva no Drive, como objetos { cabeçalho: valor }.
function histLerDrive_(id) {
  const txt = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '');
  const m = Utilities.parseCsv(txt, ';');
  if (!m.length) return [];
  const h = m[0].map(function (x) { return String(x).trim().toLowerCase(); });
  return m.slice(1).map(function (r) { const o = {}; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
}


/* ============ BUY BOX ============ */
// Mercado Livre: só produtos de catálogo (/p/MLB…) têm Buy Box ("ganhador da compra").
//   1) API oficial (conta do ML conectada): /products/{id} traz buy_box_winner (anúncio e vendedor).
//   2) Sem API ou sem o campo: a página do produto (/p/MLB…) abre sempre na oferta vencedora; o "Vendido por" dela é o ganhador.
// Amazon: a oferta em destaque do ASIN (caixa de compra) é o Buy Box; o vendedor lido na página do produto já é o ganhador.
// Magazine Luiza: não há Buy Box público equivalente.
function colBuyBoxML_(cat, ctx) {
  const k = 'bbml_' + cat;
  if (COL_CACHE[k] !== undefined) return COL_CACHE[k];
  let r = null;
  if (colApiML_()) {
    const pr = mlGet_('/products/' + cat);
    const w = pr && pr.buy_box_winner;
    if (w && (w.item_id || w.seller_id)) r = { item: String(w.item_id || '').toUpperCase(), seller: colNomeSellerML_(String(w.seller_id || ''), ctx || {}), preco: Number(w.price) || 0, fonte: 'API' };
  }
  if (!r) {
    const h = colFetch_('https://www.mercadolivre.com.br/p/' + cat);
    if (h.ok) {
      const d = colDetalheML_(h.texto);
      const item = (colMatch_(h.texto, /pdp_filters=item_id(?::|%3A)(MLB\d+)/i) || '').toUpperCase();
      if (d.seller) r = { item: '', itemPagina: item, seller: d.seller, preco: 0, fonte: 'página' };
    }
  }
  COL_CACHE[k] = r;
  return r;
}
function colEhVencedorML_(o, bb) {
  if (!bb) return false;
  if (bb.item) return String(o.id || '').toUpperCase() === bb.item;
  const a = colNorm_(o.seller || '').replace(/[^A-Z0-9]/g, ''), b = colNorm_(bb.seller || '').replace(/[^A-Z0-9]/g, '');
  return !!a && !!b && (a === b || (/DELLAMED/.test(a) && /DELLAMED/.test(b)));
}
// Menu: confere a leitura do Buy Box em até 8 produtos de catálogo da loja, sem gravar nada.
function testarBuyBox() {
  const ctx = { bloqueados: {} }, L = [];
  const base = lerAba_('PRODUTOS_BASE').filter(function (r) { return str_(r.catalogo_id); }).slice(0, 8);
  L.push('API do Mercado Livre: ' + (colApiML_() ? 'conectada' : 'não conectada (usa só a página do produto)'));
  if (!base.length) L.push('Nenhum produto da loja com catálogo (coluna catalogo_id da aba PRODUTOS_BASE vazia).');
  base.forEach(function (r) {
    const cat = str_(r.catalogo_id).toUpperCase(), bb = colBuyBoxML_(cat, ctx);
    L.push(str_(r.sku) + ' · ' + cat + ' → ' + (bb ? (bb.seller || bb.item || '?') + ' (' + bb.fonte + ')' + (/dellamed/i.test(bb.seller || '') ? ' · Dellamed ganha' : ' · Dellamed NÃO ganha') : 'não foi possível ler'));
  });
  log_('sistema', 'buybox_teste', L.join(' | ').slice(0, 480));
  try { SpreadsheetApp.getUi().alert('Teste de leitura do Buy Box', L.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}


/* ================= SHOPEE — leitura sem cadastro e sem chave =================
 * A Shopee não tem API pública de catálogo e muda as defesas com frequência. Por isso a leitura tenta, em ordem,
 * caminhos públicos que não pedem login nem chave, e guarda o que funcionou (SHOPEE_METODO) para começar por ele
 * na próxima busca:
 *   1. página de busca entregue a robôs de indexação (versão SEO, com os produtos no HTML)
 *   2. página de busca comum (HTML)
 *   3. busca interna do site (JSON v4)
 *   4. busca interna antiga (JSON v2)
 * Menu Diagnóstico › Shopee: testar leitura mostra qual caminho respondeu.
 * Comentários: leitura pública de avaliações do produto (JSON v2). Detalhes (nota e avaliações): dados estruturados da página do produto.
 */
const SHP_UA_BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const SHP_UA_BOT2 = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
const SHP_METODOS = ['ddg', 'seo_google', 'v4'];   // ddg = buscador DuckDuckGo acha os anúncios; a página de cada produto (versão para robôs) dá preço, nota e avaliações
const SHP_MAX_POR_BUSCA = 15;                        // páginas de produto abertas por busca (tempo de coleta)
function shpNum_(x) { const n = Number(String(x == null ? '' : x).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function shpPreco_(s) { const m = String(s || '').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/); return m ? shpNum_(m[1]) : 0; }
function shpVend_(s) {
  const m = String(s || '').match(/([\d.,]+)\s*(mil)?\+?\s*vendid/i);
  if (!m) return '';
  let n = Number(m[1].replace(/\./g, '').replace(',', '.')); if (m[2]) n *= 1000;
  return n || '';
}
function shpGet_(url, ua, json) {
  try {
    Utilities.sleep(600);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': ua, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
                 'x-api-source': 'pc', 'x-shopee-language': 'pt-BR', Referer: 'https://shopee.com.br/' } });
    const cod = res.getResponseCode(), txt = res.getContentText();
    if (cod !== 200) return { ok: false, motivo: 'HTTP ' + cod };
    return { ok: true, texto: txt };
  } catch (e) { return { ok: false, motivo: String(e.message || e).slice(0, 100) }; }
}
// HTML (SEO ou comum): produtos vêm como links "nome-do-produto-i.LOJA.ITEM" com nome, preço e vendidos no cartão;
// e, quando existe, como dados estruturados (ld+json ItemList/Product).
function shpParseHtml_(html) {
  const out = [], vistos = {};
  // dados estruturados
  const rx = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g; let m;
  while ((m = rx.exec(html))) {
    let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
    const nos = [].concat(j).concat((j && j['@graph']) || []);
    nos.forEach(function (n) {
      const lista = n && n.itemListElement ? [].concat(n.itemListElement) : (n && n['@type'] === 'Product' ? [n] : []);
      lista.forEach(function (x) {
        const pr = x.item || x;
        const url = String(pr.url || x.url || '');
        const id = (url.match(/-i\.(\d+)\.(\d+)/) || url.match(/product\/(\d+)\/(\d+)/));
        if (!id || vistos[id[2]]) return;
        const of = Array.isArray(pr.offers) ? pr.offers[0] : (pr.offers || {});
        const preco = shpNum_(String(of.price || of.lowPrice || '').replace('.', ','));
        const ar = pr.aggregateRating || {};
        vistos[id[2]] = 1;
        out.push({ titulo: colTexto_(pr.name || ''), preco: preco, precoOriginal: 0, link: 'https://shopee.com.br/product/' + id[1] + '/' + id[2],
                   id: id[2], shopId: id[1], foto: [].concat(pr.image || '')[0] || '', seller: '', marca: (pr.brand && (pr.brand.name || pr.brand)) || '',
                   nota: Number(ar.ratingValue) || '', avaliacoes: Number(ar.reviewCount || ar.ratingCount) || '', vendidos: '' });
      });
    });
  }
  // cartões da busca
  const rc = /<a[^>]+href="([^"]*-i\.(\d+)\.(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = rc.exec(html))) {
    const shop = m[2], item = m[3], bloco = m[4];
    if (vistos[item]) continue;
    const txt = colTexto_(bloco);
    const alt = (bloco.match(/alt="([^"]{8,})"/) || [])[1] || '';
    let nome = colTexto_(alt) || (decodeURIComponent(m[1].replace(/^.*\//, '').replace(/-i\.\d+\.\d+.*$/, '')).replace(/-/g, ' '));
    const precos = (txt.match(/R\$\s*[\d.]+(?:,\d{1,2})?/g) || []).map(shpPreco_).filter(function (x) { return x > 0; });
    if (!nome || !precos.length) continue;
    vistos[item] = 1;
    const img = (bloco.match(/src="(https:[^"]+susercontent[^"]+)"/) || [])[1] || '';
    out.push({ titulo: nome.trim(), preco: Math.min.apply(null, precos), precoOriginal: precos.length > 1 ? Math.max.apply(null, precos) : 0,
               link: 'https://shopee.com.br/product/' + shop + '/' + item, id: item, shopId: shop, foto: img, seller: '', marca: '',
               nota: '', avaliacoes: '', vendidos: shpVend_(txt) });
  }
  return out;
}
function shpParseJson_(txt) {
  let j; try { j = JSON.parse(txt); } catch (e) { return null; }
  const lista = (j && (j.items || (j.data && j.data.items))) || null;
  if (!lista) return null;
  return lista.map(function (w) {
    const it = w.item_basic || w;
    if (!it || !it.name) return null;
    const rc = it.item_rating && it.item_rating.rating_count;
    const div = (it.price || it.price_min || 0) > 1e6 ? 100000 : 1;
    return { titulo: it.name, preco: (it.price || it.price_min || 0) / div,
             precoOriginal: it.price_before_discount ? it.price_before_discount / div : 0,
             link: 'https://shopee.com.br/product/' + it.shopid + '/' + it.itemid, id: String(it.itemid || ''), shopId: String(it.shopid || ''),
             foto: it.image ? 'https://down-br.img.susercontent.com/file/' + it.image : '', seller: it.shop_name || '', marca: it.brand || '',
             nota: it.item_rating ? Math.round(it.item_rating.rating_star * 10) / 10 : '', avaliacoes: Array.isArray(rc) ? rc[0] : '',
             vendidos: it.historical_sold || it.sold || '' };
  }).filter(function (x) { return x && x.preco > 0; });
}
function shpBuscarPor_(metodo, q, pg) {
  const kw = encodeURIComponent(q), p0 = Math.max(0, (pg || 1) - 1);
  if (metodo === 'ddg') return shpBuscaDdg_(q, pg);
  if (metodo === 'seo_google' || metodo === 'seo_bing' || metodo === 'html') {
    const ua = metodo === 'seo_google' ? SHP_UA_BOT : metodo === 'seo_bing' ? SHP_UA_BOT2 : COL_UA;
    const h = shpGet_('https://shopee.com.br/search?keyword=' + kw + (p0 ? '&page=' + p0 : ''), ua, false);
    if (!h.ok) return { ok: false, motivo: h.motivo };
    const itens = shpParseHtml_(h.texto);
    return itens.length ? { ok: true, itens: itens } : { ok: false, motivo: 'página sem produtos (' + Math.round(h.texto.length / 1024) + ' KB)' };
  }
  const url = metodo === 'v4'
    ? 'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=' + kw + '&limit=50&newest=' + (p0 * 50) + '&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2'
    : 'https://shopee.com.br/api/v2/search_items/?by=relevancy&keyword=' + kw + '&limit=50&newest=' + (p0 * 50) + '&order=desc&page_type=search';
  const h = shpGet_(url, COL_UA, true);
  if (!h.ok) return { ok: false, motivo: h.motivo };
  const itens = shpParseJson_(h.texto);
  if (itens && itens.length) return { ok: true, itens: itens };
  let err = ''; try { const j = JSON.parse(h.texto); err = j.error || j.error_msg || ''; } catch (e) {}
  return { ok: false, motivo: itens ? 'sem produtos' : 'bloqueio anti-robô' + (err ? ' (erro ' + err + ')' : '') };
}
function colBuscaShopee_(q, pg) {
  const pp = PropertiesService.getScriptProperties();
  const pref = pp.getProperty('SHOPEE_METODO');
  const ordem = (pref && SHP_METODOS.indexOf(pref) >= 0 ? [pref] : []).concat(SHP_METODOS.filter(function (m) { return m !== pref; }));
  const motivos = [];
  for (let i = 0; i < ordem.length; i++) {
    const r = shpBuscarPor_(ordem[i], q, pg);
    if (r.ok) { if (ordem[i] !== pref) pp.setProperty('SHOPEE_METODO', ordem[i]); r.metodo = ordem[i]; shpCompletarLojas_(r.itens); return r; }
    motivos.push(ordem[i] + ': ' + r.motivo);
  }
  return { ok: false, motivo: 'Shopee bloqueou a leitura — ' + motivos.join(' · '), itens: [] };
}
// Nome da loja: a busca em HTML traz só o código da loja; o nome vem da página pública da loja (uma vez por loja, com cache).
function shpCompletarLojas_(itens) {
  const cache = CacheService.getScriptCache();
  const falta = {}; itens.forEach(function (it) { if (!it.seller && it.shopId) falta[it.shopId] = 1; });
  Object.keys(falta).slice(0, 15).forEach(function (sid) {
    let nome = cache.get('shp_loja_' + sid);
    if (nome === null) {
      nome = '';
      const h = shpGet_('https://shopee.com.br/api/v4/shop/get_shop_base?shopid=' + sid, COL_UA, true);
      if (h.ok) { try { const j = JSON.parse(h.texto); nome = (j.data && (j.data.name || j.data.account && j.data.account.username)) || ''; } catch (e) {} }
      if (!nome) {
        const hp = shpGet_('https://shopee.com.br/shop/' + sid, SHP_UA_BOT, false);
        if (hp.ok) nome = colTexto_(colMatch_(hp.texto, /<title[^>]*>([\s\S]*?)<\/title>/i)).replace(/\s*[|\-–].*shopee.*$/i, '').replace(/^loja (online )?(de |da |do )?/i, '').trim();
        if (hp.ok && !nome) nome = colTexto_(colMatch_(hp.texto, /"(?:name|shop_name|username)"\s*:\s*"([^"]{2,60})"/));
        if (/ofertas incr|shopee brasil|^shopee$/i.test(nome)) nome = '';           // página genérica: não é o nome da loja
      }
      cache.put('shp_loja_' + sid, nome, 21600);
    }
    itens.forEach(function (it) { if (it.shopId === sid && nome) it.seller = nome; });
  });
}
// Comentários: leitura pública de avaliações do produto. Se a Shopee bloquear, a fase segue sem eles.
function colReviewsShopee_(link) {
  const m = String(link || '').match(/product\/(\d+)\/(\d+)/) || String(link || '').match(/i\.(\d+)\.(\d+)/);
  if (!m) return { ok: false, motivo: 'link da Shopee sem código da loja e do produto' };
  const urls = ['https://shopee.com.br/api/v2/item/get_ratings?filter=1&flag=1&itemid=' + m[2] + '&limit=20&offset=0&shopid=' + m[1] + '&type=0',
                'https://shopee.com.br/api/v4/item/get_ratings?filter=1&flag=1&itemid=' + m[2] + '&limit=20&offset=0&shopid=' + m[1] + '&type=0'];
  let motivo = '';
  for (let i = 0; i < urls.length; i++) {
    const h = shpGet_(urls[i], COL_UA, true);
    if (!h.ok) { motivo = h.motivo; continue; }
    let j; try { j = JSON.parse(h.texto); } catch (e) { motivo = 'resposta não é JSON'; continue; }
    const lista = j && j.data && j.data.ratings;
    if (!lista) { motivo = 'sem avaliações na resposta' + (j && j.error ? ' (erro ' + j.error + ')' : ''); continue; }
    return { ok: true, itens: lista.map(function (v) {
      return { id: String(v.cmtid || ''), nota: Number(v.rating_star) || 0, texto: String(v.comment || '').trim(), titulo: '',
               data: v.ctime ? Utilities.formatDate(new Date(v.ctime * 1000), 'America/Sao_Paulo', 'yyyy-MM-dd') : '' };
    }) };
  }
  // plano B: avaliações que a página do produto entrega a robôs de indexação (dados estruturados)
  const hp = shpGet_('https://shopee.com.br/product/' + m[1] + '/' + m[2], SHP_UA_BOT, false);
  if (hp.ok) {
    const ld = colLdProduto_(hp.texto);
    if (ld && ld.reviews && ld.reviews.length) return { ok: true, itens: ld.reviews };
  }
  return { ok: false, motivo: 'avaliações da Shopee: ' + motivo };
}

/* ---------- menu: testar ---------- */
function testarShopee() {
  const linhas = [], q = 'dellamed cadeira de banho';
  SHP_METODOS.forEach(function (m) {
    const r = shpBuscarPor_(m, q, 1);
    linhas.push((r.ok ? 'OK  ' + r.itens.length + ' anúncios' : 'FALHOU ' + r.motivo) + ' — caminho ' + m);
  });
  const r = colBuscaShopee_(q, 1);
  if (r.ok) {
    linhas.push('', 'Caminho escolhido para a coleta: ' + r.metodo);
    r.itens.slice(0, 4).forEach(function (it) { linhas.push('   · ' + it.titulo.slice(0, 45) + ' — R$ ' + it.preco.toFixed(2) + ' — loja ' + (it.seller || 'não identificada') + (it.nota ? ' — nota ' + it.nota : '') + (it.avaliacoes ? ' (' + it.avaliacoes + ' aval.)' : '') + (it.vendidos ? ' — ' + it.vendidos + ' vendidos' : '')); });
    linhas.push('   ' + r.itens.length + ' anúncios · ' + r.itens.filter(function (x) { return x.seller; }).length + ' com loja · ' + r.itens.filter(function (x) { return x.nota; }).length + ' com nota');
    const av = colReviewsShopee_(r.itens[0].link);
    linhas.push(av.ok ? 'OK  Comentários: ' + av.itens.length + ' lidos do 1º anúncio' : 'AVISO  ' + av.motivo + ' (a Shopee entra sem comentários na Voz do cliente)');
  } else {
    linhas.push('', 'Nenhum caminho respondeu hoje. A coleta tenta de novo a cada execução; os outros marketplaces não são afetados.');
  }
  log_('sistema', 'shopee_teste', linhas.join(' | ').slice(0, 480));
  SpreadsheetApp.getUi().alert('Teste da Shopee', linhas.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---------- caminho DuckDuckGo + página do produto ----------
 * A busca da própria Shopee não entrega produtos fora do navegador. O DuckDuckGo (versão HTML, sem JavaScript) devolve os
 * links dos anúncios da Shopee para a busca; cada anúncio é aberto na versão que a Shopee entrega a robôs de indexação,
 * que traz os dados estruturados do produto (nome, preço, nota, avaliações, marca e, quando existe, a loja).
 */
function shpLinksDdg_(html) {
  const out = [], vistos = {};
  const add = function (shop, item, titulo) {
    if (vistos[item]) { if (titulo && !vistos[item].titulo) vistos[item].titulo = titulo; return; }
    vistos[item] = { shop: shop, item: item, titulo: titulo || '' }; out.push(vistos[item]);
  };
  const rx = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m;
  while ((m = rx.exec(html))) {
    let u = m[1]; const ud = u.match(/[?&]uddg=([^&]+)/); if (ud) { try { u = decodeURIComponent(ud[1]); } catch (e) {} }
    const id = u.match(/-i\.(\d+)\.(\d+)/) || u.match(/product\/(\d+)\/(\d+)/);
    if (id) add(id[1], id[2], colTexto_(m[2]).replace(/\s*[|\-–]\s*Shopee.*$/i, ''));
  }
  let t = html; try { t = decodeURIComponent(html.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')); } catch (e) {}
  const rg = /-i\.(\d+)\.(\d+)|shopee\.com\.br\/product\/(\d+)\/(\d+)/g;
  while ((m = rg.exec(t))) add(m[1] || m[3], m[2] || m[4], '');
  return out;
}
function shpLdProduto_(html) {
  let prod = null;
  const rx = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g; let m;
  while ((m = rx.exec(html)) && !prod) {
    let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
    [].concat(j).concat((j && j['@graph']) || []).forEach(function (n) {
      if (!prod && n && (n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].indexOf('Product') >= 0))) prod = n;
    });
  }
  const meta = function (k) { return colMatch_(html, new RegExp('<meta[^>]+(?:property|name)="' + k + '"[^>]+content="([^"]*)"', 'i')) || colMatch_(html, new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + k + '"', 'i')); };
  if (!prod) {
    const nome = colTexto_(meta('og:title')), preco = colNum_(meta('product:price:amount'));
    return nome && preco ? { titulo: nome, preco: preco, foto: meta('og:image') } : null;
  }
  const of = Array.isArray(prod.offers) ? prod.offers[0] : (prod.offers || {});
  const ofs = of && of.offers ? (Array.isArray(of.offers) ? of.offers[0] : of.offers) : of;
  const pv = function (x) { const n = Number(String(x == null ? '' : x).replace(',', '.')); return isFinite(n) ? n : 0; };
  const preco = pv((ofs && (ofs.price || ofs.lowPrice)) || (of && (of.price || of.lowPrice)));
  const ar = prod.aggregateRating || {};
  return { titulo: colTexto_(String(prod.name || '')), preco: preco,
           precoOriginal: pv(of && of.highPrice) > preco ? 0 : 0,
           foto: [].concat(prod.image || [])[0] || meta('og:image') || '',
           marca: prod.brand ? colTexto_(String(prod.brand.name || prod.brand)) : '',
           seller: (ofs && ofs.seller && ofs.seller.name) || (of && of.seller && of.seller.name) || '',
           nota: ar.ratingValue ? Math.round(pv(ar.ratingValue) * 10) / 10 : '', avaliacoes: Number(ar.reviewCount || ar.ratingCount) || '' };
}
function shpProduto_(shop, item) {
  const cache = CacheService.getScriptCache(), k = 'shp_p_' + item;
  const c = cache.get(k); if (c) { try { return JSON.parse(c); } catch (e) {} }
  const h = shpGet_('https://shopee.com.br/product/' + shop + '/' + item, SHP_UA_BOT, false);
  if (!h.ok) return null;
  const d = shpLdProduto_(h.texto);
  if (!d || !d.preco) return null;
  if (!d.seller) d.seller = colTexto_(colMatch_(h.texto, /"(?:shop_name|shopName|shop_username)"\s*:\s*"([^"]{2,60})"/));
  d.vendidos = shpVend_(colTexto_(h.texto.replace(/<script[\s\S]*?<\/script>/g, ' ')).slice(0, 300000));
  try { cache.put(k, JSON.stringify(d), 21600); } catch (e) {}
  return d;
}
function shpBuscaDdg_(q, pg) {
  if (pg > 1) return { ok: true, itens: [] };                                      // DuckDuckGo HTML: uma página por busca
  const h = shpGet_('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q + ' site:shopee.com.br') + '&kl=br-pt', COL_UA, false);
  if (!h.ok) return { ok: false, motivo: 'DuckDuckGo: ' + h.motivo };
  const links = shpLinksDdg_(h.texto);
  if (!links.length) return /no results|nenhum resultado|No  results/i.test(h.texto) ? { ok: true, itens: [] }
    : { ok: false, vazio: /anomaly|captcha|bots use/i.test(h.texto) ? false : true, motivo: 'DuckDuckGo sem anúncios da Shopee (' + Math.round(h.texto.length / 1024) + ' KB)' };
  const itens = [], t0 = Date.now(); let falhas = 0;
  links.slice(0, SHP_MAX_POR_BUSCA).forEach(function (l) {
    if (Date.now() - t0 > 60000 || falhas >= 4) return;
    const d = shpProduto_(l.shop, l.item);
    if (!d) { falhas++; return; }
    itens.push({ titulo: d.titulo || l.titulo, preco: d.preco, precoOriginal: d.precoOriginal || 0, link: 'https://shopee.com.br/product/' + l.shop + '/' + l.item,
                 id: l.item, shopId: l.shop, foto: d.foto || '', seller: d.seller || '', marca: d.marca || '', nota: d.nota || '',
                 avaliacoes: d.avaliacoes || '', vendidos: d.vendidos || '' });
  });
  return itens.length ? { ok: true, itens: itens } : { ok: false, motivo: links.length + ' anúncios achados, mas a página do produto não trouxe preço' };
}


/* ================= SHOPEE na Voz do cliente — comentários do portal Voz do cliente =================
 * O site da Shopee não entrega os produtos fora do navegador. Os comentários da Shopee já coletados pelo portal
 * "Voz do cliente · Dellamed" (vitrines públicas) são lidos das páginas públicas dele, sem chave nem cadastro:
 *   - página inicial do portal: comentários com produto, marca, categoria e se o anúncio é Dellamed
 *   - dossiê de cada produto no portal "eu seller": até 40 comentários por produto e canal
 * Só a Shopee entra por aqui; Mercado Livre, Amazon e Magalu seguem vindo da coleta própria.
 */
const VC_PORTAL = 'https://portal-voz-cliente.vercel.app/';
const VC_DOSSIE = 'https://eu-seller-ka.vercel.app/produto/';
function vcpRegistros_(html) {
  const t = String(html || '').replace(/\\"/g, '"'), out = [];
  const rx = /\{"(?:id|url)":"[^{}]*?"canal":"[^"]+"[^{}]*\}/g; let m;
  while ((m = rx.exec(t))) { try { out.push(JSON.parse(m[0])); } catch (e) {} }
  return out;
}
function vcpData_(d) { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
function colShopeePortal_(ctx) {
  const t0 = Date.now();
  const home = colFetchSimples_(VC_PORTAL);
  if (!home.ok) { log_('sistema', 'shopee_portal_falha', 'Portal Voz do cliente: ' + home.motivo); return; }
  const regs = vcpRegistros_(home.texto);
  const porSku = {};                                          // sku do portal → produto, categoria
  regs.forEach(function (r) {
    if (r.sku && !porSku[r.sku]) porSku[r.sku] = { produto: r.produto, categoria: r.categoria, img: '' };
    if (r.sku && r.image_url && !porSku[r.sku].img) porSku[r.sku].img = /^https?:/.test(r.image_url) ? r.image_url : VC_PORTAL.replace(/\/$/, '') + r.image_url;
  });
  const lista = regs.filter(function (r) { return r.canal === 'Shopee'; }).map(function (r) {
    return { sku: r.sku, url: r.url || r.fonte_url, data: r.data, nota: r.nota, texto: r.texto, titulo: r.titulo, fonte: r.fonte, della: r.della, marca: r.marca };
  });
  Object.keys(porSku).forEach(function (k) {                  // dossiês: mais comentários por produto
    if (Date.now() - t0 > 3.5 * 60 * 1000) return;
    const h = colFetchSimples_(VC_DOSSIE + encodeURIComponent(k));
    if (!h.ok) return;
    vcpRegistros_(h.texto).filter(function (r) { return r.canal === 'Shopee' && r.texto; }).forEach(function (r) {
      lista.push({ sku: k, url: r.url || r.fonte_url, data: r.data, nota: r.nota, texto: r.texto, titulo: r.titulo, fonte: r.fonte, della: null, marca: '' });
    });
  });
  if (!ctx.jaAval) { ctx.jaAval = {}; lerAba_('AVALIACOES').forEach(function (r) { ctx.jaAval[str_(r.review_id)] = 1; }); }
  let ixP = null; try { ixP = colIndiceProdutos_(); } catch (e) {}
  const base = {}; try { lerAba_('PRODUTOS_BASE').forEach(function (r) { base[str_(r.sku)] = r; }); } catch (e) {}
  const novas = [], fotoPorId = {};
  lista.forEach(function (v) {
    const nota = Math.round(Number(v.nota) || 0), texto = String(v.texto || '').trim();
    if (!texto || nota < 1 || nota > 5 || !v.url) return;
    const id = 'SHO-' + colHash_(v.url + '|' + texto.slice(0, 120) + '|' + nota + '|' + (v.data || ''));
    const ehDm0 = v.della === true || /dellamed/i.test(String(v.fonte || '')) || /dellamed/i.test(String(v.marca || ''));
    if (ctx.jaAval[id]) { if (ehDm0 && porSku[v.sku] && porSku[v.sku].img) fotoPorId[id] = porSku[v.sku].img; return; }
    ctx.jaAval[id] = 1;
    const p = porSku[v.sku] || {}, fonte = String(v.fonte || '');
    const ehDm = v.della === true || /dellamed/i.test(fonte) || /dellamed/i.test(String(v.marca || ''));
    let marca = ehDm ? 'Dellamed' : (v.marca && !/^outros$/i.test(v.marca) ? colNomeMarca_(v.marca) : colMarcaReconhecida_('', fonte));
    let sku = '', produto = ehDm ? (p.produto || fonte) : (fonte || p.produto), categoria = p.categoria || colCategoria_(fonte);
    if (ehDm && ixP) {                                         // produto Dellamed: usa o nome da loja oficial (mesmo produto do painel)
      const k = ixpMelhor(ixP, (p.produto || '') + ' ' + fonte, 0);
      if (k && base[k]) { sku = k; produto = str_(base[k].produto); categoria = str_(base[k].categoria) || categoria; }
    }
    const ids = String(v.url).match(/product\/(\d+)\/(\d+)/) || String(v.url).match(/i\.(\d+)\.(\d+)/);
    novas.push({ review_id: id, data: vcpData_(v.data), marketplace: 'Shopee', marca: marca, categoria: categoria, sku: sku, produto: produto,
                 nota_1a5: nota, titulo: String(v.titulo || ''), texto: texto.slice(0, 2000), link: v.url,
                 foto: (sku && base[sku] && str_(base[sku].foto)) || (ehDm && p.img) || '',          // Dellamed: foto da loja oficial ou do portal
                 item_id: ids ? ids[2] : '', origem: 'COLETA' });
  });
  if (novas.length) appendObjs_('AVALIACOES', novas);
  // comentários Dellamed já gravados sem foto: completa com a foto do produto
  try {
    if (Object.keys(fotoPorId).length) {
      const sh = aba_('AVALIACOES'), vv = sh.getDataRange().getValues(), hh = vv[0].map(function (x) { return String(x).trim().toLowerCase(); });
      const iId = hh.indexOf('review_id'), iF = hh.indexOf('foto');
      for (let r = 1; r < vv.length; r++) { const f = fotoPorId[String(vv[r][iId])]; if (f && !vv[r][iF]) sh.getRange(r + 1, iF + 1).setValue(f); }
    }
  } catch (e) {}
  try { invalidarDados_(); } catch (e) {}                                // painel passa a ler a planilha de novo (sem isso, mostra a versão guardada em cache)
  log_('sistema', 'shopee_portal', novas.length + ' comentários novos da Shopee (de ' + lista.length + ' lidos no portal Voz do cliente)');
}
function testarShopeeComentarios() {
  const ctx = { bloqueados: {}, falhas: {} };
  const antes = lerAba_('AVALIACOES').filter(function (r) { return str_(r.marketplace) === 'Shopee'; }).length;
  colShopeePortal_(ctx);
  const depois = lerAba_('AVALIACOES').filter(function (r) { return str_(r.marketplace) === 'Shopee'; }).length;
  SpreadsheetApp.getUi().alert('Comentários da Shopee', (depois - antes) + ' comentários novos da Shopee gravados na aba AVALIACOES (total da Shopee: ' + depois + ').\nAbra o painel e clique em Atualizar para ver na Voz do cliente.', SpreadsheetApp.getUi().ButtonSet.OK);
}
