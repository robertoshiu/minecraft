import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { ShadowCasterSink } from "./world-renderer";

/** A minimal record shape shared by projectile renderers. */
interface RendererRecord {
  root: TransformNode;
  mesh: Mesh;
}

/**
 * Dispose all records in the map: remove from shadow sink, dispose root (which
 * disposes child meshes), then clear the map. Does NOT touch the shared material
 * — callers are responsible for that.
 */
export function disposeRecordRoots(
  records: Map<number, RendererRecord>,
  shadowSink: ShadowCasterSink | null,
): void {
  for (const [, record] of records) {
    shadowSink?.removeShadowCaster(record.mesh);
    record.root.dispose(false, false);
  }
  records.clear();
}
