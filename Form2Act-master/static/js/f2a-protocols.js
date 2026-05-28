(() => {
const F2A = window.F2A;
const { escapeHtml, setStatus } = F2A;
let excelFilesCache = [];
let autoReloadTimer = null;

async function reload() {
  const selectedFile = document.getElementById('excelFileSelect')?.value || '';
  const selectedSheet = document.getElementById('excelSheetSelect')?.value || '';
  const body = {
    use_templates: document.getElementById('useTemplates').checked,
    dp_sheet: selectedSheet,
    templates_sheet: selectedSheet,
    dp_file: selectedFile,
    form_file: selectedFile,
    gia_file: selectedFile,
    templates_file: selectedFile,
  };
  const r = await fetch('/api/reload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  const s = data.stats;
  let msg = `ДП: ${s.dp}, опрос: ${s.form}, ГИА: ${s.gia}, шаблоны: ${s.templates}, студентов: ${s.students}`;
  if (s.errors?.length) msg += '\n' + s.errors.join('\n');
  setStatus(msg);
  await loadStudents();
  await loadWordTemplates();
}

async function loadTemplateFillStatus() {
  const tpl = getSelectedTemplate();
  if (!tpl) {
    F2A.templateFillById = null;
    return null;
  }
  try {
    const data = await (await fetch(
      '/api/template-fill-status?template=' + encodeURIComponent(tpl)
    )).json();
    if (data.error) {
      F2A.templateFillById = null;
      return null;
    }
    F2A.templateFillById = data.by_id || {};
    return data;
  } catch {
    F2A.templateFillById = null;
    return null;
  }
}

async function loadStudents() {
  const r = await fetch('/api/students');
  F2A.students = (await r.json()).students;
  const valid = new Set(F2A.students.map(s => s.id));
  F2A.checkedStudentIds = new Set([...F2A.checkedStudentIds].filter(id => valid.has(id)));
  fillStudentSourceFilter();
  if (getSelectedTemplate()) await loadTemplateFillStatus();
  syncChecksIfMasterOn();
  renderStudentTable();
  fillFioDatalist();
  fillPreviewSelect();
  window.refreshConstructorStudents?.();
  refreshProtocolMergeStatus();
}

function fillStudentSourceFilter() {
  const sel = document.getElementById('studentFilterSource');
  if (!sel) return;
  const cur = sel.value;
  const sources = new Set();
  F2A.students.forEach(s => (s.sources || []).forEach(x => sources.add(x)));
  const opts = ['<option value="">Все источники</option>'].concat(
    [...sources].sort((a, b) => a.localeCompare(b, 'ru')).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
  );
  sel.innerHTML = opts.join('');
  if (cur && [...sources].includes(cur)) sel.value = cur;
}

function getVisibleStudents() {
  let list = [...F2A.students];
  const q = F2A.studentUi.search.trim().toLowerCase();
  if (q) {
    list = list.filter(
      s => s.fio.toLowerCase().includes(q) || String(s.id).toLowerCase().includes(q)
    );
  }
  if (F2A.studentUi.source) {
    list = list.filter(s => (s.sources || []).includes(F2A.studentUi.source));
  }
  if (F2A.studentUi.status === 'ready' && F2A.templateFillById) {
    list = list.filter(s => !F2A.templateFillById[s.id]);
  } else if (F2A.studentUi.status === 'gaps' && F2A.templateFillById) {
    list = list.filter(s => F2A.templateFillById[s.id]);
  } else if (F2A.studentUi.status === 'low') {
    list = list.filter(s => s.fields_filled < F2A.MERGE_FIELDS.length);
  }
  const dir = F2A.studentUi.sortAsc ? 1 : -1;
  const key = F2A.studentUi.sort;
  list.sort((a, b) => {
    let cmp = 0;
    if (key === 'fio') cmp = (a.fio || '').localeCompare(b.fio || '', 'ru');
    else if (key === 'sources') {
      cmp = (a.sources?.[0] || '').localeCompare(b.sources?.[0] || '', 'ru');
    } else if (key === 'fields') cmp = a.fields_filled - b.fields_filled;
    else if (key === 'gaps') {
      const ga = F2A.templateFillById?.[a.id]?.missing_count ?? -1;
      const gb = F2A.templateFillById?.[b.id]?.missing_count ?? -1;
      cmp = ga - gb;
    }
    return cmp * dir;
  });
  return list;
}

function syncChecksIfMasterOn() {
  const master = document.getElementById('studentSelectAllVisible');
  if (!master?.checked) return;
  getVisibleStudents().forEach(s => F2A.checkedStudentIds.add(s.id));
}

function updateStudentSelectionUi() {
  const visible = getVisibleStudents();
  const n = F2A.checkedStudentIds.size;
  const countEl = document.getElementById('studentSelectionCount');
  if (countEl) {
    countEl.textContent = `Видно ${visible.length} из ${F2A.students.length} · выбрано ${n}`;
  }
  const btn = document.getElementById('btnGenChecked');
  if (btn) {
    btn.disabled = n === 0;
    const combined = F2A.templateScan?.mode === 'combined';
    const label = combined ? 'Скачать акт' : 'Скачать';
    btn.textContent = n ? `${label} (${n})` : label;
  }
  const allCb = document.getElementById('studentSelectAllVisible');
  if (allCb) {
    const visIds = visible.map(s => s.id);
    allCb.checked = visIds.length > 0 && visIds.every(id => F2A.checkedStudentIds.has(id));
    allCb.indeterminate =
      !allCb.checked && visIds.some(id => F2A.checkedStudentIds.has(id));
  }
  updateSortHeaders();
}

function updateSortHeaders() {
  document.querySelectorAll('#studentsTable th.col-sortable').forEach(th => {
    const on = th.dataset.sort === F2A.studentUi.sort;
    th.classList.toggle('col-sort-active', on);
    let mark = th.querySelector('.sort-mark');
    if (!mark) {
      mark = document.createElement('span');
      mark.className = 'sort-mark';
      th.appendChild(mark);
    }
    mark.textContent = on ? (F2A.studentUi.sortAsc ? ' ▲' : ' ▼') : '';
  });
  const tplCol = document.getElementById('studentTableTplCol');
  if (tplCol) tplCol.style.display = getSelectedTemplate() ? '' : 'none';
}

function renderStudentTable() {
  const tbody = document.getElementById('studentTable');
  if (!tbody) return;
  const showTpl = !!getSelectedTemplate();
  const visible = getVisibleStudents();

  tbody.innerHTML = '';
  if (!visible.length) {
    const colSpan = showTpl ? 5 : 4;
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="cursor:default">Никого не найдено — измените поиск или фильтр</td></tr>`;
    updateStudentSelectionUi();
    return;
  }

  visible.forEach(s => {
    const gap = F2A.templateFillById?.[s.id];
    const gapCell = showTpl
      ? gap
        ? `<td class="col-tpl-gaps col-tpl-gaps--warn" title="${escapeHtml((gap.missing || []).join(', '))}">${gap.missing_count}</td>`
        : '<td class="col-tpl-gaps col-tpl-gaps--ok">0</td>'
      : '<td class="col-tpl-gaps">—</td>';
    const checked = F2A.checkedStudentIds.has(s.id);
    const tr = document.createElement('tr');
    tr.dataset.id = s.id;
    tr.innerHTML =
      `<td class="col-check"><input type="checkbox" class="student-row-check" data-id="${escapeHtml(s.id)}"${checked ? ' checked' : ''} aria-label="Выбрать"></td>` +
      `<td>${escapeHtml(s.fio)}</td>` +
      `<td>${(s.sources || []).map(x => '<span class="tag">' + escapeHtml(x) + '</span>').join('') || '—'}</td>` +
      `<td>${s.fields_filled}/${F2A.MERGE_FIELDS.length}</td>${gapCell}`;
    if (s.id === F2A.selectedId) tr.classList.add('selected');
    if (checked) tr.classList.add('row-checked');
    if (gap?.missing_count) tr.classList.add('row--missing-fields');

    tr.querySelector('.student-row-check')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleStudentCheck(s.id, e.target.checked);
    });
    tr.addEventListener('click', e => {
      if (e.target.closest('.col-check')) return;
      selectStudent(s.id);
    });
    tbody.appendChild(tr);
  });

  updateStudentSelectionUi();
}

function toggleStudentCheck(id, on) {
  if (on) F2A.checkedStudentIds.add(id);
  else F2A.checkedStudentIds.delete(id);
  const row = document.querySelector(`#studentTable tr[data-id="${CSS.escape(id)}"]`);
  row?.classList.toggle('row-checked', on);
  row?.querySelector('.student-row-check')?.toggleAttribute('checked', on);
  updateStudentSelectionUi();
}

function onStudentFilterChange() {
  F2A.studentUi.search = document.getElementById('studentSearch')?.value || '';
  F2A.studentUi.status = document.getElementById('studentFilterStatus')?.value || 'all';
  F2A.studentUi.source = document.getElementById('studentFilterSource')?.value || '';
  syncChecksIfMasterOn();
  renderStudentTable();
}

async function loadExcelFilesForReload() {
  const fileEl = document.getElementById('excelFileSelect');
  const sheetEl = document.getElementById('excelSheetSelect');
  if (!fileEl || !sheetEl) return;

  try {
    const data = await (await fetch('/api/excel-files')).json();
    const files = data.files || [];
    excelFilesCache = files;
    const selectedPath = fileEl.value || files[0]?.path || '';
    fileEl.innerHTML = files.length
      ? files
          .map(
            f =>
              `<option value="${escapeHtml(f.path)}"${f.path === selectedPath ? ' selected' : ''}>${escapeHtml(f.name)}</option>`
          )
          .join('')
      : '<option value="">— не найдено —</option>';
    if (selectedPath) fileEl.value = selectedPath;

    const renderSheets = () => {
      const hit = files.find(f => f.path === fileEl.value);
      const sheets = hit?.sheets || [];
      const prev = sheetEl.value || '';
      sheetEl.innerHTML = sheets.length
        ? sheets.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')
        : '<option value="">—</option>';
      if (prev && sheets.includes(prev)) sheetEl.value = prev;
      renderExcelSheetPreview();
      scheduleAutoReload();
    };
    renderSheets();
    fileEl.onchange = renderSheets;
    sheetEl.onchange = () => {
      renderExcelSheetPreview();
      scheduleAutoReload();
    };
  } catch {
    /* ignore */
  }
}

function scheduleAutoReload() {
  if (autoReloadTimer) clearTimeout(autoReloadTimer);
  autoReloadTimer = setTimeout(() => {
    F2A.reload?.();
  }, 350);
}

async function renderExcelSheetPreview() {
  const fileEl = document.getElementById('excelFileSelect');
  const sheetEl = document.getElementById('excelSheetSelect');
  const head = document.getElementById('excelSheetPreviewHead');
  const body = document.getElementById('excelSheetPreviewBody');
  if (!fileEl || !sheetEl || !head || !body) return;
  if (!fileEl.value || !sheetEl.value) {
    head.innerHTML = '';
    body.innerHTML = '<tr><td class="muted">Выберите файл и лист</td></tr>';
    return;
  }
  try {
    const qs = new URLSearchParams({ path: fileEl.value, sheet: sheetEl.value });
    const data = await (await fetch('/api/excel-sheet-preview?' + qs.toString())).json();
    if (data.error) {
      head.innerHTML = '';
      body.innerHTML = `<tr><td class="muted">${escapeHtml(data.error)}</td></tr>`;
      return;
    }
    const cols = data.columns || [];
    const rows = data.rows || [];
    head.innerHTML = cols.length
      ? `<tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`
      : '';
    body.innerHTML = rows.length
      ? rows
          .map(r => `<tr>${r.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`)
          .join('')
      : '<tr><td class="muted">Лист пустой</td></tr>';
    if (data.truncated) {
      const colspan = Math.max(1, cols.length);
      body.insertAdjacentHTML(
        'beforeend',
        `<tr><td class="muted" colspan="${colspan}">Показана часть листа (первые строки/колонки)</td></tr>`
      );
    }
  } catch {
    head.innerHTML = '';
    body.innerHTML = '<tr><td class="muted">Не удалось загрузить таблицу</td></tr>';
  }
}

function fieldSourceControls(field) {
  const fileOpts = excelFilesCache.length
    ? excelFilesCache
        .map(f => `<option value="${escapeHtml(f.path)}">${escapeHtml(f.name)}</option>`)
        .join('')
    : '<option value="">— нет файлов —</option>';
  const id = String(field).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `<div class="field-source-row">
    <select class="field-source-file" data-source-file="${escapeHtml(field)}" data-source-id="${id}">${fileOpts}</select>
    <select class="field-source-sheet" data-source-sheet="${escapeHtml(field)}" data-source-id="${id}"><option value="">— лист —</option></select>
    <button type="button" class="ghost" data-source-load="${escapeHtml(field)}">Подставить</button>
  </div>`;
}

function bindFieldSourceControls(field, fio) {
  const root = document.querySelector(`.field-cell [data-source-file="${CSS.escape(field)}"]`)?.closest('.field-source-row');
  if (!root) return;
  const fileSel = root.querySelector('[data-source-file]');
  const sheetSel = root.querySelector('[data-source-sheet]');
  const btn = root.querySelector('[data-source-load]');
  const fieldEl = document.querySelector(`#fieldGrid [data-field="${CSS.escape(field)}"]`);
  const baseFile = document.getElementById('excelFileSelect')?.value || '';
  const baseSheet = document.getElementById('excelSheetSelect')?.value || '';
  if (baseFile) fileSel.value = baseFile;

  const renderSheets = () => {
    const hit = excelFilesCache.find(f => f.path === fileSel.value);
    const sheets = hit?.sheets || [];
    const prev = sheetSel.value || '';
    sheetSel.innerHTML = sheets.length
      ? sheets.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')
      : '<option value="">— лист —</option>';
    if (baseSheet && sheets.includes(baseSheet)) sheetSel.value = baseSheet;
    else if (prev && sheets.includes(prev)) sheetSel.value = prev;
  };
  renderSheets();
  fileSel.onchange = renderSheets;
  btn.onclick = async () => {
    if (!fileSel.value || !sheetSel.value || !fio) {
      setStatus('Выберите файл, лист и ФИО');
      return;
    }
    const r = await fetch('/api/excel-field-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: fileSel.value,
        sheet: sheetSel.value,
        fio,
        field,
      }),
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      setStatus(data.error || 'Не удалось подставить поле');
      return;
    }
    if (!data.found) {
      setStatus(data.warning || 'ФИО не найдено в выбранном файле/листе');
      return;
    }
    if (fieldEl) fieldEl.value = data.value || '';
    setStatus(`Поле «${field}» подставлено из ${data.source_col || 'колонки'}`);
  };
}

async function initProtocolTableSourceUi() {
  await loadExcelFilesForReload();
  await loadProtocolTablePickLists();
  document.getElementById('protocolTableUpload')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const data = await (await fetch('/api/table-data/upload', { method: 'POST', body: fd })).json();
    e.target.value = '';
    if (data.error) {
      setStatus(data.error);
      return;
    }
    await loadProtocolTablePickLists();
    saveTableCheck(`xlsx:${data.id}`, true);
    setStatus('Excel для шаблона загружен: ' + file.name);
  });
}

function initProtocolsStudentUi() {
  initProtocolTableSourceUi();
  const search = document.getElementById('studentSearch');
  search?.addEventListener('input', onStudentFilterChange);
  document.getElementById('studentFilterStatus')?.addEventListener('change', onStudentFilterChange);
  document.getElementById('studentFilterSource')?.addEventListener('change', onStudentFilterChange);

  document.getElementById('btnGenChecked')?.addEventListener('click', () => {
    const ids = [...F2A.checkedStudentIds];
    if (ids.length) generate(ids);
  });
  document.getElementById('btnAutoFillOne')?.addEventListener('click', async () => {
    if (!F2A.selectedId) {
      setStatus('Выберите студента');
      return;
    }
    const res = await autoFillStudentFromExcel(F2A.selectedId, { save: false });
    if (res.ok) setStatus('Автоподстановка выполнена. Проверьте поля и нажмите «Сохранить».');
  });
  document.getElementById('btnAutoFillChecked')?.addEventListener('click', async () => {
    const ids = [...F2A.checkedStudentIds];
    if (!ids.length) {
      setStatus('Отметьте студентов галочками');
      return;
    }
    let ok = 0;
    for (const id of ids) {
      const res = await autoFillStudentFromExcel(id, { save: true });
      if (res.ok) ok += 1;
    }
    await loadStudents();
    if (F2A.selectedId) await selectStudent(F2A.selectedId);
    setStatus(`Автоподстановка применена: ${ok}/${ids.length}`);
  });
  document.getElementById('studentSelectAllVisible')?.addEventListener('change', e => {
    if (e.target.checked) {
      getVisibleStudents().forEach(s => F2A.checkedStudentIds.add(s.id));
    } else {
      F2A.checkedStudentIds.clear();
    }
    renderStudentTable();
  });

  document.querySelectorAll('#studentsTable th.col-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (F2A.studentUi.sort === key) F2A.studentUi.sortAsc = !F2A.studentUi.sortAsc;
      else {
        F2A.studentUi.sort = key;
        F2A.studentUi.sortAsc = key === 'fio' || key === 'sources';
      }
      renderStudentTable();
    });
  });
}

function fillFioDatalist() {
  const list = document.getElementById('fioList');
  if (!list) return;
  list.innerHTML = F2A.students.map(s => `<option value="${escapeHtml(s.fio)}">`).join('');
}

function fillPreviewSelect() {
  const sel = document.getElementById('previewStudent');
  if (!sel) return;
  const cur = sel.value || F2A.previewId || F2A.selectedId;
  sel.innerHTML = '<option value="">— выберите —</option>' +
    F2A.students.map(s =>
      `<option value="${escapeHtml(s.id)}" title="${escapeHtml(s.fio)}">${escapeHtml(s.fio)}</option>`
    ).join('');
  if (cur && F2A.students.some(s => s.id === cur)) {
    sel.value = cur;
    const st = F2A.students.find(s => s.id === cur);
    sel.title = st?.fio || '';
  } else {
    sel.title = '';
  }
  document.getElementById('btnPreviewGen').disabled = !sel.value;
}

function updatePreviewStudentTitle() {
  const sel = document.getElementById('previewStudent');
  if (!sel?.value) {
    sel && (sel.title = '');
    return;
  }
  const st = F2A.students.find(s => s.id === sel.value);
  sel.title = st?.fio || '';
}

function ensurePreviewStudentId() {
  const sel = document.getElementById('previewStudent');
  let id = sel?.value || F2A.previewId || F2A.selectedId;
  if (!id && F2A.students?.length) {
    id = F2A.students[0].id;
    F2A.previewId = id;
    if (sel) sel.value = id;
    updatePreviewStudentTitle();
    const btnGen = document.getElementById('btnPreviewGen');
    if (btnGen) btnGen.disabled = false;
  }
  return id || null;
}

function findStudentIdByFio(fio) {
  const n = (fio || '').trim().toLowerCase();
  const hit = F2A.students.find(s => s.fio.toLowerCase() === n || s.id.toLowerCase() === n);
  return hit?.id || null;
}

const LONG_MERGE_FIELDS = new Set(['Вопросы', 'Темы_дипломного_проекта']);

async function editorFieldNames(studentId) {
  const tpl = getSelectedTemplate();
  if (tpl && F2A.templateScan?.mode === 'combined') {
    const header = F2A.templateScan.header_fields || [];
    const table = F2A.templateScan.table_fields || [];
    const names = [...new Set([...header, ...table])];
    if (names.length) return names;
    return F2A.templateScan.fields || F2A.MERGE_FIELDS;
  }
  if (tpl && studentId) {
    try {
      const data = await (
        await fetch(
          '/api/template-fields?template=' +
            encodeURIComponent(tpl) +
            '&student=' +
            encodeURIComponent(studentId)
        )
      ).json();
      if (data.fields?.length) return data.fields;
    } catch {
      /* ignore */
    }
  }
  return F2A.MERGE_FIELDS;
}

async function selectStudent(id) {
  F2A.selectedId = id;
  F2A.previewId = id;
  renderStudentTable();
  const data = await (await fetch('/api/student/' + encodeURIComponent(id))).json();
  const editor = document.getElementById('editor');
  editor.classList.add('open');
  document.getElementById('editorFio').textContent = data.record._fio || id;
  const grid = document.getElementById('fieldGrid');
  grid.innerHTML = '';
  const fields = await editorFieldNames(id);
  const tableOnly = new Set(F2A.templateScan?.table_fields || []);
  fields.forEach(field => {
    const wrap = document.createElement('div');
    const wide = LONG_MERGE_FIELDS.has(field);
    const inTable = tableOnly.has(field);
    wrap.className =
      'field-cell' + (wide ? ' field-cell--wide' : '') + (inTable ? ' field-cell--table' : '');
    const val = data.merge[field] || '';
    const control = wide
      ? `<textarea data-field="${escapeHtml(field)}" rows="5">${escapeHtml(val)}</textarea>`
      : `<input type="text" data-field="${escapeHtml(field)}" value="${escapeHtml(val)}">`;
    const hint = inTable
      ? ' <span class="field-cell__tag muted">строка таблицы</span>'
      : F2A.templateScan?.mode === 'combined' && (F2A.templateScan.header_fields || []).includes(field)
        ? ' <span class="field-cell__tag muted">шапка акта</span>'
        : '';
    wrap.innerHTML = `<label>${escapeHtml(field)}${hint}</label>${control}${fieldSourceControls(field)}`;
    grid.appendChild(wrap);
  });
  const fio = data.record?._fio || data.merge?.Фамилия_имя_отчество || '';
  fields.forEach(field => bindFieldSourceControls(field, fio));
  fillPreviewSelect();
  refreshProtocolMergeStatus();
}

function collectEditorMerge() {
  const payload = {};
  document.querySelectorAll('#fieldGrid [data-field]').forEach(el => {
    payload[el.dataset.field] = el.value;
  });
  return payload;
}

async function saveEditor() {
  if (!F2A.selectedId) return;
  const payload = {};
  document.querySelectorAll('#fieldGrid [data-field]').forEach(el => {
    payload[el.dataset.field] = el.value;
  });
  await fetch('/api/student/' + encodeURIComponent(F2A.selectedId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  setStatus('Сохранено');
  await loadStudents();
  refreshProtocolMergeStatus();
}

function collectEditorFields() {
  const names = [];
  document.querySelectorAll('#fieldGrid [data-field]').forEach(el => {
    if (el.dataset.field) names.push(el.dataset.field);
  });
  return [...new Set(names)];
}

async function autoFillStudentFromExcel(studentId, { save = false } = {}) {
  const file = document.getElementById('excelFileSelect')?.value || '';
  const sheet = document.getElementById('excelSheetSelect')?.value || '';
  const student = F2A.students.find(s => s.id === studentId);
  const fio = student?.fio || document.getElementById('editorFio')?.textContent || '';
  if (!fio) return { ok: false };
  const fields = collectEditorFields();

  const r = await fetch('/api/excel-row-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: file, sheet, fio, fields, scan_all: true }),
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    setStatus(data.error || 'Ошибка автоподстановки');
    return { ok: false };
  }
  if (!data.found) {
    setStatus(`ФИО не найдено: ${fio}`);
    return { ok: false };
  }
  const values = data.values || {};
  if (!values['группа_год']) {
    const groupFromEditor =
      document.querySelector('#fieldGrid [data-field="Группа"]')?.value || '';
    const groupFromStudent = student?.merge?.['Группа'] || '';
    const groupValue = values['Группа'] || groupFromEditor || groupFromStudent;
    const m = String(groupValue).match(/(\d)/);
    if (m) values['группа_год'] = String(new Date().getFullYear() - Number(m[1]));
  }

  if (save) {
    await fetch('/api/student/' + encodeURIComponent(studentId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
  } else if (studentId === F2A.selectedId) {
    document.querySelectorAll('#fieldGrid [data-field]').forEach(el => {
      const name = el.dataset.field;
      if (name && values[name]) el.value = values[name];
    });
  }
  return { ok: true, values, source: `${data.file || 'data'} / ${data.sheet || 'лист'}` };
}

const TEMPLATE_SELECT_IDS = ['protocolTemplate', 'previewTemplate'];

function setMergeStatusVisible(box, visible) {
  if (!box) return;
  box.hidden = !visible;
  box.classList.toggle('hidden', !visible);
}

async function refreshProtocolMergeStatus() {
  const box = document.getElementById('protocolMergeStatus');
  if (!box) return;
  const tpl = getSelectedTemplate();
  if (!tpl) {
    setMergeStatusVisible(box, false);
    box.innerHTML = '';
    F2A.templateFillById = null;
    renderStudentTable();
    return;
  }
  await loadTemplateFillStatus();
  syncChecksIfMasterOn();
  renderStudentTable();

  let url = '/api/template-fields?template=' + encodeURIComponent(tpl);
  if (F2A.selectedId) url += '&student=' + encodeURIComponent(F2A.selectedId);
  try {
    const data = await (await fetch(url)).json();
    if (data.error) {
      setMergeStatusVisible(box, false);
      return;
    }
    renderProtocolMergeStatus(box, data);
  } catch {
    setMergeStatusVisible(box, false);
  }
}

function setEditorMergeStatusVisible(box, visible) {
  if (!box) return;
  box.hidden = !visible;
  box.classList.toggle('hidden', !visible);
}

function renderEditorMergeStatus(data) {
  const editorBox = document.getElementById('editorMergeStatus');
  const editor = document.getElementById('editor');
  if (!editorBox) return;

  if (!F2A.selectedId || !editor?.classList.contains('open')) {
    setEditorMergeStatusVisible(editorBox, false);
    editorBox.innerHTML = '';
    return;
  }

  const missing = data.missing || [];
  const labels = data.missing_labels || data.labels || PREVIEW_LABELS;
  const tplFields = data.groups?.word || [];

  if (!missing.length) {
    setEditorMergeStatusVisible(editorBox, false);
    editorBox.innerHTML = '';
    return;
  }

  const rows = missing
    .map(
      f => `<tr>
        <td><code class="merge-field-code">{${escapeHtml(f)}}</code></td>
        <td>${escapeHtml(labels[f] || f)}</td>
      </tr>`
    )
    .join('');

  editorBox.innerHTML = `<details class="editor-merge-details" open>
    <summary>Не заполнено для шаблона (${missing.length}${tplFields.length ? ' из ' + tplFields.length : ''})</summary>
    <div class="editor-merge-table-wrap custom-scroll">
      <table class="editor-merge-table">
        <thead><tr><th>Поле</th><th>Описание</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
  setEditorMergeStatusVisible(editorBox, true);
}

function renderProtocolMergeStatus(box, data) {
  const tplFields = data.groups?.word || [];
  const missing = data.missing || [];
  const summary = data.fill_summary;

  renderEditorMergeStatus(data);

  let html = '';
  if (data.mode === 'combined') {
    const n = (data.table_fields || []).length;
    html += `<p class="merge-warn merge-warn--info">Режим <strong>сводного акта</strong>: ${n ? n + ' колонок в таблице' : 'таблица в шаблоне'} — отметьте студентов и скачайте один файл.</p>`;
  }

  if (!F2A.selectedId && summary) {
    const total = summary.total_students || 0;
    const withGaps = summary.students_with_gaps || 0;
    if (!tplFields.length) {
      html +=
        '<p class="merge-warn merge-warn--info">В шаблоне нет полей <code>{имя}</code>. Добавьте в конструкторе.</p>';
    } else if (withGaps > 0) {
      html += `<p class="merge-warn merge-warn--missing"><strong>У ${withGaps} из ${total}</strong> не хватает данных. Колонка «Шаблон» в таблице — сколько пустых полей; клик по студенту — список ниже.</p>`;
    } else {
      html += `<p class="merge-warn merge-warn--ok">Данные всех ${total} студентов покрывают шаблон.</p>`;
    }
    box.innerHTML = html;
    setMergeStatusVisible(box, !!html);
    return;
  }

  if (!F2A.selectedId) {
    if (!tplFields.length) {
      html +=
        '<p class="merge-warn merge-warn--info">Выберите студента в таблице — проверим поля шаблона.</p>';
    } else {
      html += `<p class="merge-warn merge-warn--info">В шаблоне ${tplFields.length} полей. Выберите студента в таблице.</p>`;
    }
    box.innerHTML = html;
    setMergeStatusVisible(box, true);
    return;
  }

  if (missing.length) {
    html += `<p class="merge-warn merge-warn--missing"><strong>${missing.length}</strong> пустых полей — список в блоке «Поля протокола» ниже.</p>`;
  } else if (!tplFields.length) {
    html += '<p class="merge-warn merge-warn--info">В шаблоне не найдено полей для подстановки.</p>';
  } else {
    html += '<p class="merge-warn merge-warn--ok">Все поля шаблона заполнены.</p>';
  }
  box.innerHTML = html;
  setMergeStatusVisible(box, true);
}

function getSelectedTemplate() {
  for (const id of TEMPLATE_SELECT_IDS) {
    const v = document.getElementById(id)?.value;
    if (v) return v;
  }
  return '';
}

function templateSelectOptions(list, cur) {
  return list.length
    ? list
        .map(t => {
          const selected = cur ? cur === t.path : t.default;
          return `<option value="${escapeHtml(t.path)}"${selected ? ' selected' : ''}>${escapeHtml(t.name)}</option>`;
        })
        .join('')
    : '<option value="">— нет .docx в data/ —</option>';
}

function syncTemplateSelects(sourceId, value) {
  TEMPLATE_SELECT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && id !== sourceId && value != null && el.value !== value) {
      el.value = value;
    }
  });
  const ctorTpl = document.getElementById('ctorGenTemplate');
  if (ctorTpl && value) ctorTpl.value = value;
}

async function loadWordTemplates(selectPath) {
  const first = document.getElementById(TEMPLATE_SELECT_IDS[0]);
  if (!first) return;
  try {
    const data = await (await fetch('/api/word-templates')).json();
    const list = data.templates || [];
    const cur = selectPath || getSelectedTemplate();
    const html = templateSelectOptions(list, cur);
    TEMPLATE_SELECT_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
    if (cur) syncTemplateSelects(null, cur);
    await loadTemplateScan();
    refreshProtocolMergeStatus();
    if (document.querySelector('.tab.active')?.dataset.tab === 'preview' && getSelectedTemplate()) {
      ensurePreviewStudentId();
      refreshWordPreview({ reloadFields: true });
    }
  } catch {
    const err = '<option value="">— ошибка загрузки —</option>';
    TEMPLATE_SELECT_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = err;
    });
  }
}

async function loadTemplateScan() {
  const tpl = getSelectedTemplate();
  if (!tpl) {
    F2A.templateScan = null;
    updateTableModeUi();
    return;
  }
  try {
    const data = await (await fetch('/api/template-scan?template=' + encodeURIComponent(tpl))).json();
    F2A.templateScan = data.error ? null : data;
  } catch {
    F2A.templateScan = null;
  }
  if (F2A.templateScan?.mode === 'combined') await loadProtocolTablePickLists();
  updateTableModeUi();
}

const PROTOCOL_TABLE_CHECKS_KEY = 'form2act_protocol_table_checks';

async function loadProtocolTablePickLists() {
  const [dipRes, xlsxRes] = await Promise.all([
    fetch('/api/diploma-tables').then(r => r.json()).catch(() => ({ tables: [] })),
    fetch('/api/table-data').then(r => r.json()).catch(() => ({ tables: [] })),
  ]);
  F2A.protocolDiplomaTables = dipRes.tables || [];
  F2A.protocolXlsxTables = xlsxRes.tables || [];
  renderProtocolTableSourceChecks();
}

function getSavedTableChecks() {
  try {
    return JSON.parse(localStorage.getItem(PROTOCOL_TABLE_CHECKS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveTableCheck(key, on) {
  const s = getSavedTableChecks();
  if (on) s[key] = true;
  else delete s[key];
  localStorage.setItem(PROTOCOL_TABLE_CHECKS_KEY, JSON.stringify(s));
}

function renderProtocolTableSourceChecks() {
  const dipBox = document.getElementById('protocolDipTableChecks');
  const xlsxBox = document.getElementById('protocolXlsxTableChecks');
  const saved = getSavedTableChecks();
  const dip = F2A.protocolDiplomaTables || [];
  const xlsx = F2A.protocolXlsxTables || [];

  if (dipBox) {
    dipBox.classList.remove('muted');
    dipBox.innerHTML = dip.length
      ? dip
          .map(t => {
            const key = `dip:${t.id}`;
            const checked = saved[key] ? ' checked' : '';
            return `<label class="check-row check-row--compact"><input type="checkbox" data-table-src="${escapeHtml(key)}" value="${escapeHtml(t.id)}"${checked}><span>${escapeHtml(t.name)} <span class="muted">(${t.row_count ?? 0})</span></span></label>`;
          })
          .join('')
      : '<span class="muted">Создайте на вкладке «Дипломы»</span>';
    dipBox.querySelectorAll('input[data-table-src]').forEach(cb => {
      cb.addEventListener('change', () => saveTableCheck(cb.dataset.tableSrc, cb.checked));
    });
  }

  if (xlsxBox) {
    xlsxBox.classList.remove('muted');
    xlsxBox.innerHTML = xlsx.length
      ? xlsx
          .map(t => {
            const key = `xlsx:${t.id}`;
            const checked = saved[key] ? ' checked' : '';
            return `<label class="check-row check-row--compact"><input type="checkbox" data-table-src="${escapeHtml(key)}" value="${escapeHtml(t.id)}"${checked}><span>${escapeHtml(t.name)} <span class="muted">(${t.row_count ?? 0})</span></span></label>`;
          })
          .join('')
      : '<span class="muted">Загрузите .xlsx ниже</span>';
    xlsxBox.querySelectorAll('input[data-table-src]').forEach(cb => {
      cb.addEventListener('change', () => saveTableCheck(cb.dataset.tableSrc, cb.checked));
    });
  }
}

function collectTableSources() {
  const sources = [];
  if (document.getElementById('protocolSrcStudents')?.checked) {
    sources.push({ data_source: 'students' });
  }
  document.querySelectorAll('#protocolDipTableChecks input[data-table-src]:checked').forEach(cb => {
    sources.push({ data_source: 'diploma_table', diploma_table_id: cb.value });
  });
  document.querySelectorAll('#protocolXlsxTableChecks input[data-table-src]:checked').forEach(cb => {
    sources.push({ data_source: 'xlsx', xlsx_id: cb.value });
  });
  return sources;
}

function updateTableModeUi() {
  const box = document.getElementById('protocolTableMode');
  const cols = document.getElementById('protocolTableColumns');
  const scan = F2A.templateScan;
  if (!box) return;
  if (!scan || scan.mode !== 'combined') {
    box.hidden = true;
    updateStudentSelectionUi();
    return;
  }
  box.hidden = false;
  renderProtocolTableSourceChecks();
  if (cols) {
    const fields = scan.table_fields || [];
    cols.innerHTML = fields.length
      ? fields.map(f => `<code>{${escapeHtml(f)}}</code>`).join(' ')
      : '<span class="muted">поля не найдены</span>';
  }
  updateStudentSelectionUi();
}

function buildCombinedTablesPayload(tableSources) {
  const scan = F2A.templateScan;
  if (!scan?.tables?.length) return null;
  const base = {
    anchor: scan.tables[0]?.suggested_anchor,
    columns: scan.tables[0]?.fields_in_row || scan.table_fields || [],
    sources: tableSources,
  };
  if (scan.table_source === 'brace' && scan.tables[0]) {
    return [
      {
        table_index: scan.tables[0].table_index,
        row_index: scan.tables[0].row_index,
        fields_in_row: scan.tables[0].fields_in_row || [],
        sources: tableSources,
      },
    ];
  }
  return [base];
}

async function onTemplateSelectChange(sourceId) {
  const value = document.getElementById(sourceId)?.value || '';
  syncTemplateSelects(sourceId, value);
  lastPreviewTemplate = null;
  if (sourceId === 'previewTemplate' || sourceId === 'protocolTemplate') {
    fillCtorTemplateSelects?.();
    await loadTemplateScan();
  }
  await refreshProtocolMergeStatus();
  if (document.querySelector('.tab.active')?.dataset.tab === 'preview' && value) {
    refreshWordPreview({ reloadFields: true, fresh: true });
  }
}

async function generate(ids) {
  const body = { ids };
  const tpl = getSelectedTemplate();
  if (tpl) body.template = tpl;
  if (F2A.templateScan?.mode === 'combined') {
    const tableSources = collectTableSources();
    if (!tableSources.length) {
      setStatus('Отметьте источник строк таблицы (студенты и/или Excel)');
      return;
    }
    body.table_sources = tableSources;
    const tables = buildCombinedTablesPayload(tableSources);
    if (tables) body.tables = tables;
  }
  const r = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (data.error) {
    setStatus(data.error);
    return;
  }
  F2A.triggerFileDownload(data.download);
  let msg =
    data.mode === 'combined'
      ? `Сводный акт: ${data.students ?? ids.length} чел. в таблице`
      : 'Скачано: ' + data.files.length + ' файл(ов)';
  const warn = data.warnings || [];
  if (warn.length === 1 && warn[0].missing?.length) {
    msg += '. Не заполнено полей: ' + warn[0].missing.length;
    refreshProtocolMergeStatus();
  } else if (warn.length > 1) {
    const total = warn.reduce((n, w) => n + (w.missing?.length || 0), 0);
    msg += `. У ${warn.length} студентов есть пустые поля (всего ${total})`;
  }
  setStatus(msg);
}

F2A.reload = reload;
F2A.loadStudents = loadStudents;
F2A.loadWordTemplates = loadWordTemplates;
F2A.getSelectedTemplate = getSelectedTemplate;
F2A.generate = generate;
F2A.selectStudent = selectStudent;
F2A.refreshProtocolMergeStatus = refreshProtocolMergeStatus;
F2A.fillPreviewSelect = fillPreviewSelect;
F2A.updatePreviewStudentTitle = updatePreviewStudentTitle;
F2A.fillFioDatalist = fillFioDatalist;
F2A.ensurePreviewStudentId = ensurePreviewStudentId;
F2A.onTemplateSelectChange = onTemplateSelectChange;
F2A.syncTemplateSelects = syncTemplateSelects;
F2A.findStudentIdByFio = findStudentIdByFio;
F2A.initProtocolsStudentUi = initProtocolsStudentUi;
F2A.loadTemplateScan = loadTemplateScan;
F2A.loadExcelFilesForReload = loadExcelFilesForReload;
window.loadProtocolTablePickLists = loadProtocolTablePickLists;
F2A.saveEditor = saveEditor;
F2A.TEMPLATE_SELECT_IDS = TEMPLATE_SELECT_IDS;
})();
