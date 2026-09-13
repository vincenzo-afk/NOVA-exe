import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../src/knowledge-graph.js";
import type { GraphNode } from "../src/knowledge-graph.js";
import { EntityResolver } from "../src/entity-resolution.js";
import type { SemanticMatcher } from "../src/entity-resolution.js";

const kingstonConnect: GraphNode = {
  id: "project-1",
  type: "Project",
  name: "KingstonConnect",
  properties: {},
  active: true,
};
const otherProject: GraphNode = {
  id: "project-2",
  type: "Project",
  name: "Kingston Archive",
  properties: {},
  active: true,
};

function graphWith(...nodes: readonly GraphNode[]): KnowledgeGraph {
  const graph = new KnowledgeGraph();
  for (const node of nodes) graph.addNode(node);
  return graph;
}

describe("EntityResolver", () => {
  it("resolves via exact identifier match without consulting the semantic matcher", () => {
    const graph = graphWith(kingstonConnect);
    const matcher: SemanticMatcher = () => {
      throw new Error("should not be called for an exact match");
    };
    const resolver = new EntityResolver(graph, matcher);

    const result = resolver.resolve("KingstonConnect", "Project");

    expect(result).toEqual({ outcome: "resolved", node: kingstonConnect, via: "exact_match" });
  });

  it("resolves via high-confidence semantic match and records the mention as an alias", () => {
    const graph = graphWith(kingstonConnect);
    const matcher: SemanticMatcher = (_mention, candidates) =>
      candidates.map((node) => ({ node, confidence: node.id === "project-1" ? 0.9 : 0.1 }));
    const resolver = new EntityResolver(graph, matcher);

    const result = resolver.resolve("my Supabase deploy project", "Project");

    expect(result).toMatchObject({ outcome: "resolved", via: "high_confidence_match" });
    expect(graph.findByExactMatch("my Supabase deploy project")?.id).toBe("project-1");
  });

  it("routes to ambiguous when two candidates are both high-confidence within the 0.1 margin", () => {
    const graph = graphWith(kingstonConnect, otherProject);
    const matcher: SemanticMatcher = (_mention, candidates) =>
      candidates.map((node) => ({ node, confidence: node.id === "project-1" ? 0.8 : 0.76 }));
    const resolver = new EntityResolver(graph, matcher);

    const result = resolver.resolve("the Kingston project", "Project");

    expect(result.outcome).toBe("ambiguous");
    if (result.outcome === "ambiguous") expect(result.candidates).toHaveLength(2);
  });

  it("resolves the top candidate when the gap clears the ambiguity margin", () => {
    const graph = graphWith(kingstonConnect, otherProject);
    const matcher: SemanticMatcher = (_mention, candidates) =>
      candidates.map((node) => ({ node, confidence: node.id === "project-1" ? 0.9 : 0.5 }));
    const resolver = new EntityResolver(graph, matcher);

    const result = resolver.resolve("the Kingston project", "Project");

    expect(result).toMatchObject({ outcome: "resolved", node: { id: "project-1" } });
  });

  it("creates a new node when no candidate is plausible", () => {
    const graph = graphWith(kingstonConnect);
    const matcher: SemanticMatcher = (_mention, candidates) =>
      candidates.map((node) => ({ node, confidence: 0.05 }));
    const resolver = new EntityResolver(graph, matcher);

    const result = resolver.resolve("a completely unrelated thing", "Project");

    expect(result).toEqual({ outcome: "create_new", flagForMergeReview: false });
  });

  it("flags the new node for merge review when the caller reports the ambiguity was never resolved", () => {
    expect(EntityResolver.stillAmbiguous()).toEqual({ outcome: "create_new", flagForMergeReview: true });
  });
});
