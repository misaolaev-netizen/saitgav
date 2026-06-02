const escapeHtml = t => (window.F2A?.escapeHtml ? F2A.escapeHtml(t) : String(t ?? ''));

const DIP_TABLE_STORAGE_KEY = 'form2act_dip_table_id';
const DIP_USE_TEMPLATE_KEY = 'form2act_dip_use_template';
const DIP_TEMPLATE_KEY = 'form2act_dip_template';
const DIPLOMA_FORM_KEYS = [
  'Рецензия_замечания', 'Рецензия_достоинства', 'Отзыв_руководителя',
  'Отзыв_руководителя_2', 'Готовое_изделие', 'Общая_оценка', 'Уровень_знаний',
  'БаллДемо', 'оценкаДемо', 'оценкаДиплом', 'ГИА', 'Дата_ДЭ',
];
const DIPLOMA_TEXT_KEYS = ['БаллДемо', 'оценкаДемо', 'оценкаДиплом', 'ГИА', 'Дата_ДЭ'];

const DIP_DRAFT_PREFIX = 'form2act_dip_draft:';
let dipDraftFio = '';
let dipAutoSaveTimer = null;

function normalizeFioKey(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ё]/g, 'е')
    .replace(/[Ё]/g, 'Е')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function setAutoSaveStatus(text, kind) {
  const el = document.getElementById('dipAutoSaveStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-saved', kind === 'saved');
  el.classList.toggle('is-dirty', kind === 'dirty');
}

function persistDiplomaDraft() {
  const fio = document.getElementById('dipFio')?.value || '';
  const key = normalizeFioKey(fio);
  if (!key) return;
  dipDraftFio = key;
  try {
    const data = readDiplomaForm();
    localStorage.setItem(DIP_DRAFT_PREFIX + key, JSON.stringify({ form: data, at: Date.now() }));
    setAutoSaveStatus('Черновик сохранён локально', 'saved');
  } catch {
    /* localStorage может быть переполнен */
  }
}

function scheduleDraftAutoSave() {
  setAutoSaveStatus('Изменения не сохранены…', 'dirty');
  if (dipAutoSaveTimer) clearTimeout(dipAutoSaveTimer);
  dipAutoSaveTimer = setTimeout(persistDiplomaDraft, 400);
}

function loadDiplomaDraftFor(fio) {
  const key = normalizeFioKey(fio);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(DIP_DRAFT_PREFIX + key);
    if (!raw) {
      dipDraftFio = key;
      setAutoSaveStatus('Черновика нет — заполните форму', '');
      return false;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.form) {
      applyDiplomaFormValues({ ...parsed.form, fio });
      const ts = new Date(parsed.at || Date.now()).toLocaleString('ru-RU');
      setAutoSaveStatus(`Загружен черновик от ${ts}`, 'saved');
      dipDraftFio = key;
      return true;
    }
  } catch {
    /* corrupted draft — ignore */
  }
  return false;
}

let dipTables = [];
let dipSelectedTableId = localStorage.getItem(DIP_TABLE_STORAGE_KEY) || '';

function updateDipSaveTargetBadge() {
  const badge = document.getElementById('dipSaveTarget');
  if (!badge) return;
  const t = dipTables.find(x => x.id === dipSelectedTableId);
  if (t) {
    badge.textContent = '→ ' + t.name;
    badge.classList.add('badge--ok');
  } else {
    badge.textContent = 'Таблица не выбрана';
    badge.classList.remove('badge--ok');
  }
}

function renderDiplomaTableList() {
  const list = document.getElementById('dipTableList');
  const meta = document.getElementById('dipTableMeta');
  const dl = document.getElementById('dipTableDownload');
  if (!list) return;

  if (!dipTables.length) {
    list.innerHTML = '<li class="muted dip-table-empty">Нет таблиц — создайте новую</li>';
    if (meta) meta.textContent = '';
    if (dl) dl.classList.add('hidden');
    updateDipSaveTargetBadge();
    return;
  }

  list.innerHTML = dipTables
    .map(t => {
      const active = t.id === dipSelectedTableId;
      return `<li><button type="button" class="dip-table-item${active ? ' active' : ''}" data-table-id="${escapeHtml(t.id)}">
        <span class="dip-table-item__name">${escapeHtml(t.name)}</span>
        <span class="dip-table-item__meta">${t.row_count ?? 0} строк</span>
      </button></li>`;
    })
    .join('');

  list.querySelectorAll('.dip-table-item').forEach(btn => {
    btn.onclick = () => selectDiplomaTable(btn.dataset.tableId);
  });

  const cur = dipTables.find(t => t.id === dipSelectedTableId);
  if (meta) {
    meta.textContent = cur
      ? `Выбрано: ${cur.name} (${cur.row_count ?? 0} строк)`
      : 'Выберите таблицу слева';
  }
  const delBtn = document.getElementById('btnDipDeleteTable');
  if (dl) {
    if (cur) {
      dl.href = '/api/diploma-tables/' + encodeURIComponent(cur.id) + '/download';
      dl.classList.remove('hidden');
    } else {
      dl.classList.add('hidden');
    }
  }
  if (delBtn) {
    if (cur) delBtn.classList.remove('hidden');
    else delBtn.classList.add('hidden');
  }
  updateDipSaveTargetBadge();
  const saveSel = document.getElementById('dipSaveFileSelect');
  if (saveSel) {
    saveSel.innerHTML = dipTables.length
      ? dipTables.map(t => `<option value="${escapeHtml(t.id)}"${t.id === dipSelectedTableId ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('')
      : '<option value="">— нет таблиц —</option>';
    saveSel.value = dipSelectedTableId || '';
  }
}

async function deleteDiplomaTable() {
  if (!dipSelectedTableId) return;
  const t = dipTables.find(x => x.id === dipSelectedTableId);
  const name = t?.name || 'таблицу';
  if (!confirm(`Удалить «${name}»? Файл Excel будет удалён.`)) return;
  const r = await fetch('/api/diploma-tables/' + encodeURIComponent(dipSelectedTableId), {
    method: 'DELETE',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    setStatus(data.error || 'Не удалось удалить');
    return;
  }
  dipSelectedTableId = '';
  localStorage.removeItem(DIP_TABLE_STORAGE_KEY);
  await loadDiplomaTables();
  window.loadProtocolTablePickLists?.();
  setStatus('Таблица удалена');
}

function selectDiplomaTable(id) {
  dipSelectedTableId = id || '';
  if (dipSelectedTableId) localStorage.setItem(DIP_TABLE_STORAGE_KEY, dipSelectedTableId);
  else localStorage.removeItem(DIP_TABLE_STORAGE_KEY);
  renderDiplomaTableList();
}

async function loadDiplomaTables() {
  try {
    const r = await fetch('/api/diploma-tables');
    const data = await r.json();
    if (!r.ok) {
      setStatus(data.error || 'Не удалось загрузить список таблиц');
      return;
    }
    dipTables = data.tables || [];
    if (dipSelectedTableId && !dipTables.some(t => t.id === dipSelectedTableId)) {
      dipSelectedTableId = dipTables[0]?.id || '';
      if (dipSelectedTableId) localStorage.setItem(DIP_TABLE_STORAGE_KEY, dipSelectedTableId);
      else localStorage.removeItem(DIP_TABLE_STORAGE_KEY);
    }
    if (!dipSelectedTableId && dipTables.length) {
      dipSelectedTableId = dipTables[0].id;
      localStorage.setItem(DIP_TABLE_STORAGE_KEY, dipSelectedTableId);
    }
    renderDiplomaTableList();
  } catch {
    setStatus('Не удалось загрузить список таблиц');
  }
}

async function createDiplomaTableSilent(name) {
  const tableName = (name || '').trim() || 'Дипломы ' + new Date().toLocaleDateString('ru-RU');
  const r = await fetch('/api/diploma-tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tableName }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Не удалось создать таблицу');
  await loadDiplomaTables();
  selectDiplomaTable(data.table.id);
  return data.table;
}

async function createDiplomaTable() {
  const name = prompt('Название таблицы:', 'Дипломы ' + new Date().toLocaleDateString('ru-RU'));
  if (name === null) return;
  try {
    const table = await createDiplomaTableSilent(name);
    setStatus('Создана таблица: ' + table.name);
  } catch (e) {
    setStatus(e.message || 'Ошибка');
  }
}

/** Выбрать существующую или создать таблицу Excel автоматически. */
async function ensureDiplomaTable() {
  await loadDiplomaTables();
  if (dipSelectedTableId && dipTables.some(t => t.id === dipSelectedTableId)) {
    return dipSelectedTableId;
  }
  if (dipTables.length) {
    selectDiplomaTable(dipTables[0].id);
    return dipSelectedTableId;
  }
  const table = await createDiplomaTableSilent();
  setStatus('Создана таблица: ' + table.name);
  return table.id;
}

function validateDiplomaForm() {
  const form = document.getElementById('diplomaForm');
  if (!form) return false;
  if (!form.checkValidity()) {
    form.reportValidity();
    return false;
  }
  return true;
}

function setDipRadio(name, value) {
  if (!value) return;
  document.querySelectorAll(`#diplomaForm input[name="${name}"]`).forEach(el => {
    el.checked = el.value === value;
  });
}

function readDiplomaForm() {
  const form = document.getElementById('diplomaForm');
  const fd = new FormData(form);
  const body = {
    fio: fd.get('fio') || '',
    pages: fd.get('pages') || '',
    graph_pages: fd.get('graph_pages') || '',
    Вопросы: fd.get('Вопросы') || '',
  };
  DIPLOMA_FORM_KEYS.forEach(k => {
    body[k] = fd.get(k) || '';
  });
  return body;
}

function applyDiplomaFormValues(form) {
  document.getElementById('dipFio').value = form.fio || '';
  document.getElementById('dipPages').value = form.pages || '';
  document.getElementById('dipGraph').value = form.graph_pages || '';
  document.getElementById('dipMerits').value = form.Рецензия_достоинства || '';
  document.getElementById('dipQuestions').value = form.Вопросы || '';
  DIPLOMA_FORM_KEYS.forEach(k => {
    if (DIPLOMA_TEXT_KEYS.includes(k)) {
      const inp = document.querySelector(`#diplomaForm [name="${k}"]`);
      if (inp) inp.value = form[k] || '';
    } else {
      setDipRadio(k, form[k]);
    }
  });
  updateDiplomaLivePreview();
}

async function loadDiplomaIntoForm(studentId) {
  const r = await fetch('/api/diploma/' + encodeURIComponent(studentId));
  if (!r.ok) {
    setStatus('Студент не найден — сохраните ФИО из списка ДП');
    return;
  }
  applyDiplomaFormValues((await r.json()).form);
}

function updateDiplomaLivePreview() {
  const box = document.getElementById('dipLivePreview');
  if (!box) return;
  const body = readDiplomaForm();
  const rows = [
    ['ФИО', body.fio],
    ['Страниц', body.pages],
    ['Граф. часть', body.graph_pages],
    ['Рецензия', body.Рецензия_замечания],
    ['Достоинства', body.Рецензия_достоинства],
    ['Отзыв', body.Отзыв_руководителя],
    ['Вопросы', body.Вопросы],
    ['Изделие', body.Готовое_изделие],
    ['Знания', body.Уровень_знаний],
  ].filter(([, v]) => v);

  box.innerHTML = rows.length
    ? rows
        .map(
          ([l, v]) =>
            `<div class="pv-row"><div class="pv-label">${escapeHtml(l)}</div><div class="pv-value">${escapeHtml(v)}</div></div>`
        )
        .join('')
    : '<p class="muted">Заполните форму</p>';
}

async function fillDipTemplateSelect() {
  const sel = document.getElementById('dipTemplate');
  if (!sel) return;
  try {
    const data = await (await fetch('/api/word-templates')).json();
    const list = data.templates || [];
    const cur = localStorage.getItem(DIP_TEMPLATE_KEY) || '';
    sel.innerHTML = list.length
      ? list.map(
          t =>
            `<option value="${escapeHtml(t.path)}"${t.path === cur ? ' selected' : ''}>${escapeHtml(t.name)}</option>`
        )
      : '<option value="">— нет .docx в data/ —</option>';
    if (cur && list.some(t => t.path === cur)) sel.value = cur;
    else if (list.length) sel.value = list[0].path;
  } catch {
    sel.innerHTML = '<option value="">— ошибка —</option>';
  }
}

function updateDipTemplateBlock() {
  const on = document.getElementById('dipUseTemplate')?.checked;
  const block = document.getElementById('dipTemplateBlock');
  if (block) block.classList.toggle('hidden', !on);
  localStorage.setItem(DIP_USE_TEMPLATE_KEY, on ? '1' : '0');
  if (on) fillDipTemplateSelect();
}

async function openDiplomaTemplatePreview() {
  if (!document.getElementById('dipUseTemplate')?.checked) {
    setStatus('Включите «С подстановкой в шаблон Word» слева');
    return;
  }
  if (!validateDiplomaForm()) return;

  const tpl = document.getElementById('dipTemplate')?.value;
  if (!tpl) {
    setStatus('Выберите шаблон Word (или загрузите .docx)');
    return;
  }

  const form = readDiplomaForm();
  localStorage.setItem(DIP_TEMPLATE_KEY, tpl);
  const studentId = F2A.findStudentIdByFio?.(form.fio) || null;

  setStatus('Подготовка предпросмотра…');
  try {
    const r = await fetch('/api/diploma/preview-merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form,
        template: tpl,
        student_id: studentId || undefined,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      setStatus(data.error || 'Ошибка предпросмотра');
      return;
    }
    if (!window.openPreviewWithMerge) {
      setStatus('Ошибка: модуль предпросмотра не загружен');
      return;
    }
    await window.openPreviewWithMerge({
      merge: data.merge,
      template: data.template || tpl,
      student_id: data.student_id,
      fields_meta: data.fields_meta,
      missing: data.missing,
    });
    if (data.missing?.length) {
      setStatus(`Предпросмотр: не заполнено ${data.missing.length} полей — исправьте слева на вкладке «Предпросмотр»`);
    } else {
      setStatus('Предпросмотр: все поля шаблона заполнены');
    }
  } catch (e) {
    setStatus(e.message || 'Не удалось открыть предпросмотр');
  }
}

async function openDiplomaPreviewTab() {
  const useTpl = document.getElementById('dipUseTemplate')?.checked;
  if (useTpl) {
    await openDiplomaTemplatePreview();
    return;
  }
  if (!validateDiplomaForm()) return;
  const fio = document.getElementById('dipFio')?.value?.trim();
  const id = F2A.selectedId || F2A.findStudentIdByFio?.(fio);
  if (!id) {
    setStatus('Студент не найден в базе — включите шаблон слева или сохраните строку');
    return;
  }
  F2A.previewId = id;
  F2A.selectedId = id;
  const sel = document.getElementById('previewStudent');
  if (sel) sel.value = id;
  F2A.fillPreviewSelect?.();
  F2A.switchTab('preview');
}

function initDiplomaPanel() {
  const form = document.getElementById('diplomaForm');
  if (!form) return;

  form.addEventListener('input', () => {
    updateDiplomaLivePreview();
    scheduleDraftAutoSave();
  });
  form.addEventListener('change', () => {
    updateDiplomaLivePreview();
    scheduleDraftAutoSave();
  });

  const fioInput = document.getElementById('dipFio');
  if (fioInput) {
    // При смене ФИО переключаемся на черновик соответствующего студента,
    // чтобы данные одного человека не «затирались» данными другого.
    const handleFioSwitch = () => {
      const value = fioInput.value;
      const newKey = normalizeFioKey(value);
      if (!newKey || newKey === dipDraftFio) return;
      // Перед загрузкой нового — сохранить текущий черновик.
      if (dipDraftFio) {
        persistDiplomaDraft();
      }
      loadDiplomaDraftFor(value);
    };
    fioInput.addEventListener('change', handleFioSwitch);
    fioInput.addEventListener('blur', handleFioSwitch);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateDiplomaForm()) return;

    let tableId;
    try {
      tableId = await ensureDiplomaTable();
    } catch (err) {
      setStatus(err.message || 'Не удалось подготовить таблицу');
      return;
    }

    const body = readDiplomaForm();
    body.table_id = tableId;
    const r = await fetch('/api/diploma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.error) {
      setStatus(data.error);
      return;
    }
    F2A.selectedId = data.id;
    F2A.previewId = data.id;
    const ex = data.excel;
    const exMsg = ex ? (ex.updated ? ' (обновлено)' : ' (добавлено)') : '';
    setStatus('Сохранено в «' + (dipTables.find(t => t.id === dipSelectedTableId)?.name || 'таблицу') + '»' + exMsg);
    persistDiplomaDraft();
    await F2A.loadStudents?.();
    await loadDiplomaTables();
    window.loadProtocolTablePickLists?.();
    updateDiplomaLivePreview();
    updateDipSaveTargetBadge();
  });

  document.getElementById('btnDipLoad')?.addEventListener('click', async () => {
    const fio = document.getElementById('dipFio').value.trim();
    if (!fio) {
      setStatus('Введите ФИО');
      return;
    }
    if (dipSelectedTableId) {
      const r = await fetch(
        '/api/diploma-tables/' + encodeURIComponent(dipSelectedTableId) + '/row?fio=' + encodeURIComponent(fio)
      );
      const data = await r.json();
      if (r.ok) {
        applyDiplomaFormValues(data.form);
        setStatus('Загружено из Excel');
        return;
      }
      if (r.status !== 404) {
        setStatus(data.error || 'Ошибка');
        return;
      }
    }
    const id = F2A.selectedId || F2A.findStudentIdByFio?.(fio);
    if (!id) {
      setStatus('Нет строки в таблице и нет студента в базе');
      return;
    }
    loadDiplomaIntoForm(id);
  });

  document.getElementById('btnDipNewTable')?.addEventListener('click', createDiplomaTable);
  document.getElementById('dipSaveFileSelect')?.addEventListener('change', e => {
    selectDiplomaTable(e.target.value || '');
  });
  document.getElementById('btnDipDeleteTable')?.addEventListener('click', deleteDiplomaTable);
  document.getElementById('btnDipImportTable')?.addEventListener('click', () => {
    document.getElementById('dipImportFile')?.click();
  });
  document.getElementById('dipImportFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/diploma-tables/import', { method: 'POST', body: fd });
    const data = await r.json();
    e.target.value = '';
    if (!r.ok) {
      setStatus(data.error || 'Ошибка импорта');
      return;
    }
    await loadDiplomaTables();
    selectDiplomaTable(data.table.id);
    setStatus('Импорт: ' + data.table.name);
  });

  const dipUseTpl = document.getElementById('dipUseTemplate');
  if (dipUseTpl && localStorage.getItem(DIP_USE_TEMPLATE_KEY) === '1') dipUseTpl.checked = true;
  dipUseTpl?.addEventListener('change', updateDipTemplateBlock);
  updateDipTemplateBlock();

  document.getElementById('btnDipTemplatePreview')?.addEventListener('click', e => {
    e.preventDefault();
    openDiplomaTemplatePreview();
  });

  document.getElementById('dipUploadTemplate')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const data = await (await fetch('/api/upload-template', { method: 'POST', body: fd })).json();
    e.target.value = '';
    if (data.error) {
      setStatus(data.error);
      return;
    }
    await fillDipTemplateSelect();
    const sel = document.getElementById('dipTemplate');
    if (sel && data.template?.path) sel.value = data.template.path;
    localStorage.setItem(DIP_TEMPLATE_KEY, data.template.path);
    setStatus('Шаблон: ' + data.template.name);
  });

  document.getElementById('btnDipPreview')?.addEventListener('click', e => {
    e.preventDefault();
    openDiplomaPreviewTab();
  });
}

window.loadDiplomaTables = loadDiplomaTables;
window.updateDiplomaLivePreview = updateDiplomaLivePreview;
initDiplomaPanel();
