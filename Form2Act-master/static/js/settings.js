(() => {
  const STORAGE_KEY = 'f2a:settings:v1';
  const DEFAULT_THEME = 'default';

  const THEMES = [
    { id: 'default', name: 'Form2Act (по умолчанию)', type: 'Тёмная',
      bg: '#070b14', surface: '#1a2236', accent: '#6ea8ff', accent2: '#a78bfa' },
    { id: 'dark-plus', name: 'Dark+ (VS Code)', type: 'Тёмная',
      bg: '#1e1e1e', surface: '#252526', accent: '#569cd6', accent2: '#c586c0' },
    { id: 'light-plus', name: 'Light+ (VS Code)', type: 'Светлая',
      bg: '#fafafa', surface: '#ececec', accent: '#0066b8', accent2: '#af00db' },
    { id: 'monokai', name: 'Monokai', type: 'Тёмная',
      bg: '#272822', surface: '#3e3d32', accent: '#66d9ef', accent2: '#f92672' },
    { id: 'dracula', name: 'Dracula', type: 'Тёмная',
      bg: '#282a36', surface: '#44475a', accent: '#8be9fd', accent2: '#ff79c6' },
    { id: 'one-dark', name: 'One Dark', type: 'Тёмная',
      bg: '#21252b', surface: '#2c313a', accent: '#61afef', accent2: '#c678dd' },
    { id: 'tokyo-night', name: 'Tokyo Night', type: 'Тёмная',
      bg: '#1a1b26', surface: '#24283b', accent: '#7aa2f7', accent2: '#bb9af7' },
    { id: 'github-dark', name: 'GitHub Dark', type: 'Тёмная',
      bg: '#0d1117', surface: '#161b22', accent: '#58a6ff', accent2: '#bc8cff' },
    { id: 'github-light', name: 'GitHub Light', type: 'Светлая',
      bg: '#ffffff', surface: '#f6f8fa', accent: '#0969da', accent2: '#8250df' },
    { id: 'nord', name: 'Nord', type: 'Тёмная',
      bg: '#2e3440', surface: '#3b4252', accent: '#88c0d0', accent2: '#b48ead' },
    { id: 'solarized-dark', name: 'Solarized Dark', type: 'Тёмная',
      bg: '#002b36', surface: '#073642', accent: '#268bd2', accent2: '#d33682' },
    { id: 'solarized-light', name: 'Solarized Light', type: 'Светлая',
      bg: '#fdf6e3', surface: '#eee8d5', accent: '#268bd2', accent2: '#6c71c4' },
    { id: 'gruvbox-dark', name: 'Gruvbox Dark', type: 'Тёмная',
      bg: '#282828', surface: '#3c3836', accent: '#83a598', accent2: '#d3869b' },
  ];

  const defaults = {
    theme: DEFAULT_THEME,
    compact: false,
    reduceMotion: false,
    autoReload: true,
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch {
      return { ...defaults };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota errors */
    }
  }

  function applyTheme(themeId) {
    const root = document.documentElement;
    if (!themeId || themeId === DEFAULT_THEME) {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', themeId);
    }
  }

  function applyDensity(compact) {
    document.documentElement.setAttribute('data-density', compact ? 'compact' : 'comfortable');
  }

  function applyReduceMotion(reduce) {
    if (reduce) {
      document.documentElement.setAttribute('data-reduce-motion', 'true');
    } else {
      document.documentElement.removeAttribute('data-reduce-motion');
    }
  }

  function findTheme(id) {
    return THEMES.find(t => t.id === id) || THEMES[0];
  }

  function renderThemePalette(currentId) {
    const root = document.getElementById('themePalette');
    if (!root) return;
    root.innerHTML = THEMES.map(t => `
      <button type="button" class="theme-card${t.id === currentId ? ' is-active' : ''}"
              role="radio" aria-checked="${t.id === currentId}" data-theme-id="${t.id}"
              title="${t.name}">
        <span class="theme-card__swatch" aria-hidden="true">
          <span style="background:${t.bg}"></span>
          <span style="background:${t.surface}"></span>
          <span style="background:${t.accent}"></span>
          <span style="background:${t.accent2}"></span>
        </span>
        <span class="theme-card__name">${t.name}</span>
        <span class="theme-card__type">${t.type}</span>
        <span class="theme-card__check" aria-hidden="true">✓</span>
      </button>
    `).join('');
  }

  function updateCurrentLabel(themeId) {
    const label = document.getElementById('themeCurrent');
    if (!label) return;
    const t = findTheme(themeId);
    label.textContent = `Активная: ${t.name}`;
  }

  function initSettingsPanel() {
    const state = loadSettings();

    // Apply now (may be a no-op since we also pre-apply early below).
    applyTheme(state.theme);
    applyDensity(state.compact);
    applyReduceMotion(state.reduceMotion);

    renderThemePalette(state.theme);
    updateCurrentLabel(state.theme);

    const palette = document.getElementById('themePalette');
    if (palette) {
      palette.addEventListener('click', e => {
        const card = e.target.closest('.theme-card');
        if (!card) return;
        const id = card.getAttribute('data-theme-id') || DEFAULT_THEME;
        state.theme = id;
        saveSettings(state);
        applyTheme(id);
        palette.querySelectorAll('.theme-card').forEach(c => {
          const on = c === card;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        updateCurrentLabel(id);
      });
    }

    const compact = document.getElementById('settingCompactDensity');
    if (compact) {
      compact.checked = !!state.compact;
      compact.addEventListener('change', () => {
        state.compact = compact.checked;
        saveSettings(state);
        applyDensity(state.compact);
      });
    }

    const reduce = document.getElementById('settingReduceMotion');
    if (reduce) {
      reduce.checked = !!state.reduceMotion;
      reduce.addEventListener('change', () => {
        state.reduceMotion = reduce.checked;
        saveSettings(state);
        applyReduceMotion(state.reduceMotion);
      });
    }

    const auto = document.getElementById('settingAutoReload');
    if (auto) {
      auto.checked = state.autoReload !== false;
      auto.addEventListener('change', () => {
        state.autoReload = auto.checked;
        saveSettings(state);
        window.F2A = window.F2A || {};
        window.F2A.autoReloadEnabled = state.autoReload;
      });
      window.F2A = window.F2A || {};
      window.F2A.autoReloadEnabled = state.autoReload !== false;
    }

    document.getElementById('btnResetTheme')?.addEventListener('click', () => {
      state.theme = DEFAULT_THEME;
      saveSettings(state);
      applyTheme(DEFAULT_THEME);
      renderThemePalette(DEFAULT_THEME);
      updateCurrentLabel(DEFAULT_THEME);
    });

    document.getElementById('btnClearLocalSettings')?.addEventListener('click', () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      Object.assign(state, defaults);
      applyTheme(state.theme);
      applyDensity(state.compact);
      applyReduceMotion(state.reduceMotion);
      renderThemePalette(state.theme);
      updateCurrentLabel(state.theme);
      if (compact) compact.checked = state.compact;
      if (reduce) reduce.checked = state.reduceMotion;
      if (auto) auto.checked = state.autoReload;
    });
  }

  // Pre-apply theme/density before DOM is ready to avoid flash of default colors.
  (function preApply() {
    const settings = loadSettings();
    applyTheme(settings.theme);
    applyDensity(settings.compact);
    applyReduceMotion(settings.reduceMotion);
    window.F2A = window.F2A || {};
    window.F2A.autoReloadEnabled = settings.autoReload !== false;
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsPanel);
  } else {
    initSettingsPanel();
  }
})();
