/************************************************************
 * MERCADO LIVRE — leitura do site inteiro via API oficial
 *
 * Usa o app que a Dellamed JÁ TEM registrado no Mercado Livre
 * (nada novo é criado). Qualquer conta do Mercado Livre pode
 * autorizar; não precisa ser a conta da loja oficial.
 *
 * O que a leitura das 8h traz, em 4 fases:
 *   1. loja        loja oficial Dellamed: preço base, foto, link, categoria, Buy Box
 *   2. sellers     todos os anúncios de "Dellamed + modelo" no ML inteiro, de qualquer vendedor
 *   3. concorrentes os anúncios mais relevantes de cada categoria em que a Dellamed vende,
 *                  de todas as outras marcas (preço, foto, nota, nº de avaliações)
 *   4. avaliacoes  avaliações novas de produtos Dellamed (loja e terceiros) e dos concorrentes
 *
 * Propriedades do script (Configurações do projeto › Propriedades do script):
 *   ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI   copiados do app que já existe
 *   ML_LOJA_ID                (opcional) ID do vendedor da loja oficial; se vazio, é descoberto sozinho
 *   ML_CONC_POR_CATEGORIA     (opcional) anúncios de concorrentes por categoria; padrão 50, máx. 200
 * Tokens, fase e cursor são gravados automaticamente. Nada disso aparece no HTML.
 ************************************************************/

const ML_API = 'https://api.mercadolibre.com';
const ML_LIMITE_MS = 4.5 * 60 * 1000;   // pausa antes do limite de 6 min e agenda a continuação
const ML_FASES = ['loja', 'sellers', 'concorrentes', 'avaliacoes'];

/* ---------- conexão (uma vez, com qualquer conta do ML) ---------- */
function mlMostrarLinkAutorizacao() {
  const p = PropertiesService.getScriptProperties();
  const id = mlProp_('ML_CLIENT_ID'), redir = mlProp_('ML_REDIRECT_URI');
  const ui = SpreadsheetApp.getUi();
  const faltam = ['ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REDIRECT_URI'].filter(function (k) { return !mlProp_(k); });
  if (faltam.length) {
    const tem = Object.keys(p.getProperties());
    ui.alert('Faltam nas propriedades DESTE projeto: ' + faltam.join(', ') +
      '\n\nPropriedades que este projeto enxerga: ' + (tem.length ? tem.join(', ') : '(nenhuma)') +
      '\n\nSe você já cadastrou e elas não aparecem aqui, foram salvas em outro projeto do Apps Script. Abra o editor pela planilha (Extensões › Apps Script) e cadastre lá.');
    return;
  }
  const url = 'https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=' + encodeURIComponent(id) +
              '&redirect_uri=' + encodeURIComponent(redir);
  const r = ui.prompt('Conectar Mercado Livre',
    '1) Abra este link logada em QUALQUER conta do Mercado Livre:\n' + url +
    '\n\n2) Autorize. Você será levada para ' + redir + '?code=TG-...\n3) Cole abaixo o endereço inteiro ou só o código TG-...:',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const code = r.getResponseText().trim().replace(/^.*code=/, '').replace(/&.*$/, '');
  const tok = mlPostToken_({ grant_type: 'authorization_code', code: code, redirect_uri: redir });
  p.setProperty('ML_USER_ID', String(tok.user_id));
  let loja = '';
  try { loja = mlLojaId_(); } catch (e) {}
  ui.alert('Conectado.' + (loja ? ' Loja oficial Dellamed encontrada (ID ' + loja + ').' :
    ' Não encontrei a loja oficial sozinha: cadastre ML_LOJA_ID nas propriedades do script.') +
    '\nAgora rode "Mercado Livre: sincronizar agora".');
}

function mlPostToken_(extra) {
  const p = PropertiesService.getScriptProperties();
  const payload = Object.assign({ client_id: mlProp_('ML_CLIENT_ID'), client_secret: mlProp_('ML_CLIENT_SECRET') }, extra);
  const res = UrlFetchApp.fetch(ML_API + '/oauth/token', { method: 'post', payload: payload, muteHttpExceptions: true,
    headers: { accept: 'application/json' } });
  const j = JSON.parse(res.getContentText() || '{}');
  if (!j.access_token) throw new Error('Mercado Livre recusou o token: ' + (j.message || res.getResponseCode()));
  if (j.refresh_token) p.setProperty('ML_REFRESH_TOKEN', j.refresh_token);   // o ML troca o refresh token a cada uso
  else if (extra.grant_type === 'authorization_code')
    throw new Error('O Mercado Livre conectou, mas não entregou o token de renovação. No app, em Fluxos OAuth, marque "Refresh Token", salve e conecte de novo.');
  CacheService.getScriptCache().put('ml_access', j.access_token, Math.min(21000, (j.expires_in || 21600) - 300));
  return j;
}
function mlToken_() {
  const c = CacheService.getScriptCache().get('ml_access');
  if (c) return c;
  const rt = PropertiesService.getScriptProperties().getProperty('ML_REFRESH_TOKEN');
  if (!rt) throw new Error('Mercado Livre ainda não conectado: falta o token. Na PLANILHA (não no editor), use o menu Diagnóstico › Mercado Livre: conectar conta, cole o endereço com code=TG-... e clique OK. Só depois rode a sincronização.');
  return mlPostToken_({ grant_type: 'refresh_token', refresh_token: rt }).access_token;
}
function mlGet_(path) {
  for (let t = 0; t < 4; t++) {
    const res = UrlFetchApp.fetch(ML_API + path, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + mlToken_() } });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 401) { CacheService.getScriptCache().remove('ml_access'); continue; }
    if (code === 429 || code >= 500) { Utilities.sleep(1500 * (t + 1)); continue; }
    return null;                                               // 403/404: item sem acesso, segue
  }
  return null;
}

// Descobre o vendedor da loja oficial Dellamed.
// Ordem: ML_LOJA_ID (se cadastrado) → busca pela loja oficial 54302 (ML_OFICIAL_STORE_ID) → anúncio de referência → busca por marca.
const ML_OFICIAL_STORE_PADRAO = '54302';        // loja oficial Dellamed no ML (mercadolivre.com.br/loja/dellamed)
const ML_ITEM_REFERENCIA = 'MLB5724160550';     // anúncio da loja oficial, usado só como plano B
function mlLojaId_() {
  const p = PropertiesService.getScriptProperties();
  const fixo = mlProp_('ML_LOJA_ID');
  if (fixo) return fixo;
  const store = mlProp_('ML_OFICIAL_STORE_ID') || ML_OFICIAL_STORE_PADRAO;
  let sid = '';
  const r1 = mlGet_('/sites/MLB/search?official_store_id=' + store + '&limit=1');
  if (r1 && r1.results && r1.results[0] && r1.results[0].seller) sid = String(r1.results[0].seller.id || '');
  if (!sid) {
    const it = mlGet_('/items/' + ML_ITEM_REFERENCIA);
    if (it && it.seller_id) sid = String(it.seller_id);
  }
  if (!sid) {
    const r = mlGet_('/sites/MLB/search?q=dellamed&limit=50');
    const cont = {};
    ((r && r.results) || []).forEach(function (x) {
      const s = x.seller && x.seller.id;
      if (s && String(x.official_store_id || '') === store) cont[s] = (cont[s] || 0) + 1;
    });
    sid = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; })[0] || '';
  }
  if (sid) p.setProperty('ML_LOJA_ID', sid);
  return sid;
}

/* ---------- teste de acesso (menu: Mercado Livre: testar acesso) ---------- */
// Mostra o código de resposta de cada tipo de consulta que a leitura usa. Não grava nada.
function mlTestarAcesso() {
  const loja = mlProp_('ML_LOJA_ID') || '480263032';
  const testes = [
    ['Conta autorizada', '/users/me'],
    ['Vendedor da loja', '/users/' + loja],
    ['Anúncios da loja', '/sites/MLB/search?seller_id=' + loja + '&limit=1'],
    ['Loja oficial 54302', '/sites/MLB/search?official_store_id=54302&limit=1'],
    ['Busca geral', '/sites/MLB/search?q=cadeira%20de%20banho&limit=1'],
    ['Categoria', '/sites/MLB/search?category=MLB264586&limit=1'],
    ['Anúncio', '/items/' + ML_ITEM_REFERENCIA],
    ['Avaliações', '/reviews/item/' + ML_ITEM_REFERENCIA + '?limit=1']
  ];
  const linhas = testes.map(function (t) {
    let cod, msg = '';
    try {
      const res = UrlFetchApp.fetch(ML_API + t[1], { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + mlToken_() } });
      cod = res.getResponseCode();
      if (cod !== 200) { try { const j = JSON.parse(res.getContentText()); msg = ' ' + (j.message || j.error || ''); } catch (e) {} }
    } catch (e) { cod = 'erro'; msg = ' ' + e.message; }
    return (cod === 200 ? 'OK  ' : 'FALHOU ' + cod) + ' — ' + t[0] + msg;
  });
  log_('sistema', 'ml_teste_acesso', linhas.join(' | ').slice(0, 480));
  SpreadsheetApp.getUi().alert('Teste de acesso ao Mercado Livre', linhas.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---------- agendamento ---------- */
function instalarGatilhoML() {
  ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getHandlerFunction() === 'sincronizarMercadoLivre') ScriptApp.deleteTrigger(g); });
  ScriptApp.newTrigger('sincronizarMercadoLivre').timeBased().everyDays(1).atHour(8).inTimezone('America/Sao_Paulo').create();
  SpreadsheetApp.getActive().toast('Sincronização diária agendada para as 8h (horário de Brasília).');
}

/* ---------- sincronização em fases, retomável ---------- */
function sincronizarMercadoLivre() {
  const inicio = Date.now();
  const p = PropertiesService.getScriptProperties();
  const cont = p.getProperty('ML_CONT_TRIGGER');                // apaga o gatilho de continuação já usado
  if (cont) {
    ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getUniqueId() === cont) ScriptApp.deleteTrigger(g); });
    p.deleteProperty('ML_CONT_TRIGGER');
  }
  const loja = mlLojaId_();
  if (!loja) throw new Error('Loja oficial Dellamed não encontrada. Cadastre ML_LOJA_ID nas propriedades do script.');

  let fase = p.getProperty('ML_FASE') || 'loja';
  let cursor = Number(p.getProperty('ML_CURSOR') || 0);
  const ctx = { loja: loja, usuarios: {} };
  let feitos = 0;                                               // garante avanço de pelo menos 1 tarefa por execução

  const puladas = [];
  while (fase) {
    if (cursor === 0 && !mlFasePermitida_(fase, loja)) {        // sem permissão: não apaga nada, só pula
      puladas.push(fase);
      log_('sistema', 'ml_fase_sem_permissao', fase + ': o Mercado Livre recusou (403). Dados anteriores mantidos.');
      fase = ML_FASES[ML_FASES.indexOf(fase) + 1] || '';
      p.setProperty('ML_FASE', fase); p.setProperty('ML_CURSOR', '0');
      continue;
    }
    const tarefas = mlTarefas_(fase);
    for (let i = cursor; i < tarefas.length; i++) {
      if (feitos > 0 && Date.now() - inicio > ML_LIMITE_MS) {   // pausa e continua em 1 minuto
        p.setProperty('ML_FASE', fase); p.setProperty('ML_CURSOR', String(i));
        const g = ScriptApp.newTrigger('sincronizarMercadoLivre').timeBased().after(60 * 1000).create();
        p.setProperty('ML_CONT_TRIGGER', g.getUniqueId());
        log_('sistema', 'ml_sync_pausa', fase + ' ' + i + ' de ' + tarefas.length);
        return;
      }
      mlExecutar_(fase, tarefas[i], i, ctx);
      feitos++;
    }
    log_('sistema', 'ml_fase_ok', fase + ' (' + tarefas.length + ')');
    fase = ML_FASES[ML_FASES.indexOf(fase) + 1] || '';
    cursor = 0;
    p.setProperty('ML_FASE', fase); p.setProperty('ML_CURSOR', '0');
  }
  p.deleteProperty('ML_FASE'); p.deleteProperty('ML_CURSOR');
  const msg = puladas.length === ML_FASES.length
    ? 'Nada foi lido: o Mercado Livre recusou todas as consultas. Autorize o app com a conta da loja oficial (conectar conta) e rode testar acesso.'
    : puladas.length ? 'Lido, exceto: ' + puladas.join(', ') + ' (sem permissão do Mercado Livre)' : 'Mercado Livre lido por completo';
  log_('sistema', puladas.length === ML_FASES.length ? 'ml_sync_sem_dados' : 'ml_sync_ok', msg);
  try { SpreadsheetApp.getActive().toast(msg, 'Mercado Livre', 15); } catch (e) {}
}

// Testa, antes de cada fase, se o Mercado Livre libera o tipo de consulta que ela usa.
function mlCodigo_(path) {
  try {
    return UrlFetchApp.fetch(ML_API + path, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + mlToken_() } }).getResponseCode();
  } catch (e) { return 0; }
}
function mlFasePermitida_(fase, loja) {
  if (fase === 'loja') return mlCodigo_('/users/' + loja + '/items/search?limit=1') === 200 ||
                              mlCodigo_('/sites/MLB/search?seller_id=' + loja + '&limit=1') === 200;
  if (fase === 'sellers' || fase === 'concorrentes') return mlCodigo_('/sites/MLB/search?q=dellamed&limit=1') === 200;
  if (fase === 'avaliacoes') {
    const it = (lerAba_('ANUNCIOS').filter(function (r) { return /^MLB/i.test(str_(r.item_id)); })[0] || {}).item_id || ML_ITEM_REFERENCIA;
    return mlCodigo_('/reviews/item/' + it + '?limit=1') === 200;
  }
  return true;
}

// Lista de tarefas de cada fase, sempre recalculada a partir da planilha (nada grande fica guardado).
function mlTarefas_(fase) {
  if (fase === 'loja') return ['loja'];
  const base = lerAba_('PRODUTOS_BASE').filter(function (r) { return String(r.origem) === 'ML_API'; });
  if (fase === 'sellers') return base.map(function (r) { return { sku: str_(r.sku), titulo: str_(r.produto), categoria: str_(r.categoria) }; });
  if (fase === 'concorrentes') {
    const cats = {};
    base.forEach(function (r) { if (r.categoria_id) cats[str_(r.categoria_id)] = str_(r.categoria); });
    return Object.keys(cats).sort().map(function (id) { return { id: id, nome: cats[id] }; });
  }
  if (fase === 'avaliacoes') {
    const ids = {};
    lerAba_('ANUNCIOS').forEach(function (r) { const id = str_(r.item_id); if (/^MLB/i.test(id)) ids[id] = 1; });
    lerAba_('CONCORRENTES').forEach(function (r) { const id = str_(r.item_id); if (/^MLB/i.test(id)) ids[id] = 1; });
    return Object.keys(ids).sort();
  }
  return [];
}

function mlExecutar_(fase, t, i, ctx) {
  if (fase === 'loja') return mlFaseLoja_(ctx.loja);
  if (fase === 'sellers') {
    if (i === 0) removerOrigem_('ANUNCIOS', 'ML_API', function (r) { return str_(r.seller) !== 'DELLAMED'; });
    const linhas = mlSellersDoProduto_(t, ctx);
    if (linhas.length) appendObjs_('ANUNCIOS', linhas);
    return;
  }
  if (fase === 'concorrentes') {
    if (i === 0) removerOrigem_('CONCORRENTES', 'ML_API');
    const linhas = mlConcorrentesDaCategoria_(t, ctx.loja);
    if (linhas.length) appendObjs_('CONCORRENTES', linhas);
    return;
  }
  if (fase === 'avaliacoes') mlAvaliacoesDoItem_(t, ctx);
}

/* ---------- fase 1: loja oficial ---------- */
function mlFaseLoja_(loja) {
  const ids = [];
  const dono = mlCodigo_('/users/' + loja + '/items/search?limit=1') === 200;   // autorizado pela conta da loja
  for (let off = 0; off < 1000; off += 50) {
    const r = dono ? mlGet_('/users/' + loja + '/items/search?status=active&limit=50&offset=' + off)
                   : mlGet_('/sites/MLB/search?seller_id=' + loja + '&limit=50&offset=' + off);
    const res = (r && r.results) || [];
    res.forEach(function (it) { ids.push(typeof it === 'string' ? it : it.id); });
    if (!res.length || ids.length >= ((r.paging && r.paging.total) || 0)) break;
  }
  if (!ids.length) { log_('sistema', 'ml_loja_vazia', 'Nenhum anúncio retornado; dados anteriores mantidos.'); return; }
  const out = [], cats = {};
  for (let i = 0; i < ids.length; i += 20) {
    const r = mlGet_('/items?ids=' + ids.slice(i, i + 20).join(',') +
      '&attributes=id,title,price,permalink,pictures,thumbnail,category_id,seller_custom_field,attributes,catalog_product_id,sold_quantity');
    (r || []).forEach(function (w) {
      const it = w.body; if (!it || w.code !== 200) return;
      if (!cats[it.category_id]) { const c = mlGet_('/categories/' + it.category_id); cats[it.category_id] = c ? c.name : ''; }
      let bb = false;
      if (it.catalog_product_id) {
        const pr = mlGet_('/products/' + it.catalog_product_id);
        bb = !!(pr && pr.buy_box_winner && String(pr.buy_box_winner.seller_id) === String(loja));
      }
      out.push({ id: it.id, sku: it.seller_custom_field || mlAttr_(it, 'SELLER_SKU') || mlAttr_(it, 'MODEL') || it.id,
                 titulo: it.title, preco: it.price, link: it.permalink, foto: mlFoto_(it), categoria: cats[it.category_id],
                 categoria_id: it.category_id, vendidos: it.sold_quantity || '', buybox: bb });
    });
  }
  if (!out.length) { log_('sistema', 'ml_loja_vazia', 'Anúncios sem detalhe; dados anteriores mantidos.'); return; }
  substituirOrigem_('PRODUTOS_BASE', 'ML_API', out.map(function (x) {
    return { sku: x.sku, produto: x.titulo, categoria: x.categoria, linha: '', preco_base: x.preco, link_oficial: x.link,
             origem: 'ML_API', foto: x.foto, mlb_id: x.id, categoria_id: x.categoria_id };
  }));
  substituirOrigem_('ANUNCIOS', 'ML_API', out.map(function (x) {
    return { data_captura: new Date(), marketplace: 'Mercado Livre', seller: 'DELLAMED', sku: x.sku, titulo: x.titulo, preco: x.preco,
             link: x.link, reputacao_0a5: 5, avaliacoes: '', vendidos: x.vendidos, ganha_buybox: x.buybox ? 'Sim' : 'Não',
             origem: 'ML_API', foto: x.foto, item_id: x.id };
  }));
}

/* ---------- fase 2: sellers com produto Dellamed no ML inteiro ---------- */
function mlSellersDoProduto_(prod, ctx) {
  const rx = /\b[A-Z]{1,4}-?\d{1,5}[A-Z]*\b/i;
  const cod = (String(prod.sku).match(rx) || String(prod.titulo).match(rx) || [''])[0];
  const q = 'Dellamed ' + (cod || String(prod.titulo).split(' ').slice(0, 5).join(' '));
  const linhas = [], vistos = {};
  for (let off = 0; off < 150; off += 50) {                    // até 150 anúncios por modelo, de qualquer vendedor
    const r = mlGet_('/sites/MLB/search?q=' + encodeURIComponent(q) + '&limit=50&offset=' + off);
    const res = (r && r.results) || [];
    res.forEach(function (it) {
      const sid = String((it.seller && it.seller.id) || '');
      if (!sid || sid === String(ctx.loja) || vistos[it.id]) return;
      const titulo = String(it.title || '');
      if (!/dellamed/i.test(titulo + ' ' + mlMarca_(it))) return;                                   // só produto Dellamed
      if (cod && titulo.toUpperCase().replace(/-/g, '').indexOf(cod.toUpperCase().replace(/-/g, '')) < 0) return; // mesmo modelo
      vistos[it.id] = 1;
      if (!ctx.usuarios[sid]) ctx.usuarios[sid] = mlGet_('/users/' + sid) || {};
      const u = ctx.usuarios[sid], rep = u.seller_reputation || {};
      let bb = 'Não';
      if (it.catalog_product_id) {
        const k = 'bb_' + it.catalog_product_id;
        if (ctx[k] === undefined) { const pr = mlGet_('/products/' + it.catalog_product_id); ctx[k] = pr && pr.buy_box_winner ? String(pr.buy_box_winner.seller_id) : ''; }
        if (ctx[k] === sid) bb = 'Sim';
      }
      linhas.push({ data_captura: new Date(), marketplace: 'Mercado Livre', seller: u.nickname || (it.seller && it.seller.nickname) || sid,
                    sku: prod.sku, titulo: titulo, preco: it.price, link: it.permalink,
                    reputacao_0a5: Number(String(rep.level_id || '').charAt(0)) || 0,
                    avaliacoes: '', vendidos: it.sold_quantity || '', ganha_buybox: bb, origem: 'ML_API', foto: mlFoto_(it), item_id: it.id });
    });
    if (!res.length || off + 50 >= ((r.paging && r.paging.total) || 0)) break;
  }
  return linhas;
}

/* ---------- fase 3: concorrentes da categoria no ML inteiro ---------- */
function mlConcorrentesDaCategoria_(cat, loja) {
  const max = Math.min(200, Number(PropertiesService.getScriptProperties().getProperty('ML_CONC_POR_CATEGORIA') || 50));
  const linhas = [];
  for (let off = 0; off < max; off += 50) {
    const r = mlGet_('/sites/MLB/search?category=' + cat.id + '&limit=' + Math.min(50, max - off) + '&offset=' + off);
    const res = (r && r.results) || [];
    res.forEach(function (it) {
      const marca = mlMarca_(it);
      if (String(it.seller && it.seller.id) === String(loja) || /dellamed/i.test(marca + ' ' + it.title)) return;
      const rv = mlGet_('/reviews/item/' + it.id + '?limit=1') || {};
      linhas.push({ categoria: cat.nome, marca: marca || 'Sem marca', produto: it.title, marketplace: 'Mercado Livre', preco: it.price,
                    nota_0a5: rv.rating_average ? Math.round(rv.rating_average * 10) / 10 : '',
                    avaliacoes: rv.paging ? rv.paging.total : '', vendidos: it.sold_quantity || '', link: it.permalink,
                    pontos_fortes: '', pontos_fracos: '', origem: 'ML_API', foto: mlFoto_(it), item_id: it.id });
    });
    if (!res.length || off + 50 >= ((r.paging && r.paging.total) || 0)) break;
  }
  return linhas;
}

/* ---------- fase 4: avaliações (Voz do cliente) ---------- */
// Dellamed: até 200 avaliações por anúncio; concorrentes: as 50 mais recentes. Só acrescenta as novas.
// As abas são lidas uma vez por execução (ctx), não a cada anúncio.
function mlAvaliacoesDoItem_(id, ctx) {
  if (!ctx.alvos) {
    ctx.ja = {}; ctx.alvos = {};
    lerAba_('AVALIACOES').forEach(function (r) { ctx.ja[str_(r.review_id)] = 1; });
    const base = {};
    lerAba_('PRODUTOS_BASE').forEach(function (r) { base[str_(r.sku)] = r; });
    lerAba_('CONCORRENTES').forEach(function (r) {
      const k = str_(r.item_id); if (!k) return;
      ctx.alvos[k] = { marca: str_(r.marca), categoria: str_(r.categoria), sku: '', produto: str_(r.produto), link: str_(r.link), foto: str_(r.foto), max: 50 };
    });
    lerAba_('ANUNCIOS').forEach(function (r) {
      const k = str_(r.item_id); if (!k) return;
      const b = base[str_(r.sku)] || {};
      ctx.alvos[k] = { marca: 'Dellamed', categoria: str_(b.categoria), sku: str_(r.sku), produto: str_(b.produto || r.titulo), link: str_(r.link), foto: str_(r.foto), max: 200 };
    });
  }
  const alvo = ctx.alvos[id];
  if (!alvo) return;
  const novas = [];
  for (let off = 0; off < alvo.max; off += 50) {
    const r = mlGet_('/reviews/item/' + id + '?limit=50&offset=' + off);
    const lista = (r && r.reviews) || [];
    lista.forEach(function (v) {
      const rid = 'ML-' + v.id;
      if (ctx.ja[rid]) return; ctx.ja[rid] = 1;
      novas.push({ review_id: rid, data: v.date_created ? new Date(v.date_created) : '', marketplace: 'Mercado Livre', marca: alvo.marca,
                   categoria: alvo.categoria, sku: alvo.sku, produto: alvo.produto, nota_1a5: v.rate, titulo: v.title || '',
                   texto: v.content || '', link: alvo.link, foto: alvo.foto, item_id: id, origem: 'ML_API' });
    });
    if (!lista.length || !r.paging || off + 50 >= r.paging.total) break;
  }
  appendObjs_('AVALIACOES', novas);
}

/* ---------- auxiliares ---------- */
// Lê uma propriedade tolerando espaços e maiúsculas/minúsculas no nome e espaços no valor.
function mlProp_(nome) {
  const todas = PropertiesService.getScriptProperties().getProperties();
  const k = Object.keys(todas).filter(function (x) { return x.trim().toUpperCase() === nome; })[0];
  return k ? String(todas[k]).trim() : '';
}
function mlAttr_(it, id) { const a = (it.attributes || []).filter(function (x) { return x.id === id; })[0]; return a ? (a.value_name || '') : ''; }
function mlMarca_(it) { return mlAttr_(it, 'BRAND'); }
function mlFoto_(it) {
  const p = it.pictures && it.pictures[0];
  const u = (p && (p.secure_url || p.url)) || it.thumbnail || '';
  return u.replace(/^http:/, 'https:').replace(/-I\.(jpg|webp)$/, '-O.$1');
}
function substituirOrigem_(nome, origem, objs) {
  removerOrigem_(nome, origem);
  appendObjs_(nome, objs);
}
// Remove as linhas de uma origem; com filtro, remove só as que passarem nele.
function removerOrigem_(nome, origem, filtro) {
  const sh = aba_(nome);
  const v = sh.getDataRange().getValues();
  const h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
  const col = h.indexOf('origem');
  const manter = [v[0]].concat(v.slice(1).filter(function (r) {
    if (String(r[col]) !== origem) return true;
    if (!filtro) return false;
    const o = {}; h.forEach(function (k, j) { o[k] = r[j]; });
    return !filtro(o);
  }));
  sh.clearContents();
  sh.getRange(1, 1, manter.length, manter[0].length).setValues(manter);
}
