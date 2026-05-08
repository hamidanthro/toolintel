# Prompts

Canonical SYSTEM_PROMPT specs for Claude (lambda runtime) and cold-start scripts.

Each file here is the source of truth for a prompt that gets injected into
LLM calls. Lambda code, cold-start scripts, and judge code all reference
these — never copy-paste prompt text into JS files.

## Conventions

- Filenames: `<role>-<vN>.md` (e.g., `science-judge-v1.md`).
- Version bumps when prompt content changes materially. Stamp existing
  pool rows with `_judgeVersion` so re-judging on prompt updates is automatic.
- Each file starts with metadata: model, temperature, inputs, outputs,
  hard rules.

## Current prompts

| File | Used by |
|---|---|
| `science-judge-v1.md` | (pending) science judge in lambda + cold-start |

## Related

- `../docs/knowledge-packs/texas-science.md` — canonical KP injected into
  generator + judge at runtime
- `../state-packs/texas/standards/teks-science.json` — machine-readable TEK
  index (legacy, [CLAUDE-SYNTHESIZED])
