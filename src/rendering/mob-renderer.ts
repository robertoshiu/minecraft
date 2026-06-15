/**
 * mob-renderer.ts — blocky composite animal models for live mobs.
 *
 * Replaces the single-box renderer with Minecraft-style multi-part models:
 * body + head + legs (+ beak for chicken, arms for humanoids). Each mob is
 * a root TransformNode named `mob_${id}` with part meshes as children.
 *
 * Leg animation: when the mob is moving (horizontal speed > 0.02), leg
 * pivot TransformNodes oscillate in rotation.x using sin(age * 0.3 + phase)
 * with alternating phase per leg so opposite legs swing together.
 *
 * Materials are cached per hex color string (one StandardMaterial per color),
 * shared across all mobs and parts of that color. Every part mesh is
 * registered with the shadow sink on creation and removed before disposal.
 *
 * getMeshCount() returns the number of live mob ROOTS (= number of mobs),
 * not the total number of part meshes.
 */

import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import type { Mob } from "../mobs/entity";
import type { MobType } from "../rules/mob-stats";
import type { ShadowCasterSink } from "./world-renderer";
import { TICKS_PER_SECOND } from "../rules/mc-1.20";
import {
  legSwing, easeToRest, idleBob, tailSway, headPitch,
  DEFAULT_GAIT, type GaitParams,
} from "./mob-animation";

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

/** Max animation advance per sync, in ticks (~0.2s) — prevents a snap after a tab-switch/pause. */
const MAX_VISUAL_DT_TICKS = 4;

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

/** Base body color per mob type. */
const MOB_COLORS: Record<MobType, string> = {
  cow:      "#6b4f3a",
  pig:      "#e0a0a8",
  sheep:    "#e8e8e0",
  chicken:  "#f0e8c0",
  zombie:   "#3a7d3a",
  skeleton: "#d8d8d0",
  creeper:  "#2f7d33",
};

// ---------------------------------------------------------------------------
// Model definition types
// ---------------------------------------------------------------------------

/** Pivot role: which animation channel drives this part. */
type PivotRole = "leg" | "head" | "tail" | "ear";

/** Logical role used to look up the atlas UV region for a part. */
type PartRole =
  | "body" | "head" | "leg" | "snout" | "horn" | "beak" | "arm" | "tail" | "ear";

/** One part of a mob model: a box with size, local offset, optional color, optional leg flag. */
interface PartDef {
  /** Box dimensions. */
  w: number;
  h: number;
  d: number;
  /** Local position offset from the mob's root (feet at y=0, centered x/z). */
  x: number;
  y: number;
  z: number;
  /** Hex color override; if omitted uses the mob's base color. */
  color?: string;
  /**
   * DEPRECATED alias for pivotRole:"leg"; still honoured.
   * If true this part is a LEG: a pivot TransformNode is placed at (x, y, z)
   * and the box mesh is parented to the pivot with its origin at the top of
   * the box, so rotating the pivot swings the leg about the hip.
   */
  isLeg?: true;
  /** Which animation channel (if any) owns this part's pivot. */
  pivotRole?: PivotRole;
  /** Logical role → selects the atlas UV region (Task 5). Defaults to "body". */
  role?: PartRole;
}

/** Full model definition for a mob type. */
interface ModelDef {
  parts: PartDef[];
  /** Per-species gait tuning; defaults to DEFAULT_GAIT when omitted. */
  gait?: GaitParams;
}

// ---------------------------------------------------------------------------
// Model library
// ---------------------------------------------------------------------------

/**
 * Quadruped helper: returns 4 leg parts at the given corner positions.
 * `hipY` is the y of the top of the leg (hip joint); `legH` is the leg length;
 * `legW` / `legD` are the cross-section sizes.
 */
function quadLegs(hipY: number, legH: number, legW: number, legD: number, halfBW: number, halfBD: number): PartDef[] {
  // Front-left, front-right, back-left, back-right
  const corners: [number, number][] = [
    [-halfBW,  halfBD],
    [ halfBW,  halfBD],
    [-halfBW, -halfBD],
    [ halfBW, -halfBD],
  ];
  return corners.map(([cx, cz]) => ({
    w: legW, h: legH, d: legD,
    x: cx, y: hipY, z: cz,
    isLeg: true,
  }));
}

/** Models keyed by mob type. All Y coords are relative to feet (y=0). */
const MODELS: Record<MobType, ModelDef> = {
  // -------------------------------------------------------------------------
  // Cow  hitbox 0.9 × 1.4
  //  body: 0.8×0.6×0.5 lifted to y 0.5–1.1
  //  head: 0.5×0.45×0.45 at front
  //  4 legs: 0.2×0.5×0.2
  // -------------------------------------------------------------------------
  cow: {
    parts: [
      // body
      { w: 0.80, h: 0.60, d: 0.50, x: 0, y: 0.80, z: 0 },
      // head (front) — driven by head look channel.
      // Pivot sits at the neck base (y = 0.825 = old center 1.05 − h/2 0.225) so the
      // +h/2 box offset in buildModel restores the box centre to 1.05 exactly.
      { w: 0.50, h: 0.45, d: 0.45, x: 0, y: 0.825, z: 0.30, pivotRole: "head", role: "head" },
      // horns (two small dark bumps on top of head) — optional decorative parts
      { w: 0.08, h: 0.15, d: 0.08, x: -0.16, y: 1.38, z: 0.28, color: "#3b2a1a" },
      { w: 0.08, h: 0.15, d: 0.08, x:  0.16, y: 1.38, z: 0.28, color: "#3b2a1a" },
      // snout
      { w: 0.28, h: 0.18, d: 0.12, x: 0, y: 0.98, z: 0.54, color: "#c09070" },
      // tail — driven by tail sway channel
      { w: 0.12, h: 0.18, d: 0.08, x: 0, y: 0.85, z: -0.28, pivotRole: "tail", role: "tail" },
      // 4 legs — hip at y=0.50, leg length 0.50
      ...quadLegs(0.50, 0.50, 0.20, 0.20, 0.28, 0.18),
    ],
    gait: { freq: 0.28, amp: 0.45 },
  },

  // -------------------------------------------------------------------------
  // Pig  hitbox 0.9 × 0.9
  //  body: 0.75×0.45×0.55 at y 0.35–0.80
  //  head: 0.50×0.40×0.40
  //  snout: small pink rect on front of head
  //  4 legs: 0.18×0.35
  // -------------------------------------------------------------------------
  pig: {
    parts: [
      // body
      { w: 0.75, h: 0.45, d: 0.55, x: 0, y: 0.575, z: 0 },
      // head
      { w: 0.50, h: 0.40, d: 0.40, x: 0, y: 0.75, z: 0.28 },
      // snout
      { w: 0.28, h: 0.18, d: 0.10, x: 0, y: 0.70, z: 0.49, color: "#d07080" },
      // 4 legs — hip at y=0.35, leg 0.35 tall
      ...quadLegs(0.35, 0.35, 0.18, 0.18, 0.26, 0.18),
    ],
  },

  // -------------------------------------------------------------------------
  // Sheep  hitbox 0.9 × 1.3
  //  body (fluffy): 0.80×0.65×0.55 at y 0.50–1.15
  //  head: 0.42×0.42×0.42
  //  4 legs: 0.20×0.50
  // -------------------------------------------------------------------------
  sheep: {
    parts: [
      // body (wool — slightly lighter shade)
      { w: 0.80, h: 0.65, d: 0.55, x: 0, y: 0.825, z: 0, color: "#eaeae0" },
      // head
      { w: 0.42, h: 0.42, d: 0.42, x: 0, y: 1.11, z: 0.28 },
      // 4 legs — hip y=0.50, length 0.50
      ...quadLegs(0.50, 0.50, 0.20, 0.20, 0.26, 0.18),
    ],
  },

  // -------------------------------------------------------------------------
  // Chicken  hitbox 0.4 × 0.7
  //  body: 0.30×0.30×0.28 at y 0.30–0.60
  //  head: 0.22×0.22×0.22
  //  beak: tiny orange box
  //  2 thin legs: 0.07×0.30
  // -------------------------------------------------------------------------
  chicken: {
    parts: [
      // body
      { w: 0.30, h: 0.30, d: 0.28, x: 0, y: 0.45, z: 0 },
      // head
      { w: 0.22, h: 0.22, d: 0.22, x: 0, y: 0.64, z: 0.10 },
      // beak (orange)
      { w: 0.10, h: 0.08, d: 0.08, x: 0, y: 0.62, z: 0.23, color: "#f08000" },
      // 2 thin legs — hip y=0.30, length 0.30
      { w: 0.07, h: 0.30, d: 0.07, x: -0.08, y: 0.30, z: 0, isLeg: true },
      { w: 0.07, h: 0.30, d: 0.07, x:  0.08, y: 0.30, z: 0, isLeg: true },
    ],
  },

  // -------------------------------------------------------------------------
  // Zombie  hitbox 0.6 × 1.95  (humanoid upright)
  //  legs: 0.25×0.75 each, hip at y=0.75
  //  torso: 0.50×0.60 at y 0.75–1.35
  //  arms: 0.20×0.55 at sides, shoulder at y=1.35
  //  head: 0.50×0.50 at y 1.35–1.85
  // -------------------------------------------------------------------------
  zombie: {
    parts: [
      // torso
      { w: 0.50, h: 0.60, d: 0.25, x: 0, y: 1.05, z: 0 },
      // head
      { w: 0.50, h: 0.50, d: 0.50, x: 0, y: 1.60, z: 0 },
      // arms (slightly darker)
      { w: 0.20, h: 0.55, d: 0.20, x: -0.35, y: 1.075, z: 0, color: "#2f6a2f" },
      { w: 0.20, h: 0.55, d: 0.20, x:  0.35, y: 1.075, z: 0, color: "#2f6a2f" },
      // 2 legs — hip at y=0.75, length 0.75
      { w: 0.25, h: 0.75, d: 0.25, x: -0.125, y: 0.75, z: 0, isLeg: true },
      { w: 0.25, h: 0.75, d: 0.25, x:  0.125, y: 0.75, z: 0, isLeg: true },
    ],
  },

  // -------------------------------------------------------------------------
  // Skeleton  hitbox 0.6 × 1.99  (thinner humanoid)
  // -------------------------------------------------------------------------
  skeleton: {
    parts: [
      // torso (slimmer)
      { w: 0.40, h: 0.60, d: 0.20, x: 0, y: 1.05, z: 0 },
      // head
      { w: 0.45, h: 0.45, d: 0.45, x: 0, y: 1.625, z: 0 },
      // arms
      { w: 0.15, h: 0.55, d: 0.15, x: -0.30, y: 1.075, z: 0, color: "#c0c0b8" },
      { w: 0.15, h: 0.55, d: 0.15, x:  0.30, y: 1.075, z: 0, color: "#c0c0b8" },
      // 2 legs — hip at y=0.75
      { w: 0.18, h: 0.75, d: 0.18, x: -0.10, y: 0.75, z: 0, isLeg: true },
      { w: 0.18, h: 0.75, d: 0.18, x:  0.10, y: 0.75, z: 0, isLeg: true },
    ],
  },

  // -------------------------------------------------------------------------
  // Creeper  hitbox 0.6 × 1.7  (tall body + small head + 4 short legs)
  // -------------------------------------------------------------------------
  creeper: {
    parts: [
      // body (tall)
      { w: 0.50, h: 0.80, d: 0.30, x: 0, y: 0.90, z: 0 },
      // head (larger than body width)
      { w: 0.50, h: 0.50, d: 0.50, x: 0, y: 1.55, z: 0 },
      // 4 short legs — hip at y=0.30, length 0.30
      ...quadLegs(0.30, 0.30, 0.18, 0.18, 0.16, 0.10),
    ],
  },
};

// ---------------------------------------------------------------------------
// Per-mob record
// ---------------------------------------------------------------------------

/** Stored data for one rendered mob. */
interface MobRecord {
  root: TransformNode;
  /** All part meshes, in order, for shadow sink management. */
  partMeshes: Mesh[];
  /** Leg pivot nodes, in part order; length equals the number of leg parts. */
  legPivots: TransformNode[];
  /** Head pivot (look + bob driver), or null if the species has no head pivot. */
  headPivot: TransformNode | null;
  /** Tail/ear pivots driven by the sway channel. */
  swayPivots: TransformNode[];
  /** Continuous wall-clock animation time in ticks (advanced by real deltaTime when nowMs is provided). */
  visualClock: number;
}

// ---------------------------------------------------------------------------
// MobRenderer
// ---------------------------------------------------------------------------

/**
 * Renders blocky composite animal models for live mobs. Each mob gets a root
 * TransformNode (`mob_${id}`) with child box meshes forming its body parts.
 */
export class MobRenderer {
  private readonly scene: Scene;
  /** Live mob records keyed by mob id. */
  private readonly records = new Map<number, MobRecord>();
  /** One StandardMaterial per hex color string, shared across all mobs. */
  private readonly materials = new Map<string, StandardMaterial>();
  /** Optional shadow caster sink for CSM registration. */
  private shadowSink: ShadowCasterSink | null = null;
  /** Last wall-clock timestamp passed to sync(); undefined until first live call. */
  private lastNowMs: number | undefined = undefined;

  constructor(scene: Scene, shadowSink?: ShadowCasterSink) {
    this.scene = scene;
    this.shadowSink = shadowSink ?? null;
  }

  /**
   * Set (or replace) the shadow caster sink. Existing part meshes are NOT
   * retroactively registered — call this before the first sync.
   */
  setShadowSink(sink: ShadowCasterSink | null): void {
    this.shadowSink = sink;
  }

  // ---- Material cache -------------------------------------------------------

  /** Return (creating if needed) the cached material for a hex color string. */
  private materialFor(hexColor: string): StandardMaterial {
    const existing = this.materials.get(hexColor);
    if (existing !== undefined) return existing;

    const mat = new StandardMaterial(`mob-mat-${hexColor}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(hexColor);
    mat.specularColor = new Color3(0, 0, 0);
    this.materials.set(hexColor, mat);
    return mat;
  }

  // ---- Model building -------------------------------------------------------

  /**
   * Build all part meshes + pivot nodes for `mob`, parent them under `root`,
   * and return the record (without storing it).
   */
  private buildModel(mob: Mob, root: TransformNode): {
    partMeshes: Mesh[];
    legPivots: TransformNode[];
    headPivot: TransformNode | null;
    swayPivots: TransformNode[];
  } {
    const modelDef = MODELS[mob.type];
    const baseColor = MOB_COLORS[mob.type];
    const partMeshes: Mesh[] = [];
    const legPivots: TransformNode[] = [];
    let headPivot: TransformNode | null = null;
    const swayPivots: TransformNode[] = [];

    modelDef.parts.forEach((part, i) => {
      const color = part.color ?? baseColor;
      const mat = this.materialFor(color);
      const pivotRole: PivotRole | undefined =
        part.pivotRole ?? (part.isLeg ? "leg" : undefined);

      if (pivotRole === "leg") {
        // Create a pivot at the hip position relative to root.
        const pivot = new TransformNode(`mob_${mob.id}_legpivot_${i}`, this.scene);
        pivot.parent = root;
        pivot.position.set(part.x, part.y, part.z);

        // Create the leg box; its LOCAL y origin is at the top (hip),
        // so the box center sits at -legH/2 (i.e. the box hangs below the pivot).
        const box = CreateBox(
          `mob_${mob.id}_part_${i}`,
          { width: part.w, height: part.h, depth: part.d },
          this.scene,
        );
        box.parent = pivot;
        // Offset the box so its top aligns with the pivot (y=0 in pivot space).
        box.position.set(0, -part.h / 2, 0);
        box.material = mat;
        box.receiveShadows = true;
        this.shadowSink?.addShadowCaster(box);

        legPivots.push(pivot);
        partMeshes.push(box);
      } else if (pivotRole === "head") {
        // Create a pivot at the part's local position; box is a child offset so
        // rotation occurs about the pivot point (base of the head).
        const pivot = new TransformNode(`mob_${mob.id}_headpivot_${i}`, this.scene);
        pivot.parent = root;
        pivot.position.set(part.x, part.y, part.z);

        const box = CreateBox(
          `mob_${mob.id}_part_${i}`,
          { width: part.w, height: part.h, depth: part.d },
          this.scene,
        );
        box.parent = pivot;
        // Box center is offset so rotation pivots about the bottom of the head.
        box.position.set(0, part.h / 2, 0);
        box.material = mat;
        box.receiveShadows = true;
        this.shadowSink?.addShadowCaster(box);

        // First head pivot wins (models have a single head).
        if (headPivot === null) headPivot = pivot;
        partMeshes.push(box);
      } else if (pivotRole === "tail" || pivotRole === "ear") {
        // Create a pivot at the part's local position; box hangs from it.
        const pivot = new TransformNode(`mob_${mob.id}_${pivotRole}pivot_${i}`, this.scene);
        pivot.parent = root;
        pivot.position.set(part.x, part.y, part.z);

        const box = CreateBox(
          `mob_${mob.id}_part_${i}`,
          { width: part.w, height: part.h, depth: part.d },
          this.scene,
        );
        box.parent = pivot;
        // Box center offset below the pivot so rotation swings about the attachment point.
        box.position.set(0, -part.h / 2, 0);
        box.material = mat;
        box.receiveShadows = true;
        this.shadowSink?.addShadowCaster(box);

        swayPivots.push(pivot);
        partMeshes.push(box);
      } else {
        // Non-pivot part: position is the CENTER of the box in root space.
        const box = CreateBox(
          `mob_${mob.id}_part_${i}`,
          { width: part.w, height: part.h, depth: part.d },
          this.scene,
        );
        box.parent = root;
        box.position.set(part.x, part.y, part.z);
        box.material = mat;
        box.receiveShadows = true;
        this.shadowSink?.addShadowCaster(box);

        partMeshes.push(box);
      }
    });

    return { partMeshes, legPivots, headPivot, swayPivots };
  }

  // ---- sync -----------------------------------------------------------------

  /**
   * Reconcile rendered models with the live mob list each frame:
   *  - Build a root + model for any new mob.
   *  - Reposition/rotate every live root.
   *  - Animate leg pivots.
   *  - Dispose any record whose mob id is gone (removing from shadow sink first).
   */
  sync(mobs: Mob[], nowMs?: number, currentTick?: number): void {
    void currentTick; // currentTick: reserved for Tasks 7/8 (hit-flash / death-grace)

    let dtTicks = 0;
    if (nowMs !== undefined) {
      const prev = this.lastNowMs ?? nowMs;
      const raw = ((nowMs - prev) / 1000) * TICKS_PER_SECOND;
      dtTicks = Math.max(0, Math.min(raw, MAX_VISUAL_DT_TICKS));
      this.lastNowMs = nowMs;
    }

    const seen = new Set<number>();

    for (const mob of mobs) {
      seen.add(mob.id);

      let record = this.records.get(mob.id);

      if (record === undefined) {
        // Create the root TransformNode for this mob.
        const root = new TransformNode(`mob_${mob.id}`, this.scene);
        const { partMeshes, legPivots, headPivot, swayPivots } = this.buildModel(mob, root);
        record = { root, partMeshes, legPivots, headPivot, swayPivots, visualClock: 0 };
        this.records.set(mob.id, record);
      }

      // Update root transform: position at feet, rotate by yaw.
      record.root.position.set(mob.feet.x, mob.feet.y, mob.feet.z);
      record.root.rotation.y = mob.yaw;

      // Continuous animation clock: advance by real delta when available, else
      // fall back to the tick-quantized mob.age (test path → identical to before).
      record.visualClock += dtTicks;
      const t = nowMs !== undefined ? record.visualClock : mob.age;

      const speed = Math.hypot(mob.velocity.x, mob.velocity.z);
      const gait = MODELS[mob.type].gait ?? DEFAULT_GAIT;
      if (speed > 0.02) {
        record.legPivots.forEach((pivot, idx) => {
          // Alternate phase: even-indexed legs swing forward, odd swing backward.
          const phase = idx % 2 === 0 ? 0 : Math.PI;
          pivot.rotation.x = legSwing(t, phase, gait);
        });
      } else {
        // Ease legs back to rest position.
        for (const pivot of record.legPivots) {
          pivot.rotation.x = easeToRest(pivot.rotation.x);
        }
      }

      // Expressive channels (live path only; test path stays byte-identical).
      if (nowMs !== undefined) {
        if (record.headPivot !== null) {
          record.headPivot.rotation.x = headPitch(0.1) * 0.5; // fixed ambient down-tilt placeholder; dynamic look-at is a later task
        }
        for (const pivot of record.swayPivots) {
          pivot.rotation.z = tailSway(t);
        }
        // Idle bob: nudge root y above the feet position already set this frame.
        record.root.position.y = mob.feet.y + idleBob(t);
      }
    }

    // Despawn: remove mobs that are no longer present.
    for (const [id, record] of this.records) {
      if (seen.has(id)) continue;

      // Remove every part mesh from the shadow sink BEFORE disposing.
      for (const mesh of record.partMeshes) {
        this.shadowSink?.removeShadowCaster(mesh);
      }

      // Dispose root with all children (disposeChildren=true, doNotRecurse=false).
      record.root.dispose(false, true);

      this.records.delete(id);
    }
  }

  // ---- Accessors ------------------------------------------------------------

  /**
   * Number of live mob ROOTS currently rendered (not the number of part meshes).
   */
  getMeshCount(): number {
    return this.records.size;
  }

  // ---- dispose --------------------------------------------------------------

  /**
   * Remove all part meshes from the shadow sink, dispose all root TransformNodes
   * (and their children), then clear the material cache.
   */
  dispose(): void {
    for (const record of this.records.values()) {
      for (const mesh of record.partMeshes) {
        this.shadowSink?.removeShadowCaster(mesh);
      }
      record.root.dispose(false, true);
    }
    this.records.clear();

    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
  }
}
