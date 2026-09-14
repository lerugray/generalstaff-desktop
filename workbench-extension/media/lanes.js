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
    detail: null,
    selectedKey: typeof saved.selectedKey === 'string' ? saved.selectedKey : null,
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
    const meta = ok ? latency : (host.code || host.message || 'unreachable');
    return `<span class="lanes-host-chip ${ok ? 'is-ok' : 'is-down'}" title="${escapeHtml(meta)}">
      <span class="lanes-host-name">${escapeHtml(host.host)}</span>
      <span class="lanes-host-meta">${escapeHtml(meta || (ok ? 'ok' : 'down'))}</span>
    </span>`;
  }

  function renderContextMeter(context) {
    if (!context) return '';
    const warn = context.warn ? ' is-warn' : '';
    const percent = typeof context.percent === 'number' ? context.percent : null;
    const fill = percent == null
      ? ''
      : `<span class="lanes-context-fill" style="width:${Math.max(2, Math.min(100, percent))}%"></span>`;
    const mark = context.warn
      ? `<span class="lanes-context-warn lanes-amber" title="Claude Code will compact at 200k unless the launcher states the window." aria-label="context warning">⚠</span>`
      : '';
    return `<div class="lanes-context-meter${warn}" title="${escapeHtml(context.label || '')}">
      <div class="lanes-context-rule">${fill}</div>
      <span class="lanes-context-copy">${escapeHtml(context.meterLabel || context.label || '')}${mark}</span>
    </div>`;
  }

  function renderRow(row) {
    const selected = state.selectedKey === row.key ? ' is-selected' : '';
    const dirty = row.dirty ? ' · dirty' : '';
    const log = row.lastLogLine
      ? `<div class="lanes-log">${escapeHtml(row.lastLogLine)}</div>`
      : '';
    const selectable = row.kind === 'lane';
    /* Amber attention mark only on failed/inconsistent iron-red counters */
    const attentionMark = row.counterColor === 'iron-red' && row.attention
      ? '<span class="lane-attention-mark lanes-amber" aria-hidden="true" title="needs attention"></span>'
      : '';
    const attentionClass = row.attention ? ' is-attention' : '';
    const contextWarn = row.contextWarn
      ? `<span class="lanes-context-warn lanes-amber" title="Claude Code will compact at 200k unless the launcher states the window." aria-label="context warning">⚠</span>`
      : '';
    const context = row.contextLabel
      ? `<div class="lanes-context-line">${escapeHtml(row.contextLabel)}${contextWarn}</div>`
      : '';
    return `<article class="lane-counter ${counterClass(row.counterColor)}${attentionClass}${selected}" data-kind="${escapeHtml(row.kind)}" data-state="${escapeHtml(row.state)}" data-key="${escapeHtml(row.key)}" data-id="${escapeHtml(row.id)}" data-host="${escapeHtml(row.host)}"${selectable ? ' role="button" tabindex="0"' : ''}>
      ${attentionMark}
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
        ${context}
        <div class="lane-marginalia">
          <span>${escapeHtml(row.elapsed)}</span>
          <span>${escapeHtml(row.sha)}${dirty}</span>
        </div>
        ${log}
      </div>
    </article>`;
  }

  function renderMonoBlock(lines, emptyLabel) {
    if (!lines || !lines.length) {
      return `<div class="lanes-detail-empty">${escapeHtml(emptyLabel)}</div>`;
    }
    return `<pre class="lanes-mono-tail" role="log">${lines.map((line) => escapeHtml(line)).join('\n')}</pre>`;
  }

  function renderDetail(detail) {
    if (!detail) {
      return `<aside class="lanes-detail is-empty" aria-label="Lane detail">
        <div class="lanes-detail-empty">Select a counter to turn its card.</div>
      </aside>`;
    }

    const markers = [
      detail.gone ? '<span class="lanes-gone lanes-amber">gone</span>' : '',
      detail.stale ? '<span class="lanes-stale">stale</span>' : '',
      detail.loading ? '<span class="lanes-loading">reading…</span>' : '',
    ].filter(Boolean).join('');

    const fields = (detail.fields || []).map((field) => `
      <div class="lanes-detail-field">
        <span class="lanes-detail-label">${escapeHtml(field.label)}</span>
        <span class="${field.marginalia ? 'lane-marginalia' : 'lanes-detail-value'}">${escapeHtml(field.value)}</span>
      </div>`).join('');

    const sentinels = (detail.sentinels || []).length
      ? `<div class="lanes-detail-sentinels">${detail.sentinels.map((entry) => `
          <div class="lanes-sentinel-row">
            <span class="lanes-sentinel-name">${escapeHtml(entry.name)}${entry.present ? '' : ' · absent'}</span>
            ${entry.lastLine ? `<span class="lane-marginalia">${escapeHtml(entry.lastLine)}</span>` : ''}
          </div>`).join('')}</div>`
      : '';

    const harvest = detail.harvest || {};
    const files = (harvest.filesChanged || []).length
      ? `<ul class="lanes-files">${harvest.filesChanged.map((file) => `<li class="lane-marginalia">${escapeHtml(file)}</li>`).join('')}</ul>`
      : '<div class="lanes-detail-empty">No changed files reported.</div>';
    const attention = (harvest.attention || []).length
      ? `<div class="lanes-attention">${harvest.attention.map((item) => `<span class="lanes-attention-item">${escapeHtml(item)}</span>`).join('')}</div>`
      : '';
    const paths = (harvest.paths || []).length
      ? `<div class="lanes-detail-paths">${harvest.paths.map((path) => `
          <div class="lanes-detail-field">
            <span class="lanes-detail-label">${escapeHtml(path.label)}</span>
            <span class="lane-marginalia">${escapeHtml(path.value)}</span>
          </div>`).join('')}</div>`
      : '';

    const error = detail.errorDetail
      ? `<div class="lanes-error">${escapeHtml(detail.errorDetail)}</div>`
      : '';

    const detailAttentionMark = detail.counterColor === 'iron-red'
      ? '<span class="lane-attention-mark lanes-amber" aria-hidden="true"></span>'
      : '';

    return `<aside class="lanes-detail ${counterClass(detail.counterColor)}" aria-label="Lane detail for ${escapeHtml(detail.laneId)}">
      ${detailAttentionMark}
      <header class="lanes-detail-header">
        <div class="lanes-detail-title">
          <strong class="lane-unit">${escapeHtml(detail.laneId)}</strong>
          <span class="lane-board">${escapeHtml(detail.host)}</span>
          <span class="lane-state">${escapeHtml(detail.state)}</span>
          ${markers}
        </div>
        <button type="button" class="lanes-harvest-action" disabled title="${escapeHtml(detail.harvestActionTooltip || 'M3+')}">${escapeHtml(detail.harvestActionLabel || 'Harvest…')}</button>
      </header>
      ${error}
      <div class="lanes-detail-fields">${fields}</div>
      ${renderContextMeter(detail.context)}
      ${sentinels}
      <section class="lanes-detail-section">
        <h3>run.status</h3>
        ${renderMonoBlock(detail.statusTail, 'No status tail.')}
      </section>
      <section class="lanes-detail-section">
        <h3>log tail</h3>
        ${renderMonoBlock(detail.logLines, 'No log lines from lane_detail.')}
      </section>
      <section class="lanes-detail-section lanes-harvest-preview">
        <h3>harvest preview</h3>
        <div class="lanes-detail-fields">
          <div class="lanes-detail-field"><span class="lanes-detail-label">process</span><span class="lanes-detail-value">${escapeHtml(harvest.process || '—')}</span></div>
          <div class="lanes-detail-field"><span class="lanes-detail-label">git</span><span class="lanes-detail-value">${escapeHtml(harvest.gitSummary || '—')}</span></div>
          <div class="lanes-detail-field"><span class="lanes-detail-label">dirty</span><span class="lanes-detail-value">${escapeHtml(harvest.dirtyCount || '—')}</span></div>
          <div class="lanes-detail-field"><span class="lanes-detail-label">since WANT</span><span class="lanes-detail-value">${escapeHtml(harvest.commitsSinceWant || '—')} commits</span></div>
          <div class="lanes-detail-field"><span class="lanes-detail-label">battery</span><span class="lanes-detail-value">${escapeHtml(harvest.battery || '—')}</span></div>
          <div class="lanes-detail-field"><span class="lanes-detail-label">tests</span><span class="lanes-detail-value">${escapeHtml(harvest.tests || '—')}</span></div>
          <div class="lanes-detail-field"><span class="lanes-detail-label">model</span><span class="lanes-detail-value">${escapeHtml(harvest.modelDoor || '—')}</span></div>
        </div>
        ${attention}
        ${paths}
        <div class="lanes-files-wrap">
          <span class="lanes-detail-label">files changed</span>
          ${files}
        </div>
      </section>
    </aside>`;
  }

  function render() {
    if (!app) return;
    const model = state.model;
    if (!model) {
      app.innerHTML = `<div class="boot"><div class="boot-mark">GS</div><div><strong>Opening Lanes</strong><span>Reading detached runs…</span></div></div>`;
      return;
    }

    const themeName = themes.find((theme) => theme.id === state.selectedTheme)?.name || 'Kriegspiel Paper';
    const banner = model.capabilityMissing
      ? `<div class="lanes-banner">${escapeHtml(model.capabilityMissing)}</div>`
      : model.errorDetail && !model.partial
        ? `<div class="lanes-banner">${escapeHtml(model.errorDetail)}</div>`
        : '';
    const stale = model.stale ? `<span class="lanes-stale">stale</span>` : '';
    const omitted = typeof model.omitted === 'number'
      ? `<span class="lanes-omitted">omitted: ${model.omitted}</span>`
      : '';
    const badge = model.badgeCount
      ? `<span class="lanes-badge-count lanes-amber">attention ${model.badgeCount}</span>`
      : '';
    const rows = (model.rows || []).length
      ? model.rows.map(renderRow).join('')
      : `<div class="lanes-empty">No detached runs on the map.</div>`;

    app.innerHTML = `<div class="lanes-shell ${state.detail || state.selectedKey ? 'has-detail' : ''}">
      <header class="lanes-header">
        <div class="lanes-title">
          <strong>Lanes</strong>
          <span>detached runs</span>
          ${badge}
          ${stale}
          ${omitted}
        </div>
        <div class="lanes-actions">
          <button type="button" class="lanes-refresh" data-action="refresh">Refresh</button>
        </div>
      </header>
      <div class="lanes-hosts">${(model.hostSummaries || []).map(hostChip).join('')}</div>
      ${banner}
      <div class="lanes-body">
        <div class="lanes-map" role="list">${rows}</div>
        ${renderDetail(state.detail)}
      </div>
      <div class="theme-picker lanes-theme">
        <div class="theme-picker-heading"><span>Palette</span><strong>${escapeHtml(themeName)}</strong></div>
        <div class="theme-swatches" role="group" aria-label="Workbench palette">
          ${themes.map((theme) => `<button class="theme-swatch" data-theme-id="${theme.id}" title="${escapeHtml(theme.name)}" aria-label="${escapeHtml(theme.name)}" aria-pressed="${theme.id === state.selectedTheme}"></button>`).join('')}
        </div>
      </div>
      ${state.notice ? `<div class="lanes-notice">${escapeHtml(state.notice)}</div>` : ''}
    </div>`;
  }

  function selectLane(article) {
    const kind = article.getAttribute('data-kind') || '';
    const key = article.getAttribute('data-key') || '';
    const id = article.getAttribute('data-id') || '';
    const host = article.getAttribute('data-host') || '';
    const laneState = article.getAttribute('data-state') || 'unknown';
    if (kind !== 'lane' || !key) return;
    state.selectedKey = key;
    remember();
    render();
    vscode.postMessage({ type: 'select-lane', key, id, host, kind, state: laneState });
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
    if (message.type === 'lanes-detail') {
      state.detail = message.detail || null;
      if (state.detail?.key) state.selectedKey = state.detail.key;
      remember();
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
      return;
    }
    const article = target.closest('.lane-counter[data-kind="lane"]');
    if (article) selectLane(article);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const article = target.closest('.lane-counter[data-kind="lane"]');
    if (!article || article !== target) return;
    event.preventDefault();
    selectLane(article);
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
