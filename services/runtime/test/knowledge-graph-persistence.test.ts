import { describe, expect, it } from "vitest";

import { PersistentKnowledgeGraph } from "../src/knowledge-graph-persistence.js";
import type { GraphNode } from "../src/knowledge-graph.js";

interface FakeGraphNodeRow {
  id: string;
  workspaceId: string;
  identityId: string;
  entityType: string;
  canonicalName: string;
  propertiesJson: string;
  aliasesJson: string;
  confidence: number;
  active: boolean;
}

interface FakeGraphEdgeRow {
  id: string;
  workspaceId: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: string;
  confidence: number;
  weight: number;
}

/** A minimal fake standing in for the generated Prisma client's `graphNode`/`graphEdge` delegates — enough to exercise hydrate/upsert without a real database. */
function createFakePrisma() {
  const nodes = new Map<string, FakeGraphNodeRow>();
  const edges = new Map<string, FakeGraphEdgeRow>();
  return {
    nodes,
    edges,
    graphNode: {
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        [...nodes.values()].filter((row) => row.workspaceId === where.workspaceId),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { id: string };
        create: FakeGraphNodeRow;
        update: Partial<FakeGraphNodeRow>;
      }) => {
        const existing = nodes.get(where.id);
        const row = existing ? { ...existing, ...update } : create;
        nodes.set(where.id, row);
        return row;
      },
    },
    graphEdge: {
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        [...edges.values()].filter((row) => row.workspaceId === where.workspaceId),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { id: string };
        create: FakeGraphEdgeRow;
        update: Partial<FakeGraphEdgeRow>;
      }) => {
        const existing = edges.get(where.id);
        const row = existing ? { ...existing, ...update } : create;
        edges.set(where.id, row);
        return row;
      },
    },
  };
}

async function flushBackgroundWrites(): Promise<void> {
  // persistNode/persistEdge are fire-and-forget promises; give the microtask
  // queue a turn so their .then/.catch continuations actually run before assertions.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return { id: "n1", type: "Project", name: "NOVA", properties: {}, active: true, ...overrides };
}

describe("PersistentKnowledgeGraph", () => {
  it("persists a newly added node and can rehydrate it into a fresh instance", async () => {
    const prisma = createFakePrisma();
    const graph = await PersistentKnowledgeGraph.hydrate({
      prisma: prisma as never,
      workspaceId: "ws1",
      identityId: "id1",
    });

    const added = graph.addNode(node());
    expect(added.ok).toBe(true);
    await flushBackgroundWrites();
    expect(prisma.nodes.has("n1")).toBe(true);

    const rehydrated = await PersistentKnowledgeGraph.hydrate({
      prisma: prisma as never,
      workspaceId: "ws1",
      identityId: "id1",
    });
    expect(rehydrated.getNode("n1")).toMatchObject({ ok: true, value: { name: "NOVA" } });
  });

  it("does not hydrate rows from a different workspace", async () => {
    const prisma = createFakePrisma();
    prisma.nodes.set("other", {
      id: "other",
      workspaceId: "ws-other",
      identityId: "id1",
      entityType: "Project",
      canonicalName: "Someone else's project",
      propertiesJson: "{}",
      aliasesJson: "[]",
      confidence: 1,
      active: true,
    });

    const graph = await PersistentKnowledgeGraph.hydrate({
      prisma: prisma as never,
      workspaceId: "ws1",
      identityId: "id1",
    });

    expect(graph.getNode("other")).toMatchObject({ ok: false });
  });

  it("persists markInactive and addAlias mutations, not just node creation", async () => {
    const prisma = createFakePrisma();
    const graph = await PersistentKnowledgeGraph.hydrate({
      prisma: prisma as never,
      workspaceId: "ws1",
      identityId: "id1",
    });
    graph.addNode(node());
    await flushBackgroundWrites();

    graph.addAlias("n1", "the project");
    graph.markInactive("n1");
    await flushBackgroundWrites();

    expect(prisma.nodes.get("n1")).toMatchObject({
      active: false,
      aliasesJson: JSON.stringify(["the project"]),
    });
  });

  it("persists an edge and both its endpoint nodes are queryable after rehydration", async () => {
    const prisma = createFakePrisma();
    const graph = await PersistentKnowledgeGraph.hydrate({
      prisma: prisma as never,
      workspaceId: "ws1",
      identityId: "id1",
    });
    graph.addNode(node({ id: "a", type: "Project", name: "A" }));
    graph.addNode(node({ id: "b", type: "Task", name: "B" }));
    const edgeResult = graph.addEdge({
      id: "e1",
      type: "involves",
      from_node_id: "a",
      to_node_id: "b",
      weight: 1,
    });
    expect(edgeResult.ok).toBe(true);
    await flushBackgroundWrites();

    const rehydrated = await PersistentKnowledgeGraph.hydrate({
      prisma: prisma as never,
      workspaceId: "ws1",
      identityId: "id1",
    });
    const queried = rehydrated.query({ node_id: "a", direction: "out", depth: 1 });
    expect(queried).toMatchObject({
      ok: true,
      value: { edges: [{ id: "e1" }], nodes: [{ id: "b" }] },
    });
  });
});
