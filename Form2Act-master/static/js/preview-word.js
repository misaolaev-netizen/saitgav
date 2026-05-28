const PreviewWord = {
  _undo: new WeakMap(),

  isDocxPreviewHtml(html) {
    if (!html || typeof html !== 'string') return false;
    return (
      html.includes('data-preview-format="docx-preview"') ||
      html.includes('class="docx-body-host"') ||
      html.includes('class="docx-wrapper"') ||
      /section[^>]+class="docx"/i.test(html)
    );
  },

  getHost(hostOrId) {
    if (!hostOrId) return document.getElementById('wordPreview');
    return typeof hostOrId === 'string' ? document.getElementById(hostOrId) : hostOrId;
  },

  getEditableRoot(host) {
    const h = this.getHost(host);
    if (!h) return null;
    const focused = h.querySelector('section.docx:focus-within');
    if (focused) return focused;
    return (
      h.querySelector('.docx-body-host .docx-wrapper section.docx') ||
      h.querySelector('.docx-wrapper section.docx') ||
      h.querySelector('.docx-editable')
    );
  },

  getDocumentHtml(host) {
    const h = this.getHost(host);
    if (!h) return null;
    if (h.querySelector('.docx-style-host') && h.querySelector('.docx-body-host')) {
      return h.innerHTML;
    }
    const bodyHost = h.querySelector('.docx-body-host');
    if (bodyHost) return bodyHost.outerHTML;
    const wrapper = h.querySelector('.docx-wrapper');
    if (wrapper) {
      return (
        '<div class="docx-body-host" data-preview-format="docx-preview">' +
        wrapper.outerHTML +
        '</div>'
      );
    }
    const root = h.querySelector('.docx-editable');
    return root ? root.innerHTML : null;
  },

  extractParagraphTexts(host) {
    const h = this.getHost(host);
    if (!h) return [];
    const nodes = h.querySelectorAll(
      'section.docx p, section.docx td, section.docx th, section.docx li, .docx-editable p'
    );
    if (nodes.length) {
      return [...nodes].map(el => el.textContent.replace(/\s+/g, ' ').trim());
    }
    return extract_texts_fallback(h.innerHTML);
  },

  getBaseline(host) {
    const h = this.getHost(host);
    if (!h?.dataset?.paragraphBaseline) return [];
    try {
      return JSON.parse(h.dataset.paragraphBaseline);
    } catch {
      return [];
    }
  },

  setBaseline(host, texts) {
    const h = this.getHost(host);
    if (!h) return;
    h.dataset.paragraphBaseline = JSON.stringify(texts || []);
  },

  _blockedInputTypes: new Set([
    'formatBold',
    'formatItalic',
    'formatUnderline',
    'formatStrikeThrough',
    'formatSuperscript',
    'formatSubscript',
    'formatFontName',
    'formatFontSize',
    'formatForeColor',
    'formatBackColor',
    'formatJustifyFull',
    'formatJustifyCenter',
    'formatJustifyRight',
    'formatJustifyLeft',
    'formatIndent',
    'formatOutdent',
    'formatRemove',
    'formatSetBlockTextDirection',
    'formatSetInlineTextDirection',
  ]),

  _getUndoSnapshot(host) {
    const body = host.querySelector('.docx-body-host');
    return body ? body.innerHTML : host.innerHTML;
  },

  _applyUndoSnapshot(host, html) {
    const body = host.querySelector('.docx-body-host');
    if (body) body.innerHTML = html;
    else host.innerHTML = html;
    host.dataset.docxEditBound = '0';
    host.dataset.undoBound = '0';
    PreviewWord.bindEditing(host);
  },

  _resetUndo(host) {
    PreviewWord._undo.set(host, {
      past: [PreviewWord._getUndoSnapshot(host)],
      future: [],
    });
  },

  _bindUndo(host) {
    if (host.dataset.undoBound === '1') return;
    host.dataset.undoBound = '1';
    PreviewWord._resetUndo(host);

    let undoTimer;
    host.addEventListener(
      'input',
      () => {
        clearTimeout(undoTimer);
        undoTimer = setTimeout(() => {
          const stack = PreviewWord._undo.get(host);
          if (!stack) return;
          const snap = PreviewWord._getUndoSnapshot(host);
          if (stack.past[stack.past.length - 1] === snap) return;
          stack.past.push(snap);
          if (stack.past.length > 60) stack.past.shift();
          stack.future = [];
        }, 350);
      },
      true
    );
  },

  bindEditing(hostOrId) {
    const host = this.getHost(hostOrId);
    if (!host) return;

    host.classList.add('docx-host--word', 'docx-host--editing');
    host.querySelectorAll('.docx-wrapper section.docx').forEach(sec => {
      sec.setAttribute('contenteditable', 'true');
      sec.setAttribute('spellcheck', 'true');
      sec.setAttribute('data-docx-section', '1');
    });
    host.querySelectorAll('.docx-editable').forEach(root => {
      root.setAttribute('contenteditable', 'true');
      root.setAttribute('spellcheck', 'true');
    });

    if (host.dataset.docxEditBound !== '1') {
      host.dataset.docxEditBound = '1';

      host.addEventListener(
        'beforeinput',
        e => {
          if (PreviewWord._blockedInputTypes.has(e.inputType)) {
            e.preventDefault();
          }
        },
        true
      );

      host.addEventListener(
        'paste',
        e => {
          const sec =
            e.target.closest?.('section.docx[contenteditable]') ||
            e.target.closest?.('.docx-editable[contenteditable]');
          if (!sec) return;
          e.preventDefault();
          const text = e.clipboardData?.getData('text/plain') || '';
          if (!text) return;
          if (document.queryCommandSupported?.('insertText')) {
            document.execCommand('insertText', false, text);
          } else {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
          }
        },
        true
      );

      host.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        if (k === 'b' || k === 'i' || k === 'u') {
          e.preventDefault();
          return;
        }
        const stack = PreviewWord._undo.get(host);
        if (!stack) return;
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          if (stack.past.length <= 1) return;
          stack.future.push(stack.past.pop());
          PreviewWord._applyUndoSnapshot(host, stack.past[stack.past.length - 1]);
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault();
          if (!stack.future.length) return;
          stack.past.push(stack.future.pop());
          PreviewWord._applyUndoSnapshot(host, stack.past[stack.past.length - 1]);
        }
      });
    }

    PreviewWord._bindUndo(host);
  },

  _previewRequestBody({ id, merge, template, raw, paragraph_baseline, paragraph_edited }) {
    const body = { merge: merge || {}, template: template || undefined };
    if (id) body.id = id;
    if (raw) body.raw = true;
    if (paragraph_baseline?.length) body.paragraph_baseline = paragraph_baseline;
    if (paragraph_edited?.length) body.paragraph_edited = paragraph_edited;
    return body;
  },

  _liveParagraphEdits(host, { fresh = false, template = null } = {}) {
    if (fresh || !host?.querySelector('.docx-wrapper')) return {};
    const loaded = host.dataset.loadedTemplate;
    if (template && loaded && loaded !== template) return {};
    const baseline = PreviewWord.getBaseline(host);
    const edited = PreviewWord.extractParagraphTexts(host);
    if (!baseline.length || !edited.length) return {};
    if (JSON.stringify(baseline) === JSON.stringify(edited)) return {};
    return { paragraph_baseline: baseline, paragraph_edited: edited };
  },

  async _fetchDocxBlob(opts, host) {
    const live = host
      ? PreviewWord._liveParagraphEdits(host, { fresh: opts.fresh, template: opts.template })
      : {};
    const fileRes = await fetch('/api/preview-doc-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PreviewWord._previewRequestBody({ ...opts, ...live })),
    });
    const ct = fileRes.headers.get('content-type') || '';
    if (!fileRes.ok || ct.includes('application/json')) {
      const err = await fileRes.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка сборки документа');
    }
    return fileRes.blob();
  },

  async _renderBlob(host, blob, docxLib) {
    host.innerHTML = '';
    const styleContainer = document.createElement('div');
    styleContainer.className = 'docx-style-host';
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'docx-body-host';
    host.appendChild(styleContainer);
    host.appendChild(bodyContainer);

    await docxLib.renderAsync(blob, bodyContainer, styleContainer, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderAltChunks: true,
      useBase64URL: true,
    });
  },

  async render(hostOrId, { id, merge, template, raw = false, fresh = false } = {}) {
    const host = this.getHost(hostOrId);
    if (!host) return;

    const docxLib = window.docx || window.docxPreview;
    if (!docxLib?.renderAsync) {
      host.innerHTML =
        '<p class="muted word-placeholder">Библиотека docx-preview не загружена</p>';
      return;
    }

    const loadedTpl = host.dataset.loadedTemplate;
    const templateChanged = !!(template && loadedTpl && loadedTpl !== template);
    const useFresh = fresh || templateChanged;
    if (templateChanged) {
      PreviewWord.setBaseline(host, []);
      host.dataset.undoBound = '0';
      host.dataset.docxEditBound = '0';
      PreviewWord._undo.delete(host);
    }

    const live = PreviewWord._liveParagraphEdits(host, { fresh: useFresh, template });
    const layoutRes = await fetch('/api/preview-doc-editable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        PreviewWord._previewRequestBody({ id, merge, template, raw, ...live })
      ),
    });
    const layout = await layoutRes.json();
    if (!layoutRes.ok) throw new Error(layout.error || 'Ошибка предпросмотра');

    PreviewWord.setBaseline(host, layout.paragraph_baseline || []);

    const blob = await PreviewWord._fetchDocxBlob(
      { id, merge, template, raw, fresh: useFresh },
      host
    );
    host.dataset.undoBound = '0';
    host.dataset.docxEditBound = '0';
    PreviewWord._undo.delete(host);
    await PreviewWord._renderBlob(host, blob, docxLib);
    PreviewWord.bindEditing(host);
    if (template) host.dataset.loadedTemplate = template;
  },

  async downloadTemplateExport({ template, id, merge, raw = true, filename, hostOrId }) {
    const host = PreviewWord.getHost(hostOrId);
    const live = host ? PreviewWord._liveParagraphEdits(host) : {};
    const body = { template, raw, ...live };
    if (id && !raw) body.id = id;
    if (merge && !raw) body.merge = merge;

    const r = await fetch('/api/template-layout/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || ct.includes('application/json')) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось скачать');
    }
    const blob = await r.blob();
    const base = (filename || template || 'template.docx').split(/[/\\]/).pop() || 'template.docx';
    const name = base.endsWith('.docx') ? base : base + '.docx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

function extract_texts_fallback(html) {
  const texts = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t) texts.push(t);
  }
  return texts;
}

window.PreviewWord = PreviewWord;
