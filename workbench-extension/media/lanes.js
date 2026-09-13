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
  const initialTheme = themeIds.has(saved.selectedTheme) ? saved.selectedTheme : 'carbon';
  document.body.dataset.theme = initialTheme;

  const state = {
    model: null,
    selectedTheme: initialTheme,
    notice: null,
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
    vscode.setState({ selectedTheme: state.selectedTheme });
  }

  function applyTheme(id) {
    if (!themeIds.has(id)) return;
    state.selectedTheme = id;
    document.body.dataset.theme = id;
    remember();
    render();
  }

  function counterClass(color) {
    switch (color) {
      case 'iron-red':
        return 'counter-iron-red';
      case 'dust':
        return 'counter-dust';
      case 'ink':
        return 'counter-ink';
      case 'amber':
        return 'counter-amber';
      default:
        return 'counter-quiet';
    }
  }

  function hostChip(host) {
    const ok = host.ok;
    const latency = typeof host.latencyMs === 'number' ? `${host.latencyMs}ms` : '';
    const detail = ok ? latency : (host.code || host.message || 'unreachable');
    return `<span class="lanes-host-chip ${ok ? 'is-ok' : 'is-down'}" title="${escapeHtml(detail)}">
      <span class="lanes-host-name">${escapeHtml(host.host)}</span>
      <span class="lanes-host-meta">${escapeHtml(detail || (ok ? 'ok' : 'down'))}</span>
    </span>`;
  }

  function renderRow(row) {
    const attention = row.attention ? ' is-attention' : '';
    const dirty = row.dirty ? ' · dirty' : '';
    const log = row.lastLogLine
      ? `<div class="lanes-log">${escapeHtml(row.lastLogLine)}</div>`
      : '';
    return `<article class="lane-counter ${counterClass(row.counterColor)}${attention}" data-kind="${escapeHtml(row.kind)}" data-state="${escapeHtml(row.state)}">
      <div class="lane-counter-mark" aria-hidden="true"></div>
      <div class="lane-counter-body">
        <div class="lane-counter-head">
          <strong class="lane-unit">${escapeHtml(row.id)}</strong>
          <span class="lane-board">${escapeHtml(row.host)}</span>
          <span class="lane-state">${escapeHtml(row.state)}</span>
        </div>
        <div class="lane-counter-meta">
          <span class="lane-door">${escapeHtml(row.modelDoor)}</span>
          <span class="lane-sentinel">${escapeHtml(row.sentinel)}</span>
        </div>
        <div class="lane-marginalia">
          <span>${escapeHtml(row.elapsed)}</span>
          <span>${escapeHtml(row.sha)}${dirty}</span>
        </div>
        ${log}
      </div>
    </article>`;
  }

  function render() {
    if (!app) return;
    const model = state.model;
    if (!model) {
      app.innerHTML = `<div class="boot"><div class="boot-mark">GS</div><div><strong>Opening Lanes</strong><span>Reading detached runs…</span></div></div>`;
      return;
    }

    const themeName = themes.find((theme) => theme.id === state.selectedTheme)?.name || 'Carbon Folio';
    const countBits = Object.entries(model.counts || {})
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => `${escapeHtml(key)} ${value}`)
      .join(' · ');
    const banner = model.capabilityMissing
      ? `<div class="lanes-banner is-miss">${escapeHtml(model.capabilityMissing)}</div>`
      : model.errorDetail
        ? `<div class="lanes-banner is-warn">${escapeHtml(model.errorDetail)}</div>`
        : model.partial
          ? `<div class="lanes-banner is-partial">Partial envelope — one or more hosts unreachable. Live rows still shown.</div>`
          : '';
    const stale = model.stale ? `<span class="lanes-stale">stale</span>` : '';
    const omitted = typeof model.omitted === 'number'
      ? `<span class="lanes-omitted">omitted: ${model.omitted}</span>`
      : '';
    const rows = (model.rows || []).length
      ? model.rows.map(renderRow).join('')
      : `<div class="lanes-empty">No detached runs on the map.</div>`;

    app.innerHTML = `<div class="lanes-shell">
      <header class="lanes-header">
        <div class="lanes-title">
          <strong>Lanes</strong>
          <span>detached runs</span>
          ${stale}
          ${omitted}
        </div>
        <div class="lanes-actions">
          <button type="button" class="lanes-refresh" data-action="refresh">Refresh</button>
        </div>
      </header>
      <div class="lanes-hosts">${(model.hostSummaries || []).map(hostChip).join('')}</div>
      ${banner}
      <div class="lanes-counts">${countBits || 'counts —'}${model.badgeCount ? ` · <span class="lanes-badge-note">attention ${model.badgeCount}</span>` : ''}</div>
      <div class="lanes-map" role="list">${rows}</div>
      <div class="theme-picker lanes-theme">
        <div class="theme-picker-heading"><span>Palette</span><strong>${escapeHtml(themeName)}</strong></div>
        <div class="theme-swatches" role="group" aria-label="Workbench palette">
          ${themes.map((theme) => `<button class="theme-swatch" data-theme-id="${theme.id}" title="${escapeHtml(theme.name)}" aria-label="${escapeHtml(theme.name)}" aria-pressed="${theme.id === state.selectedTheme}"></button>`).join('')}
        </div>
      </div>
      ${state.notice ? `<div class="lanes-notice">${escapeHtml(state.notice)}</div>` : ''}
    </div>`;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'lanes-model') {
      state.model = message.model;
      state.notice = null;
      render();
      return;
    }
    if (message.type === 'notice') {
      state.notice = message.text || null;
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
    if (target.closest('[data-action="refresh"]')) {
      vscode.postMessage({ type: 'refresh' });
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
