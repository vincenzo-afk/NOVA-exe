import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "../src/knowledge-graph.js";
import { ContextBuilder } from "../src/context-builder.js";
import { RetrievalFusion } from "../src/retrieval-fusion.js";
import type { GraphNode, RetrievalCandidate } from "../src/knowledge-graph.js";

const project: GraphNode = {
  id: "project-1",
  type: "Project",
  name: "Nova",
  properties: {},
  active: true,
};
const file: GraphNode = {
  id: "file-1",
  type: "File",
  name: "README.md",
  properties: {},
  active: true,
};
const tool: GraphNode = { id: "tool-1", type: "Tool", name: "git", properties: {}, active: true };

describe("KnowledgeGraph", () => {
  it("rejects unknown ontology node types and missing edge endpoints", () => {
    const graph = new KnowledgeGraph();

    expect(graph.addNode({ ...project, type: "Unknown" as GraphNode["type"] })).toMatchObject({
      ok: false,
      error: { code: "NOVA-MEM002" },
    });
    graph.addNode(project);
    expect(
      graph.addEdge({
        id: "edge-1",
        type: "belongs_to",
        from_node_id: "missing",
        to_node_id: project.id,
        weight: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOVA-MEM003" } });
  });

  it("enforces typed edge directions and preserves endpoint consistency", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    graph.addNode(file);

    expect(
      graph.addEdge({
        id: "edge-1",
        type: "belongs_to",
        from_node_id: file.id,
        to_node_id: project.id,
        weight: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(
      graph.addEdge({
        id: "edge-2",
        type: "belongs_to",
        from_node_id: project.id,
        to_node_id: file.id,
        weight: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOVA-MEM002" } });
  });

  it("traverses explicit outgoing relationships within the bounded depth", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    graph.addNode(tool);
    graph.addEdge({
      id: "edge-query",
      type: "depends_on",
      from_node_id: project.id,
      to_node_id: tool.id,
      weight: 1,
    });

    expect(
      graph.query({ node_id: project.id, direction: "out", edge_type: "depends_on", depth: 1 }),
    ).toMatchObject({
      ok: true,
      value: { root: project, nodes: [tool], edges: [{ id: "edge-query" }] },
    });
    expect(
      graph.query({ node_id: project.id, direction: "sideways" as "in", depth: 1 }),
    ).toMatchObject({
      ok: false,
      error: { code: "NOVA-CFG001" },
    });
  });

  it("rejects a cycle for constrained edge types while allowing inactive nodes to remain queryable explicitly", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    graph.addNode(file);
    graph.addNode(tool);
    graph.addEdge({
      id: "edge-1",
      type: "related_to",
      from_node_id: project.id,
      to_node_id: file.id,
      weight: 1,
    });
    graph.addEdge({
      id: "edge-2",
      type: "related_to",
      from_node_id: file.id,
      to_node_id: tool.id,
      weight: 1,
    });

    expect(
      graph.addEdge({
        id: "edge-3",
        type: "related_to",
        from_node_id: tool.id,
        to_node_id: project.id,
        weight: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOVA-MEM002" } });
    graph.markInactive(file.id);
    expect(graph.getNode(file.id)).toMatchObject({ ok: true, value: { active: false } });
  });
});

const candidate = (overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate => ({
  id: "memory-1",
  content: "project decision",
  semantic_score: 0.8,
  keyword_score: 0.5,
  graph_score: 0.4,
  temporal_score: 0.7,
  entity_score: 0.6,
  importance: 0.8,
  recency: 0.8,
  confidence: 0.9,
  relationship_distance: 0,
  usage_frequency: 0.2,
  pinned: false,
  project_relevance: 0.5,
  inactive: false,
  sensitive_category: undefined,
  ...overrides,
});

describe("RetrievalFusion and ContextBuilder", () => {
  it("deduplicates branch hits and ranks fused candidates", () => {
    const fusion = new RetrievalFusion();
    const result = fusion.fuse([
      { branch: "keyword", candidates: [candidate({ keyword_score: 1 })] },
      {
        branch: "semantic",
        candidates: [
          candidate({ semantic_score: 0.9 }),
          candidate({ id: "memory-2", content: "other", semantic_score: 0.7 }),
        ],
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("memory-1");
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0);
  });

  it("applies a candidate's importance/confidence/recency/pinning bonus once, not once per branch it appears in", () => {
    // All branch scores are 0 here so the only thing contributing to the
    // final score is the candidate-level bonus — isolating it from the
    // branch-fusion math. Appearing in three branches should not change
    // that bonus at all.
    const fusion = new RetrievalFusion();
    const zeroScored = candidate({
      semantic_score: 0,
      keyword_score: 0,
      graph_score: 0,
      importance: 1,
      confidence: 0,
      recency: 0,
      project_relevance: 0,
      usage_frequency: 0,
      pinned: false,
    });
    const expectedBonus = 1 * 0.2; // importance(1) * its 0.2 weight; every other factor is 0.

    const seenOnce = fusion.fuse([{ branch: "semantic", candidates: [zeroScored] }]);
    const seenThreeTimes = fusion.fuse([
      { branch: "semantic", candidates: [zeroScored] },
      { branch: "keyword", candidates: [zeroScored] },
      { branch: "graph", candidates: [zeroScored] },
    ]);

    expect(seenOnce[0]?.score).toBeCloseTo(expectedBonus, 10);
    expect(seenThreeTimes[0]?.score).toBeCloseTo(expectedBonus, 10);
  });

  it("excludes inactive and sensitive candidates before context assembly", () => {
    const builder = new ContextBuilder();
    const result = builder.build({
      original_request: "summarize project",
      response_format_instructions: "plain text",
      purpose: "general",
      token_budget: 100,
      candidates: [
        { ...candidate({ id: "active", content: "safe context", score: undefined }), score: 0.9 },
        { ...candidate({ id: "inactive", content: "old", inactive: true }), score: 0.99 },
        {
          ...candidate({ id: "financial", content: "salary", sensitive_category: "financial" }),
          score: 1,
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, value: { items: [{ id: "active" }] } });
  });

  it("evicts the lowest-ranked context first and never compresses the request or format instructions", () => {
    const builder = new ContextBuilder();
    const result = builder.build({
      original_request: "request",
      response_format_instructions: "format",
      purpose: "general",
      token_budget: 10,
      candidates: [
        { ...candidate({ id: "high", content: "high value" }), score: 0.95 },
        { ...candidate({ id: "low", content: "low value that should be evicted" }), score: 0.1 },
      ],
    });

    expect(result).toMatchObject({ ok: true, value: { items: [{ id: "high" }] } });
  });

  it("reports a hard budget failure when the protected request and format cannot fit", () => {
    const builder = new ContextBuilder();
    const result = builder.build({
      original_request: "a very long request that cannot fit",
      response_format_instructions: "a very long format contract",
      purpose: "general",
      token_budget: 2,
      candidates: [],
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-AI002" } });
  });
});

describe("KnowledgeGraph alias tracking and manual merge/split", () => {
  it("records and dedupes aliases, ignoring the node's own name", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);

    graph.addAlias("project-1", "the Nova project");
    graph.addAlias("project-1", "the Nova project");
    graph.addAlias("project-1", "Nova");

    expect(graph.getNode("project-1")).toMatchObject({
      ok: true,
      value: { aliases: ["the Nova project"] },
    });
  });

  it("resolves an exact match against a recorded alias but not against an inactive node", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    graph.addAlias("project-1", "the Nova project");

    expect(graph.findByExactMatch("the Nova project")?.id).toBe("project-1");

    graph.markInactive("project-1");
    expect(graph.findByExactMatch("the Nova project")).toBeUndefined();
  });

  it("merges a duplicate node into a canonical one, re-pointing edges and preserving the alias", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    const duplicate: GraphNode = {
      id: "project-2",
      type: "Project",
      name: "NovaApp",
      properties: {},
      active: true,
    };
    graph.addNode(duplicate);
    graph.addNode(file);
    graph.addEdge({
      id: "edge-1",
      type: "belongs_to",
      from_node_id: "file-1",
      to_node_id: "project-2",
      weight: 1,
    });

    const merged = graph.mergeNodes("project-1", "project-2");

    expect(merged).toMatchObject({ ok: true, value: { aliases: ["NovaApp"] } });
    expect(graph.getNode("project-2")).toMatchObject({ ok: true, value: { active: false } });
    expect(graph.query({ node_id: "project-1" })).toMatchObject({
      ok: true,
      value: { nodes: [{ id: "file-1" }] },
    });
  });

  it("rejects merging nodes of different ontology types", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    graph.addNode(tool);

    expect(graph.mergeNodes("project-1", "tool-1")).toMatchObject({
      ok: false,
      error: { code: "NOVA-MEM002" },
    });
  });

  it("drops a direct edge between the two merged nodes instead of turning it into a self-loop", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    const duplicate: GraphNode = {
      id: "project-2",
      type: "Project",
      name: "NovaApp",
      properties: {},
      active: true,
    };
    graph.addNode(duplicate);
    // A "these might be the same thing" edge recorded before the merge decision.
    graph.addEdge({
      id: "edge-related",
      type: "related_to",
      from_node_id: "project-1",
      to_node_id: "project-2",
      weight: 1,
    });

    graph.mergeNodes("project-1", "project-2");

    const result = graph.query({ node_id: "project-1" });
    expect(result).toMatchObject({ ok: true, value: { edges: [] } });
    if (result.ok) {
      expect(result.value.edges.some((edge) => edge.from_node_id === edge.to_node_id)).toBe(false);
    }
  });

  it("splits an alias back out into its own node and moves the specified edges", () => {
    const graph = new KnowledgeGraph();
    graph.addNode(project);
    graph.addAlias("project-1", "Kingston Connect");
    graph.addNode(file);
    graph.addEdge({
      id: "edge-1",
      type: "belongs_to",
      from_node_id: "file-1",
      to_node_id: "project-1",
      weight: 1,
    });

    const split = graph.splitNode(
      "project-1",
      "Kingston Connect",
      { id: "project-3", type: "Project", name: "Kingston Connect", properties: {}, active: true },
      ["edge-1"],
    );

    expect(split).toMatchObject({ ok: true, value: { id: "project-3" } });
    expect(graph.getNode("project-1")).toMatchObject({ ok: true, value: { aliases: [] } });
    expect(graph.query({ node_id: "project-3" })).toMatchObject({
      ok: true,
      value: { nodes: [{ id: "file-1" }] },
    });
  });
});
