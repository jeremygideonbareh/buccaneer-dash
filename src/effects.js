import * as THREE from 'three'
import { waveHeight } from './sea.js'

const SEA = new THREE.Color(0x1c86a8)
const FOAM = new THREE.Color(0xffffff)
const UP = new THREE.Vector3(0, 1, 0)

/** Foam puffs left behind moving ships. They spread out and fade into the sea. */
export function createWake(count = 1200) {
  const geo = new THREE.CircleGeometry(1, 6)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  const puffs = Array.from({ length: count }, () => ({ x: 0, z: 0, age: 1, life: 1, size: 1, spin: 0 }))
  let next = 0
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const c = new THREE.Color()

  function emit(x, z, size = 1, life = 1.6) {
    const puff = puffs[next]
    next = (next + 1) % count
    const jitter = () => (Math.random() - 0.5) * 1.2
    Object.assign(puff, { x: x + jitter(), z: z + jitter(), age: 0, life, size, spin: Math.random() * Math.PI })
  }

  /** Called per ship each frame; emits from the stern and both sides of the bow. */
  function trail(ship, dt) {
    // Drop foam by distance travelled, so the trail stays even at any speed
    const speed = Math.abs(ship.speed)
    ship.wakeDist = (ship.wakeDist || 0) + speed * dt
    if (speed < 4 || ship.wakeDist < 1.6) return
    ship.wakeDist = 0
    const pos = ship.group.position
    const f = ship.forward
    const big = ship.boosting ? 1.5 : 1
    emit(pos.x - f.x * 6, pos.z - f.z * 6, 0.9 * big)
    for (const side of [-1, 1]) {
      emit(pos.x + f.x * 4 + f.z * side * 2.6, pos.z + f.z * 4 - f.x * side * 2.6, 0.45 * big, 1)
    }
  }

  function update(t, dt) {
    for (let i = 0; i < count; i++) {
      const puff = puffs[i]
      puff.age += dt
      const k = Math.min(1, puff.age / puff.life)
      const size = k >= 1 ? 0 : puff.size * (0.7 + k * 1.8) * (1 - k * k * 0.6)
      p.set(puff.x, waveHeight(puff.x, puff.z, t) + 0.12, puff.z)
      q.setFromAxisAngle(UP, puff.spin)
      s.set(size, 1, size)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.copy(FOAM).lerp(SEA, Math.min(1, k * 1.3)))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  function clear() {
    for (const puff of puffs) puff.age = puff.life
  }

  return { mesh, trail, update, clear }
}

/** Chunky low-poly clouds drifting overhead. */
export function createClouds() {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })
  const geo = new THREE.IcosahedronGeometry(1, 0)
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group()
    const puffs = 3 + Math.floor(Math.random() * 4)
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(geo, mat)
      const r = 8 + Math.random() * 10
      puff.scale.set(r * 1.4, r * 0.8, r)
      puff.position.set((j - puffs / 2) * 12 + Math.random() * 6, Math.random() * 5, Math.random() * 10)
      cloud.add(puff)
    }
    const a = Math.random() * Math.PI * 2
    const d = 150 + Math.random() * 600
    cloud.position.set(Math.cos(a) * d, 110 + Math.random() * 60, Math.sin(a) * d)
    cloud.rotation.y = Math.random() * Math.PI
    group.add(cloud)
  }
  return {
    group,
    update(dt) {
      for (const cloud of group.children) {
        cloud.position.x += dt * 3
        if (cloud.position.x > 800) cloud.position.x = -800
      }
    },
  }
}
