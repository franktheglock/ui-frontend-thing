(function () {
  'use strict';

  const DEFAULTS = {
    chatUrl: 'https://192.168.1.129:5184',
    searchEngine: 'https://duckduckgo.com/?q=%s',
    shortcuts: [
      { label: 'Gmail',    url: 'https://mail.google.com',   color: '#ea4335' },
      { label: 'GitHub',   url: 'https://github.com',        color: '#2dba4e' },
      { label: 'Reddit',   url: 'https://reddit.com',        color: '#ff4500' },
      { label: 'YouTube',  url: 'https://youtube.com',       color: '#ff0033' },
      { label: 'X',        url: 'https://x.com',             color: '#1da1f2' },
      { label: 'Calendar', url: 'https://calendar.google.com', color: '#4285f4' },
    ],
  };

  /* ── DOM refs ── */
  const $ = (id) => document.getElementById(id);
  const chatUrlInput = $('chat-url');
  const searchEnginePresets = $('search-engine-presets');
  const searchEngineCustom = $('search-engine-custom');
  const shortcutsEditor = $('shortcuts-editor');
  const addBtn = $('add-shortcut');
  const saveBtn = $('save-btn');
  const resetBtn = $('reset-btn');
  const statusEl = $('save-status');

  let currentShortcuts = [];

  /* ── Load settings ── */
  async function loadSettings() {
    const result = await chrome.storage.sync.get([
      'chatUrl', 'searchEngine', 'shortcuts',
    ]);

    chatUrlInput.value = result.chatUrl || DEFAULTS.chatUrl;

    const savedEngine = result.searchEngine || DEFAULTS.searchEngine;
    let matched = false;
    for (const opt of searchEnginePresets.options) {
      if (opt.value === savedEngine) {
        opt.selected = true;
        matched = true;
        searchEngineCustom.style.display = 'none';
        break;
      }
    }
    if (!matched) {
      searchEnginePresets.value = '__custom__';
      searchEngineCustom.value = savedEngine;
      searchEngineCustom.style.display = 'block';
    }

    currentShortcuts = result.shortcuts || DEFAULTS.shortcuts;
    renderShortcuts();
  }

  /* ── Render shortcut rows ── */
  function renderShortcuts() {
    shortcutsEditor.innerHTML = '';
    currentShortcuts.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'shortcut-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.placeholder = 'Label';
      labelInput.value = s.label;
      labelInput.addEventListener('input', () => { currentShortcuts[i].label = labelInput.value; });

      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.placeholder = 'https://example.com';
      urlInput.value = s.url;
      urlInput.addEventListener('input', () => { currentShortcuts[i].url = urlInput.value; });

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = s.color || '#555';
      colorInput.addEventListener('input', () => { currentShortcuts[i].color = colorInput.value; });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove shortcut';
      removeBtn.addEventListener('click', () => {
        currentShortcuts.splice(i, 1);
        renderShortcuts();
      });

      row.appendChild(labelInput);
      row.appendChild(urlInput);
      row.appendChild(colorInput);
      row.appendChild(removeBtn);
      shortcutsEditor.appendChild(row);
    });
  }

  /* ── Add blank shortcut ── */
  function addShortcut() {
    currentShortcuts.push({ label: '', url: '', color: '#555' });
    renderShortcuts();
    // Focus the last row's label input
    const rows = shortcutsEditor.querySelectorAll('.shortcut-row');
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const input = lastRow.querySelector('input');
      if (input) input.focus();
    }
  }

  /* ── Save ── */
  async function saveSettings() {
    const chatUrl = chatUrlInput.value.trim() || DEFAULTS.chatUrl;

    let searchEngine;
    if (searchEnginePresets.value === '__custom__') {
      searchEngine = searchEngineCustom.value.trim() || DEFAULTS.searchEngine;
    } else {
      searchEngine = searchEnginePresets.value;
    }

    // Filter out empty shortcuts
    const shortcuts = currentShortcuts.filter((s) => s.label.trim() && s.url.trim());

    await chrome.storage.sync.set({
      chatUrl,
      searchEngine,
      shortcuts,
    });

    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2000);
  }

  /* ── Reset ── */
  async function resetDefaults() {
    await chrome.storage.sync.clear();
    currentShortcuts = [...DEFAULTS.shortcuts];
    chatUrlInput.value = DEFAULTS.chatUrl;
    searchEnginePresets.value = DEFAULTS.searchEngine;
    searchEngineCustom.value = '';
    searchEngineCustom.style.display = 'none';
    renderShortcuts();

    statusEl.textContent = '✓ Reset to defaults';
    statusEl.classList.add('show');
    setTimeout(() => {
      statusEl.classList.remove('show');
      statusEl.textContent = '✓ Settings saved';
    }, 2000);
  }

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();

    addBtn.addEventListener('click', addShortcut);
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetDefaults);

    searchEnginePresets.addEventListener('change', () => {
      if (searchEnginePresets.value === '__custom__') {
        searchEngineCustom.style.display = 'block';
        searchEngineCustom.focus();
      } else {
        searchEngineCustom.style.display = 'none';
      }
    });
  });
})();
