/**
 * spatial.ts — pure spatial audio math (distance attenuation + stereo pan).
 *
 * No Web Audio, no side effects. Fully testable in Node/Vitest.
 */

/** A simple 3-component position. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Inverse-square-law attenuation clamped to [0, 1].
 *
 * @param distance   Distance from listener to source (blocks).
 * @param refDist    Reference distance at which gain == 1 (default 1).
 * @param maxDist    Distance at/beyond which gain == 0 (default 48).
 * @returns          Gain in [0, 1]; 1 when distance <= refDist, 0 when >= maxDist.
 */
export function distanceAttenuation(
  distance: number,
  refDist = 1,
  maxDist = 48,
): number {
  if (distance <= refDist) return 1;
  if (distance >= maxDist) return 0;
  // Linear roll-off from refDist to maxDist (simple, safe, monotonically decreasing).
  return 1 - (distance - refDist) / (maxDist - refDist);
}

/**
 * Stereo panning value in [-1, 1] for a source relative to the listener.
 *
 * Negative means the source is to the listener's LEFT, positive to the RIGHT.
 * Directly ahead or behind returns ~0.
 *
 * @param listenerPos  World position of the listener.
 * @param listenerYaw  Listener's yaw in radians (Babylon convention: +Y rotation,
 *                     0 = looking along +Z, positive = clockwise).
 * @param sourcePos    World position of the sound source.
 * @returns            Pan value in [-1, 1].
 */
export function stereoPan(
  listenerPos: Vec3,
  listenerYaw: number,
  sourcePos: Vec3,
): number {
  const dx = sourcePos.x - listenerPos.x;
  const dz = sourcePos.z - listenerPos.z;

  // Listener's right-ear direction (yaw rotated 90° clockwise in XZ plane).
  // With Babylon's UniversalCamera convention (yaw=0 faces +Z, yaw increases
  // clockwise when viewed top-down):
  //   forward = ( sin(yaw),  0, cos(yaw) )
  //   right   = ( cos(yaw),  0, -sin(yaw) )
  const rightX = Math.cos(listenerYaw);
  const rightZ = -Math.sin(listenerYaw);

  // Dot product of the offset vector with the right direction gives the
  // lateral component. Clamp to [-1, 1].
  const lateral = dx * rightX + dz * rightZ;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return 0;

  return Math.max(-1, Math.min(1, lateral / dist));
}
