import * as THREE from 'three'
import { model } from './assets.js'
import { rng, hash, smallIsland, largeIsland, rockCluster, shipwreck } from './islands.js'
import { COURSE_CLEAR } from './course.js'

// The open sea is split into square chunks, generated on demand from the world
// seed as the player sails, and dropped again once they're far behind.
const CHUNK = 420
const LOAD_RADIUS = 2 // chunks each way that should exist
const DROP_RADIUS = 3
// Regattas live on a coarser grid: one per region, somewhere near its middle
const REGION = 1680
const SPAWN_CLEAR = 110

const PREFIX = ['Skull', 'Parrot', 'Kraken', 'Mermaid', 'Cutlass', 'Rum', 'Doubloon', 'Barnacle', 'Gull', 'Serpent', 'Blackwater', 'Gallows']
const PLACE = ['Cove', 'Reef', 'Bay', 'Shoals', 'Strait', 'Lagoon', 'Sound', 'Narrows', 'Keys']

const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.35, depthWrite: false })

export function createWorld(seed, collected = new Set()) {
  const group = new THREE.Group()
  const chunks = new Map() // "cx,cz" -> chunk
  const queue = []
  let colliders = []
  let features = [] // islands, rocks etc. for the minimap
  let treasures = []
  let dirty = true

  /** The regatta in region (rx, rz). Region 0,0's sits just ahead of the spawn. */
  function regatta(rx, rz) {
    const rand = rng(hash(rx, rz, seed ^ 0x5eed))
    const name = `${PREFIX[Math.floor(rand() * PREFIX.length)]} ${PLACE[Math.floor(rand() * PLACE.length)]}`
    const home = rx === 0 && rz === 0
    return {
      id: `${seed}:${rx},${rz}`,
      name: `${name} Regatta`,
      seed: hash(rx, rz, seed ^ 0xc0de),
      x: home ? 0 : rx * REGION + (rand() - 0.5) * 600,
      z: home ? 520 : rz * REGION + (rand() - 0.5) * 600,
    }
  }

  function regattasNear(x, z, reach = 1) {
    const rx = Math.round(x / REGION)
    const rz = Math.round(z / REGION)
    const list = []
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) list.push(regatta(rx + i, rz + j))
    return list
  }

  function nearestRegatta(x, z) {
    let best = null
    let bestD = Infinity
    for (const r of regattasNear(x, z)) {
      const d = Math.hypot(r.x - x, r.z - z)
      if (d < bestD) {
        bestD = d
        best = r
      }
    }
    return { regatta: best, distance: bestD }
  }

  function buildChunk(cx, cz) {
    const rand = rng(hash(cx, cz, seed))
    const chunk = { cx, cz, group: new THREE.Group(), colliders: [], features: [], treasures: [] }
    const x0 = cx * CHUNK
    const z0 = cz * CHUNK
    const nearby = regattasNear(x0 + CHUNK / 2, z0 + CHUNK / 2)

    const tryPlace = (r, make) => {
      for (let tries = 0; tries < 12; tries++) {
        const m = r + 12
        const x = x0 + m + rand() * (CHUNK - 2 * m)
        const z = z0 + m + rand() * (CHUNK - 2 * m)
        if (Math.hypot(x, z) < SPAWN_CLEAR + r) continue
        if (nearby.some((g) => Math.hypot(g.x - x, g.z - z) < COURSE_CLEAR + r)) continue
        if (chunk.features.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r + 30)) continue
        const f = make(x, z)
        chunk.group.add(f.group)
        chunk.colliders.push(...f.colliders)
        chunk.features.push(f)
        return f
      }
      return null
    }

    if (rand() < 0.5) tryPlace(90, (x, z) => largeIsland(x, z, rand))
    const small = 1 + Math.floor(rand() * 4)
    for (let i = 0; i < small; i++) {
      const s = 2.4 + rand() * 2.8
      tryPlace(s * 3.5, (x, z) => smallIsland(x, z, s, rand, { landmark: rand() < 0.12 }))
    }
    const rocks = Math.floor(rand() * 3)
    for (let i = 0; i < rocks; i++) tryPlace(24, (x, z) => rockCluster(x, z, rand))
    if (rand() < 0.2) tryPlace(12, (x, z) => shipwreck(x, z, rand))

    // Floating treasure to fish out of the water
    const loot = Math.floor(rand() * 3)
    for (let i = 0; i < loot; i++) {
      const id = `${seed}:${cx},${cz}:${i}`
      const x = x0 + 30 + rand() * (CHUNK - 60)
      const z = z0 + 30 + rand() * (CHUNK - 60)
      if (collected.has(id)) continue
      if (chunk.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 10)) continue
      const t = new THREE.Group()
      const raft = model('platform-planks')
      raft.scale.setScalar(2.4)
      const chest = model('chest')
      chest.scale.setScalar(2.4)
      chest.position.y = 1
      const glow = new THREE.Mesh(new THREE.RingGeometry(4.5, 6, 16), glowMat)
      glow.rotation.x = -Math.PI / 2
      glow.position.y = 0.4
      t.add(raft, chest, glow)
      t.position.set(x, 0, z)
      t.userData.phase = rand() * 6
      chunk.group.add(t)
      chunk.treasures.push({ id, x, z, mesh: t })
    }

    // Rowing boats and buoys on islands bob via userData.bob
    chunk.bobbers = []
    chunk.group.traverse((o) => o.userData.bob !== undefined && chunk.bobbers.push(o))
    return chunk
  }

  const key = (cx, cz) => `${cx},${cz}`

  /** Stream chunks around (x, z). With `all`, build everything now (used at load). */
  function stream(x, z, all = false) {
    const pcx = Math.floor(x / CHUNK)
    const pcz = Math.floor(z / CHUNK)
    for (const [k, c] of chunks) {
      if (Math.abs(c.cx - pcx) > DROP_RADIUS || Math.abs(c.cz - pcz) > DROP_RADIUS) {
        group.remove(c.group)
        chunks.delete(k)
        dirty = true
      }
    }
    queue.length = 0
    for (let i = -LOAD_RADIUS; i <= LOAD_RADIUS; i++)
      for (let j = -LOAD_RADIUS; j <= LOAD_RADIUS; j++) if (!chunks.has(key(pcx + i, pcz + j))) queue.push([pcx + i, pcz + j])
    queue.sort((a, b) => Math.hypot(a[0] - pcx, a[1] - pcz) - Math.hypot(b[0] - pcx, b[1] - pcz))
    // One chunk per frame keeps sailing smooth; the far ones are hidden by fog anyway
    const budget = all ? queue.length : 1
    for (let n = 0; n < budget && queue.length; n++) {
      const [cx, cz] = queue.shift()
      const c = buildChunk(cx, cz)
      chunks.set(key(cx, cz), c)
      group.add(c.group)
      dirty = true
    }
    if (dirty) {
      colliders = []
      features = []
      treasures = []
      for (const c of chunks.values()) {
        colliders.push(...c.colliders)
        features.push(...c.features)
        treasures.push(...c.treasures)
      }
      dirty = false
    }
  }

  function update(t) {
    for (const c of chunks.values()) {
      for (const o of c.bobbers) {
        o.position.y = -0.35 + Math.sin(t * 1.4 + o.userData.bob) * 0.12
      }
      for (const tr of c.treasures) {
        tr.mesh.position.y = Math.sin(t * 1.6 + tr.mesh.userData.phase) * 0.5
        tr.mesh.rotation.y = t * 0.6 + tr.mesh.userData.phase
      }
    }
  }

  /** Picks up any treasure within reach of (x, z); returns how many. */
  function collect(x, z) {
    let got = 0
    for (const c of chunks.values()) {
      c.treasures = c.treasures.filter((tr) => {
        if (Math.hypot(tr.x - x, tr.z - z) > 9) return true
        c.group.remove(tr.mesh)
        collected.add(tr.id)
        got++
        return false
      })
    }
    if (got) dirty = true
    return got
  }

  return {
    group,
    stream,
    update,
    collect,
    nearestRegatta,
    regattasNear,
    get colliders() {
      return colliders
    },
    get features() {
      return features
    },
    get treasures() {
      return treasures
    },
  }
}
