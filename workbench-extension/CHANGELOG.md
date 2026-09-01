# Changelog

## 0.4.5 — 2026-09-01

- Generalize operator identity in the Command Deck via the `generalstaff.operatorDisplayName` setting.
- Default-unset surfaces read "Needs You" and use a neutral avatar glyph; configured names personalize the attention queue and avatar initials.

## 0.4.4 — 2026-08-30

- Route the Grok 4.6 trial seat through the Grok subscription CLI as its primary runner.
- Retain the Cursor `cursor-grok-4.6-{effort}` named-model door as ordered discovery-time fallback.
- Enforce the verified Grok headless invocation contract: plain output before `-p`, provider-default effort, no model override, and `bypassPermissions` only for write-consented runs.
