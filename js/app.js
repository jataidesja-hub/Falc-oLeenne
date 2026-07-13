import { db, storage, doc, setDoc, deleteDoc, onSnapshot, collection, getDocs, ref, uploadBytes, getDownloadURL } from './firebase-config.js';

let notasData = [];
let unsubscribe = null;
let currentBmId = null;
let showOnlyPendentes = false;
let pendingToggleNota = null;

const dashSection = document.getElementById('dashboard-section');
const mainSection = document.getElementById('main-section');
const headerMeta = document.getElementById('headerMeta');
const bmList = document.getElementById('bmList');
const grid = document.getElementById('grid');
const statsEl = document.getElementById('stats');
const bmTitle = document.getElementById('bmTitle');
const periodoTitle = document.getElementById('periodoTitle');

const btnNovaPlanilha = document.getElementById('btnNovaPlanilha');
const fileInputPlanilha = document.getElementById('fileInputPlanilha');
const btnVoltar = document.getElementById('btnVoltar');
const filterPendentes = document.getElementById('filterPendentes');
const fileInputAnexo = document.getElementById('fileInputAnexo');
const loadingOverlay = document.getElementById('loadingOverlay');
const btnDownloadZip = document.getElementById('btnDownloadZip');

const btnViewResumo = document.getElementById('btnViewResumo');
const btnViewResumoText = document.getElementById('btnViewResumoText');
const resumoContainer = document.getElementById('resumo-container');
const resumoTbody = document.getElementById('resumo-tbody');
const resumoTfoot = document.getElementById('resumo-tfoot');
const mainSectionTitle = document.getElementById('mainSectionTitle');

let viewMode = 'cards';

btnNovaPlanilha.addEventListener('click', () => fileInputPlanilha.click());
btnVoltar.addEventListener('click', loadDashboard);
filterPendentes.addEventListener('click', () => {
  showOnlyPendentes = !showOnlyPendentes;
  filterPendentes.textContent = showOnlyPendentes ? '📋 Mostrar Todas' : '⏳ Só Pendentes';
  if (viewMode === 'cards') renderCards();
});

btnViewResumo.addEventListener('click', () => {
  viewMode = viewMode === 'cards' ? 'resumo' : 'cards';
  
  if (viewMode === 'resumo') {
    grid.classList.add('hidden');
    resumoContainer.classList.remove('hidden');
    filterPendentes.classList.add('hidden');
    btnViewResumoText.textContent = 'Ver Cards';
    mainSectionTitle.textContent = 'Resumo do BM';
    renderResumo();
  } else {
    grid.classList.remove('hidden');
    resumoContainer.classList.add('hidden');
    filterPendentes.classList.remove('hidden');
    btnViewResumoText.textContent = 'Resumo BM';
    mainSectionTitle.textContent = 'Notas por Cidade';
    renderCards();
  }
});

btnDownloadZip.addEventListener('click', async () => {
  const emitidas = notasData.filter(n => n.emitida && n.anexoUrl);
  if (emitidas.length === 0) {
    alert("Nenhuma nota com anexo foi encontrada neste BM.");
    return;
  }

  loadingOverlay.style.display = 'flex';
  const txt = loadingOverlay.querySelector('p');
  const oldTxt = txt.textContent;
  txt.textContent = 'Baixando anexos e gerando ZIP...';
  
  try {
    const zip = new JSZip();
    let count = 0;

    for (const nota of emitidas) {
      try {
        const response = await fetch(nota.anexoUrl);
        if (!response.ok) throw new Error('Falha no fetch');
        const blob = await response.blob();
        
        // Descobre extensão aproximada
        let ext = 'pdf';
        if (nota.anexoUrl.includes('.png') || blob.type.includes('png')) ext = 'png';
        else if (nota.anexoUrl.includes('.jpg') || nota.anexoUrl.includes('.jpeg') || blob.type.includes('jpeg')) ext = 'jpg';

        const cidadeLimpa = nota.cidade.replace(/[^a-zA-Z0-9 -]/g, '').trim();
        const bmLimpo = nota.bm.replace(/\//g, '-');
        
        const fileName = nota.nomeOriginal || `${cidadeLimpa} - BM ${bmLimpo}.${ext}`;
        zip.file(fileName, blob);
        count++;
      } catch (e) {
        console.error('Erro baixar:', nota.cidade, e);
      }
    }

    if (count > 0) {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `Anexos_BM_${currentBmId.replace('_', '-')}.zip`);
    } else {
      alert("Erro ao baixar os arquivos. Verifique se o Firebase Storage está com as regras de CORS configuradas.");
    }
  } catch (e) {
    alert("Erro geral ao gerar ZIP: " + e.message);
  }
  
  txt.textContent = oldTxt;
  loadingOverlay.style.display = 'none';
});

fileInputPlanilha.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadingOverlay.style.display = 'flex';
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = new Uint8Array(ev.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const parsed = parsePlanilha(wb);
      if (parsed.length === 0) {
        alert('Nenhum bloco encontrado.');
        loadingOverlay.style.display = 'none';
        return;
      }
      
      const bmText = parsed[0].bm || 'SemBM';
      const bmId = bmText.replace(/\//g, '_');
      
      // Salva info do BM
      await setDoc(doc(db, 'bms', bmId), {
        bm: bmText,
        periodo: parsed[0].periodo || '',
        createdAt: new Date().toISOString()
      }, { merge: true });

      // Salva cada nota inicial se não existir
      for (const nota of parsed) {
        const id = nota.cidade.replace(/\s+/g, '_').toUpperCase();
        await setDoc(doc(db, `notas_${bmId}`, id), {
          ...nota,
          emitida: false,
          anexoUrl: null
        }, { merge: true }); // merge previne sobrescrever notas já emitidas
      }

      loadingOverlay.style.display = 'none';
      alert('Planilha importada com sucesso!');
      fileInputPlanilha.value = '';
      loadDashboard();
    } catch (err) {
      loadingOverlay.style.display = 'none';
      alert('Erro: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
});

async function loadDashboard() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  currentBmId = null;
  dashSection.classList.remove('hidden');
  mainSection.classList.add('hidden');
  headerMeta.classList.add('hidden');
  headerMeta.classList.remove('flex');
  bmList.innerHTML = '<p class="text-zinc-400">Carregando BMs...</p>';

  try {
    const snap = await getDocs(collection(db, 'bms'));
    if (snap.empty) {
      bmList.innerHTML = '<p class="text-zinc-400">Nenhuma planilha importada ainda.</p>';
      return;
    }
    const bms = [];
    snap.forEach(d => bms.push({ id: d.id, ...d.data() }));
    bms.sort((a,b) => b.createdAt.localeCompare(a.createdAt));

    bmList.innerHTML = bms.map(b => `
      <div class="group relative bg-zinc-900/50 backdrop-blur-md border border-white/5 rounded-2xl p-6 hover:border-violet-500/50 hover:bg-zinc-900/80 transition-all duration-300 flex flex-col cursor-pointer">
        <div class="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none"></div>
        <div class="flex-1" onclick="openBM('${b.id}', '${b.bm}', '${b.periodo}')">
          <h3 class="text-lg font-semibold text-white mb-1">BM: ${b.bm}</h3>
          <p class="text-sm text-zinc-400">Período: ${b.periodo}</p>
        </div>
        <div class="mt-4 pt-4 border-t border-white/5 flex justify-end">
          <button class="text-xs font-medium text-red-400 hover:text-red-300 transition-colors flex items-center gap-1" onclick="deleteBM('${b.id}')">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            Excluir
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    bmList.innerHTML = `<p class="text-red-400">Erro ao carregar BMs: ${err.message}</p>`;
  }
}

window.deleteBM = async (bmId) => {
  if (!confirm('Tem certeza que deseja excluir este Boletim de Medição? Isso apagará todas as cidades dele.')) return;
  try {
    const snap = await getDocs(collection(db, `notas_${bmId}`));
    const deletes = [];
    snap.forEach(d => deletes.push(deleteDoc(doc(db, `notas_${bmId}`, d.id))));
    await Promise.all(deletes);
    
    await deleteDoc(doc(db, 'bms', bmId));
    
    loadDashboard();
  } catch (e) {
    alert('Erro ao excluir: ' + e.message);
  }
};

window.openBM = (bmId, bmText, periodoText) => {
  currentBmId = bmId;
  viewMode = 'cards';
  grid.classList.remove('hidden');
  resumoContainer.classList.add('hidden');
  filterPendentes.classList.remove('hidden');
  btnViewResumoText.textContent = 'Resumo BM';
  mainSectionTitle.textContent = 'Notas por Cidade';

  dashSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
  headerMeta.classList.remove('hidden');
  headerMeta.classList.add('flex');
  bmTitle.textContent = `BM: ${bmText}`;
  periodoTitle.textContent = `Período: ${periodoText}`;
  
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(collection(db, `notas_${bmId}`), snap => {
    notasData = [];
    snap.forEach(d => notasData.push({ docId: d.id, ...d.data() }));
    notasData.sort((a,b) => a.cidade.localeCompare(b.cidade));
    if (viewMode === 'cards') {
      renderCards();
    } else {
      renderResumo();
    }
  });
};

function formatDescription(text) {
  if (!text) return '';
  const str = String(text);
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function formatBRL(n) {
  return (n||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderCards() {
  const lista = showOnlyPendentes ? notasData.filter(n => !n.emitida) : notasData;
  const emitidas = notasData.filter(n => n.emitida).length;
  statsEl.textContent = `${emitidas} de ${notasData.length} emitidas`;

  grid.innerHTML = lista.map((nota, i) => {
    try {
      return `
        <div class="bg-zinc-900/50 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-colors flex flex-col ${nota.emitida ? 'opacity-70 grayscale-[20%]' : ''}">
          
          <div class="p-5 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-violet-400 uppercase tracking-wider">${(nota.cidade || 'Sem Cidade').split(' ')[0]} ${(nota.cidade || '').includes('REAJUSTE')?'<span class="text-amber-500">(R)</span>':''}</span>
            </div>
            ${nota.emitida 
              ? '<span class="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-wide uppercase">Emitida</span>' 
              : '<span class="text-xs text-zinc-500 font-medium">BM: '+(nota.bm || '')+'</span>'}
          </div>

          <div class="p-6 flex-1 flex flex-col gap-5">
            
            <div class="space-y-3">
              ${nota.referencia ? `
                <div>
                  <p class="text-xs text-zinc-400 leading-relaxed">${formatDescription(nota.referencia)}</p>
                </div>
              ` : ''}
              ${nota.in ? `<p class="text-[11px] font-medium text-amber-500/80 leading-snug">${formatDescription(nota.in)}</p>` : ''}
            </div>

            <div class="h-px bg-white/5 w-full my-1"></div>

            <div class="space-y-2">
              <div class="flex justify-between items-center text-sm">
                <span class="text-zinc-500">Passagem</span>
                <span class="text-zinc-300 font-medium">R$ ${formatBRL(nota.passagem)}</span>
              </div>
              <div class="flex justify-between items-center text-sm">
                <span class="text-zinc-500">Alimentação</span>
                <span class="text-zinc-300 font-medium">R$ ${formatBRL(nota.alimentacao)}</span>
              </div>
            </div>

            <div class="bg-violet-500/5 border border-violet-500/10 rounded-xl p-4 flex flex-col gap-1 items-center justify-center my-1">
              <span class="text-xs font-medium text-violet-300 uppercase tracking-wider">Valor da Nota Fiscal</span>
              <div class="text-2xl font-bold text-emerald-400 tracking-tight">R$ ${formatBRL(nota.valorNotaFiscal)}</div>
              <span class="text-[10px] text-zinc-500 mt-1">ISS: ${nota.iss_pct || ''}</span>
            </div>

            <div class="space-y-2">
              <div class="flex justify-between items-center text-sm">
                <span class="text-zinc-500">Base Retenção</span>
                <span class="text-zinc-300 font-medium">R$ ${formatBRL(nota.baseRetencao)}</span>
              </div>
              <div class="flex justify-between items-center text-sm">
                <span class="text-zinc-500">Base Cálculo</span>
                <span class="text-zinc-300 font-medium">R$ ${formatBRL(nota.baseCalculo)}</span>
              </div>
            </div>

            <div class="mt-auto">
              <div class="grid grid-cols-3 gap-2">
                <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div class="text-[10px] text-zinc-500 uppercase font-medium mb-1">ISS</div>
                  <div class="font-mono text-xs text-zinc-300">${formatBRL(nota.tributos?.iss || 0)}</div>
                </div>
                <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div class="text-[10px] text-zinc-500 uppercase font-medium mb-1">IRRF</div>
                  <div class="font-mono text-xs text-zinc-300">${formatBRL(nota.tributos?.irrf || 0)}</div>
                </div>
                <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div class="text-[10px] text-zinc-500 uppercase font-medium mb-1">PIS</div>
                  <div class="font-mono text-xs text-zinc-300">${formatBRL(nota.tributos?.pis || 0)}</div>
                </div>
                <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div class="text-[10px] text-zinc-500 uppercase font-medium mb-1">COFINS</div>
                  <div class="font-mono text-xs text-zinc-300">${formatBRL(nota.tributos?.cofins || 0)}</div>
                </div>
                <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div class="text-[10px] text-zinc-500 uppercase font-medium mb-1">CSLL</div>
                  <div class="font-mono text-xs text-zinc-300">${formatBRL(nota.tributos?.csll || 0)}</div>
                </div>
                <div class="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div class="text-[10px] text-zinc-500 uppercase font-medium mb-1">INSS</div>
                  <div class="font-mono text-xs text-zinc-300">${formatBRL(nota.tributos?.inss || 0)}</div>
                </div>
              </div>
            </div>

          </div>

          <div class="p-4 border-t border-white/5 bg-black/10">
            ${nota.emitida 
              ? `<div class="flex gap-2">
                  <button class="flex-1 py-2.5 px-3 rounded-lg text-xs font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1" onclick="handleDesfazer('${nota.docId}')">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
                    Desfazer
                  </button>
                  ${nota.anexoUrl ? `
                  <a href="${nota.anexoUrl}" target="_blank" class="flex-1 py-2.5 px-3 rounded-lg text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-1 text-center">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                    Ver
                  </a>` : ''}
                </div>`
              : `<button class="w-full py-3 px-4 rounded-xl text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all duration-200 transform active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20" onclick="iniciarEmissao('${nota.docId}')">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                  Marcar Emitida
                </button>`
            }
          </div>
        </div>
      `;
    } catch (e) {
      console.error(e);
      return `<div class="bg-red-900/50 p-4 rounded-xl text-red-200 border border-red-500/30">Erro na nota ${nota.cidade || 'desconhecida'}: ${e.message}</div>`;
    }
  }).join('');
}

function renderResumo() {
  const agrupado = {};
  
  let tpN = 0, taN = 0, tnfN = 0;
  let tpR = 0, taR = 0, tnfR = 0;

  notasData.forEach(nota => {
    const isReajuste = nota.cidade.toUpperCase().includes('REAJUSTE') || nota.cidade.toUpperCase().includes('(R)');
    
    let nomeCidade = nota.cidade.replace(/\s*\(\s*R\s*\)\s*/ig, '').replace(/\s*REAJUSTE\s*/ig, '').trim().toUpperCase();
    if (!nomeCidade) nomeCidade = 'DESCONHECIDA';
    
    if (!agrupado[nomeCidade]) {
      agrupado[nomeCidade] = {
        cidade: nomeCidade,
        normal: { passagem: 0, alimentacao: 0, valorNotaFiscal: 0 },
        reajuste: { passagem: 0, alimentacao: 0, valorNotaFiscal: 0 }
      };
    }
    
    const pass = Number(nota.passagem) || 0;
    const alim = Number(nota.alimentacao) || 0;
    const vnf = Number(nota.valorNotaFiscal) || 0;
    
    if (isReajuste) {
      agrupado[nomeCidade].reajuste.passagem += pass;
      agrupado[nomeCidade].reajuste.alimentacao += alim;
      agrupado[nomeCidade].reajuste.valorNotaFiscal += vnf;
      tpR += pass; taR += alim; tnfR += vnf;
    } else {
      agrupado[nomeCidade].normal.passagem += pass;
      agrupado[nomeCidade].normal.alimentacao += alim;
      agrupado[nomeCidade].normal.valorNotaFiscal += vnf;
      tpN += pass; taN += alim; tnfN += vnf;
    }
  });

  const linhas = Object.values(agrupado).sort((a, b) => a.cidade.localeCompare(b.cidade));
  
  resumoTbody.innerHTML = linhas.map(row => `
    <!-- CITY HEADER -->
    <tr class="bg-black/30 border-b border-white/5">
      <td colspan="6" class="px-6 py-3 text-center font-bold text-zinc-200 uppercase tracking-widest text-[13px]">${row.cidade.split(' ')[0]}</td>
    </tr>
    <!-- DATA -->
    <tr class="hover:bg-white/[0.02] transition-colors border-b border-white/10 last:border-0">
      <!-- NORMAL -->
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono text-sm text-zinc-400 opacity-80">${formatBRL(row.normal.passagem)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono text-sm text-zinc-400 opacity-80">${formatBRL(row.normal.alimentacao)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono text-sm font-bold text-violet-400 border-r border-white/5">${formatBRL(row.normal.valorNotaFiscal)}</td>
      
      <!-- REAJUSTE -->
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono text-sm text-zinc-400 opacity-80">${formatBRL(row.reajuste.passagem)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono text-sm text-zinc-400 opacity-80">${formatBRL(row.reajuste.alimentacao)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono text-sm font-bold text-amber-500">${formatBRL(row.reajuste.valorNotaFiscal)}</td>
    </tr>
  `).join('');
  
  if (linhas.length === 0) {
    resumoTbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-zinc-500">Nenhum dado encontrado.</td></tr>`;
  }
  
  resumoTfoot.innerHTML = `
    <tr>
      <td colspan="6" class="px-6 py-3 text-center font-bold text-white uppercase tracking-widest text-[13px] bg-black/40 border-b border-white/5">Total Geral</td>
    </tr>
    <tr>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono font-bold text-zinc-300 bg-black/10">R$ ${formatBRL(tpN)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono font-bold text-zinc-300 bg-black/10">R$ ${formatBRL(taN)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono font-bold text-violet-400 bg-black/10 border-r border-white/5">R$ ${formatBRL(tnfN)}</td>
      
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono font-bold text-zinc-300 bg-black/10">R$ ${formatBRL(tpR)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono font-bold text-zinc-300 bg-black/10">R$ ${formatBRL(taR)}</td>
      <td class="px-4 py-4 whitespace-nowrap text-right font-mono font-bold text-amber-500 bg-black/10">R$ ${formatBRL(tnfR)}</td>
    </tr>
  `;
}

window.iniciarEmissao = (docId) => {
  pendingToggleNota = notasData.find(n => n.docId === docId);
  fileInputAnexo.click();
};

fileInputAnexo.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !pendingToggleNota) return;
  
  const nota = pendingToggleNota;
  pendingToggleNota = null;
  fileInputAnexo.value = '';

  loadingOverlay.style.display = 'flex';
  const txt = loadingOverlay.querySelector('p');
  const oldTxt = txt.textContent;
  txt.textContent = 'Anexando nota...';
  
  try {
    const ext = file.name.split('.').pop();
    const fileName = `notas/${currentBmId}/${nota.docId}_${Date.now()}.${ext}`;
    const storageRef = ref(storage, fileName);
    
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    
    await setDoc(doc(db, `notas_${currentBmId}`, nota.docId), {
      emitida: true,
      anexoUrl: url,
      nomeOriginal: file.name,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    
    txt.textContent = oldTxt;
    loadingOverlay.style.display = 'none';

  } catch (err) {
    txt.textContent = oldTxt;
    loadingOverlay.style.display = 'none';
    alert('Erro ao anexar: ' + err.message);
    renderCards();
  }
});

window.handleDesfazer = async (docId) => {
  if (!confirm('Deseja realmente desfazer a emissão? (O anexo não será excluído do storage)')) return;
  try {
    await setDoc(doc(db, `notas_${currentBmId}`, docId), {
      emitida: false,
      anexoUrl: null,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch(e) {
    alert('Erro: '+e.message);
  }
};

window.toggleReadMore = (btn) => {
  const p = btn.previousElementSibling;
  if (p.classList.contains('line-clamp-3')) {
    p.classList.remove('line-clamp-3');
    btn.textContent = 'Ler menos';
  } else {
    p.classList.add('line-clamp-3');
    btn.textContent = 'Ler mais';
  }
};

loadDashboard();
