import { err, ok, type Result } from "@nova/shared";

import type { SpatialContext } from "./spatial-context.js";
import { type ObjectObservation, type SpatialMatch } from "./spatial-context.js";

/**
 * Completes the vision pipeline: a captured frame (from
 * VisionCaptureManager.kt's camera stills or ScreenCaptureManager.kt's
 * screen frames, per docs/20-devices/spatial-perception.md) goes in,
 * a set of resolved, graph-converged entities comes out. Previously
 * the capture surfaces existed but nothing downstream turned raw
 * bytes into anything NOVA could reason about across turns — this is
 * that missing middle step.
 *
 * The actual frame-understanding model call is an injected
 * `VisionProvider`, matching docs/18-providers/provider-interface.md's
 * separation of "what happens to captured bytes" from the capture
 * surface itself, and the same injected-collaborator pattern already
 * used throughout this codebase (SemanticMatcher, IntentResolver,
 * etc.) — this module owns the pipeline shape, not model access.
 */

export interface VisionProviderResult {
  readonly objects: readonly {
    readonly label: string;
    readonly description: string;
    readonly boundingBox?: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }[];
}

export interface VisionProvider {
  describeFrame(frameBytes: Buffer, hint?: string): Promise<VisionProviderResult>;
}

export interface VisionFrameRequest {
  readonly device_id: string;
  readonly frame_b64: string;
  readonly captured_at_epoch_ms: number;
  /** Optional free-text hint from the requester, e.g. "what am I looking at" vs "read this document" — passed through to the provider, never interpreted here. */
  readonly hint?: string;
}

export interface ResolvedObject {
  readonly node_id: string;
  readonly label: string;
  readonly via: SpatialMatch["via"];
  readonly bounding_box?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export class VisionPipeline {
  public constructor(
    private readonly provider: VisionProvider,
    private readonly spatialContext: SpatialContext,
    private readonly maxFrameBytes = 8 * 1024 * 1024,
  ) {}

  public async processFrame(
    request: VisionFrameRequest,
  ): Promise<Result<readonly ResolvedObject[]>> {
    let frameBytes: Buffer;
    try {
      frameBytes = Buffer.from(request.frame_b64, "base64");
    } catch {
      return err({
        code: "NOVA-TL003",
        message: "frame_b64 is not valid base64.",
        retryable: false,
      });
    }
    if (frameBytes.length === 0) {
      return err({ code: "NOVA-TL003", message: "Frame payload is empty.", retryable: false });
    }
    if (frameBytes.length > this.maxFrameBytes) {
      return err({
        code: "NOVA-TL003",
        message: `Frame payload (${frameBytes.length} bytes) exceeds the ${this.maxFrameBytes}-byte limit.`,
        retryable: false,
      });
    }

    let providerResult: VisionProviderResult;
    try {
      providerResult = await this.provider.describeFrame(frameBytes, request.hint);
    } catch (error) {
      return err({
        code: "NOVA-AI001",
        message: `Vision provider failed to describe the frame: ${error instanceof Error ? error.message : "unknown error"}.`,
        retryable: true,
      });
    }

    const resolved: ResolvedObject[] = providerResult.objects.map((object) => {
      const observation: ObjectObservation = {
        label: object.label,
        description: object.description,
        boundingBox: object.boundingBox,
        observedAtEpochMs: request.captured_at_epoch_ms,
        sourceDeviceId: request.device_id,
      };
      const match = this.spatialContext.observe(observation);
      return {
        node_id: match.node.id,
        label: object.label,
        via: match.via,
        bounding_box: object.boundingBox,
      };
    });

    this.spatialContext.tick(request.captured_at_epoch_ms);
    return ok(resolved);
  }
}
