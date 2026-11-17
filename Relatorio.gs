/************************************************************
 * RELATÓRIO GERENCIAL QUINZENAL
 *
 * Todo dia 15 e todo último dia do mês, às 9h, o script monta o relatório
 * da quinzena (01 a 15 ou 16 ao fim do mês), comparado com a quinzena anterior,
 * salva um HTML próprio daquele relatório no Drive e envia por e-mail a todos
 * os usuários com cadastro ativo no painel (aba USUARIOS) e ao admin.
 *
 * Menu Diagnóstico:
 *   Relatório gerencial: enviar teste para o admin   (gera agora, envia só ao admin)
 *   Relatório gerencial: agendar dias 15 e último dia (instala o agendamento)
 *
 * Fontes: as coletas guardadas (aba HISTORICO e CSVs no Drive), a aba AVALIACOES
 * e OCORRENCIAS. Nada aqui altera dados: só lê, gera o arquivo e envia.
 ************************************************************/

const REL_HORA = 9;                                     // 9h: a coleta da meia-noite já terminou
const REL_PASTA_NOME = 'Diagnóstico Dellamed — relatórios gerenciais';
const REL_QUINZENAS_TENDENCIA = 7;                      // pontos do gráfico de evolução
const REL_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/* ---------- agendamento ---------- */
function instalarGatilhoRelatorio() {
  ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getHandlerFunction() === 'relatorioDiario') ScriptApp.deleteTrigger(g); });
  ScriptApp.newTrigger('relatorioDiario').timeBased().everyDays(1).atHour(REL_HORA).inTimezone('America/Sao_Paulo').create();
  try { SpreadsheetApp.getActive().toast('Relatório gerencial agendado: dias 15 e último dia de cada mês, às ' + REL_HORA + 'h.', 'Relatório', 10); } catch (e) {}
}
// Roda todo dia; só age no dia 15 e no último dia do mês. Se a coleta ainda estiver rodando, tenta de novo em 30 min (até 6 vezes).
function relatorioDiario() {
  const p = PropertiesService.getScriptProperties();
  const cont = p.getProperty('REL_CONT_TRIGGER');
  if (cont) { ScriptApp.getProjectTriggers().forEach(function (g) { if (g.getUniqueId() === cont) ScriptApp.deleteTrigger(g); }); p.deleteProperty('REL_CONT_TRIGGER'); }
  const hoje = relHoje_();
  const ultimoDia = new Date(hoje.y, hoje.m, 0).getDate();
  if (hoje.d !== 15 && hoje.d !== ultimoDia) return;
  const per = relPeriodo_(hoje, false);
  if (p.getProperty('REL_ENVIADO') === per.chave) return;                          // já enviado
  const tent = Number(p.getProperty('REL_TENT_' + per.chave) || 0);
  if (p.getProperty('COL_FASE') && tent < 6) {                                    // coleta em andamento: espera
    p.setProperty('REL_TENT_' + per.chave, String(tent + 1));
    const g = ScriptApp.newTrigger('relatorioDiario').timeBased().after(30 * 60 * 1000).create();
    p.setProperty('REL_CONT_TRIGGER', g.getUniqueId());
    log_('sistema', 'relatorio_aguardando', 'coleta em andamento; nova tentativa em 30 min');
    return;
  }
  const r = relGerar_(per, false);
  const dest = relDestinatarios_();
  relEnviar_(r, dest, false);
  p.setProperty('REL_ENVIADO', per.chave);
  p.deleteProperty('REL_TENT_' + per.chave);
  log_('sistema', 'relatorio_enviado', per.rotulo + ' · ' + dest.length + ' destinatários · ' + r.url);
}
// Menu: gera o relatório da quinzena em curso (até hoje) e envia só para o admin.
function relatorioTesteAdmin() {
  const per = relPeriodo_(relHoje_(), true);
  const r = relGerar_(per, true);
  relEnviar_(r, [ADMIN_EMAIL], true);
  log_('sistema', 'relatorio_teste', per.rotulo + ' · enviado para ' + ADMIN_EMAIL + ' · ' + r.url);
  try { SpreadsheetApp.getUi().alert('Relatório gerencial', 'Teste enviado para ' + ADMIN_EMAIL + '.\n\nArquivo HTML deste relatório:\n' + r.url, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

/* ---------- período ---------- */
function relHoje_() {
  const s = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10), iso: s };
}
function relIso_(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
// Quinzena que contém a data; "parcial" (teste) termina hoje em vez de no fim da quinzena.
function relPeriodo_(h, parcial) {
  const q = relQuinzena_(h.y, h.m, h.d <= 15 ? 1 : 2);
  const ant = relQuinzenaAnterior_(q);
  if (parcial && h.iso < q.fim) q.fim = h.iso;
  q.ant = ant;
  q.parcial = !!parcial;
  return q;
}
function relQuinzena_(y, m, n) {
  const ult = new Date(y, m, 0).getDate();
  return { y: y, m: m, n: n, ini: relIso_(y, m, n === 1 ? 1 : 16), fim: relIso_(y, m, n === 1 ? 15 : ult),
           chave: y + '-' + ('0' + m).slice(-2) + '-' + n,
           rotulo: (n === 1 ? '1ª' : '2ª') + ' quinzena de ' + REL_MESES[m - 1] + '/' + y,
           curto: (n === 1 ? '1ª ' : '2ª ') + REL_MESES[m - 1].slice(0, 3) };
}
function relQuinzenaAnterior_(q) { return q.n === 2 ? relQuinzena_(q.y, q.m, 1) : (q.m === 1 ? relQuinzena_(q.y - 1, 12, 2) : relQuinzena_(q.y, q.m - 1, 2)); }

/* ---------- geração ---------- */
function relGerar_(per, teste) {
  const coletas = listaColetas_().map(function (c) { return c.coleta; }).sort();
  // última coleta dentro de [ini, fim] da quinzena
  const ultimaEm = function (q) { const l = coletas.filter(function (k) { const d = k.slice(0, 10); return d >= q.ini && d <= q.fim; }); return l.length ? l[l.length - 1] : ''; };
  const vend = mapaVendedores_(), cache = {};
  const metr = function (coleta) { if (!coleta) return null; if (!cache[coleta]) cache[coleta] = relMetricas_(linhasColeta_(coleta), vend, TOLERANCIA_PRECO); return cache[coleta]; };
  const cColeta = ultimaEm(per), pColeta = ultimaEm(per.ant);
  if (!cColeta) throw new Error('Nenhuma coleta encontrada na ' + per.rotulo + '.');
  // evolução: % abaixo do preço base nas últimas quinzenas
  const trend = []; let q = per;
  for (let i = 0; i < REL_QUINZENAS_TENDENCIA; i++) {
    const k = i === 0 ? cColeta : ultimaEm(q);
    if (k) { const m = metr(k); trend.unshift({ rotulo: q.curto, v: m.ads.length ? m.ads.filter(function (a) { return a.viol; }).length / m.ads.length : 0 }); }
    q = relQuinzenaAnterior_(q);
  }
  const dados = dadosComCache_();
  let ocorr = [];
  try { ocorr = lerAba_('OCORRENCIAS').map(function (r) { return { id: str_(r.review_id), status: str_(r.status), em: dataStr_(r.tratado_em).slice(0, 10) }; }); } catch (e) {}
  const R = relCalcular_(metr(cColeta), metr(pColeta), dados.avaliacoes || [], ocorr, per, prioritarios_(), trend);
  R.coleta = cColeta; R.coletaAnt = pColeta; R.teste = !!teste;
  R.geradoEm = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  const html = relHtml_(R, relLogo_());
  const nome = (teste ? 'TESTE_' : '') + 'Relatorio_gerencial_' + per.chave.slice(0, 7) + '_' + (per.n === 1 ? '1a' : '2a') + '_quinzena' +
               (teste ? '_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd_HHmm') : '') + '.html';
  const f = relPasta_().createFile(nome, html, 'text/html');
  try { f.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { R: R, html: html, nome: nome, url: f.getUrl(), arquivo: f };
}
function relPasta_() {
  const p = PropertiesService.getScriptProperties(), id = p.getProperty('REL_PASTA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  let pai = null;
  try { const it = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents(); if (it.hasNext()) pai = it.next(); } catch (e) {}
  if (!pai) pai = DriveApp.getRootFolder();
  const ex = pai.getFoldersByName(REL_PASTA_NOME), pasta = ex.hasNext() ? ex.next() : pai.createFolder(REL_PASTA_NOME);
  p.setProperty('REL_PASTA_ID', pasta.getId());
  return pasta;
}
function relLogo_() {
  try { const m = HtmlService.createHtmlOutputFromFile('Painel').getContent().match(/data:image\/png;base64,[A-Za-z0-9+\/=]+/); return m ? m[0] : ''; } catch (e) { return ''; }
}
function relDestinatarios_() {
  const l = [ADMIN_EMAIL];
  try { lerAba_('USUARIOS').forEach(function (r) { const e = str_(r.email).toLowerCase(); if (e && str_(r.status).toLowerCase() === 'ativo' && l.indexOf(e) < 0) l.push(e); }); } catch (e) {}
  return l;
}

/* ---------- envio ---------- */
function relEnviar_(r, dest, teste) {
  const R = r.R;
  const assunto = (teste ? '[TESTE] ' : '') + 'Relatório gerencial Dellamed · ' + R.per.rotulo + (R.per.parcial ? ' (até ' + relData_(R.per.fim) + ')' : '');
  const anexo = Utilities.newBlob(r.html, 'text/html', r.nome);
  const corpo = relEmailHtml_(R, r.url);
  const texto = R.titulo + '\n\n' + R.res.map(function (x) { return x[0] + ': ' + relTxt_(x[1]); }).join('\n') ;
  dest.forEach(function (to) {
    MailApp.sendEmail({ to: to, subject: assunto, body: texto, htmlBody: corpo, attachments: [anexo], name: 'Diagnóstico Dellamed' });
  });
}
function relTxt_(h) { return String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }

/* ====================================================================
   Funções puras (sem Google): métricas, regras de texto e HTML.
   ==================================================================== */

// Uma coleta → preços base, anúncios de revendedores (com violação) e anúncios de concorrentes.
function relMetricas_(rows, vend, tol) {
  const base = {};
  rows.forEach(function (r) { if (str_(r.tipo) === 'Produto Dellamed' && num_(r.preco) > 0) base[str_(r.sku)] = { preco: num_(r.preco), produto: str_(r.produto), categoria: str_(r.categoria) }; });
  const ads = [];
  rows.forEach(function (r) {
    if (str_(r.tipo) !== 'Anúncio revendedor') return;
    const b = base[str_(r.sku)], p = num_(r.preco); if (!b || !(p > 0)) return;
    const mk = str_(r.marketplace), seller = typeof nomeVendedor_ === 'function' && vend ? nomeVendedor_(vend, r.vendedor_ou_marca, mk) : str_(r.vendedor_ou_marca);
    ads.push({ seller: seller, mk: mk, sk: mk + '|' + seller, sku: str_(r.sku), produto: b.produto, preco: p, base: b.preco, gap: (p - b.preco) / b.preco, viol: p < b.preco * (1 - tol) });
  });
  const conc = [];
  rows.forEach(function (r) {
    if (str_(r.tipo) !== 'Concorrente' || !(num_(r.preco) > 0)) return;
    const mk = str_(r.marketplace);
    conc.push({ marca: str_(r.vendedor_ou_marca), categoria: str_(r.categoria), produto: str_(r.produto), mk: mk, preco: num_(r.preco),
                key: typeof colChaveAnuncio_ === 'function' ? colChaveAnuncio_(mk, str_(r.link), str_(r.item_id)) : str_(r.link) });
  });
  return { base: base, ads: ads, conc: conc };
}
function relMediana_(l) { l = l.filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; }); if (!l.length) return 0; const m = Math.floor(l.length / 2); return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2; }
function relNps_(l) { if (!l.length) return null; const pr = l.filter(function (a) { return a.nota >= 5; }).length, de = l.filter(function (a) { return a.nota <= 3; }).length; return Math.round((pr - de) / l.length * 100); }
function relPct_(v, casas) { return (v * 100).toFixed(casas === undefined ? 1 : casas).replace('.', ',') + '%'; }
function relPp_(d) { const v = Math.round(d * 1000) / 10; return (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(v)).replace('.', ',') + ' p.p.'; }
function relSinal_(v, casas) { const s = (Math.abs(v) * 100).toFixed(casas === undefined ? 1 : casas).replace('.', ','); return (v > 0 ? '+' : v < 0 ? '−' : '') + s + '%'; }
function relBrl_(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function relInt_(v) { return String(Math.round(v || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function relData_(iso) { return String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7); }
function relEsc_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function relMkCls_(mk) { return mk === 'Mercado Livre' ? 'ml' : mk === 'Amazon' ? 'az' : mk === 'Magazine Luiza' ? 'mg' : mk === 'Shopee' ? 'sh' : ''; }
function relMkNome_(mk) { return mk === 'Magazine Luiza' ? 'Magalu' : mk; }

function relCalcular_(cur, prev, avals, ocorr, per, prio, trend) {
  const R = { per: per, trend: trend, temAnt: !!prev };
  const viol = function (m) { return m.ads.filter(function (a) { return a.viol; }); };
  const cv = viol(cur), pv = prev ? viol(prev) : [];
  const pct = cur.ads.length ? cv.length / cur.ads.length : 0, pctAnt = prev && prev.ads.length ? pv.length / prev.ads.length : null;
  const desc = cv.length ? cv.reduce(function (s, a) { return s - a.gap; }, 0) / cv.length : 0;
  const descAnt = pv.length ? pv.reduce(function (s, a) { return s - a.gap; }, 0) / pv.length : null;
  const sellers = {}; cur.ads.forEach(function (a) { sellers[a.sk] = 1; });
  const sellersAnt = {}; if (prev) prev.ads.forEach(function (a) { sellersAnt[a.sk] = 1; });
  const novos = prev ? Object.keys(sellers).filter(function (k) { return !sellersAnt[k]; }) : [];
  // Voz do cliente (Dellamed) no período e no período anterior
  const dm = avals.filter(function (a) { return /dellamed/i.test(a.marca || ''); });
  const noPer = function (a, q) { const d = String(a.data || '').slice(0, 10); return d >= q.ini && d <= q.fim; };
  const avP = dm.filter(function (a) { return noPer(a, per); }), avA = dm.filter(function (a) { return noPer(a, per.ant); });
  const npsP = relNps_(avP), npsA = relNps_(avA);
  const abertos = dm.filter(function (a) { return a.nota <= 3 && a.status !== 'tratada'; }).length;
  const tratadas = ocorr.filter(function (o) { return o.status === 'tratada' && o.em >= per.ini && o.em <= per.fim; }).length;
  R.kpi = { pct: pct, pctAnt: pctAnt, desc: desc, descAnt: descAnt, nSellers: Object.keys(sellers).length, nNovos: novos.length,
            nAds: cur.ads.length, nAdsAnt: prev ? prev.ads.length : null, nps: npsP, npsAnt: npsA, nAval: avP.length, abertos: abertos, tratadas: tratadas };
  // sellers mais agressivos
  const porSeller = {};
  cur.ads.forEach(function (a) { const s = porSeller[a.sk] || (porSeller[a.sk] = { seller: a.seller, mk: a.mk, n: 0, v: 0, soma: 0, max: 0 }); s.n++; if (a.viol) { s.v++; s.soma += -a.gap; s.max = Math.max(s.max, -a.gap); } });
  const vAnt = {}; pv.forEach(function (a) { vAnt[a.sk] = (vAnt[a.sk] || 0) + 1; });
  R.agressivos = Object.keys(porSeller).map(function (k) { const s = porSeller[k]; s.k = k; s.med = s.v ? s.soma / s.v : 0;
    s.score = Math.round((0.5 * Math.min(s.med / 0.25, 1) + 0.5 * (s.v / s.n)) * 100); s.dif = prev ? s.v - (vAnt[k] || 0) : null; s.novo = prev ? !sellersAnt[k] : false; return s; })
    .filter(function (s) { return s.v > 0; }).sort(function (a, b) { return b.score - a.score || b.v - a.v; });
  const top3 = R.agressivos.slice(0, 3);
  R.shareTop3 = cv.length ? top3.reduce(function (s, x) { return s + x.v; }, 0) / cv.length : 0;
  R.top3MesmoMk = top3.length === 3 && top3.every(function (x) { return x.mk === top3[0].mk; }) ? top3[0].mk : '';
  // SKUs mais atacados
  const porSku = {};
  cv.forEach(function (a) { const s = porSku[a.sku] || (porSku[a.sku] = { sku: a.sku, produto: a.produto, sellers: {}, max: 0 }); s.sellers[a.sk] = 1; s.max = Math.max(s.max, -a.gap); });
  R.skus = Object.keys(porSku).map(function (k) { const s = porSku[k]; s.n = Object.keys(s.sellers).length; return s; }).sort(function (a, b) { return b.n - a.n || b.max - a.max; });
  // por marketplace
  R.mks = ['Mercado Livre', 'Amazon', 'Magazine Luiza', 'Shopee'].map(function (mk) {
    const l = cur.ads.filter(function (a) { return a.mk === mk; }), la = prev ? prev.ads.filter(function (a) { return a.mk === mk; }) : [];
    return { mk: mk, n: l.length, pct: l.length ? l.filter(function (a) { return a.viol; }).length / l.length : 0,
             pctAnt: la.length ? la.filter(function (a) { return a.viol; }).length / la.length : null };
  }).filter(function (x) { return x.n; });
  // revendedores novos
  R.novos = novos.map(function (k) { const l = cur.ads.filter(function (a) { return a.sk === k; }), sk = {}; l.forEach(function (a) { sk[a.sku] = 1; });
    const min = Math.min.apply(null, l.map(function (a) { return a.gap; }));
    return { seller: l[0].seller, mk: l[0].mk, skus: Object.keys(sk).length, min: min, viol: l.some(function (a) { return a.viol; }) }; })
    .sort(function (a, b) { return a.min - b.min; });
  // posição de preço por categoria (mediana Dellamed × mediana dos concorrentes)
  const cats = {};
  Object.keys(cur.base).forEach(function (s) { const b = cur.base[s]; if (!b.categoria) return; (cats[b.categoria] = cats[b.categoria] || { dm: [], mk: [] }).dm.push(b.preco); });
  cur.conc.forEach(function (c) { if (cats[c.categoria] && !/dellamed/i.test(c.marca)) cats[c.categoria].mk.push(c.preco); });
  R.cats = Object.keys(cats).map(function (k) { const md = relMediana_(cats[k].dm), mm = relMediana_(cats[k].mk); return { cat: k, d: md && mm ? (md - mm) / mm : null, n: cats[k].mk.length }; })
    .filter(function (c) { return c.d !== null && c.n >= 3; }).sort(function (a, b) { return b.d - a.d; });
  // concorrentes prioritários que mais baixaram preço (mesmo anúncio nas duas coletas)
  const pk = {}; (prio || []).forEach(function (m) { pk[String(m).toUpperCase()] = 1; });
  const antC = {}; if (prev) prev.conc.forEach(function (c) { antC[c.key] = c; });
  R.quedas = prev ? cur.conc.filter(function (c) { return pk[String(c.marca).toUpperCase()] && antC[c.key] && antC[c.key].preco > 0; })
    .map(function (c) { const pr = String(c.produto).replace(new RegExp('^\\s*' + String(c.marca).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–·:]?\\s*', 'i'), '');
      return { marca: c.marca, produto: pr || c.produto, mk: c.mk, preco: c.preco, v: (c.preco - antC[c.key].preco) / antC[c.key].preco }; })
    .filter(function (x) { return x.v < -0.005; }).sort(function (a, b) { return a.v - b.v; }) : [];
  // NPS por produto Dellamed
  const porP = {};
  avP.forEach(function (a) { (porP[a.produto] = porP[a.produto] || { p: [], a: [] }).p.push(a); });
  avA.forEach(function (a) { if (porP[a.produto]) porP[a.produto].a.push(a); });
  R.npsProd = Object.keys(porP).filter(function (k) { return porP[k].p.length >= 3; }).map(function (k) {
    const x = porP[k], n = relNps_(x.p), na = x.a.length >= 3 ? relNps_(x.a) : null;
    return { produto: k, nps: n, var: na === null ? null : n - na, t: x.p.length,
             abertos: dm.filter(function (a) { return a.produto === k && a.nota <= 3 && a.status !== 'tratada'; }).length };
  }).sort(function (a, b) { return (a.var === null ? 999 : a.var) - (b.var === null ? 999 : b.var) || a.nps - b.nps; });
  relTextos_(R);
  return R;
}

// Regras de leitura: títulos-conclusão, resumo executivo e recomendações.
function relTextos_(R) {
  const k = R.kpi, t = R.trend, top = R.agressivos.slice(0, 3), sku = R.skus[0], sku2 = R.skus[1];
  let seq = 0; for (let i = t.length - 1; i > 0 && t[i].v > t[i - 1].v + 0.001; i--) seq++;
  const dp = k.pctAnt === null ? null : k.pct - k.pctAnt;
  if (dp === null) R.titulo = relPct_(k.pct, 0) + ' dos anúncios de revendedores estão abaixo do preço base';
  else if (dp >= 0.01) R.titulo = 'A pressão de preço dos revendedores subiu' + (seq >= 2 ? ' pela ' + seq + 'ª quinzena seguida' : '') + ' e já atinge ' + relPct_(k.pct, 0) + ' dos anúncios';
  else if (dp <= -0.01) R.titulo = 'A pressão de preço dos revendedores recuou para ' + relPct_(k.pct, 0) + ' dos anúncios';
  else R.titulo = 'A pressão de preço dos revendedores ficou estável em ' + relPct_(k.pct, 0) + ' dos anúncios';
  const quem = top.length ? (top.length === 3 ? 'Os 3 sellers mais agressivos concentram ' : 'Os sellers mais agressivos concentram ') + relPct_(R.shareTop3, 0) + ' das violações' + (R.top3MesmoMk ? ', todos no ' + relMkNome_(R.top3MesmoMk) : '') + '.' : 'Nenhum seller com anúncio abaixo do preço base.';
  const npsQueda = R.npsProd.filter(function (x) { return x.var !== null && x.var <= -5; })[0];
  R.res = [
    ['O que aconteceu', relPct_(k.pct, 0) + ' dos anúncios de terceiros estão abaixo do preço base' + (dp === null ? '' : ' (' + relPp_(dp) + ')') + '. ' + quem],
    ['Por que importa', sku ? 'O SKU mais atacado, ' + relEsc_(sku.produto) + ', aparece até ' + relSinal_(-sku.max, 0) + ' do preço base, com ' + sku.n + ' sellers abaixo. A revenda que pratica o preço sugerido perde competitividade e a percepção de valor da linha cai.'
                            : 'Os preços praticados pelos revendedores estão dentro da tolerância da política comercial.'],
    ['O que fazer', (top.length ? 'Notificar ' + (top.length === 3 ? 'os 3 sellers mais agressivos' : 'os sellers mais agressivos') : 'Manter o acompanhamento') +
                    (sku ? ', revisar a política comercial do ' + relEsc_(sku.sku) + (sku2 ? ' e do ' + relEsc_(sku2.sku) : '') : '') +
                    (npsQueda ? ' e acompanhar a queda de NPS do ' + relEsc_(npsQueda.produto) : '') + '.']
  ];
  const novosViol = R.novos.filter(function (x) { return x.viol; }).length;
  R.insTrend = R.temAnt ? (k.nNovos ? k.nNovos + ' revendedor' + (k.nNovos > 1 ? 'es' : '') + ' novo' + (k.nNovos > 1 ? 's' : '') + ' na quinzena, ' + novosViol + ' já abaixo do preço base. ' : 'Nenhum revendedor novo na quinzena. ') +
              (dp >= 0.01 ? 'Sem reação comercial, a tendência é de nova alta na próxima quinzena.' : dp <= -0.01 ? 'A queda indica efeito das ações comerciais ou saída de revendedores agressivos.' : 'Patamar estável em relação à quinzena anterior.')
              : 'Primeira quinzena com coleta: as comparações começam no próximo relatório.';
  R.titulo2 = top.length ? (top.length === 3 ? 'Os 3 sellers mais agressivos respondem por ' : 'Os sellers mais agressivos respondem por ') + relPct_(R.shareTop3, 0) + ' das violações de preço' : 'Nenhuma violação de preço na quinzena';
  const mkMax = R.mks.slice().sort(function (a, b) { return b.pct - a.pct; })[0];
  R.insMk = mkMax ? 'O ' + relMkNome_(mkMax.mk) + ' tem a maior proporção de anúncios abaixo do preço base (' + relPct_(mkMax.pct, 0) + ')' + (mkMax.pctAnt !== null ? ', ' + relPp_(mkMax.pct - mkMax.pctAnt) + ' na quinzena' : '') + '.' : '';
  R.tituloNovos = !R.temAnt ? 'Revendedores novos aparecem a partir do próximo relatório' : R.novos.length ? R.novos.length + ' revendedor' + (R.novos.length > 1 ? 'es entraram' : ' entrou') + ' na quinzena e ' + novosViol + ' já anuncia' + (novosViol === 1 ? '' : 'm') + ' abaixo do preço base' : 'Nenhum revendedor novo na quinzena';
  const acima = R.cats.filter(function (c) { return c.d > 0.10; }), abaixo = R.cats.filter(function (c) { return c.d < -0.10; });
  const nomes = function (l) { return l.slice(0, 2).map(function (c) { return c.cat.toLowerCase(); }).join(' e '); };
  R.titulo3 = acima.length && abaixo.length ? 'A Dellamed está acima do mercado em ' + nomes(acima) + ' e abaixo em ' + nomes(abaixo)
            : acima.length ? 'A Dellamed está acima do mercado em ' + nomes(acima) : abaixo.length ? 'A Dellamed está abaixo do mercado em ' + nomes(abaixo) : 'A Dellamed está alinhada à mediana do mercado nas categorias monitoradas';
  const q0 = R.quedas[0];
  R.insQuedas = q0 ? relEsc_(q0.marca) + ' baixou o preço de ' + relEsc_(q0.produto.slice(0, 60)) + ' em ' + relSinal_(q0.v, 1).replace('−', '') + ' no ' + relMkNome_(q0.mk) + '.' : (R.temAnt ? 'Nenhum concorrente prioritário baixou preço no mesmo anúncio entre as duas coletas.' : '');
  const pior = R.npsProd[0];
  R.insNps = pior ? relEsc_(pior.produto) + ' tem NPS ' + (pior.nps > 0 ? '+' : '') + pior.nps + (pior.var !== null ? ' (' + (pior.var > 0 ? '+' : '') + pior.var + ' na quinzena)' : '') + ' e ' + pior.abertos + ' ocorrência' + (pior.abertos === 1 ? '' : 's') + ' em aberto.' : 'Poucas avaliações Dellamed na quinzena para calcular o NPS por produto.';
  // recomendações (sugestão automática; prazos a partir do fim da quinzena)
  const prazo = function (dias) { const d = new Date(R.per.fim + 'T12:00:00'); d.setDate(d.getDate() + dias); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2); };
  R.rec = [];
  if (top.length) R.rec.push(['alta', 'Notificar ' + top.map(function (s) { return relEsc_(s.seller); }).join(', ') + ' sobre a política de preço' + (sku ? ' do ' + relEsc_(sku.sku) + (sku2 ? ' e do ' + relEsc_(sku2.sku) : '') : '') + '.', 'Comercial', prazo(7)]);
  if (pior && (pior.nps < 0 || (pior.var !== null && pior.var <= -5))) R.rec.push(['alta', 'Analisar as avaliações negativas do ' + relEsc_(pior.produto) + ' e tratar as ' + pior.abertos + ' ocorrências em aberto.', 'Qualidade · SAC', prazo(14)]);
  if (acima.length) R.rec.push(['media', 'Material técnico para a revenda justificar o preço em ' + acima[0].cat.toLowerCase() + ' (' + relSinal_(acima[0].d, 0) + ' sobre a mediana do mercado).', 'Marketing', prazo(16)]);
  if (R.novos.filter(function (x) { return x.viol; }).length) R.rec.push(['media', 'Cruzar os revendedores novos abaixo do preço base com a base de clientes e identificar canais não autorizados.', 'Comercial', prazo(10)]);
  if (!R.rec.length) R.rec.push(['media', 'Manter o acompanhamento: nenhum ponto crítico na quinzena.', 'Marketing', prazo(15)]);
  R.rec = R.rec.slice(0, 3);
}

/* ---------- HTML do relatório (arquivo próprio de cada quinzena) ---------- */
function relHtml_(R, logo) {
  const k = R.kpi, E = relEsc_;
  const delta = function (v, txt, bomSeSobe) { if (v === null || v === undefined || isNaN(v)) return '<div class="d nt">sem quinzena anterior</div>'; const cls = Math.abs(v) < 1e-9 ? 'nt' : ((v > 0) === bomSeSobe ? 'dn' : 'up'); return '<div class="d ' + cls + '">' + txt + '</div>'; };
  const kpis = [
    ['<div class="v">' + relPct_(k.pct, 0) + '</div><div class="l">Anúncios abaixo do preço base</div>' + delta(k.pctAnt === null ? null : k.pct - k.pctAnt, (k.pctAnt === null ? '' : relPp_(k.pct - k.pctAnt) + ' vs quinzena anterior'), false)],
    ['<div class="v">' + (k.desc ? '−' + relPct_(k.desc, 1) : '—') + '</div><div class="l">Desconto médio nas violações</div>' + delta(k.descAnt === null ? null : k.desc - k.descAnt, k.descAnt === null ? '' : relPp_(k.desc - k.descAnt).replace('+', '') + (k.desc > k.descAnt ? ' mais fundo' : ' mais raso'), false)],
    ['<div class="v">' + relInt_(k.nSellers) + '</div><div class="l">Revendedores com produto Dellamed</div><div class="d nt">' + (R.temAnt ? '+' + k.nNovos + ' novos na quinzena' : 'primeira quinzena') + '</div>'],
    ['<div class="v">' + relInt_(k.nAds) + '</div><div class="l">Anúncios de terceiros monitorados</div><div class="d nt">' + (k.nAdsAnt ? relSinal_((k.nAds - k.nAdsAnt) / k.nAdsAnt, 0) + ' vs quinzena anterior' : '—') + '</div>'],
    ['<div class="v">' + (k.nps === null ? '—' : (k.nps > 0 ? '+' : k.nps < 0 ? '−' : '') + Math.abs(k.nps)) + '</div><div class="l">NPS Dellamed (' + k.nAval + ' avaliações)</div>' + delta(k.nps === null || k.npsAnt === null ? null : k.nps - k.npsAnt, k.nps === null || k.npsAnt === null ? '' : (k.nps === k.npsAnt ? 'estável' : (k.nps - k.npsAnt > 0 ? '▲ ' : '▼ ') + Math.abs(k.nps - k.npsAnt) + ' pontos'), true)],
    ['<div class="v">' + k.abertos + '</div><div class="l">Ocorrências de detratores em aberto</div><div class="d ' + (k.tratadas ? 'dn' : 'nt') + '">' + k.tratadas + ' tratada' + (k.tratadas === 1 ? '' : 's') + ' na quinzena</div>']
  ].map(function (x) { return '<div class="k">' + x[0] + '</div>'; }).join('');
  // gráfico de linha
  const t = R.trend, W = 520, H = 170, pl = 52, pr = 18, pt = 18, pb = 28;
  const vmax = Math.max(0.1, Math.ceil(Math.max.apply(null, t.map(function (x) { return x.v; }).concat([0.1])) * 10 + 0.5) / 10), vmin = Math.max(0, Math.floor(Math.min.apply(null, t.map(function (x) { return x.v; }).concat([vmax])) * 10 - 0.5) / 10);
  const xs = t.map(function (_, i) { return t.length > 1 ? pl + i * (W - pl - pr) / (t.length - 1) : (W) / 2; });
  const Y = function (v) { return pt + (H - pt - pb) * (1 - (v - vmin) / ((vmax - vmin) || 1)); };
  let svg = '';
  for (let g = vmin; g <= vmax + 1e-9; g += 0.1) svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '" stroke="#E3E9F0"/><text x="' + (pl - 8) + '" y="' + (Y(g) + 3).toFixed(1) + '" class="ax" text-anchor="end">' + Math.round(g * 100) + '%</text>';
  svg += '<polyline points="' + t.map(function (x, i) { return xs[i].toFixed(1) + ',' + Y(x.v).toFixed(1); }).join(' ') + '" fill="none" stroke="#0F3C6E" stroke-width="2.2"/>';
  t.forEach(function (x, i) { const ult = i === t.length - 1, c = ult ? '#EA6852' : '#0F3C6E';
    svg += '<circle cx="' + xs[i].toFixed(1) + '" cy="' + Y(x.v).toFixed(1) + '" r="' + (ult ? 4.5 : 3) + '" fill="' + c + '"/><text x="' + xs[i].toFixed(1) + '" y="' + (Y(x.v) - 8).toFixed(1) + '" class="vl" text-anchor="middle" fill="' + c + '">' + Math.round(x.v * 100) + '%</text><text x="' + xs[i].toFixed(1) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + E(x.rotulo) + '</text>'; });
  const linha = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + svg + '</svg>';
  // gráfico divergente por categoria
  const cats = R.cats.slice(0, 9), bw = 340, bh = 16, mid = 222;
  let rows = ''; const maxAbs = Math.max(0.25, Math.max.apply(null, cats.map(function (c) { return Math.abs(c.d); }).concat([0])));
  cats.forEach(function (c, i) { const yy = 6 + i * (bh + 8), w = Math.abs(c.d) / maxAbs * 80, x = c.d >= 0 ? mid : mid - w, cor = c.d > 0.10 ? '#EA6852' : c.d < -0.10 ? '#3BBFAD' : '#8FA6BF';
    rows += '<text x="112" y="' + (yy + 12) + '" class="cl" text-anchor="end">' + E(c.cat.length > 24 ? c.cat.slice(0, 23) + '…' : c.cat) + '</text><rect x="' + x.toFixed(1) + '" y="' + yy + '" width="' + Math.max(1, w).toFixed(1) + '" height="' + bh + '" rx="3" fill="' + cor + '"/>' +
            '<text x="' + (c.d >= 0 ? mid + w + 5 : mid - w - 5).toFixed(1) + '" y="' + (yy + 12) + '" class="vl" text-anchor="' + (c.d >= 0 ? 'start' : 'end') + '" fill="' + cor + '">' + relSinal_(c.d, 0) + '</text>'; });
  const hh = 6 + cats.length * (bh + 8);
  const div = cats.length ? '<svg viewBox="0 0 ' + bw + ' ' + (hh + 14) + '" width="100%"><line x1="' + mid + '" x2="' + mid + '" y1="2" y2="' + hh + '" stroke="#0F3C6E"/>' + rows + '<text x="' + mid + '" y="' + (hh + 12) + '" class="ax" text-anchor="middle">mediana do mercado</text></svg>' : '<p class="sub">Sem concorrentes suficientes por categoria nesta coleta.</p>';
  const mk = function (m) { return '<td class="' + relMkCls_(m) + '">' + E(relMkNome_(m)) + '</td>'; };
  const vazio = function (n, txt) { return '<tr><td colspan="' + n + '" class="vz">' + txt + '</td></tr>'; };
  const tabAgr = R.agressivos.slice(0, 5).map(function (s) { return '<tr><td class="n">' + E(s.seller) + '</td>' + mk(s.mk) + '<td>' + s.v + ' de ' + s.n + '</td><td>−' + relPct_(s.med, 1) + '</td><td>−' + relPct_(s.max, 1) + '</td><td class="' + (s.novo ? 'up' : s.dif > 0 ? 'up' : s.dif < 0 ? 'dn' : 'nt') + '">' + (s.dif === null ? '—' : s.novo ? 'novo na lista' : s.dif === 0 ? 'estável' : (s.dif > 0 ? '+' : '−') + Math.abs(s.dif) + ' anúncio' + (Math.abs(s.dif) > 1 ? 's' : '')) + '</td></tr>'; }).join('') || vazio(6, 'Nenhum seller abaixo do preço base.');
  const tabSku = R.skus.slice(0, 5).map(function (s) { return '<tr><td class="n">' + E(s.produto) + '</td><td>' + s.n + '</td><td>−' + relPct_(s.max, 1) + '</td></tr>'; }).join('') || vazio(3, 'Nenhum SKU abaixo do preço base.');
  const tabMk = R.mks.map(function (m) { return '<tr>' + mk(m.mk) + '<td>' + relInt_(m.n) + '</td><td>' + relPct_(m.pct, 0) + '</td><td class="' + (m.pctAnt === null ? 'nt' : m.pct > m.pctAnt ? 'up' : m.pct < m.pctAnt ? 'dn' : 'nt') + '">' + (m.pctAnt === null ? '—' : relPp_(m.pct - m.pctAnt)) + '</td></tr>'; }).join('');
  const tabNovos = R.novos.slice(0, 8).map(function (s) { return '<tr><td class="n">' + E(s.seller) + '</td>' + mk(s.mk) + '<td>' + s.skus + '</td><td>' + relSinal_(s.min, 1) + '</td><td class="' + (s.viol ? 'up' : 'dn') + '">' + (s.viol ? 'abaixo do base' : 'no preço') + '</td></tr>'; }).join('') || vazio(5, R.temAnt ? 'Nenhum revendedor novo.' : 'Comparação disponível a partir do próximo relatório.');
  const tabQ = R.quedas.slice(0, 4).map(function (q) { return '<tr><td class="n">' + E(q.marca) + ' · ' + E(q.produto.length > 48 ? q.produto.slice(0, 47) + '…' : q.produto) + '</td><td>' + relBrl_(q.preco) + '</td><td class="up">' + relSinal_(q.v, 1) + '</td></tr>'; }).join('') || vazio(3, R.temAnt ? 'Nenhuma queda de preço nos prioritários.' : 'Comparação disponível a partir do próximo relatório.');
  const tabNps = R.npsProd.slice(0, 4).map(function (x) { return '<tr><td class="n">' + E(x.produto) + '</td><td class="' + (x.nps < 0 ? 'up' : '') + '">' + (x.nps > 0 ? '+' : x.nps < 0 ? '−' : '') + Math.abs(x.nps) + '</td><td class="' + (x.var === null ? 'nt' : x.var < 0 ? 'up' : 'dn') + '">' + (x.var === null ? '—' : (x.var > 0 ? '+' : x.var < 0 ? '−' : '') + Math.abs(x.var)) + '</td><td>' + x.abertos + '</td></tr>'; }).join('') || vazio(4, 'Poucas avaliações na quinzena.');
  const tabRec = R.rec.map(function (r) { return '<tr><td class="p"><span class="tag ' + r[0] + '">' + (r[0] === 'alta' ? 'Alta' : 'Média') + '</span></td><td>' + r[1] + ' <i>' + E(r[2]) + ' · até ' + r[3] + '</i></td></tr>'; }).join('');
  const per = R.per, ant = per.ant;
  const rod = function (n) { return '<div class="ft"><span>Diagnóstico Dellamed · gerado ' + (R.teste ? 'como TESTE ' : 'automaticamente ') + 'em ' + E(R.geradoEm || '') + ', a partir da coleta de ' + E(relData_(R.coleta || '') + ' ' + String(R.coleta || '').slice(11, 16)) + '</span><span>' + n + ' / 3</span></div>'; };
  const cab2 = '<div class="hd2"><b>Relatório gerencial · Marketplaces</b><span>' + E(per.rotulo) + '</span></div>';
  const css = "@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'Montserrat',Arial,sans-serif;color:#13263F;background:#E9EEF4;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".pg{width:210mm;min-height:297mm;margin:0 auto 8mm;position:relative;background:#fff;padding-bottom:16mm;box-shadow:0 2px 12px rgba(15,60,110,.12)}@media print{body{background:#fff}.pg{margin:0;box-shadow:none;page-break-after:always;height:297mm;overflow:hidden}}" +
    ".hd{background:#0F3C6E;color:#fff;padding:9mm 14mm 7mm;display:flex;justify-content:space-between;align-items:flex-end}.hd img{height:26px;display:block}.hd .t{font-size:9px;letter-spacing:.14em;text-transform:uppercase;opacity:.75;margin-top:8px}" +
    ".hd .per{text-align:right;font-size:10px;opacity:.85;line-height:1.5}.hd .per b{font-size:13px;opacity:1;display:block}.hd2{background:#0F3C6E;color:#fff;padding:5mm 14mm;display:flex;justify-content:space-between;font-size:9.5px}" +
    ".bd{padding:7mm 14mm 0}h1{font-size:19px;line-height:1.28;margin:0 0 2.5mm;font-weight:700;color:#0F3C6E}h2{font-size:12.5px;margin:0 0 1.2mm;color:#0F3C6E;font-weight:700;line-height:1.3}.sub{font-size:9.5px;color:#5B6B7F;margin:0 0 3mm}" +
    ".kick{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:#1E8FA8;font-weight:700;margin:0 0 1.5mm}.res{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin:4mm 0 6mm}" +
    ".res div{border-top:3px solid #36B0C9;background:#F3F6FA;padding:3.5mm 4mm;font-size:9.5px;line-height:1.5}.res div b{display:block;font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:#0F3C6E;margin-bottom:1.5mm}" +
    ".kpis{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #DCE3EB;border-radius:6px;overflow:hidden;margin-bottom:6mm}.k{padding:3.5mm 4mm;border-right:1px solid #DCE3EB;border-bottom:1px solid #DCE3EB}.k:nth-child(3n){border-right:0}.k:nth-child(n+4){border-bottom:0}" +
    ".k .v{font-size:21px;font-weight:700;color:#0F3C6E;line-height:1.1}.k .l{font-size:9px;color:#5B6B7F;margin-top:1mm}.k .d{font-size:9px;font-weight:700;margin-top:1.5mm}.up{color:#C2412C}.dn{color:#1E8C7A}.nt{color:#5B6B7F}" +
    ".box{border:1px solid #DCE3EB;border-radius:6px;padding:4mm 5mm;margin-bottom:5mm}.g2{display:grid;grid-template-columns:1fr 1fr;gap:5mm}table{width:100%;border-collapse:collapse;font-size:9.5px}" +
    "th{font-size:7.8px;text-transform:uppercase;letter-spacing:.06em;color:#5B6B7F;text-align:right;padding:2mm;border-bottom:1.5px solid #0F3C6E;font-weight:700}th:first-child,td:first-child{text-align:left}" +
    "td{padding:2.2mm 2mm;border-bottom:1px solid #E6ECF2;text-align:right;white-space:nowrap}td.n{white-space:normal;font-weight:600}td.vz{text-align:left;color:#5B6B7F;white-space:normal}" +
    ".ml{color:#A07D00;font-weight:600}.az{color:#C46A00;font-weight:600}.mg{color:#1F6FD1;font-weight:600}.sh{color:#D7381A;font-weight:600}svg .ax{font-size:8.5px;fill:#5B6B7F}svg .vl{font-size:9px;font-weight:700}svg .cl{font-size:8.6px;fill:#13263F}" +
    ".ins{font-size:9.3px;line-height:1.55;margin:3mm 0 0;padding:3mm 4mm;background:#F3F6FA;border-left:3px solid #EA6852}.rec td{white-space:normal;text-align:left;vertical-align:top;line-height:1.5}.rec td.p{width:15mm}.rec i{color:#5B6B7F;font-style:normal;font-weight:600}" +
    ".tag{display:inline-block;font-size:7.8px;font-weight:700;padding:.6mm 2mm;border-radius:3px}.alta{background:#FDE7E3;color:#C2412C}.media{background:#FFF1D6;color:#9A6A00}" +
    ".ft{position:absolute;left:14mm;right:14mm;bottom:6mm;display:flex;justify-content:space-between;font-size:8px;color:#8494A7;border-top:1px solid #E6ECF2;padding-top:2mm}" +
    ".g4{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;font-size:8.8px;line-height:1.5;color:#3A4B60}.g4 b{display:block;color:#0F3C6E;font-size:9.5px;margin-bottom:1mm}.met{background:#F7F9FC}.auto{font-size:8px;color:#8494A7;margin:2mm 0 0}" +
    ".teste{background:#F2C14E;color:#3A2A00;font-size:9px;font-weight:700;text-align:center;padding:2mm}";
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório gerencial Dellamed · ' + E(per.rotulo) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet"><style>' + css + '</style></head><body>' +
    (R.teste ? '<div class="teste">TESTE · relatório parcial da quinzena em curso (até ' + relData_(per.fim) + '), enviado só para o admin</div>' : '') +
    // página 1
    '<section class="pg"><div class="hd"><div>' + (logo ? '<img src="' + logo + '" alt="Dellamed">' : '<b style="font-size:20px">dellamed</b>') + '<div class="t">Relatório gerencial · Marketplaces e concorrência</div></div>' +
    '<div class="per"><b>' + E(per.rotulo) + '</b>' + relData_(per.ini) + ' a ' + relData_(per.fim) + ' · comparado com ' + relData_(ant.ini) + ' a ' + relData_(ant.fim) + '</div></div><div class="bd">' +
    '<p class="kick">Resumo executivo</p><h1>' + E(R.titulo) + '</h1><p class="sub">' + E(R.mks.map(function (m) { return relMkNome_(m.mk); }).join(', ').replace(/, ([^,]*)$/, ' e $1') || 'Mercado Livre, Amazon, Magalu e Shopee') + ' · ' + relInt_(k.nSellers) + ' revendedores e ' + relInt_(k.nAds) + ' anúncios de terceiros na coleta de ' + relData_(R.coleta) + '</p>' +
    '<div class="res">' + R.res.map(function (x) { return '<div><b>' + x[0] + '</b>' + x[1] + '</div>'; }).join('') + '</div>' +
    '<div class="kpis">' + kpis + '</div>' +
    '<div class="box"><h2>Evolução dos anúncios abaixo do preço base</h2><p class="sub">% de anúncios de terceiros abaixo do preço base, última coleta de cada quinzena</p>' + linha + '<div class="ins">' + R.insTrend + '</div></div>' +
    '</div>' + rod(1) + '</section>' +
    // página 2
    '<section class="pg">' + cab2 + '<div class="bd"><p class="kick">Preço e revendedores</p><h1>' + E(R.titulo2) + '</h1><p class="sub">Ranking por agressividade: gravidade do desconto × frequência das violações</p>' +
    '<div class="box"><h2>Sellers mais agressivos da quinzena</h2><table><tr><th>Seller</th><th>Marketplace</th><th>Anúncios abaixo</th><th>Desconto médio</th><th>Maior desconto</th><th>vs quinzena anterior</th></tr>' + tabAgr + '</table></div>' +
    '<div class="g2"><div class="box"><h2>SKUs mais atacados</h2><p class="sub">Sellers abaixo do base e maior desconto</p><table><tr><th>Produto</th><th>Sellers</th><th>Maior desconto</th></tr>' + tabSku + '</table></div>' +
    '<div class="box"><h2>Onde estão as violações</h2><p class="sub">% dos anúncios abaixo do base, por marketplace</p><table><tr><th>Marketplace</th><th>Anúncios</th><th>Abaixo do base</th><th>Variação</th></tr>' + tabMk + '</table>' + (R.insMk ? '<div class="ins">' + R.insMk + '</div>' : '') + '</div></div>' +
    '<div class="box"><h2>' + E(R.tituloNovos) + '</h2><p class="sub">Sellers que não estavam na última coleta da quinzena anterior</p><table><tr><th>Seller</th><th>Marketplace</th><th>SKUs Dellamed</th><th>Menor preço vs base</th><th>Situação</th></tr>' + tabNovos + '</table></div>' +
    '</div>' + rod(2) + '</section>' +
    // página 3
    '<section class="pg">' + cab2 + '<div class="bd"><p class="kick">Concorrência e cliente</p><h1>' + E(R.titulo3) + '</h1><p class="sub">Mediana de preço Dellamed contra a mediana dos concorrentes, por categoria</p>' +
    '<div class="g2"><div class="box"><h2>Posição de preço por categoria</h2><p class="sub">Coral: mais de 10% acima; verde: mais de 10% abaixo</p>' + div + '</div>' +
    '<div class="box"><h2>Concorrentes prioritários que mais baixaram preço</h2><p class="sub">Mesmo anúncio, última coleta de cada quinzena</p><table><tr><th>Marca · produto</th><th>Preço</th><th>Variação</th></tr>' + tabQ + '</table>' + (R.insQuedas ? '<div class="ins">' + R.insQuedas + '</div>' : '') + '</div></div>' +
    '<div class="g2"><div class="box"><h2>Voz do cliente: NPS por produto</h2><p class="sub">Produtos Dellamed com 3 ou mais avaliações na quinzena</p><table><tr><th>Produto</th><th>NPS</th><th>Variação</th><th>Em aberto</th></tr>' + tabNps + '</table><div class="ins">' + R.insNps + '</div></div>' +
    '<div class="box"><h2>Recomendações e próximos passos</h2><table class="rec">' + tabRec + '</table><p class="auto">Sugestões automáticas a partir dos dados. Validar responsáveis e prazos antes de repassar.</p></div></div>' +
    '<div class="box met"><h2>Como ler este relatório</h2><div class="g4"><div><b>Preço base</b>Preço da loja oficial Dellamed no Mercado Livre na data da coleta.</div>' +
    '<div><b>Abaixo do base</b>Anúncio de terceiro ' + Math.round((typeof TOLERANCIA_PRECO === 'number' ? TOLERANCIA_PRECO : 0.03) * 100) + '% ou mais abaixo do preço base.</div>' +
    '<div><b>Agressividade</b>0 a 100: metade pelo desconto médio nas violações, metade pela frequência de anúncios abaixo do base.</div>' +
    '<div><b>NPS</b>Avaliações dos marketplaces no período: 5★ promotor, 4★ neutro, 1 a 3★ detrator.</div></div>' +
    '<p class="sub" style="margin:3mm 0 0">Fonte: coletas diárias nos três marketplaces. Comparações contra a última coleta da quinzena anterior (' + relData_(R.coletaAnt || ant.fim) + ').</p></div>' +
    '</div>' + rod(3) + '</section></body></html>';
  return html;
}

/* ---------- corpo do e-mail (resumo; o relatório completo vai anexo) ---------- */
function relEmailHtml_(R, url) {
  const k = R.kpi, E = relEsc_;
  const cel = function (v, l, d, cor) { return '<td style="padding:12px 14px;border:1px solid #DCE3EB;vertical-align:top;width:33%"><div style="font-size:22px;font-weight:700;color:#0F3C6E">' + v + '</div><div style="font-size:12px;color:#5B6B7F">' + l + '</div><div style="font-size:12px;font-weight:700;color:' + (cor || '#5B6B7F') + ';margin-top:3px">' + d + '</div></td>'; };
  const dpp = k.pctAnt === null ? null : k.pct - k.pctAnt;
  return '<div style="font-family:Montserrat,Arial,sans-serif;color:#13263F;max-width:680px">' +
    (R.teste ? '<div style="background:#F2C14E;color:#3A2A00;font-weight:700;font-size:12px;padding:8px 12px;margin-bottom:8px">TESTE · enviado só para o admin</div>' : '') +
    '<div style="background:#0F3C6E;color:#fff;padding:18px 20px"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.8">Relatório gerencial · Marketplaces</div><div style="font-size:18px;font-weight:700;margin-top:4px">' + E(R.per.rotulo) + '</div></div>' +
    '<div style="padding:18px 4px 6px"><div style="font-size:18px;font-weight:700;color:#0F3C6E;line-height:1.35">' + E(R.titulo) + '</div></div>' +
    R.res.map(function (x) { return '<div style="border-left:3px solid #36B0C9;background:#F3F6FA;padding:10px 14px;margin:8px 0;font-size:13px;line-height:1.5"><b style="color:#0F3C6E">' + x[0] + ':</b> ' + x[1] + '</div>'; }).join('') +
    '<table style="border-collapse:collapse;width:100%;margin:14px 0"><tr>' +
    cel(relPct_(k.pct, 0), 'Anúncios abaixo do preço base', dpp === null ? '' : relPp_(dpp), dpp > 0 ? '#C2412C' : '#1E8C7A') +
    cel(k.desc ? '−' + relPct_(k.desc, 1) : '—', 'Desconto médio nas violações', '') +
    cel(relInt_(k.nSellers), 'Revendedores', R.temAnt ? '+' + k.nNovos + ' novos' : '') + '</tr><tr>' +
    cel(relInt_(k.nAds), 'Anúncios de terceiros', '') +
    cel(k.nps === null ? '—' : (k.nps > 0 ? '+' : '') + k.nps, 'NPS Dellamed', k.npsAnt === null || k.nps === null ? '' : (k.nps === k.npsAnt ? 'estável' : (k.nps - k.npsAnt > 0 ? '▲ ' : '▼ ') + Math.abs(k.nps - k.npsAnt) + ' pontos'), k.nps < k.npsAnt ? '#C2412C' : k.nps > k.npsAnt ? '#1E8C7A' : '#5B6B7F') +
    cel(String(k.abertos), 'Ocorrências em aberto', k.tratadas + ' tratadas na quinzena') + '</tr></table>' +
    '<p style="font-size:11px;color:#8494A7">Diagnóstico Dellamed · enviado automaticamente nos dias 15 e no último dia de cada mês.</p></div>';
}
