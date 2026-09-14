# Web App Scaffold Template

## Purpose

Defines a concrete, tested, one-shot deployable web-application workflow
template — project init through auth, billing stub, deploy config, and
SEO metadata — as the proof that NOVA's Workflow Engine can produce a
finished deliverable, not just a code scaffold the user has to assemble
themselves. This closes the gap against Manus's Web App Builder
(`docs/references/feature-gap-analysis.md`, row 9).

## Scope

A specific, first-class workflow definition, not a new engine
capability. Everything this template needs — parallel branches,
checkpointing, per-node timeouts — already exists in the Workflow Engine
(`workflow-engine.md`). This document specifies the template's stages
and what "finished" means for this deliverable type; it does not modify
the engine.

## Why this is a template, not a new primitive

NOVA already has strong deliverable generation for documents
(`docs/06-tools/` docx/pptx/xlsx/pdf skills) and a Workflow Engine
capable of arbitrary multi-step build processes. What's missing isn't
capability, it's a specific, proven, tested pipeline that takes "build me
a web app" all the way to something actually deployable — the same
"breadth of proven task coverage" gap `long-horizon-execution.md`
identifies for cross-application workflows generally, applied here to
one concrete, high-value target.

## Template stages

1. **Project init** — scaffold the application structure and dependency
   manifest for the chosen stack, following NOVA's existing code-
   generation tool conventions.
2. **Schema** — define the data model and generate the corresponding
   migration/setup, wired to whichever backing store the target stack
   uses.
3. **Auth** — wire a working authentication flow (not a stub comment
   saying "add auth here") using a standard, well-supported library for
   the target stack.
4. **Billing integration stub** — wire a billing provider's SDK and a
   minimal working checkout path, clearly marked as needing the user's
   own account credentials/keys before going live, but structurally
   complete rather than a placeholder function.
5. **Deploy config** — generate the deployment configuration for a
   mainstream target (container config, platform-specific manifest, or
   equivalent) so "deployable" is a concrete, testable claim, not an
   aspiration.
6. **SEO metadata** — generate baseline metadata (titles, descriptions,
   sitemap, robots configuration) wired into the generated pages, not a
   separate unused file.

Each stage is a node in the workflow DAG with its own verification step
(`docs/03-runtime/verifier.md`) — a stage is only considered complete
when its output is confirmed to actually work (schema migrates cleanly,
auth flow actually authenticates a test user, deploy config actually
builds), consistent with NOVA's general principle that a false "success"
is worse than a visible failure. A template that merely generates files
without confirming they function does not meet this bar.

## Permission scope

Generating a full application involves filesystem writes, dependency
installation, and potentially reaching out to third-party billing/deploy
provider APIs during setup — each of these routes through the normal
risk-tiered permission flow (`docs/10-security/permissions.md`) exactly
as any other tool use would; this template does not carry any implicit,
bundled authorization to install packages or make external API calls
beyond what the user has already granted.

## Credentials handling

The billing and deploy stages require third-party credentials (API keys,
account tokens) that NOVA does not generate on the user's behalf. The
template's output makes explicit exactly where and how the user supplies
these — following NOVA's existing secrets handling model
(`docs/10-security/secrets.md`) rather than asking the user to paste
credentials into a chat message or a generated file in plaintext.

## Relationship to long-horizon execution

This template is a natural candidate for the long-horizon task budget
class (`long-horizon-execution.md`) given its multi-stage, potentially
multi-minute-or-longer nature — it should checkpoint and report progress
per stage rather than running silently until either everything or
nothing is produced.

## Testing requirement

Before this template is considered complete, it must be run end-to-end
against at least one real target stack with every stage's verification
step passing, and the resulting application must actually build and
deploy — this is the same "prove it, don't just claim it" standard
`long-horizon-execution.md` sets for its own cross-application templates,
applied here to a single, higher-stakes deliverable type.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 9)
- `workflow-engine.md` — the DAG execution engine this template is defined against, unchanged
- `docs/03-runtime/verifier.md` — the per-stage verification requirement
- `docs/10-security/permissions.md`, `docs/10-security/secrets.md` — the permission and credential-handling rules this template follows
- `long-horizon-execution.md` — the task-budget class this template is a natural fit for, and the proof-not-claim standard it shares
