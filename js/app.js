import { db, doc, setDoc, onSnapshot, collection } from './firebase-config.js';

let notasData = [];
let unsubscribe = null;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const grid = document.getElementById('grid');
const bmTitle = document.getElementById('bmTitle');
const periodoTitle = document.getElementById('periodoTitle');
const statsEl = document.getElementById('stats');
const filterBtn = document.getElementById('filterPendentes');
let showOnlyPendentes = false;

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

filterBtn.addEventListener('click', () => {
  showOnlyPendentes = !showOnlyPendentes;
  filterBtn.textContent = showOnlyPendentes ? '📋 Mostrar Todas' : '⏳ Só Pendentes';
  renderCards();
});

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      notasData = parsePlanilha(wb);
      if (notasData.length === 0) {
        alert('Nenhum bloco encontrado. Verifique se a aba se chama "EMISSÃO DAS NOTAS".');
        return;
      }
      document.getElementById('upload-section').style.display = 'none';
      document.getElementById('main-section').style.display = 'block';
      bmTitle.textContent = `BM: ${notasData[0].bm}`;
      periodoTitle.textContent = `Período: ${notasData[0].periodo}`;
      subscribeFirestore();
    } catch (err) {
      alert('Erro ao processar planilha: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function subscribeFirestore() {
  if (unsubscribe) unsubscribe();
  const bm = notasData[0]?.bm?.replace('/', '_') || 'sem_bm';
  const colRef = collection(db, `notas_${bm}`);
  unsubscribe = onSnapshot(colRef, snapshot => {
    snapshot.forEach(d => {
      const nota = notasData.find(n => docId(n) === d.id);
      if (nota) nota.emitida = d.data().emitida ?? false;
    });
    renderCards();
  }, () => renderCards());
}

function docId(nota) {
  return nota.cidade.replace(/\s+/g, '_').toUpperCase();
}

async function toggleEmitida(nota) {
  nota.emitida = !nota.emitida;
  const bm = nota.bm?.replace('/', '_') || 'sem_bm';
  try {
    await setDoc(doc(db, `notas_${bm}`, docId(nota)), {
      emitida: nota.emitida,
      cidade: nota.cidade,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch {
    renderCards();
  }
}

function formatBRL(n) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function gerarTexto(nota) {
  return `${nota.referencia}
BOLETIM DE MEDIÇÃO: ${nota.bm}
PERÍODO: ${nota.periodo}
${nota.in}
PASSAGEM: R$ ${formatBRL(nota.passagem)}
ALIMENTAÇÃO: R$ ${formatBRL(nota.alimentacao)}
VALOR DA NOTA FISCAL: R$ ${formatBRL(nota.valorNotaFiscal)} | ISS: ${nota.iss_pct}
BASE RETENÇÃO: R$ ${formatBRL(nota.baseRetencao)}
BASE DE CÁLCULO: R$ ${formatBRL(nota.baseCalculo)}
ISS: ${formatBRL(nota.tributos.iss)} | IRRF: ${formatBRL(nota.tributos.irrf)} | PIS: ${formatBRL(nota.tributos.pis)} | COFINS: ${formatBRL(nota.tributos.cofins)} | CSLL: ${formatBRL(nota.tributos.csll)} | INSS: ${formatBRL(nota.tributos.inss)}`;
}

async function copiar(nota, btn) {
  await navigator.clipboard.writeText(gerarTexto(nota));
  btn.textContent = '✅ Copiado!';
  setTimeout(() => btn.textContent = '📋 Copiar', 2000);
}

function renderCards() {
  const lista = showOnlyPendentes ? notasData.filter(n => !n.emitida) : notasData;
  const emitidas = notasData.filter(n => n.emitida).length;
  statsEl.textContent = `${emitidas} de ${notasData.length} emitidas`;

  grid.innerHTML = lista.map((nota, i) => `
    <div class="card ${nota.emitida ? 'emitida' : ''}" id="card-${i}">
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
          <span class="label">Período</span>
          <span>${nota.periodo}</span>
        </div>
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
        <button class="btn-copy" onclick="handleCopy(${i}, this)">📋 Copiar</button>
        <button class="btn-emit ${nota.emitida ? 'emitida' : ''}" onclick="handleToggle(${i})">
          ${nota.emitida ? '↩ Desfazer' : '✓ Marcar como Emitida'}
        </button>
      </div>
    </div>
  `).join('');
}

window.handleCopy = (i, btn) => {
  const lista = showOnlyPendentes ? notasData.filter(n => !n.emitida) : notasData;
  copiar(lista[i], btn);
};

window.handleToggle = (i) => {
  const lista = showOnlyPendentes ? notasData.filter(n => !n.emitida) : notasData;
  toggleEmitida(lista[i]);
};
