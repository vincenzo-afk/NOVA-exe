import { err, ok, type Result } from "@nova/shared";

// "PhysicalObject" (docs/20-devices/spatial-perception.md) is a
// physical-world entity type resolved from camera observations via
// SpatialContext (spatial-context.ts), using this same graph and the
// same EntityResolver every text mention already resolves through —
// deliberate convergence, not a parallel store.
export type GraphNodeType =
  | "User"
  | "Project"
  | "File"
  | "Application"
  | "Task"
  | "Decision"
  | "Tool"
  | "Conversation"
  | "Person"
  | "Goal"
  | "Device"
  | "PhysicalObject";
export type GraphEdgeType =
  | "belongs_to"
  | "depends_on"
  | "produced_by"
  | "performed_on"
  | "related_to"
  | "involves"
  | "pursues"
  | "advances"
  | "blocks"
  | "resides_on";

export interface GraphNode {
  readonly id: string;
  readonly type: GraphNodeType;
  readonly name: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  readonly active: boolean;
  /**
   * Alternate phrasings that previously resolved to this node
   * (docs/04-memory/entity-resolution.md "Alias tracking"), so a later
   * exact-match lookup on any of them short-circuits straight to this
   * node without re-running semantic matching.
   */
  readonly aliases?: readonly string[];
  /**
   * Set when this node was produced by a "still ambiguous" resolution
   * outcome (entity-resolution.md's dashed path) rather than a
   * confirmed distinct entity, so it can be surfaced for later merge
   * review rather than silently trusted as canonical.
   */
  readonly flaggedForMergeReview?: boolean;
}

export interface GraphEdge {
  readonly id: string;
  readonly type: GraphEdgeType;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly weight: number;
}

export interface GraphQueryInput {
  readonly node_id: string;
  readonly direction?: "in" | "out" | "both";
  readonly edge_type?: GraphEdgeType;
  readonly depth?: number;
}

export interface GraphQueryResult {
  readonly root: GraphNode;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface RetrievalCandidate {
  readonly id: string;
  readonly content: string;
  readonly semantic_score: number;
  readonly keyword_score: number;
  readonly graph_score: number;
  readonly temporal_score: number;
  readonly entity_score: number;
  readonly importance: number;
  readonly recency: number;
  readonly confidence: number;
  readonly relationship_distance: number;
  readonly usage_frequency: number;
  readonly pinned: boolean;
  readonly project_relevance: number;
  readonly inactive: boolean;
  readonly sensitive_category?: string;
  readonly score?: number;
}

const nodeTypes = new Set<GraphNodeType>([
  "User",
  "Project",
  "File",
  "Application",
  "Task",
  "Decision",
  "Tool",
  "Conversation",
  "Person",
  "Goal",
  "Device",
  "PhysicalObject",
]);
const edgeTypes = new Set<GraphEdgeType>([
  "belongs_to",
  "depends_on",
  "produced_by",
  "performed_on",
  "related_to",
  "involves",
  "pursues",
  "advances",
  "blocks",
  "resides_on",
]);

export class KnowledgeGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  addNode(node: GraphNode): Result<GraphNode> {
    if (!nodeTypes.has(node.type) || this.nodes.has(node.id)) {
      return err({
        code: "NOVA-MEM002",
        message: "Node violates the fixed ontology or already exists.",
        retryable: false,
      });
    }
    this.nodes.set(node.id, node);
    return ok(node);
  }

  getNode(nodeId: string): Result<GraphNode> {
    const node = this.nodes.get(nodeId);
    return node
      ? ok(node)
      : err({ code: "NOVA-MEM003", message: "Graph node does not exist.", retryable: false });
  }

  addEdge(edge: GraphEdge): Result<GraphEdge> {
    const from = this.nodes.get(edge.from_node_id);
    const to = this.nodes.get(edge.to_node_id);
    if (!from || !to) {
      return err({
        code: "NOVA-MEM003",
        message: "Graph edge endpoints must exist before edge creation.",
        retryable: false,
      });
    }
    if (!edgeTypes.has(edge.type) || !this.validDirection(edge.type, from.type, to.type)) {
      return err({
        code: "NOVA-MEM002",
        message: "Graph edge violates the fixed ontology direction.",
        retryable: false,
      });
    }
    if (this.edges.has(edge.id) || this.pathExists(edge.to_node_id, edge.from_node_id)) {
      return err({
        code: "NOVA-MEM002",
        message: "Graph edge would create a cycle or duplicate edge.",
        retryable: false,
      });
    }
    this.edges.set(edge.id, edge);
    return ok(edge);
  }

  markInactive(nodeId: string): Result<GraphNode> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return err({ code: "NOVA-MEM003", message: "Graph node does not exist.", retryable: false });
    }
    const updated = { ...node, active: false };
    this.nodes.set(nodeId, updated);
    return ok(updated);
  }

  /**
   * Records a mention as an alias of an existing node
   * (docs/04-memory/entity-resolution.md "Alias tracking"). Idempotent:
   * re-adding an already-known alias, or one equal to the node's own
   * name, is a no-op rather than an error.
   */
  addAlias(nodeId: string, alias: string): Result<GraphNode> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return err({ code: "NOVA-MEM003", message: "Graph node does not exist.", retryable: false });
    }
    const existing = node.aliases ?? [];
    if (alias === node.name || existing.includes(alias)) return ok(node);
    const updated = { ...node, aliases: [...existing, alias] };
    this.nodes.set(nodeId, updated);
    return ok(updated);
  }

  /**
   * Exact identifier match: node name or a recorded alias, matched
   * case-sensitively per entity-resolution.md's "exact identifier
   * match" step. Only considers active nodes — an inactive node is
   * logically gone and a mention of its old name should fall through
   * to semantic matching / new-node creation, not resurrect it.
   */
  findByExactMatch(mention: string, type?: GraphNodeType): GraphNode | undefined {
    for (const node of this.nodes.values()) {
      if (!node.active) continue;
      if (type !== undefined && node.type !== type) continue;
      if (node.name === mention || (node.aliases ?? []).includes(mention)) return node;
    }
    return undefined;
  }

  /** Active nodes available as entity-resolution candidates, optionally narrowed by type. */
  activeNodes(type?: GraphNodeType): readonly GraphNode[] {
    return [...this.nodes.values()].filter(
      (node) => node.active && (type === undefined || node.type === type),
    );
  }

  /**
   * Manual merge of two nodes discovered to be duplicates
   * (entity-resolution.md "Manual merge and split"). Every edge
   * touching `duplicateId` is re-pointed to `canonicalId` — preserving
   * which node originally contributed which relationship in the edge's
   * `properties`-equivalent provenance is the caller's responsibility
   * via the edge id it chooses to keep, since GraphEdge itself carries
   * no free-form properties bag. The duplicate node is marked inactive
   * (not deleted) so the audit trail stays traceable, and its aliases —
   * plus its own name — become aliases of the canonical node so future
   * mentions of either resolve to the same place. A direct edge
   * between the two merged nodes is dropped rather than re-pointed,
   * since re-pointing it would produce a self-loop — an edge shape
   * `addEdge`'s own cycle check never permits to be created directly.
   */
  mergeNodes(canonicalId: string, duplicateId: string): Result<GraphNode> {
    const canonical = this.nodes.get(canonicalId);
    const duplicate = this.nodes.get(duplicateId);
    if (!canonical || !duplicate) {
      return err({ code: "NOVA-MEM003", message: "Graph node does not exist.", retryable: false });
    }
    if (canonical.type !== duplicate.type) {
      return err({
        code: "NOVA-MEM002",
        message: "Cannot merge graph nodes of different ontology types.",
        retryable: false,
      });
    }
    for (const [edgeId, edge] of this.edges) {
      const touchesDuplicate = edge.from_node_id === duplicateId || edge.to_node_id === duplicateId;
      if (!touchesDuplicate) continue;
      const repointedFrom = edge.from_node_id === duplicateId ? canonicalId : edge.from_node_id;
      const repointedTo = edge.to_node_id === duplicateId ? canonicalId : edge.to_node_id;
      if (repointedFrom === repointedTo) {
        // A direct edge between the two nodes being merged (e.g. a
        // "related_to" edge recorded when they were first flagged as
        // possible duplicates) would become a self-loop once both
        // endpoints collapse onto canonicalId — something
        // `addEdge`'s own cycle check would never allow to be created
        // directly. Drop it rather than leave that invalid state
        // sitting in the graph.
        this.edges.delete(edgeId);
        continue;
      }
      this.edges.set(edgeId, { ...edge, from_node_id: repointedFrom, to_node_id: repointedTo });
    }
    const mergedAliases = new Set([
      ...(canonical.aliases ?? []),
      ...(duplicate.aliases ?? []),
      duplicate.name,
    ]);
    mergedAliases.delete(canonical.name);
    const updatedCanonical = { ...canonical, aliases: [...mergedAliases] };
    this.nodes.set(canonicalId, updatedCanonical);
    this.nodes.set(duplicateId, { ...duplicate, active: false });
    return ok(updatedCanonical);
  }

  /**
   * Splits an incorrectly merged alias back out into its own node
   * (entity-resolution.md "Manual merge and split"). Any edge whose id
   * is listed in `edgeIdsToMove` is re-pointed from `sourceId` to the
   * freshly created `newNode`; the alias text is removed from
   * `sourceId` so future mentions of it resolve to the split-out node
   * instead.
   */
  splitNode(
    sourceId: string,
    aliasToSplit: string,
    newNode: GraphNode,
    edgeIdsToMove: readonly string[],
  ): Result<GraphNode> {
    const source = this.nodes.get(sourceId);
    if (!source) {
      return err({ code: "NOVA-MEM003", message: "Graph node does not exist.", retryable: false });
    }
    if (!(source.aliases ?? []).includes(aliasToSplit)) {
      return err({
        code: "NOVA-MEM003",
        message: "Alias is not recorded on the source node.",
        retryable: false,
      });
    }
    const created = this.addNode(newNode);
    if (!created.ok) return created;
    for (const edgeId of edgeIdsToMove) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      if (edge.from_node_id === sourceId)
        this.edges.set(edgeId, { ...edge, from_node_id: newNode.id });
      else if (edge.to_node_id === sourceId)
        this.edges.set(edgeId, { ...edge, to_node_id: newNode.id });
    }
    const remainingAliases = (source.aliases ?? []).filter((alias) => alias !== aliasToSplit);
    const updatedSource = { ...source, aliases: remainingAliases };
    this.nodes.set(sourceId, updatedSource);
    return ok(created.value);
  }

  neighbors(nodeId: string): readonly GraphNode[] {
    const neighborIds = [...this.edges.values()]
      .filter((edge) => edge.from_node_id === nodeId || edge.to_node_id === nodeId)
      .map((edge) => (edge.from_node_id === nodeId ? edge.to_node_id : edge.from_node_id));
    return neighborIds.flatMap((id) => {
      const node = this.nodes.get(id);
      return node ? [node] : [];
    });
  }

  query(input: GraphQueryInput): Result<GraphQueryResult> {
    const root = this.nodes.get(input.node_id);
    if (!root) {
      return err({ code: "NOVA-MEM003", message: "Graph node does not exist.", retryable: false });
    }
    const direction = input.direction ?? "both";
    const depth = input.depth ?? 1;
    if (direction !== "in" && direction !== "out" && direction !== "both") {
      return err({
        code: "NOVA-CFG001",
        message: "Graph query direction or depth is invalid.",
        retryable: false,
      });
    }
    if (depth < 1 || depth > 3 || !Number.isInteger(depth)) {
      return err({
        code: "NOVA-CFG001",
        message: "Graph query direction or depth is invalid.",
        retryable: false,
      });
    }
    if (input.edge_type !== undefined && !edgeTypes.has(input.edge_type)) {
      return err({
        code: "NOVA-MEM002",
        message: "Graph query edge type is outside the fixed ontology.",
        retryable: false,
      });
    }

    const visited = new Set<string>([root.id]);
    const frontier = [root.id];
    const resultNodes: GraphNode[] = [];
    const resultEdges: GraphEdge[] = [];
    for (let level = 0; level < depth && frontier.length > 0; level += 1) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        for (const edge of this.edges.values()) {
          if (input.edge_type !== undefined && edge.type !== input.edge_type) continue;
          const outgoing = edge.from_node_id === nodeId;
          const incoming = edge.to_node_id === nodeId;
          const allowed =
            direction === "out" ? outgoing : direction === "in" ? incoming : outgoing || incoming;
          if (!allowed) continue;
          const neighborId = outgoing ? edge.to_node_id : edge.from_node_id;
          if (!resultEdges.some((existing) => existing.id === edge.id)) resultEdges.push(edge);
          if (visited.has(neighborId)) continue;
          const neighbor = this.nodes.get(neighborId);
          if (!neighbor) continue;
          visited.add(neighborId);
          resultNodes.push(neighbor);
          next.push(neighborId);
        }
      }
      frontier.splice(0, frontier.length, ...next);
    }
    return ok({ root, nodes: resultNodes, edges: resultEdges });
  }

  private validDirection(edgeType: GraphEdgeType, from: GraphNodeType, to: GraphNodeType): boolean {
    switch (edgeType) {
      case "belongs_to":
        return from === "File" && to === "Project";
      case "depends_on":
        return from === "Project" && to === "Tool";
      case "produced_by":
        return from === "Decision" && (to === "Task" || to === "Conversation");
      case "performed_on":
        return from === "Task" && (to === "File" || to === "Application");
      case "involves":
        return (from === "Conversation" || from === "Task") && to === "Person";
      case "pursues":
        return from === "User" && to === "Goal";
      case "advances":
        return from === "Task" && to === "Goal";
      case "resides_on":
        return from === "File" && to === "Device";
      case "blocks":
        return to === "Goal";
      case "related_to":
        return true;
    }
  }

  private pathExists(start: string, target: string): boolean {
    const visited = new Set<string>();
    const visit = (nodeId: string): boolean => {
      if (nodeId === target) {
        return true;
      }
      if (visited.has(nodeId)) {
        return false;
      }
      visited.add(nodeId);
      return [...this.edges.values()]
        .filter((edge) => edge.from_node_id === nodeId)
        .some((edge) => visit(edge.to_node_id));
    };
    return visit(start);
  }
}
