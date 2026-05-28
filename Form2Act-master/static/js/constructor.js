let ctorScanData = null;
let ctorTemplates = [];
let ctorPreviewTimer = null;
let ctorLastTemplate = '';
let lastFocusedCtorDoc = null;

function escapeHtmlCtor(t) {
  const d = document.createElement('div');
  d.textContent = t ?? '';
  return d.innerHTML;
}

function tplOptions(selected) {
  return ctorTemplates
    .map(
      t =>
        `<option value="${escapeHtmlCtor(t.path)}"${selected === t.path ? ' selected' : ''}>${escapeHtmlCtor(t.name)}</option>`
    )
    .join('');
}

function getCtorEditableRoot() {
  return window.PreviewWord?.getEditableRoot('ctorPreviewHost') || null;
}

function buildCtorFieldChips() {
  const box = document.getElementById('ctorFieldChips');
  if (!box) return;
  const names = ctorScanData?.fields || [];
  if (!names.length) {
    box.innerHTML = '<p class="hint muted">Нет полей — выберите .docx</p>';
    return;
  }
  box.innerHTML = names
    .map(
      name =>
        `<button type="button" class="field-chip" draggable="true" data-ctor-field="${escapeHtmlCtor(name)}" title="Вставить {${escapeHtmlCtor(name)}}">{${escapeHtmlCtor(name)}}</button>`
    )
    .join('');
}

function insertCtorFieldToken(fieldName) {
  const token = `{${fieldName}}`;
  const root = lastFocusedCtorDoc || getCtorEditableRoot();
  if (!root) {
    setStatus('Сначала кликните в документ справа');
    return;
  }
  if (window.insertTokenAtCaret?.(root, token)) {
    setStatus('В документ: ' + token);
  }
}

async function fillCtorTemplateSelects() {
  const r = await fetch('/api/word-templates');
  const data = await r.json();
  ctorTemplates = data.templates || [];
  const opts = ctorTemplates.length
    ? tplOptions('')
    : '<option value="">— нет .docx —</option>';
  const gen = document.getElementById('ctorGenTemplate');
  if (gen) {
    const prev = gen.value;
    gen.innerHTML = opts;
    const def = ctorTemplates.find(t => t.default);
    if (def) gen.value = def.path;
    else if (prev) gen.value = prev;
  }
  fillCtorPreviewStudentSelect();
  if (gen?.value) {
    await refreshCtorTemplateFields();
    scheduleCtorAutoPreview();
  }
}

function fillCtorPreviewStudentSelect() {
  const sel = document.getElementById('ctorPreviewStudent');
  if (!sel || typeof students === 'undefined') return;
  const cur = sel.value || '';
  sel.innerHTML =
    '<option value="">— только шаблон —</option>' +
    students
      .map(
        s =>
          `<option value="${escapeHtmlCtor(s.id)}"${s.id === cur ? ' selected' : ''}>${escapeHtmlCtor(s.fio)}</option>`
      )
      .join('');
}

function getCtorPreviewStudentId() {
  const v = document.getElementById('ctorPreviewStudent')?.value;
  return v || null;
}

async function refreshCtorTemplateFields() {
  const tpl = document.getElementById('ctorGenTemplate')?.value;
  if (!tpl) return false;
  const r = await fetch('/api/template-fields?template=' + encodeURIComponent(tpl));
  const data = await r.json();
  if (!r.ok) return false;
  ctorLastTemplate = tpl;
  ctorScanData = { fields: data.fields || [], template: tpl };
  buildCtorFieldChips();
  return true;
}

function scheduleCtorAutoPreview() {
  clearTimeout(ctorPreviewTimer);
  ctorPreviewTimer = setTimeout(() => ctorPreview({ quiet: true }), 450);
}

window.ctorOnTabActivate = async () => {
  fillCtorPreviewStudentSelect();
  const tpl = document.getElementById('ctorGenTemplate')?.value;
  if (tpl) {
    await refreshCtorTemplateFields();
    scheduleCtorAutoPreview();
  }
};

function getCtorDocumentHtml() {
  return window.PreviewWord?.getDocumentHtml('ctorPreviewHost') ?? null;
}

async function ctorClearLayout() {
  const tpl = document.getElementById('ctorGenTemplate')?.value;
  if (!tpl) {
    setStatus('Выберите шаблон .docx');
    return;
  }
  const r = await fetch('/api/template-layout', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template: tpl }),
  });
  const data = await r.json();
  if (!r.ok) {
    setStatus(data.error || 'Ошибка сброса');
    return;
  }
  const host = document.getElementById('ctorPreviewHost');
  if (host) {
    host.dataset.loadedTemplate = '';
    PreviewWord?.setBaseline(host, []);
  }
  setStatus('Правки сброшены — открывается оригинальный шаблон');
  await ctorPreviewEditable(true);
}

async function ctorSaveLayout() {
  const tpl = document.getElementById('ctorGenTemplate')?.value;
  if (!tpl) {
    setStatus('Выберите шаблон .docx');
    return;
  }
  const host = document.getElementById('ctorPreviewHost');
  const r = await fetch('/api/template-layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template: tpl,
      html: getCtorDocumentHtml(),
      paragraph_baseline: window.PreviewWord?.getBaseline(host) || [],
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    setStatus(data.error || 'Ошибка сохранения');
    return;
  }
  setStatus('Шаблон сохранён');
  await ctorPreviewEditable(true);
}

async function ctorDownload() {
  const tpl = document.getElementById('ctorGenTemplate')?.value;
  if (!tpl) {
    setStatus('Выберите шаблон .docx');
    return;
  }
  try {
    await window.PreviewWord.downloadTemplateExport({
      template: tpl,
      raw: true,
      hostOrId: 'ctorPreviewHost',
    });
    setStatus('Файл скачан');
  } catch (e) {
    setStatus(e.message || 'Ошибка скачивания');
  }
}

async function ctorPreviewEditable(fresh = false) {
  const host = document.getElementById('ctorPreviewHost');
  const tpl = document.getElementById('ctorGenTemplate')?.value;
  if (!tpl) throw new Error('Выберите .docx');

  const sameTpl = host?.dataset.loadedTemplate === tpl;
  const hasDoc = host?.querySelector('.docx-wrapper section.docx');
  const templateChanged = !!(host?.dataset.loadedTemplate && tpl && !sameTpl);
  if (!fresh && !templateChanged && sameTpl && hasDoc) {
    scheduleCtorPreviewFit();
    return;
  }

  await window.PreviewWord.render(host, {
    template: tpl,
    raw: true,
    fresh: fresh || templateChanged,
  });
  lastFocusedCtorDoc = getCtorEditableRoot();
  scheduleCtorPreviewFit();
}

async function ctorPreview(opts = {}) {
  const host = document.getElementById('ctorPreviewHost');
  const loading = document.getElementById('ctorPreviewLoading');
  const errEl = document.getElementById('ctorPreviewError');
  if (!host) return;

  const tpl = document.getElementById('ctorGenTemplate')?.value;
  if (!tpl) {
    if (!opts.quiet) {
      errEl.textContent = 'Выберите .docx';
      errEl.classList.remove('hidden');
    }
    return;
  }

  loading?.classList.remove('hidden');
  errEl?.classList.add('hidden');

  try {
    await refreshCtorTemplateFields();
    await ctorPreviewEditable(!!opts.fresh);
    if (!opts.quiet) setStatus('Документ открыт');
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка';
    errEl.classList.remove('hidden');
    if (!opts.quiet) setStatus(e.message);
  } finally {
    loading?.classList.add('hidden');
  }
}

let ctorFitTimer = null;
function scheduleCtorPreviewFit() {
  clearTimeout(ctorFitTimer);
  ctorFitTimer = setTimeout(() => {
    const host = document.getElementById('ctorPreviewHost');
    const box = document.getElementById('ctorPreviewScaleBox');
    if (!host || !box) return;
    host.style.setProperty('--preview-scale', '1');
    box.style.width = '';
    box.style.height = '';
  }, 80);
}

function initCtorPreviewEditing() {
  const host = document.getElementById('ctorPreviewHost');
  const scroller = document.getElementById('ctorPreviewScroller');
  if (!host) return;

  host.addEventListener('focusin', e => {
    const root = e.target.closest('section.docx, .docx-editable');
    if (root) lastFocusedCtorDoc = root;
  });
  host.addEventListener('click', e => {
    const root = e.target.closest('section.docx, .docx-editable');
    if (root) lastFocusedCtorDoc = root;
  });
  host.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types?.includes('text/plain') || !getCtorEditableRoot()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  host.addEventListener('drop', e => {
    const token = e.dataTransfer?.getData('text/plain');
    if (!token?.startsWith('{')) return;
    const root = e.target.closest('section.docx, .docx-editable') || getCtorEditableRoot();
    if (!root) return;
    e.preventDefault();
    window.insertTokenAtCaret?.(root, token);
    setStatus('В документ: ' + token);
  });

  document.getElementById('ctorFieldChips')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-ctor-field]');
    if (btn) insertCtorFieldToken(btn.dataset.ctorField);
  });
  document.getElementById('ctorFieldChips')?.addEventListener('dragstart', e => {
    const btn = e.target.closest('[data-ctor-field]');
    if (!btn) return;
    e.dataTransfer.setData('text/plain', `{${btn.dataset.ctorField}}`);
    e.dataTransfer.effectAllowed = 'copy';
    btn.classList.add('is-dragging');
  });
  document.getElementById('ctorFieldChips')?.addEventListener('dragend', e => {
    e.target.closest('[data-ctor-field]')?.classList.remove('is-dragging');
  });

  if (scroller && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => scheduleCtorPreviewFit()).observe(scroller);
  }
}

function initConstructor() {
  buildCtorFieldChips();
  fillCtorTemplateSelects();
  initCtorPreviewEditing();

  document.getElementById('btnCtorSave')?.addEventListener('click', ctorSaveLayout);
  document.getElementById('btnCtorResetLayout')?.addEventListener('click', ctorClearLayout);
  document.getElementById('btnCtorDownload')?.addEventListener('click', ctorDownload);

  document.getElementById('btnCtorAddCustomField')?.addEventListener('click', async () => {
    const tpl = document.getElementById('ctorGenTemplate')?.value;
    const ok = await window.addCustomField?.('ctorCustomFieldName', tpl);
    if (ok) await refreshCtorTemplateFields();
  });

  document.getElementById('ctorGenTemplate')?.addEventListener('change', async () => {
    ctorLastTemplate = '';
    await refreshCtorTemplateFields();
    await ctorPreviewEditable(true);
  });

  document.getElementById('ctorUploadTemplate')?.addEventListener('change', async e => {
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
    await fillCtorTemplateSelects();
    const gen = document.getElementById('ctorGenTemplate');
    if (gen && data.template?.path) gen.value = data.template.path;
    ctorLastTemplate = '';
    await refreshCtorTemplateFields();
    scheduleCtorAutoPreview();
    setStatus('Шаблон: ' + data.template.name);
  });
}

document.addEventListener('DOMContentLoaded', initConstructor);

window.refreshConstructorStudents = () => fillCtorPreviewStudentSelect();
