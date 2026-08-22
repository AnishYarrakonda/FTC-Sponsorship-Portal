# `prompts/audits/` — the Gemini audit pack

Sixteen deep audits of this app, written to be executed by an external **Gemini** agent that
finds and proves problems, and hands each one to Claude Code as a paste-ready fix prompt.

**To run one**, paste this into a Gemini agent on this repo:

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full, then execute
> `prompts/audits/prompts/A-01-auth-identity.md`. Obey the output contract exactly: write both
> files, then print the handoff prompt as one fenced block and nothing else.

Then copy the fenced block it prints and paste it into a fresh Claude Code terminal.

- `_CONTEXT-AUDIT.md` — the contract: safety rules, severity scale, evidence standard, and the
  exact output format. Every audit reads it first.
- `_RUNNER-AUDIT.md` — the audit list, lanes, and running order.
- `prompts/` — the 16 audits. `A-01`–`A-12` are static and run in parallel; `B-01`–`B-04` need
  the live stack and run one at a time (`prompts/_LANE-B-SETUP.md`).
- `findings/`, `handoff/` — Gemini's output. Empty until an audit runs.
