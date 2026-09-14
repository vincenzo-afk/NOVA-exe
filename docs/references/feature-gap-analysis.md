# Feature Gap Analysis: NOVA vs. the Field (September 2026)

## Purpose

Records the competitive analysis behind NOVA's current autonomy,
perception, resilience, and reach roadmap, and indexes the detailed
implementation documents it produced. This is a point-in-time research
snapshot (researched September 13, 2026), not a living spec — the
authoritative specs are the linked documents in each section below;
this file should be treated as the "why" and the priority ordering,
updated only when the competitive picture materially changes.

## Scope

Cross-agent capability comparison and prioritization only. Each gap's
actual design lives in its own document, linked below, following NOVA's
normal one-concept-per-document convention.

## Who was compared

| Agent | Maker | Known for |
|---|---|---|
| GPT-6 Astra | OpenAI (Sept 2026) | Direct OS-level computer operation across browsers/programs; unsupervised multi-step workflows |
| Project Astra | Google DeepMind (research prototype) | Real-time multimodal (audio+video) perception, physical-world spatial understanding, proactive assistance, cross-session memory |
| OpenClaw | OpenClaw Foundation (MIT-licensed, community) | Always-on runtime: durable task orchestration with heartbeat/auto-recovery, session rewind/branching, pinned multi-agent dashboards, broad platform reach |
| Manus | Butterfly Effect / Monica | Disposable per-task virtual computer operating inside the user's own authenticated web sessions; finished deliverables (full web apps with billing/SEO wired up) |
| Hermes Agent | Nous Research (self-hosted, MIT-licensed) | Closed learning loop (writes reusable skills from completed tasks), cron scheduling, seven pluggable sandboxed execution backends, multi-bot "Bot Mode" |

## Reading this table

For each row: what NOVA already does as well as or better than the
comparison (a real strength, not just a gap to close), and where the
detailed design lives.

| # | Capability | Verdict for NOVA today | Detailed design |
|---|---|---|---|
| 1 | Autonomous skill learning from completed tasks | Biggest gap — nothing exists today | `docs/23-autonomy/skill-learning.md` |
| 2 | Long-horizon OS-level computer use | Closer to a strength than a gap; missing proven breadth/duration | `docs/03-runtime/long-horizon-execution.md` |
| 3 | Physical-world spatial perception (camera) | No physical-space model exists; desktop `world-model.md`'s "spatial" is deliberately scoped to windows only | `docs/20-devices/spatial-perception.md` |
| 4 | Heartbeat monitoring / crash auto-recovery | Already stronger than the field — `TaskCheckpointStore.recoverAfterCrash()` re-validates rather than blindly resuming | (existing: `docs/03-runtime/task-persistence.md`) |
| 4b | Session fork/rewind/branching | Missing as a user-facing feature; checkpoint data already exists | `docs/17-workflow/session-fork-rewind.md` |
| 5 | Multi-agent delegation / specialist bot teams | Designed at the doc level; implementation status needed verification | `docs/24-collaboration/subagent-orchestration.md` |
| 6 | Diverse sandboxed execution backends | Documented CLI surface (`nova sandbox`) with no backing module | `docs/16-extensibility/execution-backends.md` |
| 7 | Pinned multi-agent live dashboard | Task Monitor exists; pinned multi-tile "mission control" view does not | `docs/40-screens/mission-control-dashboard.md` |
| 8 | Authenticated-session web automation | Mechanism likely already exists via the browser extension; audit trail needed to be an honest advantage rather than Manus's own flagged weakness | `docs/06-tools/authenticated-session-audit.md` |
| 9 | One-shot deployable web app generation | Workflow Engine already supports it structurally; no proven template exists | `docs/17-workflow/web-app-scaffold-template.md` |
| 10 | Messaging/channel reach | Three adapters (Telegram, Discord, WhatsApp) behind a good interface; count is the gap | `docs/21-channels/channel-adapter-expansion.md` |
| 11 | Vision-task benchmarking vs. Project Astra | No public Astra benchmark exists to chase; this is a capability comparison, not a leaderboard | `docs/46-ai-evaluation/vision-benchmarking.md` |

## What NOVA should not copy

Not every competitor feature is worth having:

- **Unassisted offensive cybersecurity capability** (finding unknown
  vulnerabilities, building working exploits) is out of scope regardless
  of what any competitor ships — it contradicts NOVA's own scope as a
  personal assistant (`docs/00-overview/non-goals.md`). Defensive/
  diagnostic security work for the user's own projects remains in scope.
- **Shared sessions without network/filesystem security boundaries** —
  copying a capability without its missing safeguard is copying a
  documented mistake, not a feature.
- **Blanket authenticated-session automation with no audit trail** —
  build the capability (row 8) with the audit trail from day one, not as
  a follow-up.

## Priority order

1. Skill learning (row 1) — the one genuine structural advantage, not
   just parity; builds directly on existing Workflow Engine, entity
   resolution, and schema infrastructure.
2. Spatial perception (row 3) — closes the most concretely confirmed
   gap and is the direct answer to "beat the vision tasks."
3. Sandboxed execution backends (row 6) — currently a documented but
   unimplemented CLI command; closing it also unblocks plugin testing.
4. Channel adapter breadth (row 10) — lowest engineering risk, proven
   interface, purely additive.
5. Session fork/rewind (row 4b) — small addition given existing
   checkpoint data.
6. Everything else, gated on verifying row 5's implementation status
   first.

## Related documents

- `comparisons.md` — the general categorical positioning this document extends with specific, dated competitor detail
- `inspirations.md` — design-pattern lineage, distinct from competitive gap-closing
- `docs/00-overview/non-goals.md` — the boundary that determines what NOT to copy
