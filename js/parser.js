function parsePlanilha(workbook) {
  const sheetName = workbook.SheetNames.find(n =>
    n.toUpperCase().includes('EMISS') && n.toUpperCase().includes('NOTAS')
  );
  if (!sheetName) throw new Error('Aba "EMISSÃO DAS NOTAS" não encontrada.');

  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const blocos = [];
  let bmGlobal = '', periodoGlobal = '';
  let bloco = null;
  let aguardandoTributos = false;

  function textoLinha(row) {
    return row.map(c => String(c).trim()).join(' ');
  }

  function extrairNumero(row, startIdx) {
    for (let i = startIdx; i < row.length; i++) {
      let cell = row[i];
      if (typeof cell === 'number') return cell;
      if (typeof cell === 'string') {
        const v = cell.replace(/[^\d,-]/g, '').replace(',', '.');
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0) return n;
      }
    }
    return 0;
  }

  function extrairCidade(texto) {
    const m = texto.match(/NA CIDADE DE\s+([^,.]+)/i);
    return m ? m[1].trim() : null;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const linha = textoLinha(row);

    if (!bmGlobal) {
      const mBM = linha.match(/BM[:\s]+(\d+\/\d+)/i);
      if (mBM) bmGlobal = mBM[1];
    }
    if (!periodoGlobal) {
      const mP = linha.match(/PERÍODO[:\s]+(\d{2}\/\d{2}\/\d{4}\s*a\s*\d{2}\/\d{2}\/\d{4})/i);
      if (mP) periodoGlobal = mP[1];
    }

    if (linha.toUpperCase().includes('REFERENTE AO PAGAMENTO') || linha.toUpperCase().includes('NA CIDADE DE')) {
      let cidade = extrairCidade(linha.toUpperCase());
      if (cidade) {
        if (linha.toUpperCase().includes('REAJUSTE')) {
          cidade += ' (REAJUSTE)';
        }
        if (bloco) blocos.push(bloco);
        bloco = {
          cidade,
          bm: bmGlobal,
          periodo: periodoGlobal,
          referencia: linha.trim(),
          in: '',
          passagem: 0,
          alimentacao: 0,
          valorNotaFiscal: 0,
          iss_pct: '',
          baseRetencao: 0,
          baseCalculo: 0,
          tributos: { iss: 0, irrf: 0, pis: 0, cofins: 0, csll: 0, inss: 0 },
          emitida: false
        };
        aguardandoTributos = false;
      }
      continue;
    }

    if (!bloco) continue;

    if (linha.toUpperCase().includes('BOLETIM DE MEDIÇÃO')) {
      const m = linha.match(/BOLETIM DE MEDIÇÃO[:\s]+(\d+\/\d+)/i);
      if (m) bloco.bm = m[1];
    }

    if (linha.toUpperCase().startsWith('PERÍODO') && linha.match(/\d{2}\/\d{2}\/\d{4}/)) {
      const m = linha.match(/(\d{2}\/\d{2}\/\d{4}\s*[aA]\s*\d{2}\/\d{2}\/\d{4})/);
      if (m) bloco.periodo = m[1];
    }

    if (linha.toUpperCase().includes('INSTRUÇÃO NORMATIVA')) {
       bloco.in = linha.trim();
    }

    if (linha.toUpperCase().includes('PASSAGEM') && !linha.toUpperCase().includes('CONFORME')) {
      bloco.passagem = extrairNumero(row, 0);
    }

    if (linha.toUpperCase().includes('ALIMENTAÇÃO') || linha.toUpperCase().includes('ALIMENTACAO')) {
      bloco.alimentacao = extrairNumero(row, 0);
    }

    if (linha.toUpperCase().includes('VALOR DA NOTA FISCAL')) {
      bloco.valorNotaFiscal = extrairNumero(row, 0);
      const mISS = linha.match(/ISS[:\s]+([\d,]+%)/i);
      if (mISS) bloco.iss_pct = mISS[1];
    }

    if (linha.toUpperCase().includes('BASE RETENÇÃO') || linha.toUpperCase().includes('BASE RETENCAO')) {
      bloco.baseRetencao = extrairNumero(row, 0);
    }

    if (linha.toUpperCase().includes('BASE DE CALCULO') || linha.toUpperCase().includes('BASE DE CÁLCULO')) {
      bloco.baseCalculo = extrairNumero(row, 0);
    }

    const headerTrib = linha.toUpperCase().includes('IRRF') && linha.toUpperCase().includes('COFINS');
    if (headerTrib) {
      aguardandoTributos = true;
      continue;
    }

    if (aguardandoTributos) {
      const nums = [];
      for (const cell of row) {
        let n = 0;
        if (typeof cell === 'number') n = cell;
        else if (typeof cell === 'string') {
          const v = cell.replace(/[^\d,-]/g, '').replace(',', '.');
          n = parseFloat(v);
        }
        if (!isNaN(n) && n > 0) nums.push(n);
      }
      if (nums.length >= 6) {
        bloco.tributos = {
          iss: nums[0], irrf: nums[1], pis: nums[2],
          cofins: nums[3], csll: nums[4], inss: nums[5]
        };
      }
      aguardandoTributos = false;
    }
  }

  if (bloco) blocos.push(bloco);
  return blocos;
}
