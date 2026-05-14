import fs from "node:fs";
import path from "node:path";

const SCORECARD = [
  {
    dimension: "Accessibility",
    score: 1,
    max: 4,
    finding: "Keyboard flow, live regions, and table semantics need a full pass.",
  },
  {
    dimension: "Performance",
    score: 2,
    max: 4,
    finding: "The page is light, but the main shell is over-centralized and rerenders broadly.",
  },
  {
    dimension: "Responsive Design",
    score: 2,
    max: 4,
    finding: "Mobile works, but touch targets and table overflow still feel desktop-first.",
  },
  {
    dimension: "Theming",
    score: 2,
    max: 4,
    finding: "Core tokens exist, but many sidebar and utility surfaces still bypass them.",
  },
  {
    dimension: "Anti-Patterns",
    score: 2,
    max: 4,
    finding: "The dashboard is clean, but several safe SaaS patterns flatten hierarchy and intent.",
  },
];

const ISSUE_GROUPS = [
  {
    category: "Accessibility",
    issues: [
      issue("a11y-skip-link", {
        title: "Add a skip link ahead of the fixed shell",
        severity: "P1",
        area: "Global shell",
        location: "components/dashboard-shell.tsx",
        impact: "Keyboard users have to cross the sidebar and the fixed header on every visit before reaching live content.",
        standard: "WCAG 2.4.1 Bypass Blocks",
        recommendation: "Insert a visible-on-focus skip link that lands on the main content region.",
        command: "impeccable harden",
        effort: "S",
        previewKind: "shell-skip-link",
      }),
      issue("a11y-active-nav-semantic", {
        title: "Expose the active sidebar destination with page semantics",
        severity: "P1",
        area: "Sidebar navigation",
        location: "components/dashboard-shell.tsx",
        impact: "Assistive technology gets styling cues only, not the current-page relationship.",
        standard: "WCAG 1.3.1 Info and Relationships",
        recommendation: "Add `aria-current=\"page\"` and a stronger active-state shape that does not rely on color alone.",
        command: "impeccable harden",
        effort: "S",
        previewKind: "nav-state",
      }),
      issue("a11y-mobile-nav-current", {
        title: "Bring current-page semantics to the mobile chip nav",
        severity: "P2",
        area: "Mobile header",
        location: "components/dashboard-shell.tsx",
        impact: "The mobile nav behaves like a passive chip list instead of a clear page switcher.",
        standard: "WCAG 1.3.1 Info and Relationships",
        recommendation: "Use a nav list with `aria-current` and a more explicit active indicator on mobile.",
        command: "impeccable adapt",
        effort: "S",
        previewKind: "chip-nav",
      }),
      issue("a11y-search-live-feedback", {
        title: "Announce lookup progress and completion through a live region",
        severity: "P1",
        area: "Lookup workflow",
        location: "components/dashboard-shell.tsx, components/search-input.tsx",
        impact: "Screen-reader users do not get reliable feedback when a lookup starts, fails, or returns results.",
        standard: "WCAG 4.1.3 Status Messages",
        recommendation: "Attach a polite live region that narrates loading, empty, success, and error states.",
        command: "impeccable harden",
        effort: "M",
        previewKind: "feedback-banner",
      }),
      issue("a11y-search-error-linkage", {
        title: "Associate search errors directly to the input",
        severity: "P1",
        area: "Lookup workflow",
        location: "components/dashboard-shell.tsx, components/search-input.tsx",
        impact: "A validation or API failure appears visually but is not tied to the input via `aria-describedby` or invalid state.",
        standard: "WCAG 3.3.1 Error Identification",
        recommendation: "Expose inline help and error text with `aria-invalid` and `aria-describedby`.",
        command: "impeccable harden",
        effort: "M",
        previewKind: "search-bar",
      }),
      issue("a11y-table-caption", {
        title: "Add captions and scope metadata to both result tables",
        severity: "P2",
        area: "Data tables",
        location: "components/dashboard-shell.tsx",
        impact: "The tables are readable visually, but their purpose is not announced before headers and row data start streaming.",
        standard: "WCAG 1.3.1 Info and Relationships",
        recommendation: "Add table captions and explicit header scope so readers understand context sooner.",
        command: "impeccable harden",
        effort: "S",
        previewKind: "table-structure",
      }),
      issue("a11y-focus-ring-sidebar", {
        title: "Make focus states visible on sidebar and card links",
        severity: "P1",
        area: "Interactive chrome",
        location: "components/dashboard-shell.tsx",
        impact: "Many links change only on hover, which makes keyboard focus difficult to track.",
        standard: "WCAG 2.4.7 Focus Visible",
        recommendation: "Use tokenized focus rings or outlines on every interactive surface, not just form controls.",
        command: "impeccable harden",
        effort: "M",
        previewKind: "focus-state",
      }),
      issue("a11y-icon-badge-clarity", {
        title: "Clarify the single-letter sidebar shortcut badge",
        severity: "P2",
        area: "Sidebar search",
        location: "components/dashboard-shell.tsx",
        impact: "The `F` badge is visually cryptic and does not explain whether it is a keyboard shortcut or a mode indicator.",
        standard: "WCAG 3.3.2 Labels or Instructions",
        recommendation: "Replace the isolated letter with a labeled shortcut chip such as `Press / to search`.",
        command: "impeccable clarify",
        effort: "S",
        previewKind: "shortcut-chip",
      }),
      issue("a11y-pagination-state", {
        title: "Announce page changes in the result paginator",
        severity: "P2",
        area: "Subdomain results",
        location: "components/dashboard-shell.tsx",
        impact: "Changing pages updates rows visually but gives no narration of the new page or visible result range.",
        standard: "WCAG 4.1.3 Status Messages",
        recommendation: "Add an `aria-live` summary that announces page number and result range after each change.",
        command: "impeccable harden",
        effort: "S",
        previewKind: "pagination",
      }),
      issue("a11y-empty-state-guidance", {
        title: "Make the empty state instructional instead of decorative",
        severity: "P2",
        area: "Lookup empty state",
        location: "components/dashboard-shell.tsx",
        impact: "Users get a polite dead end, but not enough recovery guidance, examples, or next steps.",
        standard: "WCAG 3.3.3 Error Suggestion",
        recommendation: "Add a concise example domain, one alternative action, and a direct retry suggestion.",
        command: "impeccable clarify",
        effort: "S",
        previewKind: "empty-state",
      }),
    ],
  },
  {
    category: "Performance",
    issues: [
      issue("perf-shell-monolith", {
        title: "Break the dashboard shell into smaller client boundaries",
        severity: "P2",
        area: "Rendering architecture",
        location: "components/dashboard-shell.tsx",
        impact: "A single client component owns the entire screen, so search interactions rerender unrelated panels and chrome.",
        recommendation: "Extract the lookup surface, side rail, account card, and report type list into smaller units with clearer ownership.",
        command: "impeccable harden",
        effort: "L",
        previewKind: "component-split",
      }),
      issue("perf-search-cache", {
        title: "Cache recent domain lookups in memory",
        severity: "P2",
        area: "Lookup workflow",
        location: "components/dashboard-shell.tsx",
        impact: "Repeated searches for the same domain always trigger a fresh network trip and loading skeleton.",
        recommendation: "Store recent domain responses and reuse them for immediate re-opens or navigation backtracks.",
        command: "impeccable optimize",
        effort: "M",
        previewKind: "search-bar",
      }),
      issue("perf-static-data-extraction", {
        title: "Move static dashboard fixtures out of the client file",
        severity: "P3",
        area: "Bundle organization",
        location: "components/dashboard-shell.tsx",
        impact: "Large literal arrays for ideas, report types, and categories make the main shell heavier than needed.",
        recommendation: "Extract static fixtures into data modules so the component stays focused on behavior.",
        command: "impeccable optimize",
        effort: "S",
        previewKind: "component-split",
      }),
      issue("perf-icon-surface-cost", {
        title: "Reduce repeated icon wrappers and decorative containers",
        severity: "P3",
        area: "Card listings",
        location: "components/dashboard-shell.tsx",
        impact: "The design is not slow now, but many tiny bordered icon holders add paint noise without much clarity gain.",
        recommendation: "Use fewer nested wrappers and let spacing or typography carry more of the hierarchy.",
        command: "impeccable distill",
        effort: "M",
        previewKind: "card-stack",
      }),
      issue("perf-loading-scope", {
        title: "Localize the loading state to result-bearing regions",
        severity: "P2",
        area: "Lookup workflow",
        location: "components/dashboard-shell.tsx",
        impact: "The reports panel swaps to skeletons on lookup even though the query affects the results table more directly.",
        recommendation: "Keep adjacent dashboard modules stable and confine loading placeholders to the query-specific content region.",
        command: "impeccable layout",
        effort: "M",
        previewKind: "loading-panel",
      }),
      issue("perf-backdrop-discipline", {
        title: "Tone down the always-on header blur",
        severity: "P3",
        area: "Top header",
        location: "components/dashboard-shell.tsx",
        impact: "The blur is modest, but it spends visual and rendering budget on a shell element that rarely needs to float.",
        recommendation: "Use a flatter surface or conditional blur only when content scrolls underneath in a meaningful way.",
        command: "impeccable quieter",
        effort: "S",
        previewKind: "toolbar",
      }),
      issue("perf-table-row-density", {
        title: "Normalize row structure for the subdomain table",
        severity: "P3",
        area: "Subdomain results",
        location: "components/dashboard-shell.tsx",
        impact: "The current rows are readable, but layout shifts slightly between badge widths and cell content lengths.",
        recommendation: "Use more stable columns, badge sizing, and a consistent row rhythm to reduce scanning fatigue.",
        command: "impeccable layout",
        effort: "M",
        previewKind: "table-density",
      }),
      issue("perf-paginator-placement", {
        title: "Keep the paginator sticky to the table frame",
        severity: "P3",
        area: "Subdomain results",
        location: "components/dashboard-shell.tsx",
        impact: "Pagination is visually separated from the row field that it controls, which increases pointer travel and reorientation.",
        recommendation: "Anchor pagination closer to the active row region or make the footer stay in view during long scans.",
        command: "impeccable layout",
        effort: "M",
        previewKind: "pagination",
      }),
      issue("perf-card-grid-sameness", {
        title: "Reduce repeated panel chrome across the left column",
        severity: "P3",
        area: "Dashboard composition",
        location: "components/dashboard-shell.tsx",
        impact: "Every section uses the same framed card language, which increases visual noise and weakens signal contrast.",
        recommendation: "Reserve card frames for modules that need containment and let lighter sections breathe directly on the page.",
        command: "impeccable distill",
        effort: "L",
        previewKind: "card-stack",
      }),
      issue("perf-status-badge-overuse", {
        title: "Reduce badge density in static dashboard areas",
        severity: "P3",
        area: "Metrics and report cards",
        location: "components/dashboard-shell.tsx, components/status-badge.tsx",
        impact: "Badges appear in many places where quieter labels would convey the same information with less noise.",
        recommendation: "Use badges for volatile states and downgrade static context labels to plain text or softer chips.",
        command: "impeccable quieter",
        effort: "M",
        previewKind: "status-badge",
      }),
    ],
  },
  {
    category: "Responsive Design",
    issues: [
      issue("resp-mobile-nav-targets", {
        title: "Increase mobile nav chip touch targets to a true 44px minimum",
        severity: "P1",
        area: "Mobile header",
        location: "components/dashboard-shell.tsx",
        impact: "The chip nav is easy to miss on phones and falls below comfortable touch sizing.",
        standard: "WCAG 2.5.5 Target Size",
        recommendation: "Increase chip height and horizontal breathing room while preserving density.",
        command: "impeccable adapt",
        effort: "S",
        previewKind: "mobile-target",
      }),
      issue("resp-header-icon-targets", {
        title: "Enlarge icon-only header controls on compact screens",
        severity: "P1",
        area: "Header actions",
        location: "components/dashboard-shell.tsx, components/ui/button.tsx",
        impact: "Notifications and drawer triggers are smaller than comfortable thumb-size on mobile.",
        standard: "WCAG 2.5.5 Target Size",
        recommendation: "Use a larger mobile size token for icon-only actions while keeping desktop density intact.",
        command: "impeccable adapt",
        effort: "S",
        previewKind: "mobile-target",
      }),
      issue("resp-search-submit-target", {
        title: "Scale the lookup submit button for touch use",
        severity: "P2",
        area: "Lookup toolbar",
        location: "components/search-input.tsx",
        impact: "The compact lookup button looks crisp on desktop but feels too tight on smaller devices.",
        standard: "WCAG 2.5.5 Target Size",
        recommendation: "Increase the mobile tap target and keep the label readable when the keyboard is open.",
        command: "impeccable adapt",
        effort: "S",
        previewKind: "search-bar",
      }),
      issue("resp-metric-strip-width", {
        title: "Relax the metric strip minimum width",
        severity: "P2",
        area: "Hero metrics",
        location: "components/dashboard-shell.tsx",
        impact: "The current `sm:min-w-[420px]` forces the summary area into a rigid shape earlier than necessary.",
        recommendation: "Let the metrics wrap or collapse more gracefully before they demand a wide row.",
        command: "impeccable adapt",
        effort: "M",
        previewKind: "metric-strip",
      }),
      issue("resp-results-table-overflow", {
        title: "Replace mandatory horizontal scrolling with a mobile table strategy",
        severity: "P1",
        area: "Subdomain results",
        location: "components/dashboard-shell.tsx",
        impact: "The main value of the feature lives in a table that requires horizontal scrolling on small screens.",
        recommendation: "Use stacked row metadata, priority columns, or a compact card-table hybrid below tablet widths.",
        command: "impeccable adapt",
        effort: "L",
        previewKind: "table-mobile",
      }),
      issue("resp-report-ideas-overflow", {
        title: "Give the fallback ideas table its own compact mobile mode",
        severity: "P2",
        area: "Report ideas",
        location: "components/dashboard-shell.tsx",
        impact: "The non-search state has the same overflow behavior as the results state, so the first mobile impression is already cramped.",
        recommendation: "Collapse secondary columns on mobile and present summary text above metrics when needed.",
        command: "impeccable adapt",
        effort: "M",
        previewKind: "table-mobile",
      }),
      issue("resp-account-row-overflow", {
        title: "Protect long values in the account card",
        severity: "P2",
        area: "Account module",
        location: "components/dashboard-shell.tsx",
        impact: "Email addresses and plan names can crowd the label/value layout on narrow widths.",
        recommendation: "Use balanced wrapping or a two-line stack when values exceed the available inline space.",
        command: "impeccable adapt",
        effort: "S",
        previewKind: "account-row",
      }),
      issue("resp-product-idea-grid", {
        title: "Make product idea rows more tolerant of text growth",
        severity: "P2",
        area: "Product ideas",
        location: "components/dashboard-shell.tsx",
        impact: "The fixed 220px label column makes the section less forgiving for longer category names or translated copy.",
        recommendation: "Use a more fluid split that can tighten or stack based on width and text length.",
        command: "impeccable adapt",
        effort: "S",
        previewKind: "split-row",
      }),
      issue("resp-sidebar-search-density", {
        title: "Reconsider the desktop-only secondary search field",
        severity: "P3",
        area: "Sidebar rail",
        location: "components/dashboard-shell.tsx",
        impact: "The extra search control adds chrome weight without helping mobile users or improving narrow-width scanning.",
        recommendation: "Either merge search responsibilities or convert the rail search into a compact command trigger.",
        command: "impeccable distill",
        effort: "M",
        previewKind: "sidebar-search",
      }),
      issue("resp-fixed-header-stack", {
        title: "Refine the two-layer mobile header stack",
        severity: "P2",
        area: "Mobile shell",
        location: "components/dashboard-shell.tsx",
        impact: "The stacked fixed bars consume a lot of vertical space before content even begins.",
        recommendation: "Condense the shell by merging functions or reducing vertical overhead on smaller screens.",
        command: "impeccable layout",
        effort: "M",
        previewKind: "toolbar",
      }),
    ],
  },
  {
    category: "Theming",
    issues: [
      issue("theme-sidebar-border-hardcode", {
        title: "Replace sidebar border hex values with shared tokens",
        severity: "P1",
        area: "Sidebar rail",
        location: "components/dashboard-shell.tsx",
        impact: "Hard-coded borders drift away from the established neutral scale and make global tuning harder later.",
        recommendation: "Use shared border tokens so chrome can evolve from one place.",
        command: "impeccable harden",
        effort: "S",
        previewKind: "token-contrast",
      }),
      issue("theme-sidebar-fill-hardcode", {
        title: "Unify sidebar fills under the surface token system",
        severity: "P1",
        area: "Sidebar rail",
        location: "components/dashboard-shell.tsx",
        impact: "Several `#111`, `#1a1a1a`, and `black` fills sit outside the token vocabulary.",
        recommendation: "Introduce sidebar-specific surface tokens or map existing values to current token roles.",
        command: "impeccable colorize",
        effort: "M",
        previewKind: "token-contrast",
      }),
      issue("theme-muted-text-hardcode", {
        title: "Replace `#888` text with tokenized muted roles",
        severity: "P2",
        area: "Sidebar and utility text",
        location: "components/dashboard-shell.tsx",
        impact: "One-off muted values make contrast tuning and future themes inconsistent.",
        recommendation: "Route every secondary text style through a tokenized muted scale.",
        command: "impeccable harden",
        effort: "S",
        previewKind: "token-contrast",
      }),
      issue("theme-white-action-button", {
        title: "Tokenize the white primary action instead of styling it inline",
        severity: "P2",
        area: "Header CTA",
        location: "components/dashboard-shell.tsx, components/ui/button.tsx",
        impact: "The top-right action looks good, but it is authored as an exception rather than a reusable variant.",
        recommendation: "Promote it to a named button variant backed by tokens, not ad-hoc classes.",
        command: "impeccable extract",
        effort: "M",
        previewKind: "button-variant",
      }),
      issue("theme-lookup-state-text", {
        title: "Move empty and error state copy off raw `text-neutral-400`",
        severity: "P2",
        area: "Lookup states",
        location: "components/dashboard-shell.tsx",
        impact: "The lookup state copy bypasses `--muted-foreground`, so it will not move with future theme calibration.",
        recommendation: "Use semantic text roles for helper and empty-state content.",
        command: "impeccable harden",
        effort: "S",
        previewKind: "empty-state",
      }),
      issue("theme-dark-mode-lock", {
        title: "Avoid hard-locking the project to dark mode only",
        severity: "P2",
        area: "Global theming",
        location: "app/globals.css, app/layout.tsx",
        impact: "The app has no pathway to test or support alternate themes because the root forces dark assumptions globally.",
        recommendation: "Separate palette definition from mode selection so future theme work is not boxed in.",
        command: "impeccable harden",
        effort: "L",
        previewKind: "theme-mode",
      }),
      issue("theme-status-accent-inline", {
        title: "Remove inline success accent colors from status badges",
        severity: "P2",
        area: "Badge system",
        location: "components/status-badge.tsx",
        impact: "A hard-coded blue accent bleeds implementation detail into a reusable component.",
        recommendation: "Express badge accents through token roles or badge variants rather than embedded color strings.",
        command: "impeccable extract",
        effort: "S",
        previewKind: "status-badge",
      }),
      issue("theme-sidebar-accent-governance", {
        title: "Formalize sidebar accent usage across interactive states",
        severity: "P3",
        area: "Sidebar identity accents",
        location: "app/globals.css, components/dashboard-shell.tsx",
        impact: "The accent color appears in a few spots, but the usage rules are implicit instead of systematized.",
        recommendation: "Define where accent can appear, how much surface it can occupy, and which states it should never dominate.",
        command: "impeccable colorize",
        effort: "M",
        previewKind: "sidebar-accent",
      }),
      issue("theme-card-border-uniformity", {
        title: "Differentiate elevated and base borders more deliberately",
        severity: "P3",
        area: "Cards and panels",
        location: "components/ui/card.tsx, components/dashboard-shell.tsx",
        impact: "Every panel shares nearly the same border weight and value, which compresses hierarchy.",
        recommendation: "Introduce a more intentional surface ladder so frame importance is legible at a glance.",
        command: "impeccable layout",
        effort: "M",
        previewKind: "surface-ladder",
      }),
      issue("theme-geist-mono-coverage", {
        title: "Use the mono stack consistently for technical values",
        severity: "P3",
        area: "Data presentation",
        location: "components/dashboard-shell.tsx, app/globals.css",
        impact: "Some infrastructure-flavored values use mono treatment while adjacent technical identifiers stay in the default sans stack.",
        recommendation: "Define when technical strings, counts, and identifiers should opt into the mono voice.",
        command: "impeccable typeset",
        effort: "S",
        previewKind: "table-density",
      }),
    ],
  },
  {
    category: "Anti-Pattern",
    issues: [
      issue("anti-card-grid-fatigue", {
        title: "Reduce the feeling of identical card stacks",
        severity: "P2",
        area: "Overall composition",
        location: "components/dashboard-shell.tsx",
        impact: "Too many similarly framed panels create a generic dashboard rhythm and flatten priority.",
        recommendation: "Let one or two sections break out of the full card treatment to create stronger editorial hierarchy.",
        command: "impeccable layout",
        effort: "L",
        previewKind: "card-stack",
      }),
      issue("anti-hero-metrics-template", {
        title: "Move beyond the default hero metric strip",
        severity: "P3",
        area: "Page hero",
        location: "components/dashboard-shell.tsx",
        impact: "The metrics follow a familiar SaaS template and do not contribute much narrative value.",
        recommendation: "Blend at least one richer explanatory module into the hero so the top of the page says something specific.",
        command: "impeccable bolder",
        effort: "M",
        previewKind: "metric-strip",
      }),
      issue("anti-search-duplication", {
        title: "Resolve the double-search pattern across sidebar and header",
        severity: "P2",
        area: "Navigation model",
        location: "components/dashboard-shell.tsx, components/search-input.tsx",
        impact: "Two search bars compete for attention but do different jobs without enough differentiation.",
        recommendation: "Either unify the mental model or visually subordinate one into a command-style affordance.",
        command: "impeccable distill",
        effort: "M",
        previewKind: "sidebar-search",
      }),
      issue("anti-generic-status-copy", {
        title: "Replace vague shell copy like `Graph online`",
        severity: "P2",
        area: "Header diagnostics",
        location: "components/dashboard-shell.tsx",
        impact: "The status indicator looks polished but does not actually tell the user what system is healthy or why it matters.",
        recommendation: "Name the system, the scope, and the state in one concise line.",
        command: "impeccable clarify",
        effort: "S",
        previewKind: "feedback-banner",
      }),
      issue("anti-report-type-wall", {
        title: "Break the report-type list into decision-oriented groups",
        severity: "P2",
        area: "Right rail",
        location: "components/dashboard-shell.tsx",
        impact: "The current list reads like a flat inventory instead of a guided set of report choices.",
        recommendation: "Group by intent, add a top recommendation, and visually rank the most common paths.",
        command: "impeccable clarify",
        effort: "M",
        previewKind: "card-stack",
      }),
      issue("anti-product-ideas-passive", {
        title: "Give product ideas more purpose or remove them from the primary scan path",
        severity: "P3",
        area: "Left column lower fold",
        location: "components/dashboard-shell.tsx",
        impact: "The section feels like filler beside the more actionable lookup and reports modules.",
        recommendation: "Either connect it to report creation or demote it into a secondary browse surface.",
        command: "impeccable distill",
        effort: "M",
        previewKind: "split-row",
      }),
      issue("anti-badge-noise", {
        title: "Trim decorative status chips where plain labels would do",
        severity: "P3",
        area: "Tables and cards",
        location: "components/dashboard-shell.tsx, components/status-badge.tsx",
        impact: "Too many small pills fragment the page into micro-signals that all feel equally important.",
        recommendation: "Reserve pills for volatile system states and simplify the rest into text hierarchy.",
        command: "impeccable quieter",
        effort: "M",
        previewKind: "status-badge",
      }),
      issue("anti-sidebar-density", {
        title: "Give the sidebar stronger grouping rhythm",
        severity: "P3",
        area: "Sidebar rail",
        location: "components/dashboard-shell.tsx",
        impact: "The current navigation is serviceable, but the visual rhythm is so even that priority and category boundaries blur together.",
        recommendation: "Use more intentional spacing, labels, and structural contrast between sections.",
        command: "impeccable layout",
        effort: "M",
        previewKind: "nav-state",
      }),
      issue("anti-empty-state-plainness", {
        title: "Make the lookup empty state feel product-specific",
        severity: "P3",
        area: "Lookup states",
        location: "components/dashboard-shell.tsx",
        impact: "The current empty state is competent but generic, which makes the feature feel less purposeful.",
        recommendation: "Add a little product voice, domain examples, and a clearer reason to keep trying.",
        command: "impeccable delight",
        effort: "S",
        previewKind: "empty-state",
      }),
      issue("anti-safe-table-header", {
        title: "Increase the results table’s technical character",
        severity: "P3",
        area: "Subdomain results",
        location: "components/dashboard-shell.tsx",
        impact: "The data works, but the table still feels like a standard admin list instead of an infrastructure intelligence surface.",
        recommendation: "Tighten column language, mono usage, row rhythm, and supporting metadata to make the table feel more intentional.",
        command: "impeccable typeset",
        effort: "M",
        previewKind: "table-density",
      }),
    ],
  },
];

const REPORT_ISSUES = ISSUE_GROUPS.flatMap((group) =>
  group.issues.map((entry) => ({ ...entry, category: group.category })),
);

const ISSUE_LOOKUP = new Map(REPORT_ISSUES.map((entry) => [entry.id, entry]));

const RECOMMENDED_COMMANDS = [
  {
    severity: "P1",
    command: "impeccable harden",
    description: "Fix accessibility semantics, keyboard flow, and error messaging first.",
  },
  {
    severity: "P1",
    command: "impeccable adapt",
    description: "Raise mobile target sizes and remove the current table overflow strategy.",
  },
  {
    severity: "P2",
    command: "impeccable clarify",
    description: "Sharpen labels, empty states, and shell feedback copy.",
  },
  {
    severity: "P2",
    command: "impeccable layout",
    description: "Improve hierarchy, panel rhythm, and row organization across the dashboard.",
  },
  {
    severity: "P3",
    command: "impeccable polish",
    description: "Run a final pass after the selected fixes land.",
  },
];

export function getReportSummary() {
  const total = SCORECARD.reduce((sum, row) => sum + row.score, 0);
  const severityCounts = REPORT_ISSUES.reduce(
    (accumulator, issueEntry) => {
      accumulator[issueEntry.severity] += 1;
      return accumulator;
    },
    { P0: 0, P1: 0, P2: 0, P3: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    scorecard: SCORECARD,
    totalScore: total,
    maxScore: SCORECARD.length * 4,
    ratingBand: total >= 18 ? "Excellent" : total >= 14 ? "Good" : total >= 10 ? "Acceptable" : total >= 6 ? "Poor" : "Critical",
    totalIssues: REPORT_ISSUES.length,
    severityCounts,
    antiPatternVerdict:
      "Passable, but still recognizably dashboard-template-first. The hierarchy is calmer than typical AI slop, yet the repeated cards, duplicated search affordances, and generic hero metrics keep it from feeling fully intentional.",
    executiveSummary: [
      "The new lookup flow is functional, but the information architecture still behaves like a general dashboard instead of a focused infrastructure workspace.",
      "Accessibility and responsive ergonomics need the first round of attention, especially skip links, focus visibility, live feedback, and touch target sizing.",
      "The token system is a solid start, but sidebar and utility surfaces still bypass it often enough that future polish would be slower than it needs to be.",
    ],
    recommendedCommands: RECOMMENDED_COMMANDS,
  };
}

export function getAuditContextFile(projectRoot) {
  return path.join(projectRoot, ".agents", "context", "impeccable-audit", "hidden-fixes.json");
}

export function loadHiddenFixes(projectRoot) {
  const stateFile = getAuditContextFile(projectRoot);

  if (!fs.existsSync(stateFile)) {
    return {
      dismissedIds: [],
      updatedAt: null,
    };
  }

  const rawFile = fs.readFileSync(stateFile, "utf8");
  const parsed = JSON.parse(rawFile);

  return {
    dismissedIds: Array.isArray(parsed.dismissedIds) ? [...new Set(parsed.dismissedIds)] : [],
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
  };
}

export function saveHiddenFixes(projectRoot, dismissedIds) {
  const stateFile = getAuditContextFile(projectRoot);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const normalizedIds = [...new Set(dismissedIds)].filter((entry) => ISSUE_LOOKUP.has(entry));
  const payload = {
    dismissedIds: normalizedIds,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function dismissFixes(projectRoot, ids) {
  const current = loadHiddenFixes(projectRoot);
  return saveHiddenFixes(projectRoot, [...current.dismissedIds, ...ids]);
}

export function restoreFixes(projectRoot, ids) {
  const current = loadHiddenFixes(projectRoot);
  const restoreSet = new Set(ids);
  return saveHiddenFixes(
    projectRoot,
    current.dismissedIds.filter((entry) => !restoreSet.has(entry)),
  );
}

export function getVisibleIssues(projectRoot) {
  const hiddenState = loadHiddenFixes(projectRoot);
  const hiddenSet = new Set(hiddenState.dismissedIds);

  return {
    hiddenState,
    issues: REPORT_ISSUES.filter((entry) => !hiddenSet.has(entry.id)),
  };
}

export function buildApplyPrompt(selectedIds) {
  const selectedIssues = selectedIds
    .map((entry) => ISSUE_LOOKUP.get(entry))
    .filter(Boolean);

  if (selectedIssues.length === 0) {
    return "No audit fixes selected.";
  }

  const bulletLines = selectedIssues.map((entry) =>
    `- [${entry.severity}] ${entry.title} (${entry.location})\n  Recommendation: ${entry.recommendation}`,
  );

  return [
    "Apply the following selected fixes from the interactive impeccable audit report.",
    "Keep the existing dashboard voice, tokens, and component language intact unless a selected fix explicitly changes them.",
    "",
    ...bulletLines,
    "",
    "After implementing, keep any unselected or dismissed findings untouched.",
  ].join("\n");
}

export function getIssueById(id) {
  return ISSUE_LOOKUP.get(id) ?? null;
}

export { REPORT_ISSUES, SCORECARD, RECOMMENDED_COMMANDS };

function issue(id, details) {
  return {
    id,
    title: details.title,
    severity: details.severity,
    area: details.area,
    location: details.location,
    impact: details.impact,
    standard: details.standard ?? "--",
    recommendation: details.recommendation,
    command: details.command,
    effort: details.effort,
    preview: {
      kind: details.previewKind,
      title: details.previewTitle ?? details.title,
    },
  };
}
