import * as THREE from 'three'
import { model } from './assets.js'

// Island builders shared by the open world and the race courses.
// Kenney's sand patch is about 7.7 x 6 units; islands scale it up.

const sandMat = new THREE.MeshStandardMaterial({ color: 0xe9cf8f, roughness: 1, flatShading: true })
const skirtGeo = new THREE.CylinderGeometry(3.5, 4.3, 3, 9)

/** Small seeded RNG, so anything can be rebuilt from its seed. */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mixes grid coordinates and a seed into one 32-bit number. */
export function hash(x, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

const pickFrom = (rand) => (arr) => arr[Math.floor(rand() * arr.length)]
const PALMS = ['palm-bend', 'palm-straight', 'palm-detailed-bend', 'palm-detailed-straight']

function sandTile(parent, x, z, top) {
  const skirt = new THREE.Mesh(skirtGeo, sandMat)
  skirt.scale.z = 0.78
  skirt.position.set(x, -1.45, z)
  skirt.receiveShadow = true
  parent.add(skirt)
  const patch = model(top)
  patch.position.set(x, 0, z)
  parent.add(patch)
}

function prop(parent, rand, name, scale, cx = 0, cz = 0, spread = 1) {
  const m = model(name)
  m.position.set(cx + (rand() - 0.5) * 4.6 * spread, 0.2, cz + (rand() - 0.5) * 3.4 * spread)
  m.rotation.y = rand() * Math.PI * 2
  m.scale.setScalar(scale)
  parent.add(m)
  return m
}

/** One sand patch with a few palms. Returns the group, its colliders and radius. */
export function smallIsland(x, z, s, rand, { landmark = false } = {}) {
  const pick = pickFrom(rand)
  const group = new THREE.Group()
  group.position.set(x, 0.6, z)
  group.rotation.y = rand() * Math.PI * 2
  group.scale.setScalar(s)
  sandTile(group, 0, 0, pick(['patch-sand', 'patch-sand-foliage', 'patch-grass-foliage']))

  if (landmark) {
    prop(group, rand, 'tower-complete-small', 0.9).position.set(0, 0.2, 0)
    const flag = model('flag-pirate')
    flag.position.set(0, 6.3, 0)
    flag.scale.setScalar(0.8)
    group.add(flag)
  } else {
    const palms = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < palms; i++) prop(group, rand, pick(PALMS), 0.7 + rand() * 0.35)
  }
  if (rand() < 0.7) prop(group, rand, pick(['rocks-sand-a', 'rocks-sand-b', 'rocks-sand-c']), 0.5)
  if (rand() < 0.35) prop(group, rand, pick(['chest', 'barrel', 'crate', 'cannon']), 0.45)
  if (rand() < 0.5) prop(group, rand, 'grass-plant', 0.6)

  const r = s * 3.5
  return { group, colliders: [{ x, z, r: r * 0.9 }], r, x, z, kind: 'small' }
}

/**
 * A big island grown tile by tile from sand patches, with a fort, huts,
 * a dock and plenty of palms. Colliders are one circle per tile.
 */
export function largeIsland(x, z, rand) {
  const pick = pickFrom(rand)
  const S = 4
  const CX = 6.1
  const CZ = 4.7

  // Grow a blob on a grid by random walk
  const tiles = new Map([['0,0', [0, 0]]])
  const target = 6 + Math.floor(rand() * 9)
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  while (tiles.size < target) {
    const [i, j] = [...tiles.values()][Math.floor(rand() * tiles.size)]
    const [di, dj] = pick(dirs)
    const key = `${i + di},${j + dj}`
    // Stay within a 5x5 footprint so the island fits the space reserved for it
    if (Math.abs(i + di) > 2 || Math.abs(j + dj) > 2) continue
    if (!tiles.has(key)) tiles.set(key, [i + di, j + dj])
  }
  const list = [...tiles.values()]
  const mi = list.reduce((a, t) => a + t[0], 0) / list.length
  const mj = list.reduce((a, t) => a + t[1], 0) / list.length
  const neighbours = ([i, j]) => dirs.filter(([di, dj]) => tiles.has(`${i + di},${j + dj}`)).length

  const group = new THREE.Group()
  group.position.set(x, 0.6, z)
  const rot = rand() * Math.PI * 2
  group.rotation.y = rot
  group.scale.setScalar(S)

  // Most-surrounded tile gets the fort; a lonely edge tile gets the dock
  const byInner = [...list].sort((a, b) => neighbours(b) - neighbours(a))
  const fort = byInner[0]
  const edge = byInner[byInner.length - 1]
  const huts = new Set(byInner.slice(1, 1 + Math.min(4, Math.floor(list.length / 3))))

  const colliders = []
  let r = 0
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  for (const t of list) {
    const lx = (t[0] - mi) * CX
    const lz = (t[1] - mj) * CZ
    const inner = neighbours(t) >= 3
    sandTile(group, lx, lz, inner ? 'patch-grass-foliage' : pick(['patch-sand', 'patch-sand-foliage']))

    if (t === fort) {
      const tower = model('tower-complete-large')
      tower.position.set(lx, 0.2, lz)
      tower.scale.setScalar(0.85)
      const flag = model('flag-pirate-high')
      flag.position.set(lx, 8.8, lz)
      flag.scale.setScalar(0.7)
      group.add(tower, flag)
      for (const side of [-1, 1]) {
        const wall = model('castle-wall')
        wall.position.set(lx + side * 2.3, 0.2, lz)
        wall.scale.setScalar(0.6)
        group.add(wall)
      }
      prop(group, rand, 'cannon', 0.5, lx, lz + 2)
    } else if (huts.has(t)) {
      const hut = model('structure')
      hut.position.set(lx, 0.2, lz)
      hut.rotation.y = rand() * Math.PI * 2
      hut.scale.setScalar(0.75)
      group.add(hut)
      prop(group, rand, pick(['crate-bottles', 'barrel', 'crate']), 0.45, lx + 1.6, lz + 1)
      prop(group, rand, pick(PALMS), 0.8, lx - 2, lz - 1.2, 0.3)
    } else {
      const palms = 1 + Math.floor(rand() * 3)
      for (let i = 0; i < palms; i++) prop(group, rand, pick(PALMS), 0.75 + rand() * 0.35, lx, lz)
      if (rand() < 0.5) prop(group, rand, pick(['rocks-sand-a', 'rocks-sand-b', 'rocks-sand-c']), 0.55, lx, lz)
      if (rand() < 0.3) prop(group, rand, pick(['chest', 'barrel', 'grass-plant', 'tower-watch']), 0.5, lx, lz)
    }

    // Tile centre in world space, for its collider
    const wx = x + (lx * cos + lz * sin) * S
    const wz = z + (-lx * sin + lz * cos) * S
    colliders.push({ x: wx, z: wz, r: 3.5 * S })
    r = Math.max(r, Math.hypot(wx - x, wz - z) + 3.5 * S)
  }

  // Dock reaching out from the edge tile, with a rowing boat alongside
  {
    const ex = (edge[0] - mi) * CX
    const ez = (edge[1] - mj) * CZ
    const len = Math.hypot(ex, ez) || 1
    const ox = ex / len
    const oz = ez / len
    const dock = model('structure-platform-dock')
    dock.position.set(ex + ox * 4.2, -0.4, ez + oz * 4.2)
    dock.rotation.y = Math.atan2(ox, oz)
    dock.scale.setScalar(0.9)
    const boat = model('boat-row-small')
    boat.position.set(ex + ox * 5 + oz * 2.4, -0.35, ez + oz * 5 - ox * 2.4)
    boat.rotation.y = Math.atan2(ox, oz) + 0.3
    boat.scale.setScalar(0.8)
    boat.userData.bob = rand() * 6
    group.add(dock, boat)
  }

  return { group, colliders, r, x, z, kind: 'large' }
}

/** A cluster of sea rocks. */
export function rockCluster(x, z, rand) {
  const pick = pickFrom(rand)
  const group = new THREE.Group()
  const colliders = []
  const n = 1 + Math.floor(rand() * 3)
  for (let i = 0; i < n; i++) {
    const rock = model(pick(['rocks-a', 'rocks-b', 'rocks-c']))
    const s = 1.8 + rand() * 1.6
    const rx = x + (rand() - 0.5) * 18
    const rz = z + (rand() - 0.5) * 18
    rock.scale.setScalar(s)
    rock.position.set(rx, -1.2, rz)
    rock.rotation.y = rand() * Math.PI * 2
    group.add(rock)
    colliders.push({ x: rx, z: rz, r: 2.4 * s })
  }
  return { group, colliders, r: 24, x, z, kind: 'rocks' }
}

export function shipwreck(x, z, rand) {
  const wreck = model('ship-wreck')
  wreck.scale.setScalar(1.5)
  wreck.position.set(x, -1.5, z)
  wreck.rotation.set(0.15, rand() * Math.PI * 2, 0.3)
  return { group: wreck, colliders: [{ x, z, r: 8 }], r: 12, x, z, kind: 'wreck' }
}
