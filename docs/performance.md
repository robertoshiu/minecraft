# Performance Guide

## Target

**60 fps @ 1080p @ view distance 8** in Chrome and Edge desktop (WebGL2).

View distance 8 means a 17x17 column grid (289 columns) is potentially visible at once, each column up to 16 chunks tall — up to ~4600 chunk meshes in memory, with ~289 visible per frame.

---

## Key Bottlenecks

### 1. Greedy Meshing (CPU)

Generating a mesh for a new chunk column involves running the greedy mesher over each 16x16x16 slice. This is the most CPU-intensive operation:

- Runs on the main thread (no worker yet)
- A cold chunk column (all new terrain) triggers 16 mesh jobs
- Each mesh job allocates typed arrays for quads

**Mitigation in place:** Greedy meshing reduces quad count by 10-100x vs naive meshing, keeping mesh upload time and GPU vertex count low. Chunk loading is spread across multiple frames via a load queue in `world-renderer.ts`.

### 2. Skylight Propagation (CPU)

BFS skylight fill runs per chunk column after terrain generation. In open terrain (few caves) the BFS is fast, but deep cave systems with many transparent blocks can cause long BFS queues.

**Mitigation in place:** Propagation is bounded per column and only runs on chunk generation, not on every block edit (edits trigger a partial re-propagation of the affected column only).

### 3. Mob AI (CPU, per tick)

Each live mob runs a pathfinding and state-machine tick. With many mobs in range this scales linearly.

**Mitigation in place:** AI ticks are skipped for mobs outside a 48-block activation range. Pathfinding uses spatial hashing for neighbor lookup rather than brute-force world queries.

### 4. Draw Calls (GPU)

Each visible chunk mesh is one draw call. At view distance 8, this is up to 289 draw calls per frame (one per column, since each column is merged into a single mesh).

**Mitigation in place:** Each chunk column's meshes are merged into a single `Mesh` per column in `rendering/chunk-mesh.ts`, keeping draw calls at `O(visible columns)` rather than `O(visible chunks)`.

### 5. Chunk Upload (GPU)

Uploading a new `VertexData` to the GPU stalls the pipeline briefly. Many simultaneous uploads (e.g., on initial load) can cause frame drops.

**Mitigation in place:** `world-renderer.ts` limits chunk mesh uploads to a configurable cap per frame (default: 4 uploads/frame), spreading the cost over multiple frames.

---

## Optimization Strategies

### Greedy Meshing

Merges coplanar, same-block visible faces into maximal rectangles. This is implemented in `src/meshing/greedy.ts`. The algorithm:

1. For each of the 6 face directions, scan each 2D slice of the chunk
2. Sweep across the slice marking visited cells
3. Extend each unvisited face greedily in X, then Y, to form the largest possible rectangle
4. Emit one quad per rectangle

Result: a flat grassy plain emits ~1 quad for the entire top surface instead of 256 individual face quads.

### 1-Voxel Neighbor Border

`src/chunk/data.ts` stores an 18x18x18 array (16x16x16 logical + 1 border on each face). The borders are populated from neighboring chunks when a chunk is loaded. This lets the greedy mesher determine face visibility at chunk edges without a world query per face.

### Chunk LOD (future)

View distance beyond 8 chunks is planned to use lower-resolution meshes (2x2x2 voxels merged into 1 logical block). Not yet implemented.

### Spatial Hashing for Mob AI

Mob neighbor queries (collision avoidance, player detection) use a spatial hash grid instead of checking all mobs. Grid cell size matches the activation radius, keeping lookups O(1) amortized.

### IndexedDB Async Writes

Save operations write to IndexedDB asynchronously and do not block the game loop. The `store.ts` layer uses a write queue to prevent transaction conflicts.

---

## How to Profile

### Babylon.js Inspector

The Babylon.js Inspector provides frame timing, draw call counts, and mesh statistics.

Open in browser console:

```javascript
// Open the inspector panel
BABYLON.Inspector.Show(scene, { embedMode: true })
```

Key tabs:
- **Scene tab** → active meshes, total vertices, draw calls per frame
- **Performance tab** → frame time breakdown (CPU/GPU)
- **Statistics tab** → texture memory, VBO sizes

### Chrome DevTools Performance Panel

1. Open DevTools (F12) → Performance tab
2. Click Record
3. Play the game for 5-10 seconds (move around to trigger chunk loads)
4. Stop recording

Look for:
- Long tasks (>50ms) on the main thread — these cause visible frame drops
- `greedyMesh` or `generateColumn` call stacks for meshing cost
- `IDBTransaction` call stacks for save I/O cost

### Chrome DevTools Rendering Panel

Enable via More tools → Rendering:

- **FPS meter** — overlay showing current frame rate and frame time
- **Layer borders** — shows how many composited layers the UI creates (keep low)
- **Paint flashing** — shows areas being repainted (HUD should be mostly static)

### Babylon.js `engine.getFps()`

Quick runtime check:

```javascript
// In browser console:
engine.getFps()           // current FPS
engine.getDeltaTime()     // last frame time in ms
scene.meshes.length       // total mesh count
scene.getActiveMeshes().length  // frustum-culled active count
```

### Identifying Chunk Mesh Cost

```javascript
// In browser console (dev build):
// Force-load a chunk and time the mesh build:
console.time('mesh')
// (trigger a player move to a new area)
console.timeEnd('mesh')
```

---

## Performance Checklist

Before shipping a build, verify:

- [ ] 60 fps sustained while walking in open terrain (view distance 8)
- [ ] No frame drop below 30 fps during initial chunk load burst
- [ ] Draw call count <= 350 at view distance 8 (289 columns + UI overhead)
- [ ] Memory usage stable over 10 minutes of play (no chunk leak)
- [ ] Save operation completes in < 500ms (no noticeable freeze)
- [ ] Mob AI tick cost < 2ms/frame with 20 active mobs in range
- [ ] Greedy mesh job < 5ms per chunk column (worst case: dense varied terrain)
