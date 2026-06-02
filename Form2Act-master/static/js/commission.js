(function () {
  const ROLE_LABELS = {
    chairman: 'Председатель',
    deputy_chairman: 'Зам. председателя',
    secretary: 'Секретарь',
    member: '',
  };

  const state = {
    loaded: false,
    data: null,
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value || '';
  }

  function clearChildren(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function renderCommission(data) {
    const commission = (data && data.commission) || {};
    setText('commissionTitle', commission.title || 'Состав государственной экзаменационной комиссии');
    setText('commissionSpecialty', commission.specialty || '');

    const chairman = commission.chairman || {};
    setText('chairmanName', chairman.name || '—');
    setText('chairmanPosition', chairman.position || '');

    const deputy = commission.deputy_chairman || {};
    setText('deputyName', deputy.name || '—');
    setText('deputyPosition', deputy.position || '');

    const secretary = commission.secretary || {};
    setText('secretaryName', secretary.name || '—');
    setText('secretaryPosition', secretary.position || '');

    const list = document.getElementById('commissionMembersList');
    if (list) {
      clearChildren(list);
      const members = Array.isArray(commission.members) ? commission.members : [];
      if (!members.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'Список членов комиссии пуст.';
        list.appendChild(li);
      } else {
        members.forEach(person => {
          const li = document.createElement('li');
          const name = (person && person.name) || '';
          const position = (person && person.position) || '';
          li.innerHTML = `<span class="member-name">${escapeHtml(name)}</span>` +
            (position ? `<span class="member-position"> — ${escapeHtml(position)}</span>` : '');
          list.appendChild(li);
        });
      }
    }

    renderSchedule(data);
    fillForm(commission);
  }

  function renderSchedule(data) {
    const container = document.getElementById('commissionSchedule');
    if (!container) return;
    clearChildren(container);
    const schedule = (data && data.schedule) || [];
    const sourceEl = document.getElementById('commissionScheduleSource');
    if (sourceEl) {
      const fileName = data && data.schedule_file;
      sourceEl.innerHTML = fileName
        ? `Источник: <code>${escapeHtml(fileName)}</code> из <code>data/</code>.`
        : 'Источник: Excel «Защита по дням» из <code>data/</code> не найден.';
    }
    if (!schedule.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Расписание комиссии не найдено в файле «Защита по дням».';
      container.appendChild(p);
      return;
    }
    schedule.forEach(day => {
      const wrap = document.createElement('section');
      wrap.className = 'commission-day';
      const head = document.createElement('div');
      head.className = 'commission-day__head';
      const dateEl = document.createElement('span');
      dateEl.className = 'commission-day__date';
      dateEl.textContent = day.date || day.sheet || '';
      head.appendChild(dateEl);
      if (day.weekday) {
        const wEl = document.createElement('span');
        wEl.className = 'commission-day__weekday';
        wEl.textContent = day.weekday;
        head.appendChild(wEl);
      }
      wrap.appendChild(head);

      const ul = document.createElement('ul');
      ul.className = 'commission-day__list';
      (day.members || []).forEach(member => {
        const li = document.createElement('li');
        li.className = `role-${member.role || 'member'}`;
        const roleLabel = ROLE_LABELS[member.role] || '';
        if (roleLabel) {
          const r = document.createElement('span');
          r.className = 'commission-day__role';
          r.textContent = roleLabel;
          li.appendChild(r);
        }
        const n = document.createElement('span');
        n.className = 'commission-day__name';
        n.textContent = member.name || '';
        li.appendChild(n);
        if (member.note && member.note !== ROLE_LABELS[member.role]) {
          const note = document.createElement('span');
          note.className = 'commission-day__note';
          note.textContent = ` — ${member.note}`;
          li.appendChild(note);
        }
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      container.appendChild(wrap);
    });
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  function buildMemberRow(member) {
    const row = document.createElement('div');
    row.className = 'commission-form__member-row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'ФИО';
    nameInput.autocomplete = 'off';
    nameInput.value = (member && member.name) || '';
    nameInput.dataset.field = 'name';

    const positionInput = document.createElement('input');
    positionInput.type = 'text';
    positionInput.placeholder = 'Должность';
    positionInput.autocomplete = 'off';
    positionInput.value = (member && member.position) || '';
    positionInput.dataset.field = 'position';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost';
    removeBtn.textContent = 'Удалить';
    removeBtn.addEventListener('click', () => {
      row.remove();
    });

    row.appendChild(nameInput);
    row.appendChild(positionInput);
    row.appendChild(removeBtn);
    return row;
  }

  function fillForm(commission) {
    setValue('formTitle', commission.title || '');
    setValue('formSpecialty', commission.specialty || '');
    setValue('formChairmanName', commission.chairman?.name || '');
    setValue('formChairmanPosition', commission.chairman?.position || '');
    setValue('formDeputyName', commission.deputy_chairman?.name || '');
    setValue('formDeputyPosition', commission.deputy_chairman?.position || '');
    setValue('formSecretaryName', commission.secretary?.name || '');
    setValue('formSecretaryPosition', commission.secretary?.position || '');

    const membersContainer = document.getElementById('commissionFormMembers');
    if (!membersContainer) return;
    clearChildren(membersContainer);
    const members = Array.isArray(commission.members) ? commission.members : [];
    if (!members.length) {
      membersContainer.appendChild(buildMemberRow({}));
    } else {
      members.forEach(member => membersContainer.appendChild(buildMemberRow(member)));
    }
  }

  function collectForm() {
    const membersContainer = document.getElementById('commissionFormMembers');
    const memberRows = membersContainer ? Array.from(membersContainer.querySelectorAll('.commission-form__member-row')) : [];
    const members = memberRows
      .map(row => {
        const inputs = row.querySelectorAll('input[data-field]');
        const member = {};
        inputs.forEach(input => {
          member[input.dataset.field] = input.value.trim();
        });
        return member;
      })
      .filter(member => member.name || member.position);

    return {
      title: document.getElementById('formTitle')?.value.trim() || '',
      specialty: document.getElementById('formSpecialty')?.value.trim() || '',
      chairman: {
        name: document.getElementById('formChairmanName')?.value.trim() || '',
        position: document.getElementById('formChairmanPosition')?.value.trim() || '',
      },
      deputy_chairman: {
        name: document.getElementById('formDeputyName')?.value.trim() || '',
        position: document.getElementById('formDeputyPosition')?.value.trim() || '',
      },
      secretary: {
        name: document.getElementById('formSecretaryName')?.value.trim() || '',
        position: document.getElementById('formSecretaryPosition')?.value.trim() || '',
      },
      members,
    };
  }

  async function loadCommission(force) {
    if (state.loaded && !force) return state.data;
    try {
      const resp = await fetch('/api/commission');
      if (!resp.ok) throw new Error('http ' + resp.status);
      const data = await resp.json();
      state.data = data;
      state.loaded = true;
      renderCommission(data);
      return data;
    } catch (err) {
      const status = document.getElementById('commissionFormStatus');
      if (status) status.textContent = 'Не удалось загрузить состав комиссии: ' + err.message;
      return null;
    }
  }

  async function saveCommission(event) {
    event?.preventDefault();
    const status = document.getElementById('commissionFormStatus');
    if (status) status.textContent = 'Сохранение…';
    try {
      const body = collectForm();
      const resp = await fetch('/api/commission', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || ('http ' + resp.status));
      }
      const data = await resp.json();
      state.data = data;
      renderCommission(data);
      if (status) status.textContent = 'Сохранено.';
      try {
        document.dispatchEvent(new CustomEvent('form2act:commission-changed', { detail: data }));
      } catch (_) { /* no-op */ }
      try { await window.refreshAfterCommission?.(); } catch (_) { /* no-op */ }
    } catch (err) {
      if (status) status.textContent = 'Ошибка сохранения: ' + err.message;
    }
  }

  function initCommissionPanel() {
    const form = document.getElementById('commissionForm');
    if (form) form.addEventListener('submit', saveCommission);

    document.getElementById('btnResetCommissionForm')?.addEventListener('click', () => {
      if (state.data?.commission) fillForm(state.data.commission);
      const status = document.getElementById('commissionFormStatus');
      if (status) status.textContent = '';
    });

    document.getElementById('btnAddCommissionMember')?.addEventListener('click', () => {
      const membersContainer = document.getElementById('commissionFormMembers');
      if (membersContainer) membersContainer.appendChild(buildMemberRow({}));
    });

    if (window.F2A) {
      const originalSwitchTab = F2A.switchTab;
      if (typeof originalSwitchTab === 'function') {
        F2A.switchTab = function patchedSwitchTab(name) {
          originalSwitchTab.call(this, name);
          if (name === 'commission') loadCommission(true);
        };
      }
    }

    document.querySelectorAll('.tab[data-tab="commission"]').forEach(btn => {
      btn.addEventListener('click', () => loadCommission(true));
    });
  }

  document.addEventListener('DOMContentLoaded', initCommissionPanel);
  if (document.readyState !== 'loading') initCommissionPanel();

  window.F2ACommission = {
    load: loadCommission,
    save: saveCommission,
  };
})();
