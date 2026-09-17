import type { PrismaClient } from "@nova/memory";
import type { StructuredLogger } from "@nova/shared";
import { type Result } from "@nova/shared";

import {
  KnowledgeGraph,
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
} from "./knowledge-graph.js";

/**
 * The follow-up the schema's own comment named and never got: `graph_nodes`/
 * `graph_edges` tables have existed in `services/memory/prisma/schema.prisma`
 * since before this file did, while `KnowledgeGraph` ran entirely on
 * in-memory `Map`s — every fact NOVA's Knowledge Graph learned was gone the
 * moment the process restarted.
 *
 * `KnowledgeGraph`'s public API is deliberately synchronous (every caller
 * across `entity-resolution.ts`, `spatial-context.ts`, `retrieval-engine.ts`
 * calls it that way, and converting all of them to async is a much larger,
 * separate change this class does not make unilaterally). This class keeps
 * that synchronous contract intact for every caller and adds durability
 * around it as a write-through layer:
 *
 * - **Hydration** (`PersistentKnowledgeGraph.hydrate`) loads every row for
 *   the workspace from Postgres/SQLite into the in-memory graph once, at
 *   startup, before any caller touches it.
 * - **Every mutation** (`addNode`, `addEdge`, `markInactive`, `addAlias`,
 *   `mergeNodes`) still returns synchronously, exactly as the base class
 *   always did, and additionally fires a background write to persist that
 *   change — a write failure is logged, never thrown into the synchronous
 *   caller, since the synchronous return contract has nowhere to carry an
 *   async failure.
 *
 * The honest limitation this tradeoff carries: a crash between the
 * synchronous in-memory mutation returning and its background write landing
 * loses that one write. Closing that gap fully requires making the whole
 * call chain async, which is real, separate follow-up work — this class
 * does not pretend that risk away.
 */

export interface PersistentKnowledgeGraphOptions {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly identityId: string;
  readonly logger?: StructuredLogger;
}

const DEFAULT_CONFIDENCE = 1;

export class PersistentKnowledgeGraph extends KnowledgeGraph {
  private constructor(private readonly options: PersistentKnowledgeGraphOptions) {
    super();
  }

  public static async hydrate(
    options: PersistentKnowledgeGraphOptions,
  ): Promise<PersistentKnowledgeGraph> {
    const graph = new PersistentKnowledgeGraph(options);
    const [nodeRows, edgeRows] = await Promise.all([
      options.prisma.graphNode.findMany({ where: { workspaceId: options.workspaceId } }),
      options.prisma.graphEdge.findMany({ where: { workspaceId: options.workspaceId } }),
    ]);
    for (const row of nodeRows) {
      const restored = rowToNode(row);
      const result = KnowledgeGraph.prototype.addNode.call(graph, restored);
      if (!result.ok) {
        options.logger?.warning("knowledge_graph.hydrate.node_rejected", {
          node_id: restored.id,
          error: result.error.message,
        });
      }
    }
    for (const row of edgeRows) {
      const restored: GraphEdge = {
        id: row.id,
        type: row.relationType as GraphEdge["type"],
        from_node_id: row.fromNodeId,
        to_node_id: row.toNodeId,
        weight: row.weight,
      };
      const result = KnowledgeGraph.prototype.addEdge.call(graph, restored);
      if (!result.ok) {
        options.logger?.warning("knowledge_graph.hydrate.edge_rejected", {
          edge_id: restored.id,
          error: result.error.message,
        });
      }
    }
    return graph;
  }

  public override addNode(node: GraphNode): Result<GraphNode> {
    const result = super.addNode(node);
    if (result.ok) this.persistNode(result.value);
    return result;
  }

  public override addEdge(edge: GraphEdge): Result<GraphEdge> {
    const result = super.addEdge(edge);
    if (result.ok) this.persistEdge(result.value);
    return result;
  }

  public override markInactive(nodeId: string): Result<GraphNode> {
    const result = super.markInactive(nodeId);
    if (result.ok) this.persistNode(result.value);
    return result;
  }

  public override addAlias(nodeId: string, alias: string): Result<GraphNode> {
    const result = super.addAlias(nodeId, alias);
    if (result.ok) this.persistNode(result.value);
    return result;
  }

  public override mergeNodes(canonicalId: string, duplicateId: string): Result<GraphNode> {
    const result = super.mergeNodes(canonicalId, duplicateId);
    if (result.ok) {
      // mergeNodes can re-point an unbounded number of edges internally;
      // rather than diff exactly which ones changed, the canonical +
      // duplicate nodes and every edge now touching either are re-persisted
      // in full — more writes than a precise diff, but always correct.
      this.persistNode(result.value);
      const duplicate = super.getNode(duplicateId);
      if (duplicate.ok) this.persistNode(duplicate.value);
      for (const edge of this.edgesTouching(canonicalId, duplicateId)) {
        this.persistEdge(edge);
      }
    }
    return result;
  }

  private edgesTouching(...nodeIds: readonly string[]): readonly GraphEdge[] {
    const found = new Map<string, GraphEdge>();
    for (const nodeId of nodeIds) {
      const queried = super.query({ node_id: nodeId, direction: "both", depth: 1 });
      if (!queried.ok) continue;
      for (const edge of queried.value.edges) found.set(edge.id, edge);
    }
    return [...found.values()];
  }

  /**
   * Like `mergeNodes`, `splitNode` re-points an arbitrary set of edges
   * internally (the caller-chosen `edgeIdsToMove`) in addition to creating a
   * node and updating the source node's aliases — the source node and every
   * edge the base implementation may have moved are re-persisted in full
   * rather than diffed. `addNode`'s override already persists the newly
   * created split-out node on its own, since `splitNode` calls `this.addNode`
   * internally and that virtual dispatch reaches this class's override.
   */
  public override splitNode(
    sourceId: string,
    aliasToSplit: string,
    newNode: GraphNode,
    edgeIdsToMove: readonly string[],
  ): Result<GraphNode> {
    const result = super.splitNode(sourceId, aliasToSplit, newNode, edgeIdsToMove);
    if (result.ok) {
      const source = super.getNode(sourceId);
      if (source.ok) this.persistNode(source.value);
      for (const edgeId of edgeIdsToMove) {
        const edge = super.query({ node_id: result.value.id, direction: "both", depth: 1 });
        if (edge.ok) {
          const moved = edge.value.edges.find((candidate) => candidate.id === edgeId);
          if (moved) this.persistEdge(moved);
        }
      }
    }
    return result;
  }

  private persistNode(node: GraphNode): void {
    this.options.prisma.graphNode
      .upsert({
        where: { id: node.id },
        create: {
          id: node.id,
          workspaceId: this.options.workspaceId,
          identityId: this.options.identityId,
          entityType: node.type,
          canonicalName: node.name,
          propertiesJson: JSON.stringify(node.properties),
          aliasesJson: JSON.stringify(node.aliases ?? []),
          confidence: DEFAULT_CONFIDENCE,
          active: node.active,
        },
        update: {
          canonicalName: node.name,
          propertiesJson: JSON.stringify(node.properties),
          aliasesJson: JSON.stringify(node.aliases ?? []),
          active: node.active,
        },
      })
      .catch((cause: unknown) => {
        this.options.logger?.error("knowledge_graph.persist.node_failed", {
          node_id: node.id,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
  }

  private persistEdge(edge: GraphEdge): void {
    this.options.prisma.graphEdge
      .upsert({
        where: { id: edge.id },
        create: {
          id: edge.id,
          workspaceId: this.options.workspaceId,
          fromNodeId: edge.from_node_id,
          toNodeId: edge.to_node_id,
          relationType: edge.type,
          confidence: DEFAULT_CONFIDENCE,
          weight: edge.weight,
        },
        update: {
          weight: edge.weight,
        },
      })
      .catch((cause: unknown) => {
        this.options.logger?.error("knowledge_graph.persist.edge_failed", {
          edge_id: edge.id,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
  }
}

interface GraphNodeRow {
  readonly id: string;
  readonly entityType: string;
  readonly canonicalName: string;
  readonly propertiesJson: string;
  readonly aliasesJson: string;
  readonly active: boolean;
}

function rowToNode(row: GraphNodeRow): GraphNode {
  let properties: Record<string, string | number | boolean> = {};
  let aliases: readonly string[] = [];
  try {
    properties = JSON.parse(row.propertiesJson) as Record<string, string | number | boolean>;
  } catch {
    properties = {};
  }
  try {
    aliases = JSON.parse(row.aliasesJson) as readonly string[];
  } catch {
    aliases = [];
  }
  return {
    id: row.id,
    type: row.entityType as GraphNodeType,
    name: row.canonicalName,
    properties,
    active: row.active,
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}
