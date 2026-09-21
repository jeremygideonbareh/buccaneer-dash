import * as THREE from 'three'
import { model } from './assets.js'
import { waveHeight } from './sea.js'

// Kenney's ships already face +z, which is heading 0 here.
export const MODEL_YAW = 0

const MAX_SPEED = 34
const BOOST_SPEED = 52
const REVERSE_SPEED = -10
const RADIUS = 4.4

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

export class Ship {
  constructor(name, { player = false, skill = 1, color = '#fff', label = '' } = {}) {
    this.player = player
    this.skill = skill
    this.color = color
    this.label = label
    this.group = new THREE.Group()
    this.hull = new THREE.Group() // bobs and tilts inside the group
    const m = model(name)
    m.rotation.y = MODEL_YAW
    m.position.y = -1.1
    this.hull.add(m)
    this.group.add(this.hull)

    // Sails and flags get a little life of their own
    this.flutter = []
    m.traverse((o) => {
      if (/^(flag|sail)/.test(o.name) && !o.isMesh) {
        this.flutter.push({ o, rot: o.rotation.clone(), scale: o.scale.clone(), phase: Math.random() * 6, flag: o.name.startsWith('flag') })
      }
    })
    this.reset({ x: 0, z: 0, heading: 0 })
  }

  reset({ x, z, heading }) {
    this.group.position.set(x, 0, z)
    this.heading = heading
    this.speed = 0
    this.steerLean = 0
    this.boost = 1
    this.boosting = false
    this.lap = 0
    this.nextGate = 0
    this.gatesPassed = 0
    this.lapStart = 0
    this.lapTimes = []
    this.finished = false
    this.finishTime = 0
    this.progress = -1
    this.lane = (Math.random() - 0.5) * 16
    this.stuck = 0
    this.reversing = 0
    this.bumped = 0
    this.wrongWay = 0
    this.rubber = 1
    this.syncTransform()
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading))
  }

  /** input: { throttle -1..1, steer -1..1 (positive = left), boost bool } */
  drive(dt, input) {
    const wantBoost = input.boost && this.boost > (this.boosting ? 0 : 0.2) && input.throttle > 0
    this.boosting = wantBoost
    if (this.boosting) this.boost = Math.max(0, this.boost - dt * 0.4)
    else this.boost = Math.min(1, this.boost + dt * 0.11)

    const top = (this.boosting ? BOOST_SPEED : MAX_SPEED) * this.skill * this.rubber
    if (input.throttle > 0) this.speed += (this.boosting ? 30 : 15) * input.throttle * dt
    else if (input.throttle < 0) this.speed += (this.speed > 0 ? -28 : -9) * -input.throttle * dt
    this.speed -= this.speed * (input.throttle === 0 ? 0.5 : 0.12) * dt
    if (this.speed > top) this.speed = THREE.MathUtils.damp(this.speed, top, 3, dt)
    this.speed = Math.max(REVERSE_SPEED, this.speed)

    // Ships need way on to turn; at a crawl the rudder barely bites
    const grip = THREE.MathUtils.clamp(Math.abs(this.speed) / 12, 0.2, 1) * Math.sign(this.speed || 1)
    this.heading += input.steer * 1.45 * grip * dt
    this.steerLean = THREE.MathUtils.damp(this.steerLean, input.steer * Math.min(1, Math.abs(this.speed) / MAX_SPEED), 4, dt)

    const f = this.forward
    this.group.position.addScaledVector(f, this.speed * dt)
  }

  /** Push out of islands, rocks and buoys. Returns true on a fresh knock. */
  collide(colliders) {
    const p = this.group.position
    let hit = false
    for (const c of colliders) {
      const dx = p.x - c.x
      const dz = p.z - c.z
      const min = c.r + RADIUS
      const d2 = dx * dx + dz * dz
      if (d2 >= min * min) continue
      const d = Math.sqrt(d2) || 0.001
      p.x = c.x + (dx / d) * min
      p.z = c.z + (dz / d) * min
      if (this.bumped <= 0 && Math.abs(this.speed) > 6) hit = true
      this.speed *= 0.55
      this.bumped = 0.4
    }
    return hit
  }

  static separate(a, b) {
    const pa = a.group.position
    const pb = b.group.position
    const dx = pa.x - pb.x
    const dz = pa.z - pb.z
    const d = Math.hypot(dx, dz)
    const min = RADIUS * 2
    if (d >= min || d === 0) return false
    const push = (min - d) / 2
    pa.x += (dx / d) * push
    pa.z += (dz / d) * push
    pb.x -= (dx / d) * push
    pb.z -= (dz / d) * push
    // A glancing knock costs a little way, scaled by how hard they overlap
    const loss = 1 - Math.min(0.04, push * 0.02)
    a.speed *= loss
    b.speed *= loss
    return true
  }

  /** Steering for rival crews: chase a point a little way down the racing line. */
  think(dt, course, t, rubber) {
    const idx = this.progress < 0 ? 0 : this.progress
    const ahead = (idx + 22) % course.SAMPLES
    const p = course.samples[ahead]
    const tan = course.tangents[ahead]
    const lane = this.lane + Math.sin(t * 0.3 + this.skill * 20) * 5
    const tx = p.x + tan.z * lane
    const tz = p.z - tan.x * lane
    const want = Math.atan2(tx - this.group.position.x, tz - this.group.position.z)
    const diff = angleDiff(want, this.heading)

    if (Math.abs(this.speed) < 2) this.stuck += dt
    else this.stuck = 0
    if (this.stuck > 1.5) {
      this.reversing = 1.2
      this.stuck = 0
    }
    if (this.reversing > 0) {
      this.reversing -= dt
      return { throttle: -1, steer: -Math.sign(diff), boost: false }
    }

    this.rubber = rubber
    return {
      throttle: Math.abs(diff) > 0.9 ? 0.4 : 1,
      steer: THREE.MathUtils.clamp(diff * 2.2, -1, 1),
      boost: (this.boost > 0.95 && Math.abs(diff) < 0.12) || (this.boosting && Math.abs(diff) < 0.3),
    }
  }

  /** Bob on the waves, tilt with the swell and lean into turns. */
  float(t, dt) {
    this.bumped -= dt
    const p = this.group.position
    const f = this.forward
    const hBow = waveHeight(p.x + f.x * 5, p.z + f.z * 5, t)
    const hStern = waveHeight(p.x - f.x * 5, p.z - f.z * 5, t)
    const hPort = waveHeight(p.x + f.z * 2.4, p.z - f.x * 2.4, t)
    const hStar = waveHeight(p.x - f.z * 2.4, p.z + f.x * 2.4, t)
    p.y = (hBow + hStern) / 2
    const speedPitch = -Math.min(Math.max(this.speed, 0), BOOST_SPEED) * 0.0025
    this.hull.rotation.x = Math.atan2(hStern - hBow, 10) + speedPitch
    this.hull.rotation.z = Math.atan2(hPort - hStar, 4.8) * 0.6 - this.steerLean * 0.22
    this.syncTransform()

    const wind = 0.5 + Math.min(1, Math.abs(this.speed) / MAX_SPEED)
    for (const s of this.flutter) {
      if (s.flag) {
        s.o.rotation.y = s.rot.y + Math.sin(t * 7 + s.phase) * 0.18 * wind
      } else {
        s.o.scale.z = s.scale.z * (1 + Math.sin(t * 3 + s.phase) * 0.04 + (this.boosting ? 0.12 : 0))
      }
    }
  }

  syncTransform() {
    this.group.rotation.y = this.heading
  }
}
