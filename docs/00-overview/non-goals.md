# Non-Goals (v2)

## Purpose

An earlier architectural review of this project identified unbounded scope
as the central risk to NOVA ever shipping, and v1 responded with a strict,
narrow non-goal list. That list did its job: v1 shipped. This v2 revision,
ratified by `docs/15-decisions/adr-0008-v5-architecture-evolution.md`,
deliberately repeals or narrows several v1 exclusions in response to a
substantially expanded product direction (multi-device, multi-channel,
voice, autonomous capability growth). The discipline that produced v1
remains: anything still on this list requires a new ADR to remove, and
nothing is added back by accretion inside an unrelated feature.

## Scope

Applies to the current architecture. Items here are not judgments that
excluded capabilities are bad ideas; they are excluded so the current
scope stays buildable, verifiable, and secure.

## Repealed from v1 (now in scope — see the docs cited)

- ~~Not cross-platform~~ → macOS/Linux full-peer support and an Android
  companion are now in scope, each a distinct, separately scheduled
  engineering effort (`docs/20-devices/multi-device-architecture.md`).
- ~~Not multi-device~~ → in scope, with an explicit sync and conflict
  model (`docs/20-devices/multi-device-architecture.md`,
  `docs/20-devices/cross-device-memory.md`).
- ~~Not a schema-flexible, self-extending system~~ → narrowed, not
  repealed: the **capability/plugin surface** may now grow at runtime
  (`docs/23-autonomy/self-growing-capability.md`); the **knowledge-graph
  ontology remains fixed and versioned** (see below — this part of the
  original exclusion stands).
- ~~No multi-agent orchestration~~ → in scope as an execution mode of the
  existing runtime (`docs/24-collaboration/multi-agent-collaboration.md`).

## Narrowed from v1

- **"Not AI-first" → "deterministic-first, not deterministic-only."**
  NOVA still prefers deterministic execution whenever a deterministic path
  exists (`docs/05-ai/deterministic-first.md`). This no longer forbids
  inherently language/perception-mediated interfaces (voice, background
  proactive assistance) where no deterministic alternative exists for the
  task itself.
- **"Not adaptive behavior" → bounded adaptive policy, not model
  training.** Personalization gains policy-level adaptation
  (`docs/23-autonomy/adaptive-personalization.md`) while the "not
  fine-tuned on user data" exclusion below remains fully intact.

## Still-standing exclusions

### Platform and deployment
- **Not a hosted/cloud multi-tenant service.** NOVA runs locally, on the
  user's own devices. There is no NOVA-operated backend that stores user
  data; multi-device sync is user-endpoint-to-user-endpoint
  (`docs/20-devices/cross-device-memory.md`), and any cloud provider usage
  is the user's own account.
- **Not multi-user.** Each identity gets an independent NOVA workspace,
  now spanning multiple *devices* but still not shared across multiple
  *people* on one workspace.

### AI and personalization
- **Not fine-tuned or trained on user data.** No component trains or
  adjusts model weights based on user activity, including the new
  adaptive-personalization layer (`docs/23-autonomy/adaptive-personalization.md`),
  which is retrieval- and policy-rule-based only. Changing this still
  requires a new ADR, because it changes the privacy and cost posture of
  the entire system.
- **Not a general chit-chat companion.** NOVA remains a tool, even as its
  interfaces (voice, proactive briefings) become more conversational.
  Adaptive personalization is explicitly barred from softening honest
  feedback or fostering dependency (`docs/23-autonomy/adaptive-personalization.md`).

### Execution
- **Not a general-purpose RPA platform for arbitrary third-party
  applications.** Vision-based control remains scoped to an explicit,
  maintained allow-list across every vision source — desktop, phone,
  browser (`docs/06-tools/vision-everywhere.md`) — not "any application on
  any surface."
- **Not first-choice GUI automation.** Vision and keyboard/mouse control
  remain the last resort in the execution priority chain, including for
  phone app control, which prefers Android Intents/deep links over
  Accessibility-Service simulation (`docs/20-devices/android-companion.md`).
- **Not unconfirmed destructive action.** No phase of NOVA executes an
  irreversible action without explicit user confirmation — restated
  explicitly for every new irreversible-action surface this revision adds:
  sending email (`docs/21-channels/email-assistant.md`), placing calls
  (`docs/21-channels/phone-calls.md`), installing software
  (`docs/23-autonomy/automatic-software-installation.md`), and opening a
  remote-control session (`docs/20-devices/remote-control.md`).
- **Autonomy is bounded to discovery and proposal, never unattended
  installation or irreversible action.** NOVA may search for and propose
  a plugin, MCP server, or application on its own initiative
  (`docs/23-autonomy/autonomous-plugin-discovery.md`), but every install
  and every irreversible action still requires explicit confirmation with
  no configuration override.

### Memory and data
- **Not unbounded raw data retention.** Unchanged, and explicitly extended
  to the new vision sources (`docs/06-tools/vision-everywhere.md`) and
  screen-streaming (`docs/20-devices/screen-streaming.md`): raw frames are
  not retained by default, only derived structured observations.
- **Not a schema-flexible, self-extending knowledge graph.** The ontology
  remains fixed and versioned (`docs/04-memory/ontology.md`); the Planner
  still cannot invent new node or edge types at runtime. Only the
  capability/plugin surface gained runtime extensibility — this
  distinction is load-bearing and is restated in
  `docs/23-autonomy/self-growing-capability.md`.

### Product identity
- **Not a database replacement**, **not a Git replacement**, **not an
  autonomous financial decision-maker**, **not an unsandboxed code
  executor**, **not a guarantor of factual correctness**, **not a bypass
  of human approval** — all unchanged from v1, and all explicitly
  reaffirmed for every new capability domain in this revision. In
  particular, automatic software installation
  (`docs/23-autonomy/automatic-software-installation.md`) and autonomous
  plugin discovery (`docs/23-autonomy/autonomous-plugin-discovery.md`)
  execute inside the same sandboxing model as any v1 tool
  (`docs/10-security/sandboxing.md`, `docs/16-extensibility/plugin-sandboxing.md`).

## What this document does not mean

Excluding something here does not mean it is unimportant or will never
exist — it means it is not currently being built, and no other document in
this repository may assume otherwise. If a document elsewhere in this
repository appears to contradict this list, this list is authoritative
until a new ADR changes it.

## Related documents

- `vision.md` — what NOVA is (the positive complement to this list)
- `goals.md` — the concrete, in-scope targets by phase
- `docs/01-product/project-scope.md` — the product-level restatement of
  this boundary for a non-engineering audience
- `docs/04-memory/persistent-user-model.md` — restates and depends on the
  "not fine-tuned on user data" exclusion while indexing every subsystem
  that otherwise makes up NOVA's structured, retrieved-not-trained user
  model
- `docs/15-decisions/adr-0001-project-scope.md` — the original v1 ADR
- `docs/15-decisions/adr-0008-v5-architecture-evolution.md` — the ADR
  that repealed/narrowed the items above
