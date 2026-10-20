/* Nota de serviço em PDF, gerada no próprio aparelho (sem biblioteca externa).
   Monta um PDF simples (A4) com as fontes padrão Helvetica, que todo leitor de
   PDF já tem, e o logo da oficina como imagem JPEG. Funciona sem internet.
   Uso: Nota.preparar() (carrega o logo) e depois Nota.gerar(dados) -> Blob. */
const Nota = (() => {
  // ---------- larguras das letras (Helvetica, em milésimos do tamanho) ----------
  // caracteres 32 a 126, na ordem
  const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,
    278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,
    944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,
    278,556,500,722,500,500,500,334,260,334,584];
  const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,
    333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,
    944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,
    333,611,556,778,556,556,500,389,280,389,584];
  // caracteres fora do ASCII: código no PDF (WinAnsi) e largura [normal, negrito]
  const ESPECIAIS = {
    " ": [0xa0, 278, 278], "°": [0xb0, 400, 400], "º": [0xba, 365, 365], "ª": [0xaa, 370, 370],
    "–": [0x96, 556, 556], "—": [0x97, 1000, 1000], "•": [0x95, 350, 350], "·": [0xb7, 278, 278],
    "‘": [0x91, 222, 278], "’": [0x92, 222, 278], "“": [0x93, 333, 500], "”": [0x94, 333, 500],
    "…": [0x85, 1000, 1000], "€": [0x80, 556, 556], "§": [0xa7, 556, 556], "²": [0xb2, 333, 333], "³": [0xb3, 333, 333],
  };
  // código WinAnsi e largura de um caractere
  function glifo(ch, bold) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return [c, (bold ? W_BOLD : W_REG)[c - 32]];
    if (ESPECIAIS[ch]) return [ESPECIAIS[ch][0], ESPECIAIS[ch][bold ? 2 : 1]];
    if (c >= 0xa0 && c <= 0xff) {
      // letras acentuadas têm a largura da letra sem acento
      const base = ch.normalize("NFD")[0];
      const b = base.charCodeAt(0);
      return [c, b >= 32 && b <= 126 ? (bold ? W_BOLD : W_REG)[b - 32] : 556];
    }
    if (/\s/.test(ch)) return [32, 278];
    return [63, bold ? 611 : 556]; // "?" para o que a fonte padrão não tem
  }
  const largura = (txt, size, bold) => [...String(txt)].reduce((s, ch) => s + glifo(ch, bold)[1], 0) * size / 1000;
  // texto -> string do PDF (bytes acima de 126 como \ddd, assim o arquivo fica em ASCII)
  function strPDF(txt, bold) {
    let o = "";
    for (const ch of String(txt)) {
      const c = glifo(ch, bold)[0];
      if (c === 40 || c === 41 || c === 92) o += "\\" + String.fromCharCode(c);
      else if (c < 32 || c > 126) o += "\\" + c.toString(8).padStart(3, "0");
      else o += String.fromCharCode(c);
    }
    return "(" + o + ")";
  }
  // quebra o texto em linhas que cabem na largura
  function quebrar(txt, maxW, size, bold) {
    const linhas = [];
    for (const par of String(txt ?? "").split(/\r?\n/)) {
      let atual = "";
      for (let palavra of par.split(/\s+/).filter(Boolean)) {
        // palavra maior que a linha: corta em pedaços
        while (largura(palavra, size, bold) > maxW) {
          let n = palavra.length;
          while (n > 1 && largura(palavra.slice(0, n), size, bold) > maxW) n--;
          if (atual) { linhas.push(atual); atual = ""; }
          linhas.push(palavra.slice(0, n));
          palavra = palavra.slice(n);
        }
        const tent = atual ? atual + " " + palavra : palavra;
        if (largura(tent, size, bold) <= maxW) atual = tent;
        else { linhas.push(atual); atual = palavra; }
      }
      linhas.push(atual);
    }
    return linhas;
  }

  // ---------- montagem do PDF ----------
  const A4 = { w: 595.28, h: 841.89 };
  const n2 = (v) => (Math.round(v * 100) / 100).toString();
  const cor = (hex) => {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((i) => n2(parseInt(h.slice(i, i + 2), 16) / 255)).join(" ");
  };
  class Doc {
    constructor() { this.paginas = []; this.imagem = null; this.novaPagina(); }
    novaPagina() { this.ops = []; this.paginas.push(this.ops); }
    // y medido do topo da página; no texto, y é a linha de base
    texto(x, y, txt, { size = 10, bold = false, c = "#1c2230", alinhar = "esq" } = {}) {
      const w = largura(txt, size, bold);
      const x0 = alinhar === "dir" ? x - w : alinhar === "centro" ? x - w / 2 : x;
      this.ops.push(`BT /${bold ? "F2" : "F1"} ${n2(size)} Tf ${cor(c)} rg ${n2(x0)} ${n2(A4.h - y)} Td ${strPDF(txt, bold)} Tj ET`);
    }
    ret(x, y, w, h, { fill = null, stroke = null, lw = 0.8 } = {}) {
      const op = fill && stroke ? "B" : fill ? "f" : "S";
      this.ops.push(`q ${fill ? cor(fill) + " rg " : ""}${stroke ? cor(stroke) + " RG " + n2(lw) + " w " : ""}${n2(x)} ${n2(A4.h - y - h)} ${n2(w)} ${n2(h)} re ${op} Q`);
    }
    linha(x1, y1, x2, y2, { c = "#e3e6eb", lw = 0.8, tracejada = false } = {}) {
      this.ops.push(`q ${cor(c)} RG ${n2(lw)} w ${tracejada ? "[3 2] 0 d " : ""}${n2(x1)} ${n2(A4.h - y1)} m ${n2(x2)} ${n2(A4.h - y2)} l S Q`);
    }
    foto(x, y, w, h) {
      if (this.imagem) this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(A4.h - y - h)} cm /Im1 Do Q`);
    }
    // junta tudo num arquivo PDF
    arquivo(titulo) {
      const partes = [], offs = [];
      let tam = 0;
      const enc = new TextEncoder();
      const add = (p) => { const b = typeof p === "string" ? enc.encode(p) : p; partes.push(b); tam += b.length; };
      const obj = (n, corpo) => { offs[n] = tam; add(`${n} 0 obj\n`); for (const c of [].concat(corpo)) add(c); add("\nendobj\n"); };
      add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
      const nPag = this.paginas.length, temImg = !!this.imagem;
      const primeiraPag = temImg ? 6 : 5;
      const kids = this.paginas.map((_, i) => `${primeiraPag + i * 2} 0 R`).join(" ");
      obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
      obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${nPag} >>`);
      obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      if (temImg) {
        const im = this.imagem;
        obj(5, [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, "\nendstream"]);
      }
      const recursos = `<< /Font << /F1 3 0 R /F2 4 0 R >>${temImg ? " /XObject << /Im1 5 0 R >>" : ""} >>`;
      this.paginas.forEach((ops, i) => {
        const nP = primeiraPag + i * 2, nC = nP + 1;
        const conteudo = ops.join("\n");
        obj(nP, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources ${recursos} /Contents ${nC} 0 R >>`);
        obj(nC, `<< /Length ${enc.encode(conteudo).length} >>\nstream\n${conteudo}\nendstream`);
      });
      const nInfo = primeiraPag + nPag * 2;
      obj(nInfo, `<< /Title ${strPDF(titulo)} /Producer (Oficina - historico de servicos) >>`);
      const xref = tam;
      let x = `xref\n0 ${nInfo + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i <= nInfo; i++) x += String(offs[i]).padStart(10, "0") + " 00000 n \n";
      add(x + `trailer\n<< /Size ${nInfo + 1} /Root 1 0 R /Info ${nInfo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      const out = new Uint8Array(tam);
      let p = 0;
      for (const b of partes) { out.set(b, p); p += b.length; }
      return out;
    }
  }

  // ---------- logo ----------
  let logo = null, carregando = null;
  // carrega o logo uma vez (fica guardado para as próximas notas)
  function preparar(src = "logo-branco.png") {
    if (logo || carregando) return carregando || Promise.resolve(logo);
    carregando = new Promise((ok) => {
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement("canvas");
          cv.width = img.naturalWidth; cv.height = img.naturalHeight;
          const g = cv.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
          g.drawImage(img, 0, 0);
          const b64 = cv.toDataURL("image/jpeg", 0.92).split(",")[1];
          const bin = atob(b64), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          logo = { w: cv.width, h: cv.height, bytes };
        } catch (e) { logo = null; }
        carregando = null; ok(logo);
      };
      img.onerror = () => { carregando = null; ok(null); };
      img.src = src;
    });
    return carregando;
  }

  // ---------- a nota ----------
  /* dados: { oficina: {nome, endereco, telefone, documento}, data: "15/10/2026",
              cliente: {nome, telefone, endereco}, veiculo: {placa, nome},
              itens: [texto], maoDeObra, pecas, total, temDivisao, fmt: (valor) => "R$ ..." } */
  function gerar(d) {
    const doc = new Doc();
    doc.imagem = logo;
    const M = 42, L = A4.w - M * 2, DIR = A4.w - M;
    const LARANJA = "#e8590c", ESCURO = "#201e1f", CINZA = "#6b7385", BORDA = "#e3e6eb", CREME = "#fff4ec";
    let y = 40;

    // cabeçalho: logo, dados da oficina e quadro com a data do serviço
    const logoH = 66, logoW = logo ? (logoH * logo.w) / logo.h : 0;
    if (logo) doc.foto(M, y, logoW, logoH);
    const quadroW = 168, quadroX = DIR - quadroW;
    const infoX = M + (logo ? logoW + 14 : 0), infoW = quadroX - infoX - 12;
    let yi = y + 15;
    for (const l of quebrar(d.oficina.nome || "Oficina", infoW, 15, true)) { doc.texto(infoX, yi, l, { size: 15, bold: true }); yi += 18; }
    yi += 1;
    const linhaInfo = (txt) => { for (const l of quebrar(txt, infoW, 9.5)) { doc.texto(infoX, yi, l, { size: 9.5, c: "#3d4454" }); yi += 13; } };
    if (d.oficina.endereco) linhaInfo(d.oficina.endereco);
    if (d.oficina.telefone) linhaInfo("Telefone: " + d.oficina.telefone);
    if (d.oficina.documento) linhaInfo("CNPJ/CPF: " + d.oficina.documento);
    const qc = quadroX + quadroW / 2;
    doc.ret(quadroX, y, quadroW, logoH, { fill: CREME });
    doc.ret(quadroX, y + logoH - 4, quadroW, 4, { fill: LARANJA });
    doc.texto(qc, y + 24, "DATA DO SERVIÇO", { size: 8, bold: true, c: CINZA, alinhar: "centro" });
    doc.texto(qc, y + 48, d.data || "—", { size: 20, bold: true, c: LARANJA, alinhar: "centro" });
    y = Math.max(y + logoH, yi - 6) + 16;

    // título "Nota de serviço" abaixo do cabeçalho
    doc.linha(M, y, DIR, y, { c: BORDA });
    y += 14;
    doc.ret(M, y, L, 34, { fill: CREME });
    doc.ret(M, y, 5, 34, { fill: LARANJA });
    doc.texto(M + 18, y + 23, "Nota de serviço", { size: 17, bold: true, c: ESCURO });
    y += 34 + 24;

    // cliente e veículo
    const colW = (L - 20) / 2, col2 = M + colW + 20;
    const rotulo = (x, yy, txt) => doc.texto(x, yy, txt, { size: 7.5, bold: true, c: CINZA });
    rotulo(M, y, "CLIENTE"); rotulo(col2, y, "VEÍCULO");
    let y1 = y + 16, y2 = y + 16;
    for (const l of quebrar(d.cliente.nome || "—", colW, 11.5, true)) { doc.texto(M, y1, l, { size: 11.5, bold: true }); y1 += 15; }
    const valCol = (x, yy, txt) => { for (const l of quebrar(txt, colW, 9.5)) { doc.texto(x, yy, l, { size: 9.5, c: "#3d4454" }); yy += 13; } return yy; };
    if (d.cliente.telefone) y1 = valCol(M, y1, "Telefone: " + d.cliente.telefone);
    if (d.cliente.endereco) y1 = valCol(M, y1, "Endereço: " + d.cliente.endereco);
    doc.texto(col2, y2, d.veiculo.placa || "—", { size: 11.5, bold: true }); y2 += 15;
    if (d.veiculo.nome) y2 = valCol(col2, y2, d.veiculo.nome);
    y = Math.max(y1, y2) + 14;

    // serviços realizados (continua em outra página se não couber)
    const limite = A4.h - 50;
    const garantir = (h) => {
      if (y + h > limite) { doc.novaPagina(); y = 50; return true; }
      return false;
    };
    const cabecalhoTabela = (titulo) => {
      doc.ret(M, y, L, 22, { fill: ESCURO });
      doc.texto(M + 12, y + 14.5, titulo, { size: 9, bold: true, c: "#ffffff" });
      y += 22;
    };
    cabecalhoTabela("SERVIÇOS REALIZADOS");
    const itens = d.itens.length ? d.itens : ["—"];
    itens.forEach((item, i) => {
      const linhas = quebrar(item, L - 40, 10.5);
      const h = linhas.length * 14 + 12;
      if (garantir(h)) cabecalhoTabela("SERVIÇOS REALIZADOS (continuação)");
      if (i % 2 === 1) doc.ret(M, y, L, h, { fill: "#fafbfc" });
      doc.texto(M + 12, y + 17, "•", { size: 10.5, bold: true, c: LARANJA });
      linhas.forEach((l, k) => doc.texto(M + 26, y + 17 + k * 14, l, { size: 10.5 }));
      y += h;
      doc.linha(M, y, DIR, y, { c: BORDA });
    });
    y += 18;

    // valores
    garantir(d.temDivisao ? 82 : 32);
    const vW = 250, vX = DIR - vW;
    const linhaValor = (rot, val) => {
      doc.texto(vX + 10, y + 15, rot, { size: 10, c: "#3d4454" });
      doc.texto(DIR - 10, y + 15, val, { size: 10.5, bold: true, alinhar: "dir" });
      y += 22;
      doc.linha(vX, y, DIR, y, { c: BORDA, tracejada: true });
    };
    if (d.temDivisao) {
      linhaValor("Mão de obra", d.fmt(d.maoDeObra));
      linhaValor("Peças", d.fmt(d.pecas));
      y += 6;
    }
    doc.ret(vX, y, vW, 32, { fill: LARANJA });
    doc.texto(vX + 12, y + 20.5, "TOTAL", { size: 11, bold: true, c: "#ffffff" });
    doc.texto(DIR - 12, y + 21.5, d.fmt(d.total), { size: 15, bold: true, c: "#ffffff", alinhar: "dir" });

    const bytes = doc.arquivo(`Nota de serviço ${d.data || ""}`.trim());
    return new Blob([bytes], { type: "application/pdf" });
  }

  return { preparar, gerar, largura, quebrar, pronto: () => !!logo };
})();
