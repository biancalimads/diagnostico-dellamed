/************************************************************
 * BASE DE EXEMPLO — só para testar o painel.
 * Linhas com origem = EXEMPLO. Sellers e marcas concorrentes são
 * fictícios e os preços são ilustrativos; as fotos são as oficiais
 * da pasta de marketing no Drive. O painel mostra um aviso enquanto
 * houver linha de exemplo. Remova pelo menu Diagnóstico.
 ************************************************************/

function carregarExemplo() {
  configurarPlanilha();
  let seed = 7;
  const rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
  const foto = function (id) { return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w600'; };

  const produtos = [
    { sku: 'D30', produto: 'Cadeira de Banho D30', categoria: 'Cadeiras de banho', linha: 'Home Care', preco: 459.90, foto: foto('14uGXUQRZoAmtNSzDkpIO8gRLu5Xg_ujo') },
    { sku: 'D55', produto: 'Cadeira de Banho D55 Ultraleve', categoria: 'Cadeiras de banho', linha: 'Home Care', preco: 529.90, foto: foto('1son5mRwohS0NVv-wxO29uZmwE2q7xFp8') },
    { sku: 'D100', produto: 'Cadeira de Rodas D100', categoria: 'Cadeiras de rodas', linha: 'Home Care', preco: 899.90, foto: foto('1b64kX7kQksFEKaSgQJtqzKE9emirKddb') },
    { sku: 'D1000', produto: 'Cadeira de Rodas Motorizada D1000', categoria: 'Cadeiras motorizadas', linha: 'Home Care', preco: 8990.00, foto: foto('1S792nKsCugwKFU4_Nz2xkxhKDI5CHvY2') },
    { sku: 'D11', produto: 'Andador 3 Rodas D11', categoria: 'Andadores', linha: 'Home Care', preco: 389.90, foto: foto('1oIU8PNerbQq-xyDY4XJnIPDnpABejjme') },
    { sku: 'D8', produto: 'Bengala Tipo T D8', categoria: 'Bengalas e muletas', linha: 'Home Care', preco: 89.90, foto: foto('1WeNapurSo3Igw4QSsn96ublrEIA56CkJ') },
    { sku: 'OXIPED', produto: 'Oxímetro de Dedo Pediátrico', categoria: 'Oxímetros', linha: 'Health Care', preco: 149.90, foto: foto('1aPqupf100aZzhF73GeyV1eTrRaa5eFJ0') }
  ];
  appendObjs_('PRODUTOS_BASE', produtos.map(function (p) {
    return { sku: p.sku, produto: p.produto, categoria: p.categoria, linha: p.linha, preco_base: p.preco,
             link_oficial: 'https://www.mercadolivre.com.br/loja/dellamed', origem: 'EXEMPLO', foto: p.foto };
  }));

  const mks = ['Mercado Livre', 'Mercado Livre', 'Amazon', 'Magazine Luiza'];
  const hoje = new Date(), ads = [];
  for (let i = 1; i <= 26; i++) {
    const s = { nome: 'Loja Exemplo ' + ('0' + i).slice(-2), rep: Math.round((2.5 + rnd() * 2.5) * 10) / 10, agress: rnd(), porte: rnd() };
    const n = 2 + Math.floor(s.porte * 8);
    for (let k = 0; k < n; k++) {
      const p = pick(produtos);
      const fator = s.agress > 0.6 ? 0.78 + rnd() * 0.2 : 0.95 + rnd() * 0.12;
      ads.push({ data_captura: hoje, marketplace: pick(mks), seller: s.nome, sku: p.sku, titulo: p.produto + ' (anúncio de exemplo)',
                 preco: Math.round(p.preco * fator * 100) / 100, link: '', reputacao_0a5: s.rep,
                 avaliacoes: Math.floor(rnd() * 400 * s.porte), vendidos: Math.floor(rnd() * 900 * s.porte),
                 ganha_buybox: (s.agress > 0.6 && rnd() > 0.45) ? 'Sim' : 'Não', origem: 'EXEMPLO', foto: p.foto });
    }
  }
  produtos.forEach(function (p) {
    ads.push({ data_captura: hoje, marketplace: 'Mercado Livre', seller: 'DELLAMED', sku: p.sku, titulo: p.produto, preco: p.preco,
               link: 'https://www.mercadolivre.com.br/loja/dellamed', reputacao_0a5: 5, avaliacoes: 300, vendidos: 800,
               ganha_buybox: 'Sim', origem: 'EXEMPLO', foto: p.foto });
  });
  appendObjs_('ANUNCIOS', ads);

  const SINGULAR = { 'Cadeiras de banho': 'Cadeira de banho', 'Cadeiras de rodas': 'Cadeira de rodas', 'Cadeiras motorizadas': 'Cadeira motorizada',
                     'Andadores': 'Andador', 'Bengalas e muletas': 'Bengala', 'Oxímetros': 'Oxímetro' };
  const marcas = ['Concorrente A', 'Concorrente B', 'Concorrente C', 'Concorrente D'];
  const fortes = ['Preço de entrada agressivo', 'Muitas avaliações positivas', 'Entrega Full em todo o país', 'Linha ampla na categoria', 'Fotos e vídeo no anúncio'];
  const fracos = ['Estrutura mais pesada', 'Garantia curta', 'Poucas avaliações', 'Reclamações de montagem', 'Sem registro Anvisa visível no anúncio'];
  const conc = [];
  produtos.forEach(function (p) {
    marcas.forEach(function (m) {
      const nProd = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < nProd; k++) {
        conc.push({ categoria: p.categoria, marca: m, produto: (SINGULAR[p.categoria] || p.categoria) + ' ' + m.slice(-1) + (k + 1),
                    marketplace: pick(mks), preco: Math.round(p.preco * (0.7 + rnd() * 0.55) * 100) / 100,
                    nota_0a5: Math.round((3.6 + rnd() * 1.3) * 10) / 10, avaliacoes: Math.floor(rnd() * 900), vendidos: Math.floor(rnd() * 2500),
                    link: '', pontos_fortes: pick(fortes), pontos_fracos: pick(fracos), origem: 'EXEMPLO', foto: '' });
      }
    });
    conc.push({ categoria: p.categoria, marca: 'Dellamed', produto: p.produto, marketplace: 'Mercado Livre', preco: p.preco, nota_0a5: 4.7,
                avaliacoes: 300, vendidos: 800, link: 'https://www.mercadolivre.com.br/loja/dellamed',
                pontos_fortes: 'Fabricante nacional; assistência técnica', pontos_fracos: '', origem: 'EXEMPLO', foto: p.foto });
  });
  appendObjs_('CONCORRENTES', conc);

  // Voz do cliente: avaliações fictícias (textos de exemplo)
  const T = {
    5: [['Excelente', 'Chegou bem embalado e antes do prazo. Muito firme, minha mãe se sentiu segura.'],
        ['Recomendo', 'Produto de qualidade, fácil de montar e o acabamento é muito bom.'],
        ['Perfeito', 'Atendeu tudo que eu precisava. Leve e prático de guardar.'],
        ['Ótimo custo-benefício', 'Pelo preço, superou a expectativa. Material resistente.']],
    4: [['Bom produto', 'Cumpre o que promete, só achei o manual pouco claro na montagem.'],
        ['Gostei', 'Bom, mas a entrega atrasou dois dias.'],
        ['Satisfeita', 'Produto bom, o tamanho é um pouco menor do que eu imaginava.']],
    3: [['Razoável', 'Funciona, mas o material parece mais fraco do que nas fotos.'],
        ['Mais ou menos', 'A trava da roda é dura e difícil de acionar.']],
    2: [['Esperava mais', 'Veio faltando um parafuso e demorei para conseguir troca.'],
        ['Não gostei', 'A pintura começou a descascar depois de algumas semanas de uso no banho.']],
    1: [['Veio com defeito', 'Chegou com a peça quebrada e o atendimento demorou para responder sobre a garantia.'],
        ['Péssimo', 'A entrega atrasou mais de 10 dias e o produto chegou amassado.'],
        ['Não recomendo', 'A bateria não segura carga, precisei devolver.']]
  };
  const pesosDm = [5, 5, 5, 5, 5, 4, 4, 4, 3, 2, 1], pesosC = [5, 5, 5, 4, 4, 3, 3, 2, 1, 1];
  const aval = [], ocorr = [];
  let rid = 1;
  const add = function (marca, cat, sku, prod, foto, pesos) {
    const nota = pick(pesos), t = pick(T[nota]);
    const dt = new Date(hoje.getTime() - Math.floor(rnd() * 60) * 86400000);
    const id = 'EX-' + (rid++);
    aval.push({ review_id: id, data: dt, marketplace: pick(mks), marca: marca, categoria: cat, sku: sku, produto: prod, nota_1a5: nota,
                titulo: t[0], texto: t[1], link: '', foto: foto, item_id: '', origem: 'EXEMPLO' });
    if (marca === 'Dellamed' && nota <= 3 && rnd() > 0.55)
      ocorr.push([id, 'tratada', 'comercial.sul@dellamed.com.br', dt, 'Cliente contatado, troca enviada.']);
  };
  produtos.forEach(function (p) {
    for (let k = 0; k < 12; k++) add('Dellamed', p.categoria, p.sku, p.produto, p.foto, pesosDm);
    marcas.forEach(function (m) { for (let k = 0; k < 3; k++) add(m, p.categoria, '', (SINGULAR[p.categoria] || p.categoria) + ' ' + m.slice(-1) + '1', '', pesosC); });
  });
  appendObjs_('AVALIACOES', aval);
  if (ocorr.length) { const oc = aba_('OCORRENCIAS'); oc.getRange(oc.getLastRow() + 1, 1, ocorr.length, 5).setValues(ocorr); }
  SpreadsheetApp.getActive().toast('Base de exemplo carregada (' + ads.length + ' anúncios).');
}

function limparExemplo() {
  ['PRODUTOS_BASE', 'ANUNCIOS', 'CONCORRENTES', 'AVALIACOES'].forEach(function (nome) {
    const sh = aba_(nome);
    const v = sh.getDataRange().getValues();
    const col = v[0].map(function (h) { return String(h).toLowerCase(); }).indexOf('origem');
    if (col < 0) return;
    const manter = [v[0]].concat(v.slice(1).filter(function (r) { return String(r[col]).toUpperCase() !== 'EXEMPLO'; }));
    sh.clearContents();
    sh.getRange(1, 1, manter.length, manter[0].length).setValues(manter);
  });
  const oc = aba_('OCORRENCIAS'), ov = oc.getDataRange().getValues();
  for (let i = ov.length - 1; i >= 1; i--) if (String(ov[i][0]).indexOf('EX-') === 0) oc.deleteRow(i + 1);
  SpreadsheetApp.getActive().toast('Base de exemplo removida.');
}
