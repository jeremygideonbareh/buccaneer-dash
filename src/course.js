import * as THREE from 'three'
import { model } from './assets.js'
import { rng, smallIsland } from './islands.js'

export const GATE_HALF = 24 // half the gap between a gate's two buoys
const GATES = 14
const SAMPLES = 800
const RADIUS = 230
/** Open-world islands must keep this far from a course's centre. */
export const COURSE_CLEAR = 430

const beaconMat = new THREE.MeshBasicMaterial({
  color: 0xffd35a,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: false,
})
const markerMat = new THREE.MeshStandardMaterial({
  color: 0xffc233,
  emissive: 0xb87400,
  emissiveIntensity: 0.8,
  roughness: 0.3,
  metalness: 0.6,
})

/**
 * Builds a closed course around `center`: a wobbly loop through GATES buoy
 * gates, with islands and rocks scattered off the racing line. Everything is
 * derived from `seed`, so a regatta is the same course every visit.
 */
export function createCourse(seed, center = { x: 0, z: 0 }) {
  const rand = rng(seed)
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const group = new THREE.Group()
  const colliders = [] // { x, z, r }

  // The racing line: control points around a circle with jittered angle and radius
  const n = 9
  const points = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.35
    const r = RADIUS * (0.68 + rand() * 0.55)
    points.push(new THREE.Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r))
  }
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal')
  const length = curve.getLength()
  const samples = curve.getSpacedPoints(SAMPLES).slice(0, SAMPLES)
  const tangents = samples.map((_, i) => curve.getTangentAt(i / SAMPLES))

  const distToLine = (x, z) => {
    let best = Infinity
    for (const p of samples) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2)
    return Math.sqrt(best)
  }

  // Gates: two barrel buoys each. Gate 0 is the start/finish, marked by towers.
  const gates = []
  for (let i = 0; i < GATES; i++) {
    const u = i / GATES
    const pos = curve.getPointAt(u)
    const tangent = curve.getTangentAt(u)
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x)
    gates.push({ pos, tangent, normal, index: i, sample: Math.round(u * SAMPLES) % SAMPLES })

    for (const side of [-1, 1]) {
      const p = pos.clone().addScaledVector(normal, side * GATE_HALF)
      const buoy = new THREE.Group()
      if (i === 0) {
        const tower = model('tower-complete-small')
        tower.scale.setScalar(1.6)
        tower.position.y = -2
        const flag = model('flag-pirate-high')
        flag.scale.setScalar(2)
        flag.position.y = 8.5
        buoy.add(tower, flag)
        colliders.push({ x: p.x, z: p.z, r: 3.6 })
      } else {
        const barrel = model('barrel')
        barrel.scale.setScalar(2.2)
        barrel.position.y = -0.8
        const flag = model('flag-pennant')
        flag.scale.setScalar(2)
        flag.position.y = 1.6
        buoy.add(barrel, flag)
        buoy.userData.bob = rand() * 6
        colliders.push({ x: p.x, z: p.z, r: 2.2 })
      }
      buoy.position.copy(p)
      buoy.rotation.y = rand() * Math.PI * 2
      group.add(buoy)
    }
  }

  // The dock beside the start line
  {
    const g = gates[0]
    const dock = model('structure-platform-dock')
    dock.scale.setScalar(2.2)
    dock.position.copy(g.pos).addScaledVector(g.normal, GATE_HALF + 16)
    dock.position.y = -1
    dock.rotation.y = Math.atan2(g.normal.x, g.normal.z)
    group.add(dock)
    colliders.push({ x: dock.position.x, z: dock.position.z, r: 7 })
  }

  // Islands: rejection-sample spots clear of the racing line and each other
  const islands = []
  for (let tries = 0; tries < 160 && islands.length < 12; tries++) {
    const x = center.x + (rand() - 0.5) * RADIUS * 2.9
    const z = center.z + (rand() - 0.5) * RADIUS * 2.9
    const s = 3 + rand() * 2.4
    const r = s * 3.5
    if (Math.hypot(x - center.x, z - center.z) > COURSE_CLEAR - r - 10) continue
    if (distToLine(x, z) < r + GATE_HALF + 16) continue
    if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 24)) continue
    const island = smallIsland(x, z, s, rand, { landmark: islands.length === 0 })
    islands.push(island)
    group.add(island.group)
    colliders.push(...island.colliders)
  }

  // Rocks just off the line, to punish lazy corners
  let rocks = 0
  for (let tries = 0; tries < 120 && rocks < 10; tries++) {
    const i = Math.floor(rand() * SAMPLES)
    const p = samples[i]
    const t = tangents[i]
    const side = rand() < 0.5 ? -1 : 1
    const off = GATE_HALF + 12 + rand() * 30
    const x = p.x + t.z * side * off
    const z = p.z - t.x * side * off
    if (distToLine(x, z) < GATE_HALF + 10) continue
    if (Math.hypot(x - center.x, z - center.z) > COURSE_CLEAR - 15) continue
    if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 14)) continue
    const rock = model(pick(['rocks-a', 'rocks-b', 'rocks-c']))
    const s = 1.8 + rand() * 1.4
    rock.scale.setScalar(s)
    rock.position.set(x, -1.2, z)
    rock.rotation.y = rand() * Math.PI * 2
    group.add(rock)
    colliders.push({ x, z, r: 2.4 * s })
    rocks++
  }

  // A shipwreck somewhere scenic, off the line
  for (let tries = 0; tries < 60; tries++) {
    const x = center.x + (rand() - 0.5) * RADIUS * 2.4
    const z = center.z + (rand() - 0.5) * RADIUS * 2.4
    if (Math.hypot(x - center.x, z - center.z) > COURSE_CLEAR - 20) continue
    if (distToLine(x, z) < GATE_HALF + 30) continue
    if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 20)) continue
    const wreck = model('ship-wreck')
    wreck.scale.setScalar(1.5)
    wreck.position.set(x, -1.5, z)
    wreck.rotation.set(0.15, rand() * Math.PI * 2, 0.3)
    group.add(wreck)
    colliders.push({ x, z, r: 8 })
    break
  }

  // Spinning gold ring that marks the player's next gate
  const marker = new THREE.Mesh(new THREE.TorusGeometry(7, 0.9, 6, 20), markerMat)
  group.add(marker)

  // A tall beam of light over the start line, so sailors can find the regatta
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 400, 10, 1, true), beaconMat)
  beacon.position.set(gates[0].pos.x, 200, gates[0].pos.z)
  group.add(beacon)

  /** Nearest sample index to (x, z), searching near `hint` when given. */
  function nearest(x, z, hint = -1) {
    let best = hint
    let bestD = Infinity
    const scan = (i) => {
      const p = samples[(i + SAMPLES) % SAMPLES]
      const d = (p.x - x) ** 2 + (p.z - z) ** 2
      if (d < bestD) {
        bestD = d
        best = (i + SAMPLES) % SAMPLES
      }
    }
    if (hint < 0) for (let i = 0; i < SAMPLES; i++) scan(i)
    else for (let i = hint - 40; i <= hint + 40; i++) scan(i)
    return best
  }

  /** Grid positions behind the start line, two abreast. */
  function startPoses(count) {
    const poses = []
    for (let k = 0; k < count; k++) {
      const row = Math.floor(k / 2)
      const u = 1 - (22 + row * 20) / length
      const p = curve.getPointAt(u)
      const t = curve.getTangentAt(u)
      const lateral = (k % 2 ? 1 : -1) * 9
      poses.push({
        x: p.x + t.z * lateral,
        z: p.z - t.x * lateral,
        heading: Math.atan2(t.x, t.z),
      })
    }
    return poses
  }

  /** nextGate < 0 means no race is on: show the beacon instead of the ring. */
  function update(t, nextGate) {
    beacon.visible = nextGate < 0
    beacon.material.opacity = 0.22 + Math.sin(t * 2) * 0.06
    for (const c of group.children) {
      if (c.userData.bob !== undefined) {
        c.position.y = Math.sin(t * 1.4 + c.userData.bob) * 0.5
        c.rotation.z = Math.sin(t * 1.1 + c.userData.bob) * 0.08
      }
    }
    const g = gates[nextGate]
    marker.visible = !!g
    if (g) {
      marker.position.set(g.pos.x, 12 + Math.sin(t * 2.5) * 1.2, g.pos.z)
      marker.rotation.y = t * 1.8
    }
  }

  return {
    group,
    curve,
    length,
    samples,
    tangents,
    gates,
    colliders,
    islands,
    nearest,
    startPoses,
    update,
    SAMPLES,
  }
}
