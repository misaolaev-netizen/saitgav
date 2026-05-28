(() => {
const F2A = window.F2A;
const { escapeHtml, setStatus, MERGE_FIELDS, PREVIEW_LABELS } = F2A;
document.getElementById('btnPreviewWord')?.addEventListener('click', () => {
  if (F2A.selectedId) F2A.previewId = F2A.selectedId;
  F2A.fillPreviewSelect();
  F2A.switchTab('preview');
});

function collectPreviewFieldsMerge() {
  const payload = {};
  document.querySelectorAll('#previewSections [data-preview-field]').forEach(el => {
    const key = el.dataset.previewField;
    if (el.type === 'radio') {
      if (el.checked) payload[key] = el.value;
      return;
    }
    payload[key] = el.value;
  });
  return Object.keys(payload).length ? payload : null;
}

function setPreviewFieldValue(field, value) {
  const nodes = document.querySelectorAll(`#previewSections [data-preview-field="${field}"]`);
  if (!nodes.length) return;
  const first = nodes[0];
  if (first.type === 'radio') {
    let matched = false;
    nodes.forEach(r => {
      r.checked = r.value === value;
      if (r.checked) matched = true;
    });
    if (!matched && value) {
      const extra = document.createElement('textarea');
      extra.dataset.previewField = field;
      extra.value = value;
      extra.rows = 3;
      const wrap = nodes[0].closest('.preview-edit--choices');
      if (wrap && !wrap.querySelector('textarea[data-preview-field]')) {
        wrap.insertAdjacentHTML('beforeend',
          `<p class="hint preview-choice-fallback">Значение из Excel не совпало с вариантами:</p>`);
        wrap.appendChild(extra);
      }
    }
    return;
  }
  first.value = value;
}

function getPreviewFieldValue(field) {
  const nodes = document.querySelectorAll(`#previewSections [data-preview-field="${field}"]`);
  if (!nodes.length) return '';
  if (nodes[0].type === 'radio') {
    const checked = [...nodes].find(r => r.checked);
    if (checked) return checked.value;
    const ta = nodes[0].closest('.preview-edit--choices')?.querySelector('textarea[data-preview-field]');
    return ta?.value || '';
  }
  return nodes[0].value;
}

function renderPreviewFieldControl(k, val, labels, isMissing) {
  const label = labels[k] || F2A.PREVIEW_LABELS[k] || k;
  const gapCls = isMissing ? ' preview-edit--gap' : '';
  const head = `<label class="preview-edit-head" title="${escapeHtml(k)}"><code class="field-tag">{${escapeHtml(k)}}</code><span>${escapeHtml(label)}</span>${isMissing ? '<em class="preview-gap-mark">не заполнено</em>' : ''}</label>`;
  const choices = F2A.PREVIEW_FIELD_CHOICES[k];
  if (choices) {
    const radios = choices.map(opt => {
      const long = opt.value.length > 80 ? ' long' : '';
      const checked = val && val === opt.value ? ' checked' : '';
      return `<label class="radio-card${long}"><input type="radio" name="pf_${escapeHtml(k)}" data-preview-field="${escapeHtml(k)}" value="${escapeHtml(opt.value)}"${checked}><span>${escapeHtml(opt.label)}</span></label>`;
    }).join('');
    return `<div class="preview-edit preview-edit--choices${gapCls}">${head}<div class="preview-choices">${radios}</div></div>`;
  }
  const wide = F2A.LONG_PREVIEW_FIELDS.has(k) || (val && val.length > 80);
  const control = wide
    ? `<textarea data-preview-field="${escapeHtml(k)}" rows="4" placeholder="Текст или {другое_поле}…">${escapeHtml(val)}</textarea>`
    : `<input type="text" data-preview-field="${escapeHtml(k)}" value="${escapeHtml(val)}" placeholder="{${escapeHtml(k)}} или текст">`;
  return `<div class="preview-edit${wide ? ' preview-edit--wide' : ''}${gapCls}">${head}${control}</div>`;
}

function sortTemplateFieldKeys(keys, missing) {
  const miss = missing || new Set();
  return [...keys].sort((a, b) => {
    const am = miss.has(a) ? 0 : 1;
    const bm = miss.has(b) ? 0 : 1;
    if (am !== bm) return am - bm;
    return a.localeCompare(b, 'ru');
  });
}

function renderMissingFieldsBanner(missingList, missingLabels, labels) {
  if (!missingList?.length) return '';
  let html = `<div class="merge-warn merge-warn--missing preview-missing-banner" role="alert">
    <strong>Не заполнено для шаблона (${missingList.length})</strong>
    <p class="hint">Заполните поля ниже — документ обновится автоматически.</p>
    <ul class="merge-missing-list">`;
  for (const f of missingList) {
    html += `<li><code>{${escapeHtml(f)}}</code> — ${escapeHtml(missingLabels[f] || labels[f] || f)}</li>`;
  }
  return html + '</ul></div>';
}

function renderPreviewFieldsFromMerge(merge, meta, templatePath) {
  const sections = document.getElementById('previewSections');
  if (!sections || !meta) return;

  const values = merge || {};
  const labels = meta.labels || F2A.PREVIEW_LABELS;
  const groups = meta.groups || {};
  const missing = new Set(meta.missing || []);
  const missingLabels = meta.missing_labels || {};
  const tplName = (templatePath || '').split(/[/\\]/).pop();

  let html = `<p class="hint template-meta">${escapeHtml(tplName)} · форма дипломов + база</p>`;
  html += renderMissingFieldsBanner(meta.missing, missingLabels, labels);

  const renderGroup = (title, keys) => {
    if (!keys?.length) return '';
    const items = keys
      .map(k => renderPreviewFieldControl(k, values[k] || '', labels, missing.has(k)))
      .join('');
    return `<div class="preview-group"><h3>${escapeHtml(title)}</h3><div class="preview-fields-grid">${items}</div></div>`;
  };

  const templateBrace = groups.brace || [];
  const templateMailmerge = groups.mailmerge || [];
  const templateAll =
    meta.template_all ||
    groups.template_all ||
    [...new Set([...templateBrace, ...templateMailmerge, ...(groups.word || [])])];

  html += renderGroup(
    'Поля в шаблоне {…}',
    sortTemplateFieldKeys(templateBrace.length ? templateBrace : templateAll, missing)
  );
  const mailOnly = templateMailmerge.filter(k => !templateBrace.includes(k));
  if (mailOnly.length) {
    html += renderGroup('Поля Word (слияние)', sortTemplateFieldKeys(mailOnly, missing));
  }
  html += renderGroup('Дипломы (форма)', groups.diploma);
  html += renderGroup('Протокол / Excel (не в шаблоне)', groups.protocol);
  html += renderGroup('Свои поля', groups.custom);

  const shown = new Set([
    ...templateAll,
    ...(groups.diploma || []),
    ...(groups.protocol || []),
    ...(groups.custom || []),
  ]);
  const extra = Object.keys(values).filter(k => !shown.has(k)).sort();
  if (extra.length) {
    html += renderGroup('Из Excel', extra);
  }

  const missingOnly = (meta.missing || []).filter(f => !shown.has(f) && !extra.includes(f));
  if (missingOnly.length) {
    html += renderGroup('Требуют заполнения', missingOnly);
  }

  sections.innerHTML = html;
  const chipFields = meta.fields?.length ? meta.fields : [...shown, ...extra];
  buildFieldChips(chipFields);
  F2A.lastPreviewFieldsStudent = F2A.diplomaPreviewMode ? '__diploma__' : F2A.lastPreviewFieldsStudent;
  F2A.lastPreviewTemplate = templatePath || F2A.lastPreviewTemplate;
}

function buildFieldChips(fieldNames) {
  const box = document.getElementById('fieldChips');
  const wrap = document.getElementById('previewFieldInserter');
  if (!box || !wrap) return;
  if (!fieldNames.length) {
    wrap.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');
  box.innerHTML = fieldNames.map(name =>
    `<button type="button" class="field-chip" draggable="true" data-insert-field="${escapeHtml(name)}" title="Вставить {${escapeHtml(name)}} в документ">{${escapeHtml(name)}}</button>`
  ).join('');
}

function getPreviewEditableRoot() {
  return window.PreviewWord?.getEditableRoot('wordPreview') || null;
}

function getPreviewDocumentHtml() {
  return window.PreviewWord?.getDocumentHtml('wordPreview') ?? null;
}

function insertTokenAtCaret(root, text) {
  if (!root) return false;
  root.focus();
  const sel = window.getSelection();
  if (!sel) return false;

  let range;
  if (sel.rangeCount && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function insertFieldToken(fieldName) {
  const token = `{${fieldName}}`;
  const docRoot = getPreviewEditableRoot();
  const activeInDoc =
    docRoot &&
    (docRoot === document.activeElement || docRoot.contains(document.activeElement));

  if (activeInDoc || F2A.lastFocusedPreviewDoc) {
    const root = F2A.lastFocusedPreviewDoc || docRoot;
    if (root && insertTokenAtCaret(root, token)) {
      syncDocumentToFields(root);
      setStatus('В документ: ' + token);
      return;
    }
  }

  const el = F2A.lastFocusedPreviewInput || document.querySelector('#previewSections [data-preview-field]');
  if (!el) {
    setStatus('Кликните в документ справа или в поле слева');
    return;
  }
  el.focus();
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  setStatus('В поле: ' + token);
}

function syncDocumentToFields(root) {
  if (!root) return;
  root.querySelectorAll('.merge-editable[data-merge-field]').forEach(span => syncSpanToField(span));
}

document.getElementById('previewSections')?.addEventListener('focusin', e => {
  if (e.target.matches('[data-preview-field]')) F2A.lastFocusedPreviewInput = e.target;
});

document.getElementById('fieldChips')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-insert-field]');
  if (!btn) return;
  insertFieldToken(btn.dataset.insertField);
});

document.getElementById('fieldChips')?.addEventListener('dragstart', e => {
  const btn = e.target.closest('[data-insert-field]');
  if (!btn) return;
  const token = `{${btn.dataset.insertField}}`;
  e.dataTransfer.setData('text/plain', token);
  e.dataTransfer.effectAllowed = 'copy';
  btn.classList.add('is-dragging');
});

document.getElementById('fieldChips')?.addEventListener('dragend', e => {
  e.target.closest('[data-insert-field]')?.classList.remove('is-dragging');
});

function renderPreviewFieldGroup(title, keys, values, labels, missingSet) {
  if (!keys?.length) return '';
  const miss = missingSet || new Set();
  return `<div class="preview-group"><h3>${escapeHtml(title)}</h3><div class="preview-fields-grid">` +
    keys.map(k => renderPreviewFieldControl(k, values[k] || '', labels, miss.has(k))).join('') +
    '</div></div>';
}

async function addCustomField(nameInputId, templatePath) {
  const inp = document.getElementById(nameInputId);
  const name = inp?.value?.trim();
  if (!name) {
    setStatus('Введите имя поля');
    return false;
  }
  const r = await fetch('/api/custom-fields', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, template: templatePath || undefined }),
  });
  const data = await r.json();
  if (!r.ok) {
    setStatus(data.error || 'Ошибка');
    return false;
  }
  if (inp) inp.value = '';
  setStatus('Поле добавлено: {' + name + '}');
  return true;
}

async function refreshPreviewFields(id) {
  const sections = document.getElementById('previewSections');
  const template = F2A.getSelectedTemplate();
  if (!sections) return;
  if (!template) {
    sections.innerHTML = '<p class="muted">Выберите шаблон Word (.docx в папке data/)</p>';
    return;
  }

  const [previewRes, fieldsRes] = await Promise.all([
    fetch('/api/preview/' + encodeURIComponent(id)),
    fetch('/api/template-fields?template=' + encodeURIComponent(template)),
  ]);
  const data = await previewRes.json();
  const fieldsData = await fieldsRes.json();
  if (data.error) {
    sections.innerHTML = `<p class="muted">${escapeHtml(data.error)}</p>`;
    return;
  }
  if (fieldsData.error) {
    sections.innerHTML = `<p class="muted">${escapeHtml(fieldsData.error)}</p>`;
    return;
  }

  const values = data.preview || {};
  const labels = fieldsData.labels || data.labels || F2A.PREVIEW_LABELS;
  const groups = fieldsData.groups || {};
  const missingSet = new Set(fieldsData.missing || []);
  const missingLabels = fieldsData.missing_labels || {};
  const tplName = template.split(/[/\\]/).pop();
  const chipFields = fieldsData.fields || [];
  const templateBrace = groups.brace || [];
  const templateMailmerge = groups.mailmerge || [];
  const templateAll =
    fieldsData.template_all ||
    groups.template_all ||
    [...new Set([...templateBrace, ...templateMailmerge, ...(groups.word || [])])];

  let html = `<p class="hint template-meta">${escapeHtml(tplName)} · данные из Excel и форм</p>`;
  html += renderMissingFieldsBanner(fieldsData.missing, missingLabels, labels);
  html += renderPreviewFieldGroup(
    'Поля в шаблоне {…}',
    sortTemplateFieldKeys(templateBrace.length ? templateBrace : templateAll, missingSet),
    values,
    labels,
    missingSet
  );
  const mailOnly = templateMailmerge.filter(k => !templateBrace.includes(k));
  if (mailOnly.length) {
    html += renderPreviewFieldGroup(
      'Поля Word (слияние)',
      sortTemplateFieldKeys(mailOnly, missingSet),
      values,
      labels,
      missingSet
    );
  }
  html += renderPreviewFieldGroup('Дипломы (форма)', groups.diploma, values, labels, missingSet);
  html += renderPreviewFieldGroup('Протокол / Excel (не в шаблоне)', groups.protocol, values, labels, missingSet);
  html += renderPreviewFieldGroup('Свои поля', groups.custom, values, labels, missingSet);

  const shown = new Set([
    ...templateAll,
    ...(groups.diploma || []),
    ...(groups.protocol || []),
    ...(groups.custom || []),
  ]);
  const extra = Object.keys(values).filter(k => !shown.has(k)).sort();
  if (extra.length) {
    html += renderPreviewFieldGroup('Из Excel', extra, values, labels, missingSet);
  }

  sections.innerHTML = html;
  buildFieldChips(chipFields.length ? chipFields : [...shown, ...extra]);
  F2A.lastPreviewFieldsStudent = id;
  F2A.lastPreviewTemplate = template;
  F2A.diplomaPreviewMode = false;
}

let previewMergeTimer = null;
function schedulePreviewMergeRefresh() {
  const id = document.getElementById('previewStudent')?.value || F2A.previewId;
  const hasFields = document.querySelector('#previewSections [data-preview-field]');
  if (!id && !F2A.diplomaPreviewMode && !hasFields) return;
  clearTimeout(previewMergeTimer);
  previewMergeTimer = setTimeout(() => {
    const collected = collectPreviewFieldsMerge();
    refreshWordPreview({
      skipFieldsReload: true,
      fresh: true,
      mergeOverride: collected || undefined,
      diplomaPreviewMode: F2A.diplomaPreviewMode,
    });
  }, 450);
}

document.getElementById('previewSections')?.addEventListener('input', e => {
  if (e.target.matches('[data-preview-field]')) schedulePreviewMergeRefresh();
});

document.getElementById('previewSections')?.addEventListener('change', e => {
  if (e.target.matches('[data-preview-field]')) schedulePreviewMergeRefresh();
});

document.getElementById('btnAddCustomField')?.addEventListener('click', async () => {
  const id = document.getElementById('previewStudent')?.value || F2A.previewId || F2A.selectedId;
  const ok = await addCustomField('customFieldName', F2A.getSelectedTemplate());
  if (ok && id) await refreshPreviewFields(id);
});

document.getElementById('customFieldName')?.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  document.getElementById('btnAddCustomField')?.click();
});

async function savePreviewFields() {
  const id = document.getElementById('previewStudent')?.value || F2A.previewId || F2A.selectedId;
  if (!id) return;
  const merge = collectPreviewFieldsMerge();
  const docRoot = getPreviewEditableRoot();
  if (docRoot) syncDocumentToFields(docRoot);

  const payload = {
    template: F2A.getSelectedTemplate() || undefined,
    merge: merge || {},
  };
  const html = getPreviewDocumentHtml();
  if (html != null) payload.html = html;

  const r = await fetch('/api/student/' + encodeURIComponent(id) + '/preview-layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) {
    setStatus(data.error || 'Ошибка сохранения');
    return;
  }
  setStatus('Сохранено: поля и текст предпросмотра');
  await F2A.loadStudents();
  await refreshWordPreview({ skipFieldsReload: true, fresh: true });
}

async function refreshWordPreview(opts = {}) {
  const sel = document.getElementById('previewStudent');
  const tpl = opts.template || F2A.getSelectedTemplate();
  const id = sel?.value || F2A.previewId || null;
  const loading = document.getElementById('previewLoading');
  const errEl = document.getElementById('previewError');
  const wordEl = document.getElementById('wordPreview');
  const btnGen = document.getElementById('btnPreviewGen');
  const sections = document.getElementById('previewSections');

  errEl?.classList.add('hidden');
  if (!tpl) {
    if (wordEl) {
      wordEl.innerHTML = '<p class="word-placeholder muted">Выберите шаблон Word (.docx в папке data/)</p>';
    }
    if (btnGen) btnGen.disabled = !id;
    F2A.lastPreviewFieldsStudent = null;
    return;
  }

  if (id) {
    F2A.previewId = id;
    if (sel && !sel.value) sel.value = id;
  }
  if (btnGen) btnGen.disabled = !id;

  const needFields =
    id &&
    (opts.reloadFields ||
      id !== F2A.lastPreviewFieldsStudent ||
      tpl !== F2A.lastPreviewTemplate ||
      !document.querySelector('#previewSections [data-preview-field]'));

  if (opts.diplomaFieldsMeta && !opts.skipFieldsReload) {
    renderPreviewFieldsFromMerge(opts.mergeOverride || {}, opts.diplomaFieldsMeta, tpl);
    F2A.diplomaPreviewMode = true;
  } else if (needFields && !opts.skipFieldsReload) {
    await refreshPreviewFields(id);
  } else if (!id && !opts.diplomaPreviewMode && sections && !sections.querySelector('[data-preview-field]')) {
    const tplName = tpl.split(/[/\\]/).pop();
    sections.innerHTML = `<p class="hint template-meta">${escapeHtml(tplName)}</p><p class="muted">Выберите студента — справа подставятся поля из Excel.</p>`;
    F2A.lastPreviewTemplate = tpl;
  }

  loading?.classList.remove('hidden');

  try {
    const fromPanel = collectPreviewFieldsMerge();
    const merge = fromPanel
      ? fromPanel
      : opts.mergeOverride !== undefined
        ? opts.mergeOverride
        : id
          ? collectPreviewFieldsMerge()
          : null;
    await window.PreviewWord.render('wordPreview', {
      template: tpl,
      id: id || undefined,
      merge: merge || undefined,
      raw: !id && !merge,
      fresh: !!opts.fresh,
    });
    F2A.lastFocusedPreviewDoc = getPreviewEditableRoot();
    F2A.schedulePreviewFit();
    loading?.classList.add('hidden');
    const fio = id ? F2A.students.find(s => s.id === id)?.fio : '';
    if (opts.diplomaPreviewMode || opts.mergeOverride !== undefined) {
      const miss = opts.diplomaFieldsMeta?.missing?.length;
      let msg = fio
        ? 'Предпросмотр (форма дипломов + база): ' + fio
        : 'Предпросмотр по форме дипломов';
      if (miss) msg += `. Не заполнено полей: ${miss}`;
      setStatus(msg);
    } else {
      setStatus(
        fio
          ? 'Предпросмотр с подстановкой: ' + fio
          : 'Шаблон без данных — выберите студента'
      );
    }
  } catch (err) {
    loading?.classList.add('hidden');
    errEl.textContent = err.message || 'Не удалось показать документ';
    errEl.classList.remove('hidden');
  }
}

function bindEditableSpans(host) {
  const root = host.querySelector('.docx-editable') || host;
  host.classList.add('docx-host--editing');
  root.addEventListener('input', e => {
    const span = e.target.closest?.('.merge-editable');
    if (span) syncSpanToField(span);
  });
  root.addEventListener('blur', e => {
    const span = e.target.closest?.('.merge-editable');
    if (span) syncSpanToField(span);
  }, true);
}

function syncSpanToField(span) {
  const field = span.dataset.mergeField;
  if (!field) return;
  const value = span.textContent.trim();
  if (document.querySelector(`[data-preview-field="${field}"]`)) {
    setPreviewFieldValue(field, value);
    document.querySelector(`[data-preview-field="${field}"]`)
      ?.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function syncFieldToSpans(fieldName, value) {
  document.querySelectorAll(`.merge-editable[data-merge-field="${fieldName}"]`).forEach(span => {
    if (document.activeElement !== span) span.textContent = value;
  });
}

function updatePreviewFieldGapState(field, value) {
  const nodes = document.querySelectorAll(`#previewSections [data-preview-field="${field}"]`);
  const wrap = nodes[0]?.closest('.preview-edit');
  if (!wrap) return;
  const filled = !!(value && String(value).trim());
  wrap.classList.toggle('preview-edit--gap', !filled);
  const mark = wrap.querySelector('.preview-gap-mark');
  if (mark) mark.hidden = filled;
}

function onPreviewFieldChange(el) {
  if (!el?.dataset?.previewField) return;
  const value = el.type === 'radio' ? (el.checked ? el.value : getPreviewFieldValue(el.dataset.previewField)) : el.value;
  if (el.type === 'radio' && !el.checked) return;
  syncFieldToSpans(el.dataset.previewField, value);
  updatePreviewFieldGapState(el.dataset.previewField, value);
}

document.getElementById('previewSections')?.addEventListener('input', e => {
  if (!e.target.matches('[data-preview-field]')) return;
  onPreviewFieldChange(e.target);
});

document.getElementById('previewSections')?.addEventListener('change', e => {
  if (!e.target.matches('[data-preview-field][type="radio"]')) return;
  onPreviewFieldChange(e.target);
});

function initPreviewDocumentEditing() {
  const scroller = document.getElementById('wordPreviewScroller');
  const host = document.getElementById('wordPreview');
  if (!host) return;

  if (scroller && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (document.getElementById('panel-preview')?.classList.contains('is-active')) {
        F2A.schedulePreviewFit();
      }
    }).observe(scroller);
  }

  host.addEventListener('focusin', e => {
    const root = e.target.closest('section.docx, .docx-editable');
    if (root) F2A.lastFocusedPreviewDoc = root;
  });

  host.addEventListener('click', e => {
    const root = e.target.closest('section.docx, .docx-editable');
    if (root) F2A.lastFocusedPreviewDoc = root;
  });

  host.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types?.includes('text/plain')) return;
    if (!getPreviewEditableRoot()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  host.addEventListener('drop', e => {
    const token = e.dataTransfer?.getData('text/plain');
    if (!token || !token.startsWith('{')) return;
    const root = e.target.closest('section.docx, .docx-editable') || getPreviewEditableRoot();
    if (!root) return;
    e.preventDefault();
    insertTokenAtCaret(root, token);
    syncDocumentToFields(root);
    setStatus('В документ: ' + token);
  });
}

function initPreviewBindings() {
  document.getElementById('btnSavePreviewFields')?.addEventListener('click', savePreviewFields);

  document.getElementById('previewStudent')?.addEventListener('change', e => {
    F2A.previewId = e.target.value || null;
    const btnGen = document.getElementById('btnPreviewGen');
    if (btnGen) btnGen.disabled = !F2A.previewId;
    F2A.updatePreviewStudentTitle?.();
    F2A.lastPreviewFieldsStudent = null;
    F2A.diplomaPreviewMode = false;
    refreshWordPreview({ reloadFields: true });
  });

  (F2A.TEMPLATE_SELECT_IDS || ['protocolTemplate', 'previewTemplate']).forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => F2A.onTemplateSelectChange?.(id));
  });

  document.getElementById('uploadTemplateFile')?.addEventListener('change', async e => {
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
    await F2A.loadWordTemplates(data.template.path);
    F2A.lastPreviewTemplate = null;
    setStatus('Шаблон загружен: ' + data.template.name);
    refreshWordPreview({ reloadFields: true });
  });

  document.getElementById('btnPreviewGen')?.addEventListener('click', () => {
    const id = document.getElementById('previewStudent')?.value || F2A.previewId;
    if (id) F2A.generate([id]);
  });

  document.getElementById('btnRefreshPreview')?.addEventListener('click', () => {
    refreshWordPreview({ reloadFields: false, fresh: true });
  });
}

F2A.refreshWordPreview = refreshWordPreview;

window.openPreviewWithMerge = async payload => {
  const merge = payload.merge || {};
  const templatePath = payload.template;
  const studentId = payload.student_id;
  const opts = {
    fresh: true,
    skipFieldsReload: false,
    mergeOverride: merge,
    template: templatePath,
    diplomaFieldsMeta: payload.fields_meta || null,
    diplomaPreviewMode: true,
  };
  if (templatePath) {
    F2A.syncTemplateSelects?.(null, templatePath);
    F2A.lastPreviewTemplate = null;
  }
  if (studentId) {
    F2A.previewId = studentId;
    const sel = document.getElementById('previewStudent');
    if (sel) sel.value = studentId;
    F2A.updatePreviewStudentTitle?.();
  }
  F2A.pendingPreviewOpts = opts;
  F2A.switchTab('preview');
  F2A.pendingPreviewOpts = null;
  await refreshWordPreview(opts);
};
F2A.addCustomField = addCustomField;
F2A.insertTokenAtCaret = insertTokenAtCaret;
F2A.initPreviewDocumentEditing = initPreviewDocumentEditing;
F2A.initPreviewBindings = initPreviewBindings;
window.bindEditablePreview = bindEditableSpans;
window.insertTokenAtCaret = insertTokenAtCaret;
window.addCustomField = addCustomField;
})();
