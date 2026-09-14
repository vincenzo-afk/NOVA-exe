# Computer-Use Superiority: Why NOVA's PC Control Is the Differentiator, Not Just a Feature

## Purpose

Ties together NOVA's existing execution-tier architecture into a single,
explicit answer to "which agent controls a computer best" — the
practical framing behind the broader competitive analysis
(`docs/references/feature-gap-analysis.md`). This document does not add
a new mechanism. It states, in one place, why the mechanisms already
specified elsewhere (the tiered execution chain, verification, the
World Model, and the permission architecture) add up to a stronger and
more trustworthy claim on "controls the PC" than an agent that operates
purely as simulated keyboard/mouse input, however capable that agent's
underlying model is.

## Scope

A synthesis and index, not a new subsystem. Every mechanism referenced
here is fully specified in its own document; this document's job is to
state why their combination is the actual competitive edge, so the
claim is never made loosely elsewhere without pointing back to the real
architecture behind it.

## The core claim, stated precisely

An agent that operates a computer exclusively through simulated human
input (screenshot in, click/type out) is doing the least reliable thing
possible at every step — it has no structural signal about what it's
acting on and inherits none of the target application's own safety
checks. NOVA's `execution-priority.md` tier chain (Native Runtime →
Internal Functions → API → MCP → CLI → Accessibility → Vision →
Keyboard/Mouse) treats that mode as the **last resort**, used only when
every more reliable, more structured mechanism is confirmed unavailable
for the specific action at hand. This is the opposite default from an
agent architected around "acts like a human user" as its primary mode —
and it is the concrete, buildable reason NOVA can claim to control a PC
*better*, not just as capably.

## The four pillars

1. **Deterministic-first execution** (`execution-priority.md`,
   `docs/05-ai/deterministic-first.md`) — every action prefers the most
   structured, most verifiable mechanism available for that specific
   application, falling back to vision-guided input only when nothing
   else works. This is strictly stronger than an architecture that
   treats screen-and-input as the primary interface to everything.
2. **Ground-truth verification, not assumed success**
   (`docs/03-runtime/verifier.md`) — every action's outcome is confirmed
   through a ground-truth signal wherever one exists, with vision-based
   re-inspection only as a secondary fallback. An agent that doesn't
   independently confirm its own actions worked is one hallucinated
   "success" away from silently corrupting the user's work; NOVA's
   Verifier is what stands between "the click was sent" and "the click
   did what it was supposed to."
3. **Live, causally-attributed state awareness** (`docs/03-runtime/world-model.md`)
   — before any low-tier input action fires, NOVA re-validates current
   window/focus state against what's actually true right now, not what
   was assumed at planning time (`automation.md`'s pre-action
   validation). An agent operating blind to the user having switched
   windows mid-task is a correctness and safety problem NOVA's
   architecture specifically closes.
4. **Auditable, revocable, risk-tiered permissioning**
   (`docs/10-security/permissions.md`) — every tier, and every
   authenticated-session action specifically (`authenticated-session-audit.md`),
   is gated and traceable. Full, unconditional OS control with no
   described permission model — the framing several competitors use — is
   a worse product for the large majority of users who are not
   comfortable handing over unrestricted control, even if it is
   marginally faster for the minority who are.

## What "better than any multimodal agent" actually means here

This document deliberately does not claim NOVA's underlying vision or
reasoning models are more capable than any competitor's — that claim
depends on whichever provider is configured
(`docs/18-providers/provider-interface.md`) and is outside NOVA's own
architecture to guarantee. What NOVA's architecture *can* guarantee,
independent of which model is behind it, is that **any** multimodal
model NOVA uses inherits this four-pillar discipline automatically: a
weaker model routed through the deterministic-first tier chain, with
Verifier confirmation and World Model revalidation around it, will make
fewer unrecoverable mistakes than a stronger model given raw,
unverified, unvalidated screen control. The architecture is the
multiplier, not a substitute for model quality — which is exactly why
this is a durable structural advantage rather than something that
evaporates the moment a competitor ships a better underlying model.

## Long-horizon operation

For sustained, multi-hour, multi-program work specifically —
`GPT-6 Astra`'s headline framing — the same four pillars apply per-step
across the entire duration (`long-horizon-execution.md`), plus periodic
progress surfacing so a long unattended run is never a black box between
its start and its end. Duration does not relax verification or
permissioning at any point in the run; a long-horizon task is the same
discipline sustained, not a different, looser mode.

## What this document explicitly rules out

Consistent with `docs/references/feature-gap-analysis.md`'s "what NOVA
should not copy" section: none of this is a justification for building
toward unassisted offensive capability, blanket authenticated-session
automation without an audit trail, or removing confirmation gates in the
name of raw speed. The claim this document makes is that reliability,
verifiability, and auditability *are* the competitive advantage — trading
them away for a marginal speed or autonomy claim would undermine the
actual thesis of this document, not strengthen it.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document's framing supports
- `docs/06-tools/execution-priority.md` — the tiered execution chain this document's core claim rests on
- `docs/05-ai/deterministic-first.md` — the general principle behind tier ordering
- `docs/03-runtime/verifier.md` — the ground-truth verification pillar
- `docs/03-runtime/world-model.md`, `docs/06-tools/automation.md` — the state-revalidation pillar
- `docs/10-security/permissions.md`, `docs/06-tools/authenticated-session-audit.md` — the permissioning pillar
- `docs/03-runtime/long-horizon-execution.md` — sustained operation under the same four pillars
- `docs/18-providers/provider-interface.md` — where model choice, distinct from this architecture, is configured
