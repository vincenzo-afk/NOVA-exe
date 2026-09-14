# Authenticated-Session Web Automation Audit Trail

## Purpose

Specifies the audit-trail requirement for any NOVA action taken inside
the user's own authenticated browser sessions — the mechanism Manus is
known for, and the exact open question Manus's own coverage flags about
it: when an agent acts inside a user's real login, who did what stops
being cleanly answerable unless the agent makes it answerable on purpose
(`docs/references/feature-gap-analysis.md`, row 8). The differentiator
NOVA builds here is the audit trail, not the automation mechanism itself
— the mechanism most likely already exists.

## Scope

The tracing and permission requirements for authenticated-session
browser actions. The browser extension's automation mechanism itself
(`apps/browser-extension/`, `docs/06-tools/automation.md`) is unchanged;
this document specifies what must be recorded and gated around it, not
how clicks and form fills are executed.

## The honest starting point

The browser extension operating in the user's real, logged-in browser
context is the same mechanism that makes Manus powerful and is
explicitly the same mechanism Manus's own coverage says makes "who did
what" unanswerable once it's in use. Copying the capability without
copying the missing safeguard would be copying a documented weakness,
not a feature — this document exists specifically so that does not
happen.

## Mandatory span emission

Every authenticated-session action taken through the browser extension
emits a `nova.tool` span (`packages/shared/src/tracer.ts`) that
carries, at minimum:

- **Which site** the action was taken on.
- **Which authenticated identity** was in use (the logged-in account the
  action operated as, not just "the browser").
- **What action was taken** (navigation, form submission, click,
  data read) at a level specific enough to reconstruct intent from the
  trace later, not merely "browser action occurred."

This is not optional instrumentation added after the fact — an
authenticated-session action with no corresponding span is treated as a
tracing defect, the same severity NOVA already treats missing
verification signals as (`docs/03-runtime/verifier.md`). This closes
exactly the accountability gap Manus's own coverage identifies: `nova
traces <correlation-id>` is always able to answer "who did what,"
because the record exists at action time, not reconstructed after.

## Risk-tiered confirmation, not blanket approval

Enabling browser automation at all must never function as blanket
approval for every subsequent authenticated action. High-risk actions —
anything that submits a form, completes a purchase, or sends a message
on the user's behalf — route through the existing risk-tiered
permission/confirmation flow (`docs/10-security/permissions.md`),
evaluated **per domain**, not granted once for the browser extension as
a whole. A user who authorizes NOVA to read their authenticated email
inbox has not thereby authorized NOVA to submit a purchase on an
unrelated authenticated shopping site — each domain's action-tier
requires its own grant, tracked through the same permission-grant store
already used elsewhere (`services/runtime/src/permission-grant-store.ts`).

## Read vs. write distinction

Consistent with the general permission model, read-only authenticated
actions (viewing a page, extracting information already visible to the
logged-in user) are a materially lower risk tier than write actions
(submitting, purchasing, messaging, deleting) and are gated
accordingly — this mirrors the same risk-tier distinction already
applied elsewhere in NOVA's permission model rather than treating "uses
an authenticated session" as a single undifferentiated risk category.

## What this document deliberately does not do

This document does not attempt to prevent all possible misuse of an
authenticated session — that is a fundamentally shared-risk property of
any tool that can act as the logged-in user, including Manus's own. What
it requires is that every such action is **traceable and
individually gated**, so misuse is detectable and unauthorized actions
require an explicit grant, rather than silently accepted as an
inevitable cost of the capability.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 8)
- `docs/06-tools/automation.md` — the underlying browser automation mechanism this document adds accountability around, unchanged
- `packages/shared/src/tracer.ts` — the span-emission mechanism every authenticated action must use
- `docs/10-security/permissions.md`, `services/runtime/src/permission-grant-store.ts` — the per-domain, risk-tiered confirmation flow
- `docs/03-runtime/verifier.md` — the severity precedent (missing signal treated as a defect) this document's mandatory-span requirement follows
