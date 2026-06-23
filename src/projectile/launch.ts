import type { Vec3 } from "../mobs/entity";

/** Normalize aimDir and produce a spawn origin (eye + dir*spawnOffset) and velocity (dir*speed). */
export function launchProjectile(
  eye: Vec3, aimDir: Vec3, speed: number, spawnOffset: number,
): { origin: Vec3; velocity: Vec3 } {
  const len = Math.hypot(aimDir.x, aimDir.y, aimDir.z) || 1;
  const nx = aimDir.x / len, ny = aimDir.y / len, nz = aimDir.z / len;
  const origin: Vec3 = { x: eye.x + nx * spawnOffset, y: eye.y + ny * spawnOffset, z: eye.z + nz * spawnOffset };
  const velocity: Vec3 = { x: nx * speed, y: ny * speed, z: nz * speed };
  return { origin, velocity };
}
