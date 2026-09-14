# Content Interaction: Find-on-Page and Reading Mode

## Purpose

Specifies two capabilities for working with content already visible or
open — finding and extracting matches within it, and having it read
aloud — as a genuine gap: NOVA's Browser Observer tracks *which* tabs
are open (`docs/07-observers/` / browser observer docs) but not the
*content within* a page on demand, and NOVA's voice pipeline generates
spoken *responses* (`docs/22-voice/voice-assistant.md`) but never
narrates existing *documents*. Grouped together because both are
"do something with the content that's already there," using the same
content-extraction step as their first move.

## Scope

Find-on-page/extraction and read-aloud narration, across browser, PDF,
text editor, and terminal surfaces where each is meaningfully
supported. Does not cover generating new content — that's each
surface's existing document-generation tooling
(`docs/06-tools/` docx/pptx/pdf skills).

## Content extraction — the shared first step

Both capabilities begin by extracting the text content of whatever
surface is targeted, using the highest available tier for that surface
per `docs/06-tools/execution-priority.md`: a browser's DOM/accessibility
tree (Internal Functions / Accessibility tier, not a screenshot) for web
pages, the PDF skill's existing text-extraction path
(`docs/06-tools/` pdf skill) for PDFs, direct file read for a text
editor's open buffer, and terminal scrollback for a terminal. Vision-
based OCR is the fallback only when none of those structured paths are
available (a scanned, non-OCR'd PDF; an image-only page) — consistent
with the deterministic-first principle applied everywhere else in this
project, and notably more reliable than a screenshot-first approach for
this specific task, since "count how many times 'error' appears" is
trivially exact against extracted text and only approximate against
OCR'd pixels.

## Find-on-page and extraction

"Find 'invoice' on this page," "count how many times 'error' appears,"
"extract all email addresses" — each is a query against the extracted
text from above: substring/regex matching for find and count, a
pattern-matching extraction (email/phone/URL patterns) for structured
extraction. Matches are highlighted in-surface where the surface
supports programmatic highlighting (browser DOM manipulation, PDF
annotation); where it doesn't (raw terminal text), results are returned
as a list with surrounding context instead. This is read-only by
construction — highlighting or extracting text never writes to the
source document, so it carries no permission-tier requirement beyond
whatever tier already governs reading that surface's content.

## Reading mode and narration

"Read this article aloud," "summarize this page in 3 bullet points,"
"save as audio podcast." The first two reuse existing infrastructure
directly: narration is the extracted content piped through the same
TTS synthesis `voice-assistant.md` already specifies for spoken
responses, just given document text instead of a generated reply as
its input; summarization is an ordinary Claude call over the extracted
text, identical in kind to any other summarization request, not a
special "document mode." Adjustable speed, voice, and language use
whatever controls `voice-assistant.md`'s TTS layer already exposes for
spoken responses — this document does not add a second, separate voice
configuration surface.

"Save as audio podcast" (export narration as a standalone audio file)
is the one genuinely new piece: it takes the same TTS synthesis output
used for live narration and writes it to a file instead of streaming it
to a speaker, using the existing document-generation output pattern
(`docs/06-tools/` skills write to `/mnt/user-data/outputs`-equivalent
locations and are handed back as a deliverable) rather than a bespoke
audio pipeline.

## Related documents

- `docs/06-tools/execution-priority.md` — the tier preference for content extraction (structured first, OCR/vision last)
- `docs/07-observers/` — the browser/tab tracking this document's browser-surface extraction builds on
- `docs/22-voice/voice-assistant.md` — the TTS synthesis and configuration reused for narration, unchanged
- `docs/06-tools/computer-use-superiority.md` — the general deterministic-first argument this document is one instance of
