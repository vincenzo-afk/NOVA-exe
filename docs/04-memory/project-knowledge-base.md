# Project Knowledge Bases

## Purpose

Lets a project's own codebase, issue tracker, and documentation become
retrievable memory — "what's the status of the X feature?" answered by
actually searching code, issues, docs, and recent commits — closing a
gap this project doesn't currently specify: the memory architecture
(`docs/04-memory/`) is built around personal/conversational memory, not
ingestion of an external corpus the size of a repository.

## Scope

Ingestion, indexing, and retrieval for a bounded, user-designated
external corpus (a repository, an issue tracker, a documentation site).
Does not change personal memory's architecture — a project knowledge
base is a **separate, explicitly-scoped index**, not an extension of
the personal Knowledge Graph, for the reasons below.

## Why this is a separate index, not more Knowledge Graph nodes

Personal memory is built to represent a bounded number of durable facts
about one person's life, with confidence decay and lifecycle rules
tuned for that scale and shape (`docs/04-memory/memory-lifecycle.md`).
A codebase can be hundreds of thousands of lines across thousands of
files, churning on every commit — indexing it as Knowledge Graph nodes
would violate that architecture's actual design assumptions and degrade
retrieval for everything else stored there. A project knowledge base is
instead its own retrieval index, using the same underlying embedding
and retrieval mechanics (`docs/04-memory/embeddings.md`,
`docs/04-memory/retrieval-engine.md`) but a **separate store**,
scoped per project and explicitly attached or detached by the user —
never auto-discovered or auto-indexed from an arbitrary filesystem
location.

## Ingestion

A user designates a source (a local repository path, a connected issue
tracker, a documentation folder or site) to index. Ingestion:

- **Code** — chunked by natural boundaries (function/class/module, not
  fixed-size windows), each chunk embedded and indexed with its file
  path and location, so a match can be resolved back to an exact,
  openable location the way any other file reference in this project
  already is.
- **Issues** — ingested via whichever tracker's own API is connected
  (following `docs/18-providers/provider-interface.md`'s pattern, the
  same as any other external system this project integrates with), with
  state (open/closed, labels, assignee) kept as structured metadata
  alongside the embedded text, not flattened into prose.
- **Documentation** — ingested the same way markdown/HTML content is
  processed elsewhere in this project (matching the doc skills'
  existing text-extraction conventions).
- **Recent commits** — a rolling window of recent commit messages and
  diffs, refreshed incrementally rather than requiring a full
  re-ingestion of the whole repository on every change — a full re-index
  runs periodically or on explicit request, not on every commit.

Ingestion never includes secrets or credential files — the same
exclusion patterns already applied to filesystem access generally
(`docs/10-security/secrets.md`, path containment enforcement in
`docs/10-security/permissions.md`) apply here, so a `.env` file or
credentials directory is never embedded and indexed just because it
happens to sit inside the designated repository path.

## Retrieval and grounded answers

"What's the status of the X feature?" resolves as a retrieval query
against this index — pulling the most relevant code, issue, and doc
chunks — followed by an ordinary Claude call grounded in exactly what
was retrieved, using the same citation discipline this project already
requires for grounded answers generally: an answer states what the
retrieved chunks actually show, distinguishes an issue's *current*
state from a stale cached one (checked via the tracker's live API where
freshness matters, not solely the last-indexed snapshot), and does not
fill gaps with plausible-sounding invention when the index doesn't
contain the answer.

## Freshness and staleness

Because a codebase changes continuously, every retrieved chunk carries
its last-indexed timestamp, and the retrieval layer prefers fresher
chunks the same way general memory retrieval prefers recent, corroborated
facts over stale ones (`docs/04-memory/memory-confidence.md`'s
staleness model, applied here to code/doc chunks instead of personal
facts) — an answer about "the X feature" built from a chunk indexed
before a relevant recent commit is a known risk this document doesn't
pretend away; the incremental commit-window ingestion above exists
specifically to keep that gap small.

## Related documents

- `docs/04-memory/embeddings.md`, `docs/04-memory/retrieval-engine.md` — the retrieval mechanics this document's separate index reuses
- `docs/04-memory/memory-lifecycle.md` — the personal-memory design this document's corpus is deliberately kept separate from
- `docs/04-memory/memory-confidence.md` — the staleness model this document's freshness handling mirrors
- `docs/18-providers/provider-interface.md` — the integration pattern for connecting an issue tracker
- `docs/10-security/secrets.md`, `docs/10-security/permissions.md` — the exclusion rules ingestion never overrides
