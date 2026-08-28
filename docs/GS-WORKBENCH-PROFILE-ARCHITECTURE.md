# GeneralStaff Workbench — public code, private operator profile

**Decision:** keep one public Workbench codebase and package. Do not maintain a
second private application fork.

The public repository should own the UI, safety boundaries, provider adapters,
profile schema, discovery logic, and first-run setup. A machine-local operator
profile should decide which installed subscriptions appear, which model and
effort defaults each lane uses, and which GeneralStaff root the Workbench opens.
An optional bootstrap file may live in a private repository, but it must contain
configuration only—not application code or credentials.

## Why this boundary

Two application forks would drift in exactly the areas that matter most:
security fixes, provider invocation changes, conversation persistence, and
visual behavior. A profile overlay gives the operator a ready-to-run private
desk while keeping every product fix on the public code path.

The profile also matches the two real onboarding states:

- A public install begins empty, discovers supported CLIs, and asks the user to
  connect or configure only the subscriptions they have.
- A private operator install loads an allowlisted profile of known lanes,
  defaults, and labels, then verifies each one locally. Exceptional binary
  overrides remain a separate machine-scoped setting.

## Proposed layers

### 1. Public Workbench package

The VSIX contains:

- conversation, decision, recovery, receipt, and permission-boundary logic;
- built-in adapters for supported provider CLIs;
- the six Workbench palettes;
- a versioned provider-profile schema and validator;
- first-run discovery and setup UI.

No operator identity, private repository path, subscription roster, token, or
provider credential belongs in the package.

### 2. Machine-local Workbench profile

Add a machine-scoped `generalstaff.providerProfilePath` setting. The referenced
JSON file should allow only declarative values such as:

- enabled built-in lane IDs;
- display labels and evidence labels;
- preferred built-in runner for a lane;
- model ID and supported effort default;
- ordering and job-shaped seat availability.

The profile must not accept arbitrary command templates, shell fragments, or
executable paths. An exceptional binary-path override belongs in a separate
machine-scoped VS Code setting, is never imported from a repository profile,
and remains subject to the built-in lane probe before Workbench can spawn it.
Model and effort values must be validated against the selected built-in
adapter. Authentication remains owned by each provider CLI and the operating
system keychain.

### 3. Optional private bootstrap overlay

The private GeneralStaff repository may carry a non-secret profile template and
a launcher that points the isolated VS Code profile at it. Machine-specific
absolute paths should be generated locally or stored in ignored state. This
overlay can make the operator's subscriptions ready on first launch without
creating a private product fork.

## Current v2.3 position

Workbench already auto-discovers authenticated local CLIs. Codex explicitly
selects GPT-5.6 Sol. The Fable lane prefers the authenticated Claude CLI and
falls back to the authenticated Cursor subscription with an explicit Fable 5
model. Effort choices are lane-specific and validated in both the webview and
extension host.

The selected GeneralStaff root now supplies two private runtime overlays without
creating a private application fork:

- canonical `skills/*/SKILL.md` procedures are discovered and compiled in the
  extension host only, with no private contents entering the VSIX or webview;
- allowlisted Headroom and Lane Desk installations are detected locally and
  passed ephemerally to lanes with a native MCP transport. Lane Desk has a
  bounded read-only CLI fallback for other lanes; Headroom does not use its
  prohibited proxy/wrap modes as a fallback.

What remains before the public/private boundary is complete:

1. Add the versioned profile schema and `providerProfilePath` machine setting.
2. Move operator-specific lane ordering, evidence labels, and defaults out of
   the public lane catalog into a private profile template.
3. Add first-run setup that starts with no assumed subscriptions and reports
   installed, authenticated, and unsupported states without exposing secrets.
4. Add import/export for non-secret profile settings and migration tests.

Until those pieces land, v2.3 is safe to package publicly but its provider
catalog still reflects the operator-oriented default bench rather than a fully
neutral first-run configuration.
