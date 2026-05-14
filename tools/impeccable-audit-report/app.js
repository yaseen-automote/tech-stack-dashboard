const state = {
  payload: null,
  selectedIds: new Set(),
  filters: {
    search: "",
    severities: new Set(["P1", "P2", "P3"]),
    category: "All",
    area: "All",
    effort: "All",
  },
  copiedPrompt: false,
  busy: false,
};

const severityMeta = {
  P0: { label: "P0 Blocking", copy: "Prevents success or basic completion." },
  P1: { label: "P1 Major", copy: "High-impact usability or standards issue." },
  P2: { label: "P2 Minor", copy: "Noticeable friction worth addressing next." },
  P3: { label: "P3 Polish", copy: "Quality lift with lower urgency." },
};

const appNode = document.getElementById("app");

void loadReport();

async function loadReport() {
  const response = await fetch("/api/report", { cache: "no-store" });
  state.payload = await response.json();
  render();
}

function render() {
  if (!state.payload) {
    return;
  }

  const visibleIssues = getFilteredIssues();
  const grouped = groupBySeverity(visibleIssues);
  const selectedIssues = state.payload.issues.filter((entry) => state.selectedIds.has(entry.id));

  appNode.innerHTML = `
    <div class="report-shell">
      <div class="report-grid">
        <aside class="report-column controls">
          ${renderControls(visibleIssues)}
        </aside>
        <main class="report-column">
          ${renderHero()}
          ${renderFindings(grouped)}
        </main>
        <aside class="report-column summary">
          ${renderSelectionSummary(selectedIssues, visibleIssues)}
        </aside>
      </div>
    </div>
  `;

  bindEvents();
}

function renderHero() {
  const { summary } = state.payload;

  return `
    <section class="report-card hero-card">
      <div class="report-card-header">
        <p class="eyebrow">Impeccable Audit / Interactive Report</p>
        <div class="hero-topline">
          <div>
            <h1 class="hero-title">50 visual fixes, organized for selection instead of overwhelm.</h1>
            <p class="hero-copy">${summary.executiveSummary.join(" ")}</p>
          </div>
          <div class="score-pill">
            <div class="score-value">${summary.totalScore}/${summary.maxScore}</div>
            <div class="score-label">${summary.ratingBand}</div>
          </div>
        </div>
      </div>
      <div class="report-card-body">
        <div class="token-chip-row">
          <span class="mini-chip">Visible issues: ${state.payload.issues.length}</span>
          <span class="mini-chip">Hidden for future audits: ${state.payload.hiddenState.dismissedIds.length}</span>
          <span class="mini-chip">Generated: ${new Date(summary.generatedAt).toLocaleString()}</span>
        </div>
        <div class="score-grid">
          ${summary.scorecard
            .map(
              (entry) => `
                <article class="score-card">
                  <div class="score-card-value">${entry.score}/${entry.max}</div>
                  <p class="score-card-title">${entry.dimension}</p>
                  <p class="score-card-copy">${entry.finding}</p>
                </article>
              `,
            )
            .join("")}
        </div>
        <div class="report-card slim" style="margin-top:16px;">
          <div class="report-card-body">
            <p class="eyebrow">Anti-Patterns Verdict</p>
            <p class="body-copy" style="margin-top:0;">${summary.antiPatternVerdict}</p>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderControls(visibleIssues) {
  const { summary, filters } = state.payload;
  const severityCounts = countBy(visibleIssues, "severity");

  return `
    <section class="report-card">
      <div class="report-card-header">
        <p class="eyebrow">Controls</p>
        <h2 class="control-title">Filter the report down to the fixes you actually care about.</h2>
      </div>
      <div class="report-card-body stack">
        <div class="control-section">
          <label class="meta-label" for="audit-search">Search issues</label>
          <input id="audit-search" class="search-input" value="${escapeHtml(state.filters.search)}" placeholder="Search title, impact, area, or file" />
        </div>

        <div class="control-section">
          <p class="meta-label">Severity</p>
          <div class="control-chip-row">
            ${["P1", "P2", "P3"]
              .map(
                (severity) => `
                  <button class="control-chip ${state.filters.severities.has(severity) ? "active" : ""}" data-toggle-severity="${severity}">
                    ${severity}
                    <span class="mini-chip sev-${severity}">${severityCounts[severity] ?? 0}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>

        <div class="control-section">
          <p class="meta-label">Category</p>
          <select class="select-input" id="filter-category">
            ${["All", ...filters.categories]
              .map(
                (entry) => `
                  <option value="${escapeHtml(entry)}" ${state.filters.category === entry ? "selected" : ""}>${entry}</option>
                `,
              )
              .join("")}
          </select>
        </div>

        <div class="control-section">
          <p class="meta-label">Area</p>
          <select class="select-input" id="filter-area">
            ${["All", ...filters.areas]
              .map(
                (entry) => `
                  <option value="${escapeHtml(entry)}" ${state.filters.area === entry ? "selected" : ""}>${entry}</option>
                `,
              )
              .join("")}
          </select>
        </div>

        <div class="control-section">
          <p class="meta-label">Effort</p>
          <select class="select-input" id="filter-effort">
            ${["All", ...filters.efforts]
              .map(
                (entry) => `
                  <option value="${escapeHtml(entry)}" ${state.filters.effort === entry ? "selected" : ""}>${entry}</option>
                `,
              )
              .join("")}
          </select>
        </div>

        <div class="control-section">
          <p class="meta-label">Bulk actions</p>
          <div class="bulk-actions">
            <button class="button" data-action="select-visible">Select visible</button>
            <button class="button ghost" data-action="clear-selection">Clear selection</button>
            <button class="button ghost" data-action="reset-hidden" ${state.payload.hiddenState.dismissedIds.length === 0 ? "disabled" : ""}>
              Restore hidden
            </button>
          </div>
        </div>

        <div class="report-card slim">
          <div class="report-card-body">
            <p class="eyebrow">Recommended order</p>
            <div class="stack">
              ${summary.recommendedCommands
                .map(
                  (entry) => `
                    <div class="selection-row">
                      <strong>[${entry.severity}] ${entry.command}</strong>
                      <span>${entry.description}</span>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderFindings(grouped) {
  return `
    <section class="report-card">
      <div class="report-card-header">
        <p class="eyebrow">Findings</p>
        <h2 class="control-title">Rendered before/after previews for every visible issue</h2>
      </div>
      <div class="report-card-body issue-list">
        ${["P1", "P2", "P3"]
          .map((severity) => renderSeveritySection(severity, grouped[severity] ?? []))
          .join("")}
      </div>
    </section>
  `;
}

function renderSeveritySection(severity, issues) {
  const meta = severityMeta[severity];

  return `
    <details class="severity-section" ${severity === "P1" ? "open" : ""}>
      <summary>
        <div>
          <div class="meta-chip-row">
            <span class="mini-chip sev-${severity}">${meta.label}</span>
            <span class="mini-chip">${issues.length} visible</span>
          </div>
          <p class="severity-copy">${meta.copy}</p>
        </div>
        <span class="mini-chip">Toggle</span>
      </summary>
      <div class="severity-body">
        ${issues.map(renderIssueCard).join("") || `<div class="empty-selection">No visible issues in this severity after your current filters.</div>`}
      </div>
    </details>
  `;
}

function renderIssueCard(issue) {
  const checked = state.selectedIds.has(issue.id);

  return `
    <label class="issue-checkbox">
      <input type="checkbox" data-issue-checkbox="${issue.id}" ${checked ? "checked" : ""} />
      <article class="issue-card-shell">
        <div class="issue-card-header">
          <div>
            <div class="meta-chip-row">
              <span class="mini-chip severity-chip sev-${issue.severity}">${issue.severity}</span>
              <span class="mini-chip">${issue.category}</span>
              <span class="mini-chip">${issue.area}</span>
              <span class="mini-chip">Effort ${issue.effort}</span>
            </div>
            <h3 class="issue-card-title">${escapeHtml(issue.title)}</h3>
            <p class="issue-card-copy">${escapeHtml(issue.impact)}</p>
          </div>
          <span class="issue-toggle" aria-hidden="true"></span>
        </div>
        <div class="issue-card-body">
          <div class="issue-meta-grid">
            <div class="meta-block">
              <p class="meta-label">Location</p>
              <p class="meta-value">${escapeHtml(issue.location)}</p>
            </div>
            <div class="meta-block">
              <p class="meta-label">Recommendation</p>
              <p class="meta-value">${escapeHtml(issue.recommendation)}</p>
            </div>
            <div class="meta-block">
              <p class="meta-label">Suggested command</p>
              <p class="meta-value">${escapeHtml(issue.command)}</p>
            </div>
            <div class="meta-block">
              <p class="meta-label">Standard</p>
              <p class="meta-value">${escapeHtml(issue.standard)}</p>
            </div>
          </div>
          <div class="preview-grid">
            <div class="preview-panel">
              <div class="preview-label">
                <span>Before</span>
                <span>${escapeHtml(issue.preview.title)}</span>
              </div>
              <div class="preview-scene">${renderPreviewScene(issue.preview.kind, "before")}</div>
            </div>
            <div class="preview-panel">
              <div class="preview-label">
                <span>After</span>
                <span>Suggested direction</span>
              </div>
              <div class="preview-scene">${renderPreviewScene(issue.preview.kind, "after")}</div>
            </div>
          </div>
        </div>
      </article>
    </label>
  `;
}

function renderSelectionSummary(selectedIssues, visibleIssues) {
  const summary = state.payload.summary;
  const promptReady = selectedIssues.length > 0;

  return `
    <section class="report-card">
      <div class="report-card-header">
        <p class="eyebrow">Selection Basket</p>
        <h2 class="control-title">Choose what to implement, copy the prompt, then hide what you never want to see again.</h2>
      </div>
      <div class="report-card-body stack">
        <div class="stat-grid">
          <div class="stat-card">
            <strong>${selectedIssues.length}</strong>
            <span>Selected fixes</span>
          </div>
          <div class="stat-card">
            <strong>${visibleIssues.length}</strong>
            <span>Visible after filters</span>
          </div>
          <div class="stat-card">
            <strong>${state.payload.hiddenState.dismissedIds.length}</strong>
            <span>Hidden from future audits</span>
          </div>
          <div class="stat-card">
            <strong>${summary.severityCounts.P1}</strong>
            <span>Major findings total</span>
          </div>
        </div>

        <div class="split-actions">
          <button class="button primary" data-action="copy-prompt" ${promptReady ? "" : "disabled"}>
            ${state.copiedPrompt ? "Prompt copied" : "Copy apply prompt"}
          </button>
          <button class="button" data-action="dismiss-selected" ${promptReady ? "" : "disabled"}>
            Hide selected from future reports
          </button>
        </div>
        <p class="footer-note">The hide action writes dismissed fix ids into the project context at <code>.agents/context/impeccable-audit/hidden-fixes.json</code>.</p>

        ${
          selectedIssues.length > 0
            ? `<div class="selection-list">${selectedIssues
                .map(
                  (entry) => `
                    <div class="selection-row">
                      <strong>[${entry.severity}] ${escapeHtml(entry.title)}</strong>
                      <span>${escapeHtml(entry.recommendation)}</span>
                    </div>
                  `,
                )
                .join("")}</div>`
            : `<div class="empty-selection">Select any issue card to add it here. The copied prompt will list the exact fixes you chose, not the whole audit.</div>`
        }
      </div>
    </section>
  `;
}

function bindEvents() {
  document.getElementById("audit-search")?.addEventListener("input", (event) => {
    state.filters.search = event.currentTarget.value;
    render();
  });

  document.getElementById("filter-category")?.addEventListener("change", (event) => {
    state.filters.category = event.currentTarget.value;
    render();
  });

  document.getElementById("filter-area")?.addEventListener("change", (event) => {
    state.filters.area = event.currentTarget.value;
    render();
  });

  document.getElementById("filter-effort")?.addEventListener("change", (event) => {
    state.filters.effort = event.currentTarget.value;
    render();
  });

  document.querySelectorAll("[data-toggle-severity]").forEach((button) => {
    button.addEventListener("click", () => {
      const severity = button.getAttribute("data-toggle-severity");
      if (!severity) {
        return;
      }

      if (state.filters.severities.has(severity)) {
        state.filters.severities.delete(severity);
      } else {
        state.filters.severities.add(severity);
      }

      render();
    });
  });

  document.querySelectorAll("[data-issue-checkbox]").forEach((inputNode) => {
    inputNode.addEventListener("change", () => {
      const issueId = inputNode.getAttribute("data-issue-checkbox");
      if (!issueId) {
        return;
      }

      if (inputNode.checked) {
        state.selectedIds.add(issueId);
      } else {
        state.selectedIds.delete(issueId);
      }

      state.copiedPrompt = false;
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-action");
      if (!action || state.busy) {
        return;
      }

      state.busy = true;
      try {
        if (action === "select-visible") {
          getFilteredIssues().forEach((entry) => state.selectedIds.add(entry.id));
          state.copiedPrompt = false;
          render();
        }

        if (action === "clear-selection") {
          state.selectedIds.clear();
          state.copiedPrompt = false;
          render();
        }

        if (action === "copy-prompt") {
          const promptResponse = await fetch("/api/prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...state.selectedIds] }),
          });
          const payload = await promptResponse.json();
          await navigator.clipboard.writeText(payload.prompt);
          state.copiedPrompt = true;
          render();
        }

        if (action === "dismiss-selected") {
          const response = await fetch("/api/dismiss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...state.selectedIds] }),
          });
          state.payload = await response.json();
          state.selectedIds.clear();
          state.copiedPrompt = false;
          render();
        }

        if (action === "reset-hidden") {
          const response = await fetch("/api/reset-hidden", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          state.payload = await response.json();
          render();
        }
      } finally {
        state.busy = false;
      }
    });
  });
}

function getFilteredIssues() {
  const issues = state.payload?.issues ?? [];
  const searchValue = state.filters.search.trim().toLowerCase();

  return issues.filter((entry) => {
    if (!state.filters.severities.has(entry.severity)) {
      return false;
    }

    if (state.filters.category !== "All" && entry.category !== state.filters.category) {
      return false;
    }

    if (state.filters.area !== "All" && entry.area !== state.filters.area) {
      return false;
    }

    if (state.filters.effort !== "All" && entry.effort !== state.filters.effort) {
      return false;
    }

    if (!searchValue) {
      return true;
    }

    const haystack = [entry.title, entry.impact, entry.location, entry.recommendation, entry.area]
      .join(" ")
      .toLowerCase();

    return haystack.includes(searchValue);
  });
}

function groupBySeverity(issues) {
  return issues.reduce(
    (groups, entry) => {
      groups[entry.severity].push(entry);
      return groups;
    },
    { P0: [], P1: [], P2: [], P3: [] },
  );
}

function countBy(items, key) {
  return items.reduce((accumulator, entry) => {
    const value = entry[key];
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function renderPreviewScene(kind, mode) {
  const after = mode === "after";
  const sceneMap = {
    "shell-skip-link": () => `
      <div class="scene-shell">
        ${after ? `<div class="scene-callout"></div>` : ""}
        <div class="scene-toolbar"><div class="scene-line medium"></div><div class="scene-button"></div></div>
        <div class="scene-side">
          <div class="scene-rail"><div class="scene-rail-item active"></div><div class="scene-rail-item"></div><div class="scene-rail-item"></div></div>
          <div class="scene-card"><div class="scene-line"></div><div class="scene-line short"></div></div>
        </div>
      </div>
    `,
    "nav-state": () => `
      <div class="scene-rail">
        <div class="scene-rail-item ${after ? "active" : ""}"></div>
        <div class="scene-rail-item"></div>
        <div class="scene-rail-item"></div>
        <div class="scene-rail-item"></div>
      </div>
      <div class="scene-note">${after ? "Clear current-page emphasis and grouping" : "Color-only active state and flat grouping"}</div>
    `,
    "chip-nav": () => `
      <div class="scene-chip-row">
        <div class="scene-chip ${after ? "large" : ""}"></div>
        <div class="scene-chip ${after ? "large" : ""}"></div>
        <div class="scene-chip ${after ? "large" : ""}"></div>
      </div>
      <div class="scene-note">${after ? "Larger targets with clearer active state" : "Compressed chips below ideal touch size"}</div>
    `,
    "feedback-banner": () => `
      <div class="scene-toolbar">
        <div class="scene-line medium"></div>
        <div class="scene-pill"></div>
      </div>
      <div class="scene-banner ${after ? "" : "warning"}">
        <div class="scene-line"></div>
      </div>
      ${after ? `<div class="scene-note">Specific, actionable system feedback</div>` : `<div class="scene-note">Generic or weak status narration</div>`}
    `,
    "search-bar": () => `
      <div class="scene-card">
        ${after ? `<div class="scene-line short"></div>` : ""}
        <div class="scene-toolbar">
          <div class="scene-input"></div>
          <div class="scene-button ${after ? "tall" : ""}"></div>
        </div>
        ${after ? `<div class="scene-banner danger"><div class="scene-line short"></div></div>` : `<div class="scene-note">Placeholder-only guidance</div>`}
      </div>
    `,
    "table-structure": () => `
      <div class="scene-table">
        ${after ? `<div class="scene-banner"><div class="scene-line medium"></div></div>` : ""}
        <div class="scene-table-head"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-cell"></div></div>
        <div class="scene-table-row"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-pill"></div></div>
        <div class="scene-table-row"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-pill"></div></div>
      </div>
    `,
    "focus-state": () => `
      <div class="scene-rail">
        <div class="scene-rail-item ${after ? "active" : ""}"></div>
        <div class="scene-rail-item"></div>
        <div class="scene-rail-item"></div>
      </div>
      ${after ? `<div class="scene-callout"></div>` : `<div class="scene-note">Hover carries more information than focus</div>`}
    `,
    "shortcut-chip": () => `
      <div class="scene-toolbar">
        <div class="scene-input"></div>
        <div class="scene-pill"></div>
      </div>
      <div class="scene-note">${after ? "Shortcut explained in plain language" : "Single-letter badge with no explanation"}</div>
    `,
    pagination: () => `
      <div class="scene-card">
        <div class="scene-table-row"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-pill"></div></div>
        <div class="scene-table-row"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-pill"></div></div>
        <div class="scene-toolbar">
          <div class="scene-button"></div>
          ${after ? `<div class="scene-line short"></div>` : `<div class="scene-cell"></div>`}
          <div class="scene-button"></div>
        </div>
      </div>
    `,
    "empty-state": () => `
      <div class="scene-card" style="align-items:center; justify-content:center; min-height: 152px;">
        <div class="scene-pill" style="width: 48px;"></div>
        <div class="scene-line medium"></div>
        <div class="scene-line short"></div>
        ${after ? `<div class="scene-chip-row"><div class="scene-chip"></div><div class="scene-chip"></div></div>` : ""}
      </div>
    `,
    "component-split": () => `
      <div class="scene-card">
        ${
          after
            ? `<div class="scene-grid-two"><div class="scene-card"><div class="scene-line"></div></div><div class="scene-card"><div class="scene-line"></div></div></div>`
            : `<div class="scene-card"><div class="scene-line"></div><div class="scene-line"></div><div class="scene-line short"></div></div>`
        }
        <div class="scene-note">${after ? "Focused modules with clearer ownership" : "One large client surface owning everything"}</div>
      </div>
    `,
    "loading-panel": () => `
      <div class="scene-shell">
        <div class="scene-card"><div class="scene-line"></div><div class="scene-line short"></div></div>
        ${
          after
            ? `<div class="scene-table"><div class="scene-table-row"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-cell"></div></div><div class="scene-table-row"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-cell"></div></div></div>`
            : `<div class="scene-card"><div class="scene-line"></div><div class="scene-line"></div><div class="scene-line"></div></div>`
        }
      </div>
    `,
    toolbar: () => `
      <div class="scene-toolbar">
        <div class="scene-line medium"></div>
        <div class="scene-chip-row" style="padding:0; border:0; background:transparent;">
          <div class="scene-pill"></div>
          <div class="scene-button"></div>
        </div>
      </div>
      <div class="scene-note">${after ? "Flatter, clearer toolbar hierarchy" : "Blurred shell competing with content"}</div>
    `,
    "table-density": () => `
      <div class="scene-table">
        <div class="scene-table-head"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-cell"></div></div>
        <div class="scene-table-row"><div class="scene-cell ${after ? "medium" : ""}"></div><div class="scene-cell"></div><div class="scene-pill"></div></div>
        <div class="scene-table-row"><div class="scene-cell ${after ? "medium" : ""}"></div><div class="scene-cell"></div><div class="scene-pill"></div></div>
        <div class="scene-table-row"><div class="scene-cell ${after ? "medium" : ""}"></div><div class="scene-cell"></div><div class="scene-pill"></div></div>
      </div>
    `,
    "mobile-target": () => `
      <div class="scene-chip-row">
        <div class="scene-chip ${after ? "large" : ""}"></div>
        <div class="scene-chip ${after ? "large" : ""}"></div>
      </div>
      <div class="scene-toolbar">
        <div class="scene-button ${after ? "tall" : ""}"></div>
        <div class="scene-button ${after ? "tall" : ""}"></div>
      </div>
    `,
    "metric-strip": () => `
      <div class="scene-grid-two">
        <div class="scene-metric"><div class="scene-line short"></div><div class="scene-line"></div></div>
        <div class="scene-metric"><div class="scene-line short"></div><div class="scene-line"></div></div>
        ${
          after
            ? `<div class="scene-metric" style="grid-column: 1 / -1;"><div class="scene-line medium"></div><div class="scene-line short"></div></div>`
            : `<div class="scene-metric"><div class="scene-line short"></div><div class="scene-line"></div></div>`
        }
      </div>
    `,
    "table-mobile": () => `
      ${
        after
          ? `<div class="scene-card"><div class="scene-line"></div><div class="scene-line short"></div><div class="scene-chip-row"><div class="scene-chip"></div><div class="scene-chip"></div></div></div><div class="scene-card"><div class="scene-line"></div><div class="scene-line short"></div></div>`
          : `<div class="scene-table"><div class="scene-table-head"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-cell"></div></div><div class="scene-table-row"><div class="scene-cell"></div><div class="scene-cell"></div><div class="scene-pill"></div></div></div>`
      }
    `,
    "account-row": () => `
      <div class="scene-card">
        <div class="scene-toolbar"><div class="scene-line short"></div><div class="scene-line ${after ? "short" : "medium"}"></div></div>
        <div class="scene-toolbar"><div class="scene-line short"></div><div class="scene-line ${after ? "short" : "medium"}"></div></div>
      </div>
    `,
    "split-row": () => `
      ${
        after
          ? `<div class="scene-card"><div class="scene-line short"></div><div class="scene-line"></div><div class="scene-line medium"></div></div>`
          : `<div class="scene-toolbar"><div class="scene-line short"></div><div class="scene-line medium"></div></div>`
      }
    `,
    "sidebar-search": () => `
      <div class="scene-side">
        <div class="scene-rail"><div class="scene-rail-item"></div><div class="scene-rail-item"></div><div class="scene-rail-item"></div></div>
        <div class="scene-card">
          ${
            after
              ? `<div class="scene-banner"><div class="scene-line short"></div></div>`
              : `<div class="scene-toolbar"><div class="scene-input"></div><div class="scene-pill"></div></div>`
          }
          <div class="scene-line"></div>
        </div>
      </div>
    `,
    "token-contrast": () => `
      <div class="scene-grid-two">
        <div class="scene-card"><div class="scene-line"></div><div class="scene-line"></div></div>
        <div class="scene-card ${after ? "" : ""}"><div class="scene-line"></div><div class="scene-line"></div></div>
      </div>
      <div class="scene-note">${after ? "Shared surface ladder driven by tokens" : "One-off grays authored inline"}</div>
    `,
    "button-variant": () => `
      <div class="scene-toolbar">
        <div class="scene-line medium"></div>
        <div class="scene-button ${after ? "tall" : ""}"></div>
      </div>
      <div class="scene-note">${after ? "Reusable action variant with named intent" : "Inline classes define a one-off hero CTA"}</div>
    `,
    "theme-mode": () => `
      <div class="scene-card">
        <div class="scene-toolbar"><div class="scene-line short"></div><div class="scene-pill"></div></div>
        <div class="scene-grid-two">
          <div class="scene-card"><div class="scene-line"></div></div>
          ${after ? `<div class="scene-card"><div class="scene-line"></div></div>` : ""}
        </div>
      </div>
    `,
    "status-badge": () => `
      <div class="scene-chip-row">
        <div class="scene-pill"></div>
        <div class="scene-pill"></div>
        ${after ? `<div class="scene-line short"></div>` : `<div class="scene-pill"></div>`}
      </div>
      <div class="scene-note">${after ? "Badges reserved for live states only" : "Pills everywhere, even for static context"}</div>
    `,
    "sidebar-accent": () => `
      <div class="scene-rail">
        <div class="scene-rail-item active"></div>
        <div class="scene-rail-item ${after ? "" : "active"}"></div>
        <div class="scene-rail-item"></div>
      </div>
      <div class="scene-note">${after ? "Accent applied with restraint" : "Accent energy leaks into too many chrome moments"}</div>
    `,
    "surface-ladder": () => `
      <div class="scene-grid-two">
        <div class="scene-card"><div class="scene-line"></div></div>
        <div class="scene-card" style="${after ? "background: color-mix(in srgb, var(--background) 92%, transparent);" : ""}"><div class="scene-line"></div></div>
      </div>
      <div class="scene-note">${after ? "Clearer hierarchy between base and raised surfaces" : "Most panels share the same visual weight"}</div>
    `,
    "card-stack": () => `
      ${
        after
          ? `<div class="scene-grid-two"><div class="scene-card"><div class="scene-line"></div></div><div class="scene-card"><div class="scene-line"></div></div></div><div class="scene-banner"><div class="scene-line medium"></div></div>`
          : `<div class="scene-card"><div class="scene-line"></div></div><div class="scene-card"><div class="scene-line"></div></div><div class="scene-card"><div class="scene-line"></div></div>`
      }
    `,
  };

  const renderer = sceneMap[kind] ?? sceneMap["card-stack"];
  return renderer();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
