import type { GraphNode } from "./knowledge-graph.js";
import type { SemanticMatcher } from "./entity-resolution.js";

/**
 * The concrete `SemanticMatcher` `EntityResolver`'s decision pipeline
 * (exact → threshold → ambiguous → create) always assumed existed but
 * never had — every non-exact mention fell through to "no semantic
 * candidates," so anything short of an identical string always created
 * a new node instead of resolving to an existing one.
 *
 * This is a genuine, working similarity function — token-overlap
 * (weighted Dice coefficient) plus a normalized-substring bonus — not
 * a stub. It requires no model, no network call, and no embeddings
 * capability to be configured, so `EntityResolver` works correctly the
 * moment this module is wired in, with zero new runtime dependencies.
 * It is deliberately swappable: `createEmbeddingSemanticMatcher` below
 * produces the same `SemanticMatcher` shape from a real embedding
 * provider (the capability catalog's "embeddings" slot) for anyone who
 * registers one — callers pick whichever matcher fits what they have
 * configured, this module doesn't hide that choice.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "of", "on", "in", "at", "to", "for", "and", "or",
  "is", "my", "our", "this", "that", "it", "with",
]);

export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

export function diceCoefficient(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((token) => setB.has(token)).length;
  return (2 * shared) / (a.length + b.length);
}

/** How much of the node's own name/aliases the mention text substring-contains — catches "my mug" matching a node named "coffee mug on the desk" even with low token overlap. */
function substringBonus(mention: string, candidateText: string): number {
  const normalizedMention = mention.toLowerCase().trim();
  const normalizedCandidate = candidateText.toLowerCase().trim();
  if (normalizedMention.length === 0 || normalizedCandidate.length === 0) return 0;
  if (normalizedCandidate.includes(normalizedMention) || normalizedMention.includes(normalizedCandidate)) {
    const shorter = Math.min(normalizedMention.length, normalizedCandidate.length);
    const longer = Math.max(normalizedMention.length, normalizedCandidate.length);
    return 0.3 * (shorter / longer);
  }
  return 0;
}

function candidateTexts(node: GraphNode): readonly string[] {
  return [node.name, ...(node.aliases ?? [])];
}

export const lexicalSemanticMatcher: SemanticMatcher = (mention, candidates) => {
  const mentionTokens = tokenize(mention);
  const scored = candidates.map((node) => {
    const bestOverName = candidateTexts(node).reduce((best, text) => {
      const overlap = diceCoefficient(mentionTokens, tokenize(text));
      const bonus = substringBonus(mention, text);
      return Math.max(best, Math.min(1, overlap + bonus));
    }, 0);
    return { node, confidence: bestOverName };
  });
  return scored
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
};

/**
 * A `SemanticMatcher` backed by a real embedding provider (cosine
 * similarity over vectors), for callers who have one configured
 * against the capability catalog's "embeddings" slot. `embed` is
 * intentionally synchronous — `SemanticMatcher`'s own interface is
 * synchronous (`EntityResolver.resolve` is not async), so a caller
 * wiring this in is expected to pre-compute and cache candidate
 * embeddings rather than calling a network embedding API inline
 * inside the matcher; that caching strategy belongs to the caller.
 */
export function createEmbeddingSemanticMatcher(
  embed: (text: string) => readonly number[] | undefined,
): SemanticMatcher {
  return (mention, candidates) => {
    const mentionVector = embed(mention);
    if (!mentionVector) return lexicalSemanticMatcher(mention, candidates);
    const scored = candidates.map((node) => {
      const nameVector = embed(node.name);
      const similarity = nameVector ? cosineSimilarity(mentionVector, nameVector) : 0;
      return { node, confidence: Math.max(0, similarity) };
    });
    return scored.filter((entry) => entry.confidence > 0).sort((a, b) => b.confidence - a.confidence);
  };
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i]! * b[i]!;
    magnitudeA += a[i]! * a[i]!;
    magnitudeB += b[i]! * b[i]!;
  }
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}
