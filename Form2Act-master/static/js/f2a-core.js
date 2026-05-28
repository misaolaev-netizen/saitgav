const F2A = (window.F2A = window.F2A || {});

F2A.MERGE_FIELDS = JSON.parse(document.body.dataset.mergeFields || '[]');
const DIPLOMA_FIELD_NAMES = JSON.parse(document.body.dataset.diplomaFields || '[]');
F2A.PREVIEW_LABELS = JSON.parse(document.body.dataset.previewLabels || '{}');

F2A.DIPLOMA_KEYS = DIPLOMA_FIELD_NAMES.length
  ? DIPLOMA_FIELD_NAMES
  : [
      'Рецензия_замечания',
      'Рецензия_достоинства',
      'Отзыв_руководителя',
      'Отзыв_руководителя_2',
      'Готовое_изделие',
      'Общая_оценка',
      'Уровень_знаний',
    ];

F2A.students = [];
F2A.selectedId = null;
F2A.previewId = null;
F2A.checkedStudentIds = new Set();
F2A.studentUi = {
  search: '',
  status: 'all',
  source: '',
  sort: 'fio',
  sortAsc: true,
};
F2A.lastPreviewFieldsStudent = null;
F2A.lastPreviewTemplate = null;
F2A.lastFocusedPreviewInput = null;
F2A.lastFocusedPreviewDoc = null;
F2A.templateFillById = null;

F2A.LONG_PREVIEW_FIELDS = new Set(['Вопросы', 'Темы_дипломного_проекта', 'Рецензия_достоинства']);

F2A.PREVIEW_FIELD_CHOICES = {
  Рецензия_замечания: [
    { value: 'замечаний нет', label: 'замечаний нет' },
    { value: 'незначительные замечания', label: 'незначительные замечания' },
    { value: 'есть замечания', label: 'есть замечания' },
  ],
  Отзыв_руководителя: [
    { value: 'Положительный', label: 'Положительный' },
    { value: 'Отрицательный', label: 'Отрицательный' },
  ],
  Отзыв_руководителя_2: [
    {
      value:
        'Содержание дипломного проекта соответствует выданному индивидуальному заданию. Дипломный проект выполнен на высоком уровне, соответствует всем требованиям и может быть допущен к защите.',
      label: 'Высокий уровень — соответствует заданию, допущен к защите',
    },
    {
      value:
        'Содержание дипломного проекта не полностью соответствует выданному индивидуальному заданию. Дипломный проект выполнен на удовлетворительном уровне, может быть допущен к защите.',
      label: 'Не полностью соответствует заданию — удовлетворительный уровень',
    },
    {
      value:
        'Содержание дипломного проекта полностью соответствует выданному индивидуальному заданию. Дипломный проект выполнен на удовлетворительном уровне, может быть допущен к защите.',
      label: 'Полностью соответствует заданию — удовлетворительный уровень',
    },
  ],
  Готовое_изделие: [
    { value: 'Приложение', label: 'Приложение' },
    { value: 'Мобильное приложение', label: 'Мобильное приложение' },
    { value: 'Веб-сайт', label: 'Веб-сайт' },
    { value: 'Подсистема', label: 'Подсистема' },
  ],
  Общая_оценка: [
    {
      value:
        'При защите работы обучающийся показал знание вопросов темы, оперировал данными исследования, без особых затруднений отвечал на поставленные вопросы',
      label: 'Без особых затруднений отвечал на вопросы',
    },
    {
      value:
        'При защите работы обучающийся показал знание вопросов темы, оперировал данными исследования, с некоторыми затруднениями отвечал на поставленные вопросы',
      label: 'С некоторыми затруднениями отвечал на вопросы',
    },
  ],
  Уровень_знаний: [
    { value: 'отличный', label: 'отличный' },
    { value: 'хороший', label: 'хороший' },
    { value: 'удовлетворительный', label: 'удовлетворительный' },
  ],
};

F2A.moveTabIndicator = function moveTabIndicator(name) {
  const tabs = document.getElementById('tabList');
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  const indicator = document.getElementById('tabIndicator');
  if (!tabs || !tab || !indicator) return;
  const tr = tabs.getBoundingClientRect();
  const br = tab.getBoundingClientRect();
  indicator.style.width = `${br.width}px`;
  indicator.style.transform = `translateX(${br.left - tr.left}px)`;
};

F2A.switchTab = function switchTab(name) {
  if (!document.querySelector(`.tab[data-tab="${name}"]`)) return;

  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  document.querySelectorAll('.panel').forEach(p => {
    const on = p.id === `panel-${name}`;
    if (on) {
      p.hidden = false;
      p.classList.remove('is-active');
      void p.offsetWidth;
      p.classList.add('is-active');
    } else {
      p.classList.remove('is-active');
      p.hidden = true;
    }
  });

  requestAnimationFrame(() => F2A.moveTabIndicator(name));

  if (name === 'protocols') {
    F2A.loadTemplateScan?.();
  }
  if (name === 'preview') {
    if (F2A.pendingPreviewOpts) {
      requestAnimationFrame(() => F2A.schedulePreviewFit());
    } else {
      F2A.ensurePreviewStudentId?.();
      const id = document.getElementById('previewStudent')?.value || F2A.previewId;
      const tpl = F2A.getSelectedTemplate?.();
      const tplChanged = !!(tpl && tpl !== F2A.lastPreviewTemplate);
      F2A.refreshWordPreview?.({
        reloadFields: id && id !== F2A.lastPreviewFieldsStudent,
        fresh: tplChanged,
      });
      requestAnimationFrame(() => F2A.schedulePreviewFit());
    }
  }
  if (name === 'diplomas') {
    window.updateDiplomaLivePreview?.();
    window.loadDiplomaTables?.();
  }
  if (name === 'constructor') {
    window.refreshConstructorStudents?.();
    window.fillCtorTemplateSelects?.();
    window.ctorOnTabActivate?.();
  }
};

document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => F2A.switchTab(t.dataset.tab);
});

window.addEventListener('resize', () => {
  const active = document.querySelector('.tab.active')?.dataset.tab;
  if (active) F2A.moveTabIndicator(active);
  if (active === 'preview') F2A.schedulePreviewFit?.();
});

let previewFitTimer = null;
F2A.schedulePreviewFit = function schedulePreviewFit() {
  clearTimeout(previewFitTimer);
  previewFitTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      F2A.fitPreviewDocument();
      requestAnimationFrame(F2A.fitPreviewDocument);
    });
  }, 50);
};

F2A.fitPreviewDocument = function fitPreviewDocument() {
  const box = document.getElementById('previewScaleBox');
  const host = document.getElementById('wordPreview');
  if (!box || !host) return;
  host.style.setProperty('--preview-scale', '1');
  box.style.width = '';
  box.style.height = '';
};

requestAnimationFrame(() => F2A.moveTabIndicator('protocols'));

F2A.setStatus = function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
};

F2A.triggerFileDownload = function triggerFileDownload(url) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

F2A.escapeHtml = function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t ?? '';
  return d.innerHTML;
};

Object.defineProperty(window, 'students', {
  get: () => F2A.students,
  set: v => {
    F2A.students = v;
  },
  configurable: true,
});
window.setStatus = msg => F2A.setStatus(msg);
window.switchTab = name => F2A.switchTab(name);
window.MERGE_FIELDS = F2A.MERGE_FIELDS;
window.PREVIEW_LABELS = F2A.PREVIEW_LABELS;
