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

btnNovaPlanilha.addEventListener('click', () => fileInputPlanilha.click());
btnVoltar.addEventListener('click', loadDashboard);
filterPendentes.addEventListener('click', () => {
  showOnlyPendentes = !showOnlyPendentes;
  filterPendentes.textContent = showOnlyPendentes ? '📋 Mostrar Todas' : '⏳ Só Pendentes';
  renderCards();
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
  dashSection.style.display = 'block';
  mainSection.style.display = 'none';
  headerMeta.style.display = 'none';
  bmList.innerHTML = '<p>Carregando BMs...</p>';

  try {
    const snap = await getDocs(collection(db, 'bms'));
    if (snap.empty) {
      bmList.innerHTML = '<p>Nenhuma planilha importada ainda.</p>';
      return;
    }
    const bms = [];
    snap.forEach(d => bms.push({ id: d.id, ...d.data() }));
    bms.sort((a,b) => b.createdAt.localeCompare(a.createdAt));

    bmList.innerHTML = bms.map(b => `
      <div class="bm-card">
        <div class="bm-card-content" onclick="openBM('${b.id}', '${b.bm}', '${b.periodo}')">
          <h3>BM: ${b.bm}</h3>
          <p>Período: ${b.periodo}</p>
        </div>
        <button class="btn-delete-bm" onclick="deleteBM('${b.id}')">🗑️ Excluir</button>
      </div>
    `).join('');
  } catch (err) {
    bmList.innerHTML = `<p>Erro ao carregar BMs: ${err.message}</p>`;
  }
}

window.deleteBM = async (bmId) => {
  if (!confirm('Tem certeza que deseja excluir este Boletim de Medição? Isso apagará todas as cidades dele.')) return;
  try {
    // Busca todas as notas deste BM para excluí-las
    const snap = await getDocs(collection(db, `notas_${bmId}`));
    const deletes = [];
    snap.forEach(d => deletes.push(deleteDoc(doc(db, `notas_${bmId}`, d.id))));
    await Promise.all(deletes);
    
    // Exclui o documento do BM
    await deleteDoc(doc(db, 'bms', bmId));
    
    loadDashboard();
  } catch (e) {
    alert('Erro ao excluir: ' + e.message);
  }
};

window.openBM = (bmId, bmText, periodoText) => {
  currentBmId = bmId;
  dashSection.style.display = 'none';
  mainSection.style.display = 'block';
  headerMeta.style.display = 'flex';
  bmTitle.textContent = `BM: ${bmText}`;
  periodoTitle.textContent = `Período: ${periodoText}`;
  
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(collection(db, `notas_${bmId}`), snap => {
    notasData = [];
    snap.forEach(d => notasData.push({ docId: d.id, ...d.data() }));
    notasData.sort((a,b) => a.cidade.localeCompare(b.cidade));
    renderCards();
  });
};

function formatBRL(n) {
  return (n||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderCards() {
  const lista = showOnlyPendentes ? notasData.filter(n => !n.emitida) : notasData;
  const emitidas = notasData.filter(n => n.emitida).length;
  statsEl.textContent = `${emitidas} de ${notasData.length} emitidas`;

  grid.innerHTML = lista.map((nota, i) => `
    <div class="card ${nota.emitida ? 'emitida' : ''}">
      <div class="card-header">
        <div>
          <span class="badge-cidade">${nota.cidade}</span>
          ${nota.emitida ? '<span class="badge-ok">✓ EMITIDA</span>' : ''}
        </div>
        <div class="card-bm">${nota.bm}</div>
      </div>
      <div class="card-body">
        ${nota.referencia ? `<div class="referencia-text">${nota.referencia}</div>` : ''}
        ${nota.in ? `<div class="in-text">${nota.in}</div>` : ''}
        <div class="row-info">
          <span class="label">Passagem</span>
          <span>R$ ${formatBRL(nota.passagem)}</span>
        </div>
        <div class="row-info">
          <span class="label">Alimentação</span>
          <span>R$ ${formatBRL(nota.alimentacao)}</span>
        </div>
        <div class="row-info highlight">
          <span class="label">Valor da Nota Fiscal</span>
          <span>R$ ${formatBRL(nota.valorNotaFiscal)} <small>${nota.iss_pct}</small></span>
        </div>
        <div class="row-info">
          <span class="label">Base Retenção</span>
          <span>R$ ${formatBRL(nota.baseRetencao)}</span>
        </div>
        <div class="row-info">
          <span class="label">Base de Cálculo</span>
          <span>R$ ${formatBRL(nota.baseCalculo)}</span>
        </div>
        <div class="tributos-grid">
          <div class="trib"><span>ISS</span><strong>${formatBRL(nota.tributos.iss)}</strong></div>
          <div class="trib"><span>IRRF</span><strong>${formatBRL(nota.tributos.irrf)}</strong></div>
          <div class="trib"><span>PIS</span><strong>${formatBRL(nota.tributos.pis)}</strong></div>
          <div class="trib"><span>COFINS</span><strong>${formatBRL(nota.tributos.cofins)}</strong></div>
          <div class="trib"><span>CSLL</span><strong>${formatBRL(nota.tributos.csll)}</strong></div>
          <div class="trib"><span>INSS</span><strong>${formatBRL(nota.tributos.inss)}</strong></div>
        </div>
      </div>
      <div class="card-footer">
        ${nota.emitida 
          ? `<button class="btn-action danger" onclick="handleDesfazer('${nota.docId}')">↩ Desfazer</button>
             ${nota.anexoUrl ? `<a href="${nota.anexoUrl}" target="_blank" class="btn-action view">📄 Ver Anexo</a>` : ''}`
          : `<button class="btn-action emit" onclick="iniciarEmissao('${nota.docId}')">✓ Marcar como Emitida (Anexar Nota)</button>`
        }
      </div>
    </div>
  `).join('');
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

  const btn = document.querySelector(`.card-footer button`);
  btn.textContent = '⏳ Anexando...';
  
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
    
  } catch (err) {
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

loadDashboard();
