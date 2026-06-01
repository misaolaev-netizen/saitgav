function initFilePickers() {
  document.querySelectorAll('[data-file-picker]').forEach(wrap => {
    const input = wrap.querySelector('input[type="file"]');
    const trigger = wrap.querySelector('[data-file-label]');
    const nameEl = wrap.querySelector('[data-file-name]');
    if (!input || !trigger) return;
    trigger.addEventListener('click', e => {
      e.preventDefault();
      input.click();
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (nameEl) {
        const hideEmpty = wrap.classList.contains('file-picker--compact')
          || wrap.classList.contains('file-picker--toolbar');
        nameEl.textContent = file ? file.name : (hideEmpty ? '' : 'Файл не выбран');
        nameEl.classList.toggle('has-file', !!file);
      }
      if (file && wrap.classList.contains('file-picker--toolbar') && trigger.tagName === 'BUTTON') {
        trigger.textContent = '+ ' + (file.name.length > 14 ? file.name.slice(0, 12) + '…' : file.name);
      }
    });
  });
}

document.getElementById('btnReload')?.addEventListener('click', () => F2A.reload());
document.getElementById('btnSave')?.addEventListener('click', () => F2A.saveEditor?.());
document.getElementById('btnUpload')?.addEventListener('click', async () => {
  const f = document.getElementById('uploadFile')?.files?.[0];
  if (!f) {
    F2A.setStatus('Выберите файл');
    return;
  }
  const fd = new FormData();
  fd.append('file', f);
  const data = await (await fetch('/api/upload', { method: 'POST', body: fd })).json();
  if (data.error) {
    F2A.setStatus(data.error);
    return;
  }
  F2A.setStatus(
    `Файл сохранён в data/: ${data.path?.split(/[/\\]/).pop() || 'ok'}. Обновляю данные…`
  );
  await F2A.loadExcelFilesForReload?.();
  await F2A.reload?.();
});

document.getElementById('btnImportSource')?.addEventListener('click', async () => {
  const f = document.getElementById('importSourceFile')?.files?.[0];
  const kind = document.getElementById('importSourceKind')?.value || 'dp';
  if (!f) {
    F2A.setStatus('Выберите Excel-файл для импорта');
    return;
  }
  const fd = new FormData();
  fd.append('file', f);
  fd.append('kind', kind);
  F2A.setStatus(`Импортирую «${f.name}» как ${kind.toUpperCase()}…`);
  let data;
  try {
    data = await (await fetch('/api/import-source', { method: 'POST', body: fd })).json();
  } catch (err) {
    F2A.setStatus('Ошибка сети при импорте: ' + err.message);
    return;
  }
  if (data?.error) {
    F2A.setStatus(data.error);
    return;
  }
  const fname = data.name || f.name;
  const s = data.stats || {};
  F2A.setStatus(
    `Импортирован «${fname}» (${kind}). ДП:${s.dp||0}, опрос:${s.form||0}, ГИА:${s.gia||0}, шаблоны:${s.templates||0}, студентов:${s.students||0}.`
  );
  await F2A.loadExcelFilesForReload?.();
  await F2A.loadStudents?.();
});

initFilePickers();
F2A.initProtocolsStudentUi?.();
F2A.initPreviewDocumentEditing?.();
F2A.initPreviewBindings?.();
F2A.loadWordTemplates?.().then(() => F2A.reload());
