(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const app = document.getElementById('app');
  const themes = [
    { id: 'paper', name: 'Kriegspiel Paper' },
    { id: 'night', name: 'Kriegspiel Night' },
    { id: 'linen', name: 'Linen Folio' },
    { id: 'vellum', name: 'Map Vellum' },
    { id: 'iron', name: 'Iron Press' },
    { id: 'carbon', name: 'Carbon Folio' },
  ];
  const themeIds = new Set(themes.map((theme) => theme.id));
  const initialTheme = themeIds.has(saved.selectedTheme) ? saved.selectedTheme : 'paper';
  document.body.dataset.theme = initialTheme;

  const state = {
    model: null,
    selectedKey: typeof saved.selectedKey === 'string' ? saved.selectedKey : null,
    selectedTheme: initialTheme,
    rulingOpen: false,
    rulingBusy: false,
    rulingError: null,
    rulingRow: null,
    form: {
      verdict: '',
      tags: '',
      session: '',
    },
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function remember() {
    vscode.setState({
      selectedTheme: state.selectedTheme,
      selectedKey: state.selectedKey,
    });
  }

  function applyTheme(id) {
    if (!themeIds.has(id)) return;
    state.selectedTheme = id;
    document.body.dataset.theme = id;
    remember();
    render();
  }

  function selectedLeaf() {
    if (!state.model || !state.selectedKey) return null;
    return (state.model.leaves || []).find((leaf) => leaf.key === state.selectedKey) || null;
  }

  function renderPlate(leaf) {
    if (!leaf) {
      return `<aside class="desk-plate is-empty"><div class="desk-empty-line">Select a leaf to read its card.</div></aside>`;
    }
    if (leaf.cardMissing || !leaf.cardHtml) {
      return `<aside class="desk-plate is-empty" aria-label="Packet plate">
        <div class="desk-plate-head">
          <strong class="desk-leaf-title">${escapeHtml(leaf.folderName)}</strong>
          <span class="desk-leaf-meta">${escapeHtml(leaf.game)} · ${escapeHtml(leaf.gate)} · ${escapeHtml(leaf.date)}</span>
        </div>
        <div class="desk-card-missing">card not staged as HTML</div>
      </aside>`;
    }
    return `<aside class="desk-plate" aria-label="WHAT-TO-JUDGE plate">
      <div class="desk-plate-head">
        <strong class="desk-leaf-title">${escapeHtml(leaf.folderName)}</strong>
        <span class="desk-leaf-meta">${escapeHtml(leaf.game)} · ${escapeHtml(leaf.gate)} · ${escapeHtml(leaf.date)}</span>
      </div>
      <iframe class="desk-card-frame" sandbox="" referrerpolicy="no-referrer" title="WHAT-TO-JUDGE" data-plate="1"></iframe>
    </aside>`;
  }

  function renderLeaf(leaf) {
    const selected = state.selectedKey === leaf.key ? ' is-selected' : '';
    const stamps = [
      leaf.readyGatePassed ? '<span class="desk-stamp is-set">ready</span>' : '<span class="desk-stamp">ready · absent</span>',
      leaf.replayGatePassed ? '<span class="desk-stamp is-set">replay</span>' : '<span class="desk-stamp">replay · absent</span>',
    ].join('');
    return `<article class="desk-leaf${selected}" data-key="${escapeHtml(leaf.key)}" role="button" tabindex="0">
      <span class="desk-waiting lanes-amber" aria-hidden="true" title="waiting"></span>
      <div class="desk-leaf-body">
        <div class="desk-leaf-head">
          <strong class="desk-leaf-title">${escapeHtml(leaf.folderName)}</strong>
          <span class="desk-waiting-label lanes-amber">waiting</span>
        </div>
        <div class="desk-leaf-meta">
          <span>${escapeHtml(leaf.game)}</span>
          <span>${escapeHtml(leaf.gate)}</span>
          <span>${escapeHtml(leaf.date)}</span>
        </div>
        <div class="desk-stamps">${stamps}</div>
      </div>
    </article>`;
  }

  function renderFiles(leaf) {
    if (!leaf) return '';
    const rows = (leaf.files || []).map((file) => `
      <div class="desk-file-row">
        <span class="desk-file-name">${escapeHtml(file.name)}</span>
        <span class="desk-file-meta">${escapeHtml(file.type)} · ${escapeHtml(file.sizeLabel)}</span>
      </div>`).join('');
    return `<section class="desk-files">
      <h3>Files</h3>
      ${rows || '<div class="desk-empty-line">No files listed.</div>'}
    </section>`;
  }

  function renderRulingForm(leaf) {
    if (!leaf || !state.rulingOpen) return '';
    const sessionDefault = state.form.session || state.model?.defaultSession || '';
    return `<form class="desk-ruling" data-ruling-form="1">
      <h3>Record ruling</h3>
      <label class="desk-field">
        <span>Verdict</span>
        <input type="text" name="verdict" maxlength="500" autocomplete="off" spellcheck="true" value="${escapeHtml(state.form.verdict)}" placeholder="Ray's words, one line" required />
      </label>
      <label class="desk-field">
        <span>Tags <em>optional</em></span>
        <input type="text" name="tags" maxlength="200" autocomplete="off" spellcheck="false" value="${escapeHtml(state.form.tags)}" placeholder="extra tags, comma-separated" />
      </label>
      <label class="desk-field">
        <span>Session</span>
        <input type="text" name="session" maxlength="32" autocomplete="off" spellcheck="false" value="${escapeHtml(sessionDefault)}" placeholder="sNNN" required />
      </label>
      ${state.rulingError ? `<div class="desk-error">${escapeHtml(state.rulingError)}</div>` : ''}
      ${state.rulingRow ? `<pre class="desk-ruling-row">${escapeHtml(state.rulingRow)}</pre>` : ''}
      <div class="desk-ruling-actions">
        <button type="submit" class="desk-action primary" ${state.rulingBusy ? 'disabled' : ''}>${state.rulingBusy ? 'Recording…' : 'Confirm ruling'}</button>
        <button type="button" class="desk-action" data-action="cancel-ruling" ${state.rulingBusy ? 'disabled' : ''}>Cancel</button>
      </div>
    </form>`;
  }

  function renderDetail(leaf) {
    if (!leaf) {
      return `<div class="desk-detail is-empty"><div class="desk-empty-line">One packet, one leaf.</div></div>`;
    }
    return `<div class="desk-detail">
      ${renderPlate(leaf)}
      <div class="desk-detail-rail">
        ${renderFiles(leaf)}
        <div class="desk-actions">
          <button type="button" class="desk-action" data-action="open-folder" data-key="${escapeHtml(leaf.key)}">Open folder in Finder</button>
          <button type="button" class="desk-action" data-action="open-annotate" data-key="${escapeHtml(leaf.key)}" ${leaf.hasAnnotate ? '' : 'disabled'}>Open ANNOTATE</button>
          <button type="button" class="desk-action primary" data-action="record-ruling" data-key="${escapeHtml(leaf.key)}">Record ruling…</button>
        </div>
        ${renderRulingForm(leaf)}
      </div>
    </div>`;
  }

  function render() {
    if (!app) return;
    const model = state.model;
    if (!model) {
      app.innerHTML = `<div class="boot"><div class="boot-mark">GS</div><div><strong>Opening Desk</strong><span>Reading handoff packets…</span></div></div>`;
      return;
    }

    const themeName = themes.find((theme) => theme.id === state.selectedTheme)?.name || 'Kriegspiel Paper';
    const badge = model.badgeCount
      ? `<span class="desk-badge-count lanes-amber">waiting ${model.badgeCount}</span>`
      : '';
    const leaf = selectedLeaf();
    const folio = model.empty
      ? `<div class="desk-empty">${escapeHtml(model.emptyMessage)}</div>`
      : `<div class="desk-folio">
          <div class="desk-leaves" role="list">${(model.leaves || []).map(renderLeaf).join('')}</div>
          ${renderDetail(leaf)}
        </div>`;

    app.innerHTML = `<div class="desk-shell">
      <header class="desk-header">
        <div class="desk-title">
          <strong>Desk</strong>
          <span>handoff packets</span>
          ${badge}
        </div>
        <button type="button" class="desk-action" data-action="refresh">Refresh</button>
      </header>
      ${model.errorDetail ? `<div class="desk-error">${escapeHtml(model.errorDetail)}</div>` : ''}
      ${model.notice ? `<div class="desk-notice">${escapeHtml(model.notice)}</div>` : ''}
      ${folio}
      <div class="theme-picker desk-theme">
        <div class="theme-picker-heading"><span>Palette</span><strong>${escapeHtml(themeName)}</strong></div>
        <div class="theme-swatches" role="group" aria-label="Workbench palette">
          ${themes.map((theme) => `<button class="theme-swatch" data-theme-id="${theme.id}" title="${escapeHtml(theme.name)}" aria-label="${escapeHtml(theme.name)}" aria-pressed="${theme.id === state.selectedTheme}"></button>`).join('')}
        </div>
      </div>
    </div>`;

    const frame = app.querySelector('iframe.desk-card-frame[data-plate]');
    const plateLeaf = selectedLeaf();
    if (frame instanceof HTMLIFrameElement && plateLeaf?.cardHtml) {
      frame.srcdoc = plateLeaf.cardHtml;
    }
  }

  function selectLeaf(key) {
    state.selectedKey = key;
    state.rulingOpen = false;
    state.rulingError = null;
    state.rulingRow = null;
    state.form = { verdict: '', tags: '', session: state.model?.defaultSession || '' };
    remember();
    render();
    vscode.postMessage({ type: 'select-leaf', key });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'desk-model') {
      state.model = message.model;
      if (typeof message.selectedKey === 'string') state.selectedKey = message.selectedKey;
      else if (message.selectedKey === null && state.selectedKey) {
        const still = (message.model?.leaves || []).some((leaf) => leaf.key === state.selectedKey);
        if (!still) state.selectedKey = null;
      }
      if (!state.form.session && message.model?.defaultSession) {
        state.form.session = message.model.defaultSession;
      }
      state.rulingBusy = false;
      render();
      return;
    }
    if (message.type === 'ruling-result') {
      state.rulingBusy = false;
      if (message.ok) {
        state.rulingOpen = false;
        state.rulingError = null;
        state.rulingRow = message.stdout || null;
        state.form = { verdict: '', tags: '', session: state.model?.defaultSession || '' };
      } else {
        state.rulingError = message.errorDetail || 'Ruling failed.';
        if (message.stdout) state.rulingRow = message.stdout;
      }
      render();
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const themeId = target.closest('[data-theme-id]')?.getAttribute('data-theme-id');
    if (themeId) {
      applyTheme(themeId);
      return;
    }
    const actionEl = target.closest('[data-action]');
    const action = actionEl?.getAttribute('data-action');
    if (action === 'refresh') {
      vscode.postMessage({ type: 'refresh' });
      return;
    }
    if (action === 'open-folder') {
      vscode.postMessage({ type: 'open-folder', key: actionEl.getAttribute('data-key') });
      return;
    }
    if (action === 'open-annotate') {
      vscode.postMessage({ type: 'open-annotate', key: actionEl.getAttribute('data-key') });
      return;
    }
    if (action === 'record-ruling') {
      state.rulingOpen = true;
      state.rulingError = null;
      state.rulingRow = null;
      if (!state.form.session && state.model?.defaultSession) {
        state.form.session = state.model.defaultSession;
      }
      render();
      return;
    }
    if (action === 'cancel-ruling') {
      state.rulingOpen = false;
      state.rulingError = null;
      render();
      return;
    }
    const leaf = target.closest('.desk-leaf');
    if (leaf) {
      selectLeaf(leaf.getAttribute('data-key') || '');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const leaf = target.closest('.desk-leaf');
    if (!leaf || leaf !== target) return;
    event.preventDefault();
    selectLeaf(leaf.getAttribute('data-key') || '');
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-ruling-form')) return;
    event.preventDefault();
    const leaf = selectedLeaf();
    if (!leaf || state.rulingBusy) return;
    const data = new FormData(form);
    const verdict = String(data.get('verdict') || '').trim();
    const tags = String(data.get('tags') || '').trim();
    const session = String(data.get('session') || '').trim();
    state.form = { verdict, tags, session };
    if (!verdict) {
      state.rulingError = 'Verdict is required.';
      render();
      return;
    }
    state.rulingBusy = true;
    state.rulingError = null;
    render();
    vscode.postMessage({
      type: 'record-ruling',
      key: leaf.key,
      verdict,
      tags,
      session,
    });
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
