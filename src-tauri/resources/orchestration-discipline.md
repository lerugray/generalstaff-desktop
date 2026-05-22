# Orchestration context discipline

If you are running as an **orchestrator** — a long-lived session that
coordinates work across tasks rather than doing the detailed work
itself — the rules below keep your context window lean so the session
lasts. They do not apply to a focused single-task session, where you
should read whatever you need.

An orchestrator runs out of context not from its instructions but from
tool results piling up in-window. The worst offenders: images read as
raw files, unfiltered shell output, and large whole-file reads.

1. **Delegate heavy work to throwaway subagents.** Anything that pulls
   a lot of content into the window — reading code files, multi-file
   investigation, large-file reads, web research, visual checks — goes
   to a subagent. It works in its own disposable context and returns a
   short text result. You keep the result, not the raw material.

2. **Never read an image into the orchestrator.** A single screenshot
   can cost tens of thousands of tokens. Visual checks go to a subagent
   that looks and returns a plain-text verdict.

3. **Filter every shell command.** Pipe to `head` / `tail` / `grep`,
   use `--oneline`, `-n`, `--stat`. Never let a raw log, file dump, or
   long listing land in the window unfiltered.

4. **Cap subagent reports.** State a hard length limit in every
   subagent prompt — roughly 500 words. A subagent that needs to say
   more is mis-scoped: split the task, or re-run it.

5. **Prefer compressed, targeted reads.** For files you open yourself,
   read only the part you need — a line range, a signature listing, a
   structural map — not the whole file.

6. **Route routable work to cheaper model tiers where available.**
   Summaries, drafts, mechanical edits, and structured extraction do
   not need the top tier. Reserve the strongest model for genuine
   reasoning and judgment.

7. **Write plain, terse output.** No jargon, no ceremony, no restating
   the question, no hedging padding.
