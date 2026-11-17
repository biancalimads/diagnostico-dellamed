/**
 * TESTE ISOLADO DA SHOPEE — não altera nada do painel nem da coleta.
 * Como usar:
 *   1. No Apps Script, clique em + (Adicionar arquivo) › Script e dê o nome TesteShopee.
 *   2. Cole este conteúdo e salve.
 *   3. No topo do editor, escolha a função testeShopee e clique em Executar.
 * Resultado: aba TESTE_SHOPEE na planilha (criada só para o teste) e um resumo na tela.
 * Para remover depois: apague este arquivo e a aba TESTE_SHOPEE.
 */
var TSH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
var TSH_UA_GOOGLE = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
var TSH_UA_BING = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
var TSH_CAMINHOS = ['seo_google', 'seo_bing', 'html', 'v4', 'v2'];
var TSH_BUSCAS_EXTRA = ['mercur cadeira de rodas', 'ortobras cadeira de banho', 'g-tech nebulizador'];   // concorrentes
var TSH_MAX_PRODUTOS = 8;   // produtos Dellamed da aba PRODUTOS_BASE usados no teste

function testeShopee() {
  var ss = SpreadsheetApp.getActive(), resumo = [];
  // 1) qual caminho responde
  var q0 = 'dellamed cadeira de banho', caminho = '';
  TSH_CAMINHOS.forEach(function (c) {
    var r = tshBuscar_(c, q0);
    resumo.push((r.ok ? 'OK      ' + r.itens.length + ' anúncios' : 'FALHOU  ' + r.motivo) + '  —  caminho ' + c);
    if (r.ok && !caminho) caminho = c;
  });
  if (!caminho) {
    resumo.push('', 'Nenhum caminho respondeu. A Shopee bloqueou a leitura a partir do Google hoje.');
    tshAlerta_(resumo); return;
  }
  // 2) buscas reais: produtos da loja + concorrentes
  var buscas = [];
  try {
    var sh = ss.getSheetByName('PRODUTOS_BASE'), v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
    var iP = h.indexOf('produto'), iI = h.indexOf('item');
    for (var i = 1; i < v.length && buscas.length < TSH_MAX_PRODUTOS; i++) {
      var nome = String((iI >= 0 && v[i][iI]) || v[i][iP] || '').trim();
      if (nome) buscas.push('dellamed ' + nome.toLowerCase().split(/\s+/).slice(0, 5).join(' '));
    }
  } catch (e) {}
  if (!buscas.length) buscas.push(q0);
  buscas = buscas.concat(TSH_BUSCAS_EXTRA);
  var linhas = [], lojas = {}, t0 = Date.now();
  buscas.forEach(function (q) {
    if (Date.now() - t0 > 4 * 60 * 1000) return;               // folga para o limite de 6 min do Google
    var r = tshBuscar_(caminho, q);
    if (!r.ok) { linhas.push([q, caminho, 'FALHOU: ' + r.motivo, '', '', '', '', '', '', '']); return; }
    r.itens.slice(0, 15).forEach(function (it) {
      if (!it.seller && it.shopId) it.seller = lojas[it.shopId] !== undefined ? lojas[it.shopId] : (lojas[it.shopId] = tshLoja_(it.shopId));
      linhas.push([q, caminho, it.titulo, it.preco, it.precoOriginal || '', it.seller || '(código ' + it.shopId + ')', it.vendidos || '', it.nota || '', it.avaliacoes || '', it.link]);
    });
  });
  // 3) detalhe e comentários do 1º anúncio
  var primeiro = linhas.filter(function (l) { return /^https/.test(l[9]); })[0];
  if (primeiro) {
    var d = tshDetalhe_(primeiro[9]);
    resumo.push('', d.ok ? 'OK      Página do produto: nota ' + (d.nota || '—') + ', ' + (d.avaliacoes || '—') + ' avaliações, loja ' + (d.seller || '—') : 'AVISO   Página do produto: ' + d.motivo);
    var av = tshComentarios_(primeiro[9]);
    resumo.push(av.ok ? 'OK      Comentários: ' + av.n + ' lidos do 1º anúncio' : 'AVISO   Comentários: ' + av.motivo);
  }
  // 4) grava a aba de teste
  var aba = ss.getSheetByName('TESTE_SHOPEE') || ss.insertSheet('TESTE_SHOPEE');
  aba.clear();
  aba.getRange(1, 1, 1, 10).setValues([['busca', 'caminho', 'título', 'preço', 'preço cheio', 'loja', 'vendidos', 'nota', 'avaliações', 'link']]).setFontWeight('bold');
  if (linhas.length) aba.getRange(2, 1, linhas.length, 10).setValues(linhas);
  aba.setFrozenRows(1);
  var ok = linhas.filter(function (l) { return /^https/.test(l[9]); });
  resumo.push('', ok.length + ' anúncios gravados na aba TESTE_SHOPEE (' + buscas.length + ' buscas, caminho ' + caminho + ').',
              ok.filter(function (l) { return !/^\(código/.test(l[5]); }).length + ' com nome da loja · ' + ok.filter(function (l) { return l[6]; }).length + ' com vendidos.');
  tshAlerta_(resumo);
}

function tshAlerta_(l) {
  Logger.log(l.join('\n'));
  try { SpreadsheetApp.getUi().alert('Teste da Shopee', l.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}
function tshGet_(url, ua, json) {
  try {
    Utilities.sleep(600);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': ua, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
                 'x-api-source': 'pc', 'x-shopee-language': 'pt-BR', Referer: 'https://shopee.com.br/' } });
    var cod = res.getResponseCode(), txt = res.getContentText();
    if (cod !== 200) return { ok: false, motivo: 'HTTP ' + cod };
    return { ok: true, texto: txt };
  } catch (e) { return { ok: false, motivo: String(e.message || e).slice(0, 100) }; }
}
function tshTexto_(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function tshNum_(x) { var n = Number(String(x == null ? '' : x).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function tshPreco_(s) { var m = String(s || '').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/); return m ? tshNum_(m[1]) : 0; }
function tshVend_(s) {
  var m = String(s || '').match(/([\d.,]+)\s*(mil)?\+?\s*vendid/i);
  if (!m) return '';
  var n = Number(m[1].replace(/\./g, '').replace(',', '.')); if (m[2]) n *= 1000;
  return n || '';
}
function tshBuscar_(caminho, q) {
  var kw = encodeURIComponent(q);
  if (caminho === 'seo_google' || caminho === 'seo_bing' || caminho === 'html') {
    var ua = caminho === 'seo_google' ? TSH_UA_GOOGLE : caminho === 'seo_bing' ? TSH_UA_BING : TSH_UA;
    var h = tshGet_('https://shopee.com.br/search?keyword=' + kw, ua, false);
    if (!h.ok) return { ok: false, motivo: h.motivo };
    var itens = tshParseHtml_(h.texto);
    return itens.length ? { ok: true, itens: itens } : { ok: false, motivo: 'página sem produtos (' + Math.round(h.texto.length / 1024) + ' KB)' };
  }
  var url = caminho === 'v4'
    ? 'https://shopee.com.br/api/v4/search/search_items?by=relevancy&keyword=' + kw + '&limit=50&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2'
    : 'https://shopee.com.br/api/v2/search_items/?by=relevancy&keyword=' + kw + '&limit=50&newest=0&order=desc&page_type=search';
  var hj = tshGet_(url, TSH_UA, true);
  if (!hj.ok) return { ok: false, motivo: hj.motivo };
  var j = null; try { j = JSON.parse(hj.texto); } catch (e) {}
  var lista = j && (j.items || (j.data && j.data.items));
  if (!lista || !lista.length) return { ok: false, motivo: 'bloqueio anti-robô' + (j && (j.error || j.error_msg) ? ' (erro ' + (j.error || j.error_msg) + ')' : '') };
  var out = lista.map(function (w) {
    var it = w.item_basic || w; if (!it || !it.name) return null;
    var div = (it.price || it.price_min || 0) > 1e6 ? 100000 : 1, rc = it.item_rating && it.item_rating.rating_count;
    return { titulo: it.name, preco: (it.price || it.price_min || 0) / div, precoOriginal: it.price_before_discount ? it.price_before_discount / div : 0,
             link: 'https://shopee.com.br/product/' + it.shopid + '/' + it.itemid, shopId: String(it.shopid || ''), seller: it.shop_name || '',
             nota: it.item_rating ? Math.round(it.item_rating.rating_star * 10) / 10 : '', avaliacoes: Array.isArray(rc) ? rc[0] : '', vendidos: it.historical_sold || it.sold || '' };
  }).filter(function (x) { return x && x.preco > 0; });
  return out.length ? { ok: true, itens: out } : { ok: false, motivo: 'sem produtos' };
}
function tshParseHtml_(html) {
  var out = [], vistos = {}, m;
  var rx = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
  while ((m = rx.exec(html))) {
    var j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
    [].concat(j).concat((j && j['@graph']) || []).forEach(function (n) {
      var lista = n && n.itemListElement ? [].concat(n.itemListElement) : (n && n['@type'] === 'Product' ? [n] : []);
      lista.forEach(function (x) {
        var pr = x.item || x, url = String(pr.url || x.url || '');
        var id = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/product\/(\d+)\/(\d+)/);
        if (!id || vistos[id[2]]) return;
        var of = Array.isArray(pr.offers) ? pr.offers[0] : (pr.offers || {}), ar = pr.aggregateRating || {};
        vistos[id[2]] = 1;
        out.push({ titulo: tshTexto_(pr.name || ''), preco: Number(of.price || of.lowPrice) || 0, precoOriginal: 0,
                   link: 'https://shopee.com.br/product/' + id[1] + '/' + id[2], shopId: id[1], seller: '',
                   nota: Number(ar.ratingValue) || '', avaliacoes: Number(ar.reviewCount || ar.ratingCount) || '', vendidos: '' });
      });
    });
  }
  var rc = /<a[^>]+href="([^"]*-i\.(\d+)\.(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = rc.exec(html))) {
    var shop = m[2], item = m[3], bloco = m[4];
    if (vistos[item]) continue;
    var txt = tshTexto_(bloco), alt = (bloco.match(/alt="([^"]{8,})"/) || [])[1] || '';
    var nome = tshTexto_(alt);
    if (!nome) { try { nome = decodeURIComponent(m[1].replace(/^.*\//, '').replace(/-i\.\d+\.\d+.*$/, '')).replace(/-/g, ' '); } catch (e) {} }
    var precos = (txt.match(/R\$\s*[\d.]+(?:,\d{1,2})?/g) || []).map(tshPreco_).filter(function (x) { return x > 0; });
    if (!nome || !precos.length) continue;
    vistos[item] = 1;
    out.push({ titulo: nome.trim(), preco: Math.min.apply(null, precos), precoOriginal: precos.length > 1 ? Math.max.apply(null, precos) : 0,
               link: 'https://shopee.com.br/product/' + shop + '/' + item, shopId: shop, seller: '', nota: '', avaliacoes: '', vendidos: tshVend_(txt) });
  }
  return out;
}
function tshLoja_(sid) {
  var h = tshGet_('https://shopee.com.br/api/v4/shop/get_shop_base?shopid=' + sid, TSH_UA, true);
  if (h.ok) { try { var j = JSON.parse(h.texto); var n = j.data && (j.data.name || (j.data.account && j.data.account.username)); if (n) return n; } catch (e) {} }
  var hp = tshGet_('https://shopee.com.br/shop/' + sid, TSH_UA_GOOGLE, false);
  if (!hp.ok) return '';
  var t = (hp.texto.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  return tshTexto_(t).replace(/\s*[|\-–].*shopee.*$/i, '').replace(/^loja (online )?(de |da |do )?/i, '').trim();
}
function tshDetalhe_(link) {
  var ids = String(link).match(/product\/(\d+)\/(\d+)/);
  var hp = tshGet_('https://shopee.com.br/product/' + ids[1] + '/' + ids[2], TSH_UA_GOOGLE, false);
  if (!hp.ok) return { ok: false, motivo: hp.motivo };
  var rx = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g, m;
  while ((m = rx.exec(hp.texto))) {
    var j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
    var p = [].concat(j).filter(function (n) { return n && n['@type'] === 'Product'; })[0];
    if (p) { var of = Array.isArray(p.offers) ? p.offers[0] : (p.offers || {}), ar = p.aggregateRating || {};
      return { ok: true, nota: ar.ratingValue, avaliacoes: ar.reviewCount || ar.ratingCount, seller: of.seller && of.seller.name }; }
  }
  return { ok: false, motivo: 'página sem dados estruturados (' + Math.round(hp.texto.length / 1024) + ' KB)' };
}
function tshComentarios_(link) {
  var ids = String(link).match(/product\/(\d+)\/(\d+)/), motivo = '';
  ['v2', 'v4'].forEach(function (v) {
    if (motivo === 'ok') return;
    var h = tshGet_('https://shopee.com.br/api/' + v + '/item/get_ratings?filter=1&flag=1&itemid=' + ids[2] + '&limit=20&offset=0&shopid=' + ids[1] + '&type=0', TSH_UA, true);
    if (!h.ok) { motivo = v + ': ' + h.motivo; return; }
    try { var j = JSON.parse(h.texto); if (j.data && j.data.ratings) { motivo = 'ok'; tshComentarios_.n = j.data.ratings.length; } else motivo = v + ': sem avaliações (erro ' + (j.error || '?') + ')'; }
    catch (e) { motivo = v + ': resposta não é JSON'; }
  });
  return motivo === 'ok' ? { ok: true, n: tshComentarios_.n } : { ok: false, motivo: motivo };
}
