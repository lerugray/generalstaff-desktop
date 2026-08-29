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
    snapshot: null,
    conversations: [],
    orchestratorSessionId: null,
    hydrated: false,
    notes: {},
    activeConversationId: null,
    selectedTargetKind: 'general',
    selectedProjectId: saved.selectedProjectId || null,
    selectedLaneId: saved.selectedLaneId || 'codex',
    selectedSeat: saved.selectedSeat || 'orchestrate',
    selectedEffort: saved.selectedEffort || 'default',
    selectedSkillId: saved.selectedSkillId || '',
    selectedTheme: initialTheme,
    selectedPermission: 'read',
    draft: saved.draft || '',
    pendingPrompt: '',
    pendingSend: null,
    pendingContext: [],
    creatingConversation: false,
    runStatus: {},
    pendingActionConversationId: null,
    notice: null,
  };

  const seatCopy = {
    orchestrate: ['Orchestrate', 'Direct work, preserve decisions, and judge completion.'],
    build: ['Build', 'Implement a bounded outcome and verify it.'],
    review: ['Review', 'Read-only findings, ordered by impact.'],
    verify: ['Verify', 'Re-run checks and test completion claims.'],
    assist: ['Fast assist', 'Answer or investigate without expanding scope.'],
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderText(value) {
    const safe = escapeHtml(value);
    const pieces = safe.split(/(```[\s\S]*?```)/g);
    return pieces
      .map((piece) => {
        if (piece.startsWith('```') && piece.endsWith('```')) {
          const code = piece.slice(3, -3).replace(/^\w+\n/, '');
          return `<pre><code>${code}</code></pre>`;
        }
        return piece
          .split(/\n{2,}/)
          .map((paragraph) => `<p>${paragraph.replaceAll('\n', '<br>')}</p>`)
          .join('');
      })
      .join('');
  }

  function formatWhen(value) {
    if (!value) return 'recently';
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    const delta = Date.now() - date.getTime();
    const minutes = Math.max(1, Math.round(delta / 60_000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 30) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  function remember() {
    vscode.setState({
      activeConversationId: state.activeConversationId,
      selectedTargetKind: state.selectedTargetKind,
      selectedProjectId: state.selectedProjectId,
      selectedLaneId: state.selectedLaneId,
      selectedSeat: state.selectedSeat,
      selectedEffort: state.selectedEffort,
      selectedSkillId: state.selectedSkillId,
      selectedTheme: state.selectedTheme,
      draft: state.draft,
    });
  }

  function currentProject() {
    if (state.selectedTargetKind !== 'project') return undefined;
    return state.snapshot?.projects.find((project) => project.id === state.selectedProjectId);
  }

  function currentTarget() {
    const project = currentProject();
    return project ? { kind: 'project', projectId: project.id } : { kind: 'general' };
  }

  function conversationProject(conversation) {
    return conversation?.target?.kind === 'project'
      ? state.snapshot?.projects.find((project) => project.id === conversation.target.projectId)
      : undefined;
  }

  function currentConversation() {
    return state.conversations.find((conversation) => conversation.id === state.activeConversationId);
  }

  function selectOrchestratorSession(clearDraft = false) {
    state.activeConversationId = state.orchestratorSessionId;
    state.selectedTargetKind = 'general';
    state.selectedProjectId = null;
    state.pendingContext = [];
    const session = currentConversation();
    if (session) {
      state.selectedLaneId = session.laneId;
      state.selectedSeat = session.seat;
      state.selectedEffort = session.effort || 'default';
      state.selectedSkillId = session.skillId || '';
      state.selectedPermission = session.permission || 'read';
    }
    if (clearDraft) state.draft = '';
  }

  function compatibleLanes() {
    return (state.snapshot?.lanes || []).filter(
      (lane) => lane.state === 'available' && lane.roles.includes(state.selectedSeat) &&
        (lane.permissions || ['read', 'write']).includes(state.selectedPermission),
    );
  }

  function ensureSelections() {
    const projects = state.snapshot?.projects || [];
    if (state.selectedTargetKind === 'project' && !projects.some((project) => project.id === state.selectedProjectId)) {
      state.selectedTargetKind = 'general';
    }
    const lanes = compatibleLanes();
    if (!lanes.some((lane) => lane.id === state.selectedLaneId)) {
      state.selectedLaneId = lanes[0]?.id || null;
    }
    const selectedLane = lanes.find((lane) => lane.id === state.selectedLaneId);
    if (!selectedLane?.efforts?.some((effort) => effort.id === state.selectedEffort)) {
      state.selectedEffort = selectedLane?.defaultEffort || 'default';
    }
    if (state.selectedSkillId && !(state.snapshot?.skills || []).some((skill) => skill.id === state.selectedSkillId)) {
      state.selectedSkillId = '';
    }
    if (state.activeConversationId && !state.conversations.some((item) => item.id === state.activeConversationId)) {
      state.activeConversationId = null;
    }
    remember();
  }

  function projectDot(project) {
    if (project.needsReview) return 'review';
    if (project.inProgress) return 'active';
    return 'quiet';
  }

  function applyTheme(id) {
    if (!themeIds.has(id)) return;
    state.selectedTheme = id;
    document.body.dataset.theme = id;
    remember();
    render();
  }

  function renderRail() {
    const projects = state.snapshot?.projects || [];
    const lanes = state.snapshot?.lanes || [];
    const available = lanes.filter((lane) => lane.state === 'available').length;
    const privateTools = (state.snapshot?.capabilities || []).filter((capability) => capability.state === 'available').length;
    return `
      <aside class="rail">
        <div class="brand">
          <div class="brand-mark"><span>G</span><span>S</span></div>
          <div><strong>GeneralStaff</strong><small>Workbench 2.5</small></div>
        </div>
        <button class="general-command-target ${state.activeConversationId === state.orchestratorSessionId ? 'selected' : ''}" data-action="general-command">
          <span class="general-command-mark">GS</span>
          <span><strong>Orchestrator session</strong><small><i class="session-live-dot"></i> Live seat · private root</small></span>
          <span class="pinned-label">Primary</span>
        </button>
        <nav class="rail-nav" aria-label="Workbench">
          <div class="rail-label"><span>Project commands</span><span>${projects.length}</span></div>
          <div class="project-list">
            ${projects
              .map(
                (project) => `
                  <button class="project-item ${state.selectedTargetKind === 'project' && project.id === state.selectedProjectId && !state.activeConversationId ? 'selected' : ''}" data-project-id="${escapeHtml(project.id)}">
                    <span class="project-status ${projectDot(project)}"></span>
                    <span class="project-copy"><strong>${escapeHtml(project.name)}</strong><small>${project.inProgress ? `${project.inProgress} active` : project.pending ? `${project.pending} queued` : 'standing by'}</small></span>
                    ${project.needsReview ? `<span class="project-count">${project.needsReview}</span>` : ''}
                  </button>`,
              )
              .join('')}
          </div>
          <div class="rail-label"><span>Recent project orders</span></div>
          <div class="conversation-list">
            ${state.conversations
              .filter((conversation) => conversation.target?.kind === 'project')
              .slice(0, 7)
              .map(
                (conversation) => `
                  <button class="conversation-link ${conversation.id === state.activeConversationId ? 'selected' : ''}" data-conversation-id="${escapeHtml(conversation.id)}">
                    <span>${escapeHtml(conversation.title)}</span><small>${formatWhen(conversation.updatedAt)}</small>
                  </button>`,
              )
              .join('') || '<p class="empty-rail">Project orders will collect here.</p>'}
          </div>
        </nav>
        <div class="theme-picker">
          <div class="theme-picker-heading"><span>Palette</span><strong>${escapeHtml(themes.find((theme) => theme.id === state.selectedTheme)?.name || 'Carbon Folio')}</strong></div>
          <div class="theme-swatches" role="group" aria-label="Workbench palette">
            ${themes.map((theme) => `<button class="theme-swatch" data-theme-id="${theme.id}" title="${escapeHtml(theme.name)}" aria-label="${escapeHtml(theme.name)}" aria-pressed="${theme.id === state.selectedTheme}"></button>`).join('')}
          </div>
        </div>
        <div class="rail-footer">
          <span class="pulse-dot"></span>
          <div><strong>${available} of ${lanes.length} lanes ready</strong><small>${privateTools} private tools · one desk</small></div>
          <button class="icon-button" data-action="refresh" title="Refresh fleet">↻</button>
        </div>
      </aside>`;
  }

  function renderTopbar(title, eyebrow) {
    const now = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date());
    return `
      <header class="topbar">
        <div><small>${escapeHtml(eyebrow)}</small><h1>${escapeHtml(title)}</h1></div>
        <div class="topbar-actions">
          <span class="date-chip">${escapeHtml(now)}</span>
          <button class="ghost-button" data-action="open-terminal">Terminal</button>
          <button class="avatar" title="Operator">RW</button>
        </div>
      </header>`;
  }

  function renderSeatSelect() {
    const active = currentConversation();
    const disabled = active?.kind === 'orchestrator' || (active && state.runStatus[active.id]);
    return `
      <label class="select-field">
        <span>Seat</span>
        <select id="seat-select" ${disabled ? 'disabled' : ''}>
          ${Object.entries(seatCopy)
            .map(([id, copy]) => `<option value="${id}" ${id === state.selectedSeat ? 'selected' : ''}>${copy[0]}</option>`)
            .join('')}
        </select>
      </label>`;
  }

  function renderLaneSelect() {
    const disabled = currentConversation() && state.runStatus[currentConversation().id];
    return `
      <label class="select-field lane-field">
        <span>Model lane</span>
        <select id="lane-select" ${disabled ? 'disabled' : ''}>
          ${compatibleLanes()
            .map((lane) => `<option value="${lane.id}" ${lane.id === state.selectedLaneId ? 'selected' : ''}>${escapeHtml(lane.name)}</option>`)
            .join('')}
        </select>
      </label>`;
  }

  function renderPermissionSelect() {
    const disabled = currentConversation() && state.runStatus[currentConversation().id];
    return `
      <label class="select-field permission-field ${state.selectedPermission === 'write' ? 'write' : ''}">
        <span>Access</span>
        <select id="permission-select" ${disabled ? 'disabled' : ''}>
          <option value="read" ${state.selectedPermission === 'read' ? 'selected' : ''}>Read only</option>
          <option value="write" ${state.selectedPermission === 'write' ? 'selected' : ''}>Can edit repo</option>
        </select>
      </label>`;
  }

  function renderEffortSelect() {
    const lane = (state.snapshot?.lanes || []).find((item) => item.id === state.selectedLaneId);
    const efforts = lane?.efforts || [{ id: 'default', label: 'Provider default' }];
    const disabled = Boolean(currentConversation() && state.runStatus[currentConversation().id]);
    return `
      <label class="select-field effort-field">
        <span>Effort</span>
        <select id="effort-select" ${disabled || efforts.length < 2 ? 'disabled' : ''}>
          ${efforts.map((effort) => `<option value="${effort.id}" ${effort.id === state.selectedEffort ? 'selected' : ''}>${escapeHtml(effort.label)}</option>`).join('')}
        </select>
      </label>`;
  }

  function renderSkillSelect() {
    const skills = state.snapshot?.skills || [];
    const disabled = Boolean(currentConversation() && state.runStatus[currentConversation().id]);
    return `
      <label class="select-field skill-field">
        <span>Skill</span>
        <select id="skill-select" ${disabled || !skills.length ? 'disabled' : ''} title="Private procedures loaded from this GeneralStaff root">
          <option value="" ${!state.selectedSkillId ? 'selected' : ''}>No skill</option>
          ${skills.map((skill) => `<option value="${escapeHtml(skill.id)}" ${skill.id === state.selectedSkillId ? 'selected' : ''} title="${escapeHtml(skill.description)}">/${escapeHtml(skill.id)}</option>`).join('')}
        </select>
      </label>`;
  }

  function renderComposer(compact = false) {
    const project = currentProject();
    const general = state.selectedTargetKind === 'general';
    const seat = seatCopy[state.selectedSeat];
    const active = currentConversation();
    const orchestrator = active?.kind === 'orchestrator' || (general && state.activeConversationId === state.orchestratorSessionId);
    const running = Boolean(active && state.runStatus[active.id]);
    return `
      <section class="composer ${compact ? 'compact' : ''}">
        <div class="composer-heading">
          <div class="project-monogram">${escapeHtml((project?.name || 'GS').slice(0, 2).toUpperCase())}</div>
          <div><strong>${orchestrator ? 'Orchestrator session' : `Command ${escapeHtml(project?.name || 'project')}`}</strong><small>${orchestrator ? 'One continuous GeneralStaff seat rooted in the private repository.' : escapeHtml(seat?.[1] || '')}</small></div>
        </div>
        ${!compact ? `<div class="context-row">
          <button class="context-button" data-action="pick-context"><span>＋</span> Reference local files</button>
          ${state.pendingContext.map((item) => `<span class="context-chip"><i>${item.kind === 'image' ? '◇' : item.kind === 'data' ? '▦' : '¶'}</i>${escapeHtml(item.label)}</span>`).join('')}
        </div>` : ''}
        ${state.selectedPermission === 'write' ? `<div class="permission-banner"><strong>Edit access enabled</strong><span>The lane may modify only the ${general ? 'private GeneralStaff root' : 'discovered project repository'}. Consent is recorded with the run.</span></div>` : ''}
        <textarea id="prompt" rows="${compact ? 3 : 4}" placeholder="${orchestrator ? 'Message the orchestrator…' : 'Describe the project outcome…'}" ${running ? 'disabled' : ''}>${escapeHtml(state.draft)}</textarea>
        <div class="composer-footer">
          <div class="composer-selects">${renderSeatSelect()}${renderLaneSelect()}${renderEffortSelect()}${renderSkillSelect()}${renderPermissionSelect()}</div>
          <button class="send-button" data-action="send" ${!state.snapshot?.rootPath || !state.selectedLaneId || running || state.creatingConversation || state.pendingSend ? 'disabled' : ''}>
            <span>${orchestrator ? 'Send' : 'Issue order'}</span><span class="send-arrow">↑</span>
          </button>
        </div>
      </section>`;
  }

  function renderAttention() {
    const items = state.snapshot?.attention || [];
    return `
      <section class="panel attention-panel">
        <div class="panel-heading"><div><small>OPERATOR QUEUE</small><h2>Needs Ray</h2></div><span class="count-pill">${items.length}</span></div>
        <div class="item-stack">
          ${items
            .slice(0, 5)
            .map((item) => {
              const project = state.snapshot.projects.find((candidate) => candidate.id === item.projectId);
              return `
                <button class="attention-item" ${item.projectId ? `data-project-id="${escapeHtml(item.projectId)}"` : ''}>
                  <span class="attention-icon ${escapeHtml(item.kind)}">${item.kind === 'review' ? '✓' : item.kind === 'decision' ? '?' : '!'}</span>
                  <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(project?.name || 'GeneralStaff')} · ${escapeHtml(item.detail)}</small></span>
                  <span class="chevron">›</span>
                </button>`;
            })
            .join('') || '<div class="empty-state"><strong>No decisions waiting</strong><span>The fleet can keep moving without you.</span></div>'}
        </div>
      </section>`;
  }

  function renderActivity() {
    const items = state.snapshot?.activity || [];
    return `
      <section class="panel activity-panel">
        <div class="panel-heading"><div><small>FIELD REPORT</small><h2>Recently landed</h2></div></div>
        <div class="timeline">
          ${items
            .slice(0, 5)
            .map(
              (item) => `
                <div class="timeline-item">
                  <span class="timeline-dot ${escapeHtml(item.tone)}"></span>
                  <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div>
                  <time>${formatWhen(item.when)}</time>
                </div>`,
            )
            .join('') || '<div class="empty-state"><strong>No recent receipts</strong><span>Completed work will appear here with evidence.</span></div>'}
        </div>
      </section>`;
  }

  function renderLanes() {
    const lanes = state.snapshot?.lanes || [];
    return `
      <section class="lane-section">
        <div class="section-heading"><div><small>AVAILABLE CAPACITY</small><h2>Your model bench</h2></div><span>Choose by job, not hype.</span></div>
        <div class="lane-grid">
          ${lanes
            .map((lane) => {
              const permissionCompatible = (lane.permissions || ['read', 'write']).includes(state.selectedPermission);
              const unavailable = lane.state !== 'available' || !permissionCompatible;
              const permissionIssue = state.selectedPermission === 'write' ? 'read only' : 'edit access only';
              return `
                <button class="lane-card ${lane.id === state.selectedLaneId ? 'selected' : ''} ${unavailable ? 'unavailable' : ''}" data-lane-id="${escapeHtml(lane.id)}" ${unavailable ? 'disabled' : ''}>
                  <div class="lane-card-top"><span class="lane-glyph">${escapeHtml(lane.name.slice(0, 1))}</span><span class="availability ${unavailable ? 'unavailable' : lane.state}">${!permissionCompatible ? permissionIssue : lane.state}</span></div>
                  <strong>${escapeHtml(lane.name)}</strong>
                  <p>${escapeHtml(lane.detail)}</p>
                  <small>${escapeHtml(lane.evidenceLabel || 'Evidence class not recorded')}</small>
                </button>`;
            })
            .join('')}
        </div>
      </section>`;
  }

  function renderProjectContext() {
    const project = currentProject();
    if (!project) return '';
    const note = state.notes[project.id] || '';
    return `
      <section class="project-context">
        <div class="panel artifact-panel">
          <div class="panel-heading">
            <div><small>PROJECT TABLE</small><h2>${escapeHtml(project.name)} artifacts</h2></div>
            <button class="context-action" data-action="open-project">Open primary ↗</button>
          </div>
          <div class="artifact-grid">
            ${(project.artifacts || [])
              .map(
                (artifact) => `
                  <button class="artifact-card" data-file-path="${escapeHtml(artifact.path)}">
                    <span class="artifact-icon ${escapeHtml(artifact.kind)}">${artifact.kind === 'preview' ? '◫' : artifact.kind === 'image' ? '◇' : artifact.kind === 'pdf' ? 'P' : '¶'}</span>
                    <span><strong>${escapeHtml(artifact.label)}</strong><small>${escapeHtml(artifact.kind)} · ${formatWhen(artifact.changedAt)}</small></span>
                    <span class="chevron">›</span>
                  </button>`,
              )
              .join('') || '<div class="empty-state small"><strong>No surfaced artifacts yet</strong><span>GeneralStaff will still open the project mission.</span></div>'}
          </div>
        </div>
        <div class="panel note-panel">
          <div class="panel-heading"><div><small>PRIVATE MARGIN</small><h2>Operator note</h2></div><span class="local-badge">local</span></div>
          <p>Keep the thought you do not want an agent to turn into work yet.</p>
          <textarea id="project-note" maxlength="10000" placeholder="A decision, hunch, or reminder for ${escapeHtml(project.name)}…">${escapeHtml(note)}</textarea>
          <div class="note-footer"><span>Stored in this Workbench profile</span><button data-action="save-note">Save note</button></div>
        </div>
      </section>`;
  }

  function renderDashboard() {
    const project = currentProject();
    const general = state.selectedTargetKind === 'general';
    const projects = state.snapshot?.projects || [];
    const totalActive = projects.reduce((sum, item) => sum + item.inProgress, 0);
    const totalQueued = projects.reduce((sum, item) => sum + item.pending, 0);
    const totalReview = projects.reduce((sum, item) => sum + item.needsReview, 0);
    return `
      <main class="main">
        ${renderTopbar(general ? 'General Command' : project?.name || 'Project Command', general ? 'GENERAL STAFF · ORCHESTRATOR SEAT' : 'GENERAL STAFF · PROJECT SEAT')}
        <div class="content">
          <section class="hero">
            <div class="hero-copy">
              <span class="hero-kicker"><span></span> ${general ? 'The orchestrator is listening' : 'The project seat is listening'}</span>
              <h2>${general ? 'Command the fleet.' : 'State the outcome.'}<br><em>Keep command.</em></h2>
              <p>${escapeHtml(general ? 'Catch up, route, dispatch, and ask fleet-wide questions from the private GeneralStaff root. Choose a project only when the work belongs in one repository.' : project?.mission || 'Direct the next useful project outcome in plain English.')}</p>
              <div class="hero-stats">
                <div><strong>${totalActive}</strong><span>active</span></div>
                <div><strong>${totalQueued}</strong><span>queued</span></div>
                <div><strong>${totalReview}</strong><span>for review</span></div>
              </div>
            </div>
            ${renderComposer(false)}
          </section>
          <div class="dashboard-grid">${renderAttention()}${renderActivity()}</div>
          ${general ? '' : renderProjectContext()}
          ${renderLanes()}
        </div>
      </main>`;
  }

  function renderSetup() {
    return `
      <main class="main setup-main">
        ${renderTopbar('Connect GeneralStaff', 'GENERAL STAFF · FIRST RUN')}
        <div class="setup-card">
          <span class="assistant-mark large">GS</span>
          <small>ONE-TIME SETUP</small>
          <h2>Choose the folder that holds your fleet.</h2>
          <p>The Workbench needs the GeneralStaff private root containing <code>state/</code>. It stores the choice locally and never guesses a personal Desktop path.</p>
          <button class="send-button" data-action="choose-root"><span>Choose GeneralStaff root</span><span class="send-arrow">↗</span></button>
        </div>
      </main>`;
  }

  function renderReceipt(conversation) {
    const receipt = conversation.receipt;
    if (!receipt) return '';
    const seconds = Math.max(1, Math.round((receipt.finishedAt - receipt.startedAt) / 1000));
    const healthy = receipt.exitCode === 0 && !receipt.stopped;
    const continuity = receipt.continuity === 'native'
      ? 'native session resumed'
      : receipt.continuity === 'transcript'
        ? 'transcript handoff'
        : 'new provider session';
    return `
      <div class="receipt ${healthy ? 'healthy' : 'failed'}">
        <span class="receipt-mark">${healthy ? '✓' : '!'}</span>
        <div class="receipt-copy">
          <strong>${healthy ? 'Lane completed' : receipt.stopped ? 'Run stopped' : 'Lane needs attention'}</strong>
          <small>${escapeHtml(receipt.modelLabel)} · ${seconds}s · exit ${receipt.exitCode ?? '—'} · ${receipt.permission === 'write' ? 'edit access' : 'read only'} · ${continuity}${receipt.skillId ? ` · /${escapeHtml(receipt.skillId)}` : ''}${receipt.capabilities?.length ? ` · ${escapeHtml(receipt.capabilities.join(' + '))}` : ''}</small>
          <details>
            <summary>Run evidence</summary>
            <dl><dt>Working directory</dt><dd>${escapeHtml(receipt.workingDirectory || 'not recorded')}</dd><dt>Continuity</dt><dd>${escapeHtml(continuity)}</dd><dt>Consent</dt><dd>${receipt.permission === 'write' ? `Enabled ${formatWhen(receipt.consentedAt)}` : 'Read-only default'}</dd></dl>
            <pre>${escapeHtml((receipt.evidence || []).join('\n') || 'No raw lane envelope was captured.')}</pre>
          </details>
        </div>
      </div>`;
  }

  function renderDecisions(conversation, messageId, running) {
    const decisions = (conversation.decisions || []).filter((decision) => decision.messageId === messageId);
    return decisions
      .map((decision) => {
        const answer = decision.options.find((option) => option.id === decision.answerOptionId);
        return `
          <section class="decision-card ${decision.answeredAt ? 'answered' : ''}">
            <div class="decision-kicker"><span>Operator decision</span><small>${decision.answeredAt ? 'recorded' : 'work is paused here'}</small></div>
            <h3>${escapeHtml(decision.title)}</h3>
            <p>${escapeHtml(decision.question)}</p>
            <div class="decision-options">
              ${decision.options.map((option) => `
                <button
                  class="decision-option ${option.id === decision.answerOptionId ? 'chosen' : ''}"
                  data-action="answer-decision"
                  data-decision-id="${escapeHtml(decision.id)}"
                  data-option-id="${escapeHtml(option.id)}"
                  ${decision.answeredAt || running ? 'disabled' : ''}
                >
                  <strong>${escapeHtml(option.label)}</strong>
                  ${option.description ? `<span>${escapeHtml(option.description)}</span>` : ''}
                </button>`).join('')}
            </div>
            ${answer ? `<div class="decision-answer"><span>✓</span><strong>You chose ${escapeHtml(answer.label)}</strong><small>${formatWhen(decision.answeredAt)}</small></div>` : '<small class="decision-footnote">Your answer returns to the same conversation and permission boundary.</small>'}
          </section>`;
      })
      .join('');
  }

  function renderRecovery(conversation, running) {
    const lastAssistant = [...conversation.messages].reverse().find((message) => message.role === 'assistant');
    if (lastAssistant?.status !== 'error') return '';
    return `
      <section class="recovery-card">
        <div><small>RECOVERY DESK</small><h3>The command can be recovered.</h3><p>Retry keeps safe native context when available. Transcript recovery starts a fresh provider session from the visible conversation.</p></div>
        <div class="recovery-actions">
          <button class="recovery-primary" data-action="retry-run" ${running ? 'disabled' : ''}>↻ Retry last command</button>
          <button data-action="retry-transcript" ${running ? 'disabled' : ''}>Retry from transcript</button>
          <button data-action="choose-lane" ${running ? 'disabled' : ''}>Change lane</button>
        </div>
      </section>`;
  }

  function renderConversation() {
    let conversation = currentConversation();
    if (!conversation && state.selectedTargetKind === 'general' && state.orchestratorSessionId) {
      state.activeConversationId = state.orchestratorSessionId;
      conversation = currentConversation();
    }
    if (!conversation) return renderDashboard();
    const project = conversationProject(conversation);
    const general = conversation.target?.kind === 'general';
    const orchestrator = conversation.kind === 'orchestrator';
    const lane = state.snapshot?.lanes.find((item) => item.id === conversation.laneId);
    const run = state.runStatus[conversation.id];
    const contextItems = conversation.context || [];
    return `
      <main class="main conversation-main">
        ${renderTopbar(orchestrator ? 'Orchestrator session' : conversation.title, orchestrator ? 'GENERAL STAFF · LIVE COMMAND SEAT' : `${escapeHtml(project?.name || conversation.target?.projectId || 'Project')} · ${escapeHtml(seatCopy[conversation.seat]?.[0] || conversation.seat)}`)}
        <div class="conversation-shell">
          <div class="conversation-meta">
            ${orchestrator ? '<div class="session-identity"><span class="session-live-dot"></span><strong>Continuous session</strong><small>Transcript retained; compatible provider sessions resume after reopen</small></div>' : '<button class="back-button" data-action="dashboard">← Project Command</button>'}
            <div class="meta-chips">
              <span>${escapeHtml(lane?.name || conversation.laneId)}</span>
              <span>${escapeHtml(lane?.evidenceLabel || 'Evidence class not recorded')}</span>
              ${conversation.skillId ? `<span class="skill-chip">/${escapeHtml(conversation.skillId)}</span>` : ''}
              <span class="permission-chip ${conversation.permission === 'write' ? 'write' : ''}">${conversation.permission === 'write' ? 'Can edit repo' : 'Read only'}</span>
              ${project ? '<button data-action="open-project">Open project ↗</button>' : '<span class="root-chip">GENERALSTAFF_ROOT</span>'}
            </div>
          </div>
          ${contextItems.length ? `<div class="conversation-context"><span>Context</span>${contextItems.map((item) => `<button data-file-path="${escapeHtml(item.path)}">${escapeHtml(item.label)}</button>`).join('')}</div>` : ''}
          <section class="message-stream">
            ${conversation.messages
              .map(
                (message) => `
                  <article class="message ${message.role} ${message.status || ''}" data-message-id="${escapeHtml(message.id)}">
                    <div class="message-author">${message.role === 'user' ? '<span class="avatar tiny">RW</span><strong>You</strong>' : '<span class="assistant-mark">GS</span><strong>GeneralStaff</strong>'}${message.attempt === 'retry' ? '<span class="attempt-badge">Recovery attempt</span>' : ''}<time>${formatWhen(message.createdAt)}</time></div>
                    <div class="message-body">${message.text ? renderText(message.text) : '<div class="thinking"><i></i><i></i><i></i><span>Taking the seat…</span></div>'}</div>
                  </article>
                  ${renderDecisions(conversation, message.id, Boolean(run))}`,
              )
              .join('') || `<div class="conversation-welcome"><span class="assistant-mark large">GS</span><h2>${orchestrator ? 'The orchestrator seat is ready.' : 'What project outcome are we ordering?'}</h2><p>${orchestrator ? 'Catch up, make rulings, follow up, or dispatch work. Every message continues this same session from the private GeneralStaff root.' : 'This project order runs from the selected repository with its own bounded conversation.'}</p></div>`}
            ${renderReceipt(conversation)}
            ${renderRecovery(conversation, Boolean(run))}
          </section>
          <div class="conversation-compose-wrap">
            ${run ? `<div class="run-strip"><span class="spinner"></span><span>${escapeHtml(run)}</span><button data-action="stop-run">Stop</button></div>` : ''}
            ${renderComposer(true)}
          </div>
        </div>
      </main>`;
  }

  function renderNotice() {
    if (!state.notice) return '';
    return `<div class="toast ${state.notice.tone}"><span>${state.notice.tone === 'error' ? '!' : 'i'}</span>${escapeHtml(state.notice.text)}</div>`;
  }

  function render() {
    if (!state.snapshot) return;
    const oldPrompt = document.getElementById('prompt');
    if (oldPrompt) state.draft = oldPrompt.value;
    const oldStream = document.querySelector('.message-stream');
    const oldScrollTop = oldStream?.scrollTop || 0;
    const wasNearBottom = oldStream ? oldStream.scrollHeight - oldStream.scrollTop - oldStream.clientHeight < 72 : true;
    const restorePromptFocus = document.activeElement?.id === 'prompt';
    const selectionStart = oldPrompt?.selectionStart;
    const selectionEnd = oldPrompt?.selectionEnd;
    ensureSelections();
    const content = state.snapshot.rootPath ? renderConversation() : renderSetup();
    app.innerHTML = `<div class="workbench">${renderRail()}${content}${renderNotice()}</div>`;
    if (state.activeConversationId) {
      requestAnimationFrame(() => {
        const stream = document.querySelector('.message-stream');
        if (stream) stream.scrollTop = wasNearBottom ? stream.scrollHeight : oldScrollTop;
      });
    }
    if (restorePromptFocus) {
      requestAnimationFrame(() => {
        const prompt = document.getElementById('prompt');
        prompt?.focus();
        if (prompt && selectionStart !== undefined && selectionEnd !== undefined) {
          prompt.setSelectionRange(selectionStart, selectionEnd);
        }
      });
    }
    remember();
  }

  function issueCommand() {
    const prompt = document.getElementById('prompt');
    const text = prompt?.value.trim();
    if (!text || !state.snapshot?.rootPath || !state.selectedLaneId) return;
    let conversation = currentConversation();
    if (!conversation && state.selectedTargetKind === 'general' && state.orchestratorSessionId) {
      state.activeConversationId = state.orchestratorSessionId;
      conversation = currentConversation();
    }
    if (conversation) {
      if (state.runStatus[conversation.id] || state.pendingSend) return;
      state.pendingSend = { conversationId: conversation.id, text };
      vscode.postMessage({ type: 'send-prompt', conversationId: conversation.id, text });
      render();
      return;
    }
    if (state.creatingConversation) return;
    state.creatingConversation = true;
    state.pendingPrompt = text;
    vscode.postMessage({
      type: 'new-conversation',
      target: currentTarget(),
      laneId: state.selectedLaneId,
      seat: state.selectedSeat,
      effort: state.selectedEffort,
      permission: state.selectedPermission,
      skillId: state.selectedSkillId || undefined,
      contextPaths: state.pendingContext.map((item) => item.path),
    });
    render();
  }

  function postRoutingUpdate() {
    const conversation = currentConversation();
    if (!conversation || state.runStatus[conversation.id]) return;
    vscode.postMessage({
      type: 'update-routing',
      conversationId: conversation.id,
      laneId: state.selectedLaneId,
      seat: state.selectedSeat,
      effort: state.selectedEffort,
      permission: state.selectedPermission,
      skillId: state.selectedSkillId || undefined,
    });
  }

  app.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const projectId = target.dataset.projectId;
    const laneId = target.dataset.laneId;
    const conversationId = target.dataset.conversationId;
    const filePath = target.dataset.filePath;
    const decisionId = target.dataset.decisionId;
    const optionId = target.dataset.optionId;
    const themeId = target.dataset.themeId;
    const action = target.dataset.action;

    if (themeId) {
      applyTheme(themeId);
    } else if (filePath) {
      vscode.postMessage({ type: 'open-file', path: filePath });
    } else if (projectId) {
      state.selectedTargetKind = 'project';
      state.selectedProjectId = projectId;
      state.activeConversationId = null;
      state.selectedPermission = 'read';
      render();
    } else if (laneId) {
      state.selectedLaneId = laneId;
      ensureSelections();
      render();
    } else if (conversationId) {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      state.activeConversationId = conversationId;
      if (conversation) {
        state.selectedTargetKind = conversation.target?.kind || 'project';
        state.selectedProjectId = conversation.target?.projectId || null;
        state.selectedLaneId = conversation.laneId;
        state.selectedSeat = conversation.seat;
        state.selectedEffort = conversation.effort || 'default';
        state.selectedSkillId = conversation.skillId || '';
        state.selectedPermission = conversation.permission || 'read';
      }
      render();
    } else if (action === 'dashboard') {
      const projectId = currentConversation()?.target?.projectId || state.selectedProjectId;
      state.activeConversationId = null;
      state.selectedTargetKind = projectId ? 'project' : 'general';
      state.selectedProjectId = projectId || null;
      state.selectedPermission = 'read';
      render();
    } else if (action === 'general-command') {
      selectOrchestratorSession();
      render();
      requestAnimationFrame(() => document.getElementById('prompt')?.focus());
    } else if (action === 'new-command') {
      selectOrchestratorSession(true);
      render();
      requestAnimationFrame(() => document.getElementById('prompt')?.focus());
    } else if (action === 'send') {
      issueCommand();
    } else if (action === 'refresh') {
      vscode.postMessage({ type: 'refresh' });
    } else if (action === 'open-terminal') {
      vscode.postMessage({ type: 'open-terminal', target: currentConversation()?.target || currentTarget() });
    } else if (action === 'open-project') {
      const conversation = currentConversation();
      const id = conversation?.target?.kind === 'project' ? conversation.target.projectId : currentProject()?.id;
      if (id) vscode.postMessage({ type: 'open-project', projectId: id });
    } else if (action === 'stop-run') {
      const id = currentConversation()?.id;
      if (id) vscode.postMessage({ type: 'stop-run', conversationId: id });
    } else if (action === 'retry-run' || action === 'retry-transcript') {
      const id = currentConversation()?.id;
      if (id && !state.runStatus[id]) {
        state.pendingActionConversationId = id;
        state.runStatus[id] = action === 'retry-run' ? 'Preparing a safe retry…' : 'Preparing transcript recovery…';
        vscode.postMessage({
          type: 'retry-run',
          conversationId: id,
          strategy: action === 'retry-run' ? 'auto' : 'transcript',
        });
        render();
      }
    } else if (action === 'answer-decision' && decisionId && optionId) {
      const id = currentConversation()?.id;
      if (id && !state.runStatus[id]) {
        state.pendingActionConversationId = id;
        state.runStatus[id] = 'Recording your decision…';
        vscode.postMessage({ type: 'answer-decision', conversationId: id, decisionId, optionId });
        render();
      }
    } else if (action === 'choose-lane') {
      const select = document.getElementById('lane-select');
      select?.focus();
      try {
        select?.showPicker?.();
      } catch {
        // Focus is a complete fallback when the host disallows programmatic picker opening.
      }
    } else if (action === 'save-note') {
      const note = document.getElementById('project-note');
      if (state.selectedProjectId && note) {
        vscode.postMessage({ type: 'save-note', projectId: state.selectedProjectId, text: note.value });
      }
    } else if (action === 'pick-context') {
      vscode.postMessage({ type: 'pick-context', target: currentConversation()?.target || currentTarget() });
    } else if (action === 'choose-root') {
      vscode.postMessage({ type: 'choose-root' });
    }
  });

  app.addEventListener('change', (event) => {
    if (event.target.id === 'seat-select') {
      state.selectedSeat = event.target.value;
      ensureSelections();
      render();
      postRoutingUpdate();
    }
    if (event.target.id === 'lane-select') {
      state.selectedLaneId = event.target.value;
      ensureSelections();
      render();
      postRoutingUpdate();
    }
    if (event.target.id === 'effort-select') {
      state.selectedEffort = event.target.value;
      remember();
      postRoutingUpdate();
    }
    if (event.target.id === 'skill-select') {
      state.selectedSkillId = event.target.value;
      remember();
      postRoutingUpdate();
    }
    if (event.target.id === 'permission-select') {
      state.selectedPermission = event.target.value;
      render();
      postRoutingUpdate();
    }
  });

  app.addEventListener('input', (event) => {
    if (event.target.id === 'prompt') {
      state.draft = event.target.value;
      remember();
    }
  });

  app.addEventListener('keydown', (event) => {
    if (event.target.id === 'prompt' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      issueCommand();
    }
  });

  function patchConversationDelta(message) {
    const stream = document.querySelector('.message-stream');
    const wasNearBottom = stream ? stream.scrollHeight - stream.scrollTop - stream.clientHeight < 72 : false;
    const article = [...document.querySelectorAll('[data-message-id]')]
      .find((candidate) => candidate.dataset.messageId === message.messageId);
    if (!article) {
      render();
      return;
    }
    article.classList.remove('streaming', 'complete', 'error');
    article.classList.add(message.status);
    const body = article.querySelector('.message-body');
    if (body) {
      body.innerHTML = message.text
        ? renderText(message.text)
        : '<div class="thinking"><i></i><i></i><i></i><span>Taking the seat…</span></div>';
    }
    if (stream && wasNearBottom) stream.scrollTop = stream.scrollHeight;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'state') {
      state.snapshot = message.snapshot;
      state.conversations = message.conversations || [];
      state.orchestratorSessionId = message.orchestratorSessionId || null;
      if (!state.hydrated) {
        state.activeConversationId = state.orchestratorSessionId;
        state.selectedTargetKind = 'general';
        const session = state.conversations.find((item) => item.id === state.orchestratorSessionId);
        if (session) {
          state.selectedLaneId = session.laneId;
          state.selectedSeat = session.seat;
          state.selectedEffort = session.effort || 'default';
          state.selectedSkillId = session.skillId || '';
          state.selectedPermission = session.permission || 'read';
        }
        state.hydrated = true;
      }
      state.notes = message.notes || {};
      render();
    } else if (message.type === 'conversations') {
      state.conversations = message.conversations || [];
      const active = state.conversations.find((item) => item.id === state.activeConversationId);
      if (active) state.selectedSkillId = active.skillId || '';
      if (state.pendingSend) {
        const conversation = state.conversations.find((item) => item.id === state.pendingSend.conversationId);
        const accepted = conversation?.messages.some(
          (item) => item.role === 'user' && item.text.trim() === state.pendingSend.text.trim(),
        );
        if (accepted) {
          const prompt = document.getElementById('prompt');
          if (prompt) prompt.value = '';
          state.draft = '';
          state.pendingSend = null;
        }
      }
      render();
    } else if (message.type === 'conversation-selected') {
      state.creatingConversation = false;
      state.activeConversationId = message.conversation.id;
      state.selectedTargetKind = message.conversation.target?.kind || 'project';
      state.selectedProjectId = message.conversation.target?.projectId || null;
      state.selectedLaneId = message.conversation.laneId;
      state.selectedSeat = message.conversation.seat;
      state.selectedEffort = message.conversation.effort || 'default';
      state.selectedSkillId = message.conversation.skillId || '';
      state.selectedPermission = message.conversation.permission || 'read';
      state.pendingContext = [];
      if (!state.conversations.some((item) => item.id === message.conversation.id)) {
        state.conversations.unshift(message.conversation);
      }
      const prompt = state.pendingPrompt;
      state.pendingPrompt = '';
      render();
      if (prompt) {
        state.pendingSend = { conversationId: message.conversation.id, text: prompt };
        vscode.postMessage({ type: 'send-prompt', conversationId: message.conversation.id, text: prompt });
      }
    } else if (message.type === 'routing-updated') {
      if (message.conversation) {
        const index = state.conversations.findIndex((item) => item.id === message.conversation.id);
        if (index >= 0) state.conversations[index] = message.conversation;
        state.selectedLaneId = message.conversation.laneId;
        state.selectedSeat = message.conversation.seat;
        state.selectedEffort = message.conversation.effort || 'default';
        state.selectedSkillId = message.conversation.skillId || '';
        state.selectedPermission = message.conversation.permission || 'read';
      }
      render();
    } else if (message.type === 'conversation-delta') {
      const conversation = state.conversations.find((item) => item.id === message.conversationId);
      const item = conversation?.messages.find((candidate) => candidate.id === message.messageId);
      if (item) {
        item.text = message.text;
        item.status = message.status;
      }
      if (message.status !== 'streaming') {
        delete state.runStatus[message.conversationId];
        if (state.pendingActionConversationId === message.conversationId) state.pendingActionConversationId = null;
      }
      patchConversationDelta(message);
    } else if (message.type === 'run-event') {
      if (state.pendingActionConversationId === message.conversationId) state.pendingActionConversationId = null;
      state.runStatus[message.conversationId] = message.event.text;
      render();
    } else if (message.type === 'notice') {
      if (message.tone === 'error') state.creatingConversation = false;
      if (message.conversationId && state.pendingActionConversationId === message.conversationId) {
        delete state.runStatus[message.conversationId];
        state.pendingActionConversationId = null;
      }
      state.notice = { text: message.text, tone: message.tone };
      render();
      window.setTimeout(() => {
        state.notice = null;
        render();
      }, 4200);
    } else if (message.type === 'notes') {
      state.notes = message.notes || {};
      render();
    } else if (message.type === 'context-picked') {
      const existing = new Set(state.pendingContext.map((item) => item.path));
      state.pendingContext.push(...(message.items || []).filter((item) => !existing.has(item.path)));
      state.pendingContext = state.pendingContext.slice(0, 12);
      render();
      requestAnimationFrame(() => document.getElementById('prompt')?.focus());
    } else if (message.type === 'focus-composer') {
      selectOrchestratorSession();
      render();
      requestAnimationFrame(() => document.getElementById('prompt')?.focus());
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      selectOrchestratorSession(true);
      render();
      requestAnimationFrame(() => document.getElementById('prompt')?.focus());
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
