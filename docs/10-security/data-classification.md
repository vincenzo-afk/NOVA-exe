# Data Classification

## Purpose

Which handling rules apply to a given category of data NOVA touches —
credential storage, diagnostic-log exclusion, and the user-facing
privacy inventory. This is deliberately **not** an encryption-tiering
scheme: `docs/10-security/encryption.md` is explicit that memory is
encrypted uniformly with no "less sensitive" category exempted, and
nothing here overrides that. Classification here governs _other_
handling differences — what gets vaulted separately, what's excluded
from diagnostic logs, and what must appear in the privacy inventory —
not encryption strength.

## Scope

Data categories and which existing handling document governs each.
Encryption mechanics are `encryption.md`; credential vaulting mechanics
are `secrets.md`; diagnostic-log exclusions are docs/13-devops/
logging.md`.

## Categories

| Category                     | Examples                                                                        | Handling                                                                                                                                                                                                                                                                                               | Governing document                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Credentials**              | AI provider API keys, MCP server credentials, integration tokens                | OS-native credential vault, never in the structured store or diagnostic logs, referenced only by vault-entry pointer                                                                                                                                                                                   | `secrets.md`                                                                                                                                                 |
| **Observed content (raw)**   | Clipboard content, notification bodies, keystroke/mouse content, screen content | Keyboard/mouse content is never captured; clipboard and notification bodies are separately permission-gated and sensitive sources are excluded. Task-bound screen frames are session-ephemeral, never persisted or placed in diagnostic logs, and only approved derived observations may enter memory. | `docs/07-observers/clipboard.md`, `notifications.md`, `keyboard.md`, `mouse.md`, `docs/06-tools/desktop-agent.md`; exclusions in `docs/13-devops/logging.md` |
| **Memory content**           | Working/Recent/Long-term Memory entries, Knowledge Graph nodes/edges            | Encrypted uniformly at rest (`encryption.md`); every category collected here must appear in the user-facing data inventory (`docs/29-product/privacy.md`)                                                                                                                                              | `encryption.md`, `docs/29-product/privacy.md`                                                                                                                |
| **Audit/diagnostic records** | Audit log entries, diagnostic logs                                              | Audit is append-only and user-facing (`docs/10-security/audit.md`); diagnostic logs are shorter-retention and never transmitted by default (`docs/13-devops/logging.md`)                                                                                                                               | `docs/10-security/audit.md`, `docs/13-devops/logging.md`                                                                                                     |
| **Configuration values**     | Provider routing preferences, cost budgets, feature flag state                  | Not secret, but validated against `docs/14-development/configuration-schema.md`; a config value is never itself a place to store a credential (those always resolve to the vault, per `secrets.md`)                                                                                                    | `docs/14-development/configuration-schema.md`                                                                                                                |

## The rule this file exists to enforce

Every category of data NOVA collects must appear in exactly one row
above (or a new row added in the same change that introduces a new
category) — an uncategorized data category is how a credential ends up
in a diagnostic log, or a memory category ends up missing from the
privacy inventory, silently. This is the same "no orphan data" discipline
`docs/29-product/settings.md` already applies to settings screens
(1:1 mapping to an architecture doc); this file is the equivalent
mapping for data categories.

## Related documents

- `docs/10-security/encryption.md` — uniform encryption at rest (not a tiering scheme)
- `docs/10-security/secrets.md` — credential vaulting
- `docs/13-devops/logging.md` — diagnostic-log exclusions
- `docs/29-product/privacy.md` — the user-facing data inventory every memory-content category must appear in
- `docs/10-security/audit.md` — the audit trail's own append-only handling
