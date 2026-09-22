import * as THREE from 'three'
import { loadAssets } from './assets.js'
import { createSea } from './sea.js'
import { createCourse, GATE_HALF } from './course.js'
import { createWorld } from './world.js'
import { Ship } from './ship.js'
import { createWake, createClouds } from './effects.js'
import { unlockAudio, toggleMute, isMuted, sfx } from './audio.js'
import { allScores, qualifies, addScore, loadSave, newSave, storeSave, formatTime, ordinal } from './scores.js'

const LAPS = 3
const COURSE_BUILD = 950 // build a regatta's course once this close to it
const COURSE_DROP = 1150
const START_REACH = 60 // how near the start line you must be to press E
const $ = (id) => document.getElementById(id)

// ---------------------------------------------------------------- scene

const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const SKY = 0x9fd9ee
const scene = new THREE.Scene()
scene.background = new THREE.Color(SKY)
scene.fog = new THREE.Fog(SKY, 200, 620)
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1500)

scene.add(new THREE.HemisphereLight(0xdff4ff, 0x1d6f8c, 1.5))
const sun = new THREE.DirectionalLight(0xfff0d0, 2.4)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 450 })
sun.shadow.bias = -0.0005
scene.add(sun, sun.target)
const SUN_OFFSET = new THREE.Vector3(120, 190, 70)

const sea = createSea()
const wake = createWake()
const clouds = createClouds()
scene.add(sea.mesh, wake.mesh, clouds.group)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// ---------------------------------------------------------------- game state

const CREWS = [
  { model: 'ship-pirate-large', player: true, color: '#f2b632', label: 'You' },
  { model: 'ship-pirate-medium', skill: 0.94, color: '#e0503a', label: 'Red Morgan' },
  { model: 'ship-ghost', skill: 0.96, color: '#7fe0c0', label: 'The Phantom' },
  { model: 'ship-pirate-small', skill: 0.9, color: '#d8d8d8', label: 'Salty Pete' },
]
const SPAWN = { x: 0, z: 0, heading: 0 }

let save = null
let world = null
let course = null
let regatta = null // the regatta whose course is built
let ships = []
let player = null
let rivals = []
let state = 'loading' // loading | menu | roam | countdown | racing | finished | paused
let screen = 'loading'
let returnTo = 'menu'
let worldTime = 0
let raceTime = 0
let countdown = 0
let lastCount = 0
let finishedCount = 0
let finishDelay = -1
let shake = 0
let freshEntry = null
let pausedFrom = 'roam'

const camPos = new THREE.Vector3(0, 40, -80)
const camLook = new THREE.Vector3()
const inRace = () => ['countdown', 'racing', 'finished'].includes(state) || (state === 'paused' && pausedFrom !== 'roam')

function makeWorld() {
  if (world) scene.remove(world.group)
  dropCourse()
  world = createWorld(save.seed, save.collected)
  scene.add(world.group)
  player.reset(SPAWN)
  world.stream(SPAWN.x, SPAWN.z, true)
}

function dropCourse() {
  if (course) scene.remove(course.group)
  course = null
  regatta = null
}

/** Keep the nearest regatta's course built while the player is in its waters. */
function manageCourse() {
  if (inRace()) return
  const p = player.group.position
  const near = world.nearestRegatta(p.x, p.z)
  if (course && Math.hypot(regatta.x - p.x, regatta.z - p.z) > COURSE_DROP) dropCourse()
  if (near.distance < COURSE_BUILD && (!regatta || regatta.id !== near.regatta.id)) {
    dropCourse()
    regatta = near.regatta
    course = createCourse(regatta.seed, regatta)
    scene.add(course.group)
  }
}

function setRivals(on) {
  for (const s of rivals) {
    s.group.visible = on
    if (on) scene.add(s.group)
    else scene.remove(s.group)
  }
}

// ---------------------------------------------------------------- screens

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === id)
  screen = id
  $('hud').hidden = !['roam', 'countdown', 'racing', 'finished', 'paused'].includes(state)
  const race = inRace()
  $('race-hud').hidden = !race
  $('roam-hud').hidden = race
  for (const el of document.querySelectorAll('[data-race-only]')) el.hidden = !race
  $('touch').hidden = !!id || $('hud').hidden || !TOUCH
  if (!id) document.activeElement?.blur()
  const first = id && $(id).querySelector('input, .btn.primary, .btn')
  if (first && !first.closest('[hidden]')) first.focus({ preventScroll: true })
}

function banner(text) {
  const el = $('banner')
  el.textContent = text
  el.classList.remove('pop')
  void el.offsetWidth // restart the animation
  el.classList.add('pop')
}

function toMenu() {
  state = 'menu'
  setRivals(false)
  dropCourse()
  player.reset(SPAWN)
  returnTo = 'menu'
  show('menu')
}

function setSail() {
  unlockAudio()
  state = 'roam'
  show(null)
  banner('Anchors aweigh!')
}

function startRace() {
  unlockAudio()
  if (!course) return
  const poses = course.startPoses(ships.length)
  ships.forEach((s, i) => s.reset(poses[i]))
  setRivals(true)
  wake.clear()
  finishedCount = 0
  raceTime = 0
  state = 'countdown'
  countdown = 3.99
  lastCount = 4
  finishDelay = -1
  returnTo = 'finish'
  show(null)
  banner(regatta.name)
}

function leaveRace() {
  setRivals(false)
  player.nextGate = 0
  player.lap = 0
  state = 'roam'
  returnTo = 'menu'
  show(null)
}

function pause() {
  if (!['roam', 'racing', 'countdown'].includes(state)) return
  pausedFrom = state
  state = 'paused'
  show('pause')
}
function resume() {
  state = pausedFrom
  show(null)
}

function renderScores() {
  const all = allScores()
  const boards = $('score-boards')
  boards.innerHTML = ''
  $('gold-line').textContent = `Treasure hoard: ${save.gold} doubloons`
  const entries = Object.entries(all).filter(([, b]) => b.list?.length)
  $('score-empty').hidden = entries.length > 0
  // Regattas in this world first
  entries.sort(([a], [b]) => (b.startsWith(`${save.seed}:`) ? 1 : 0) - (a.startsWith(`${save.seed}:`) ? 1 : 0))
  let delay = 0
  for (const [, board] of entries) {
    const section = document.createElement('section')
    section.className = 'board'
    const h = document.createElement('h3')
    h.textContent = board.name
    const ol = document.createElement('ol')
    for (const s of board.list) {
      const li = document.createElement('li')
      li.style.animationDelay = `${(delay += 50)}ms`
      if (freshEntry && s.date === freshEntry.date && s.time === freshEntry.time) li.classList.add('fresh')
      const who = document.createElement('div')
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = s.name
      const meta = document.createElement('span')
      meta.className = 'meta'
      meta.textContent = `${ordinal(s.place)} place · best lap ${formatTime(s.bestLap)} · ${new Date(s.date).toLocaleDateString()}`
      who.append(name, meta)
      const time = document.createElement('span')
      time.className = 'time'
      time.textContent = formatTime(s.time)
      li.append(who, time)
      ol.append(li)
    }
    section.append(h, ol)
    boards.append(section)
  }
}

function showFinish() {
  state = 'finished'
  const place = player.place
  const best = Math.min(...player.lapTimes)
  $('finish-title').textContent = ['Victory!', 'So close!', 'Not bad, sailor', 'Swabbing duty'][place - 1]
  const ahead = ships.filter((s) => s.finished && s.place < place).map((s) => s.label)
  $('finish-sub').textContent =
    place === 1 ? `${regatta.name} is yours, captain.` : `${ahead.join(' and ')} beat you to the chest.`
  $('finish-place').textContent = ordinal(place)
  $('finish-time').textContent = formatTime(player.finishTime)
  $('finish-lap').textContent = formatTime(best)
  const form = $('name-form')
  form.hidden = !qualifies(regatta.id, player.finishTime)
  if (!form.hidden) {
    try {
      $('name-input').value = localStorage.getItem('bd-name') || ''
    } catch {}
  }
  returnTo = 'finish'
  show('finish')
}

$('name-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const name = $('name-input').value.trim().slice(0, 14) || 'Nameless Scallywag'
  try {
    localStorage.setItem('bd-name', name)
  } catch {}
  freshEntry = {
    name,
    time: player.finishTime,
    bestLap: Math.min(...player.lapTimes),
    place: player.place,
    date: new Date().toISOString(),
  }
  const rank = addScore(regatta, freshEntry)
  $('name-form').hidden = true
  $('finish-sub').textContent = rank >= 0 ? `Logged at #${rank + 1} for ${regatta.name}.` : 'Logged.'
  sfx.bell()
  $('finish').querySelector('.btn.primary').focus()
})

const actions = {
  play: setSail,
  restart: startRace,
  leave: leaveRace,
  quit: toMenu,
  scores: () => {
    renderScores()
    show('scores')
  },
  howto: () => show('howto'),
  back: () => show(returnTo),
  resume,
  pausebtn: () => (state === 'paused' ? resume() : pause()),
  newworld: () => {
    save = newSave(save.gold)
    makeWorld()
    banner('New waters charted')
  },
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]')
  if (!btn) return
  unlockAudio()
  sfx.click()
  actions[btn.dataset.action]?.()
})

$('mute').classList.toggle('off', isMuted())
$('mute').addEventListener('click', () => {
  unlockAudio()
  $('mute').classList.toggle('off', toggleMute())
})

// ---------------------------------------------------------------- input

const keys = new Set()
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
  keys.add(e.code)
  if (e.repeat) return
  if (e.code === 'KeyM') {
    unlockAudio()
    $('mute').classList.toggle('off', toggleMute())
  }
  if (e.code === 'Escape') {
    if (state === 'paused') resume()
    else if (screen === 'scores' || screen === 'howto') show(returnTo)
    else pause()
  }
  if (e.code === 'KeyE' && state === 'roam' && nearStart()) startRace()
  if (e.code === 'Enter' && screen === 'menu' && document.activeElement === document.body) setSail()
})
window.addEventListener('keyup', (e) => keys.delete(e.code))
window.addEventListener('blur', () => {
  keys.clear()
  pause()
})

// Touch controls: the on-screen buttons add and remove the same key codes the
// keyboard uses, so the rest of the game needs no changes.
const TOUCH = matchMedia('(pointer: coarse)').matches
if (TOUCH) {
  document.body.classList.add('touch')
  $('pause-btn').hidden = false
  for (const btn of document.querySelectorAll('#touch [data-key]')) {
    const code = btn.dataset.key
    const press = (e) => {
      e.preventDefault()
      unlockAudio()
      keys.add(code)
      btn.classList.add('on')
      btn.setPointerCapture?.(e.pointerId)
    }
    const release = () => {
      keys.delete(code)
      btn.classList.remove('on')
    }
    btn.addEventListener('pointerdown', press)
    btn.addEventListener('pointerup', release)
    btn.addEventListener('pointercancel', release)
    btn.addEventListener('lostpointercapture', release)
    btn.addEventListener('contextmenu', (e) => e.preventDefault())
  }
  // Tapping the "race here" prompt starts the regatta, in place of pressing E.
  $('prompt').addEventListener('click', () => {
    if (state === 'roam' && nearStart()) startRace()
  })
}

const playerInputOverride = {}
function playerInput() {
  const k = (...codes) => codes.some((c) => keys.has(c))
  return {
    throttle: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
    steer: (k('KeyA', 'ArrowLeft') ? 1 : 0) - (k('KeyD', 'ArrowRight') ? 1 : 0),
    boost: k('Space', 'ShiftLeft', 'ShiftRight'),
    ...playerInputOverride,
  }
}

function nearStart() {
  if (!course) return false
  const g = course.gates[0].pos
  const p = player.group.position
  return Math.hypot(g.x - p.x, g.z - p.z) < START_REACH
}

// ---------------------------------------------------------------- race logic

const tmp = new THREE.Vector3()

/** How far round the whole race a ship is, in world units. */
function raceDistance(s) {
  const g = course.gates[s.nextGate]
  const gateGap = course.length / course.gates.length
  return s.gatesPassed * gateGap - Math.hypot(g.pos.x - s.group.position.x, g.pos.z - s.group.position.z)
}

function checkGate(s, prev) {
  if (s.finished) return // they sail on, but their race is over
  const g = course.gates[s.nextGate]
  const before = tmp.set(prev.x - g.pos.x, 0, prev.z - g.pos.z).dot(g.tangent)
  const p = s.group.position
  const d = tmp.set(p.x - g.pos.x, 0, p.z - g.pos.z)
  const after = d.dot(g.tangent)
  const lateral = d.dot(g.normal)
  if (!(before < 0 && after >= 0 && Math.abs(lateral) < GATE_HALF + 2)) return

  s.gatesPassed++
  s.nextGate = (g.index + 1) % course.gates.length
  if (g.index !== 0) {
    if (s.player) sfx.gate()
    return
  }
  if (s.lap > 0) s.lapTimes.push(raceTime - s.lapStart)
  s.lap++
  s.lapStart = raceTime
  if (s.lap > LAPS) {
    s.finished = true
    s.finishTime = raceTime
    s.place = ++finishedCount
    if (s.player) {
      banner(s.place === 1 ? 'Victory!' : `${ordinal(s.place)} place`)
      if (s.place === 1) sfx.fanfare()
      else sfx.lose()
      finishDelay = 2.4
    }
  } else if (s.player && s.lap > 1) {
    sfx.bell()
    banner(s.lap === LAPS ? 'Final lap!' : `Lap ${s.lap}`)
  }
}

function standings() {
  return ships.filter((s) => s.group.visible).sort((a, b) => {
    if (a.finished || b.finished) return (a.finished ? a.place : 99) - (b.finished ? b.place : 99)
    return raceDistance(b) - raceDistance(a)
  })
}

function updateShips(dt) {
  const racing = state === 'racing' || state === 'finished'
  const sailing = state === 'roam' || racing
  const playerDist = racing ? raceDistance(player) : 0
  const prev = new THREE.Vector3()
  const active = racing || state === 'countdown' ? ships : [player]

  for (const s of active) {
    prev.copy(s.group.position)
    if (sailing) {
      let input
      if (s.player && !(racing && s.finished)) input = playerInput()
      else {
        // Mild rubber-banding keeps rivals in sight without making them unbeatable
        const gap = s.player ? 0 : raceDistance(s) - playerDist
        input = s.think(dt, course, worldTime, THREE.MathUtils.clamp(1 - gap * 0.00025, 0.92, 1.05))
      }
      s.drive(dt, input)
      let hit = s.collide(world.colliders)
      if (course) hit = s.collide(course.colliders) || hit
      if (hit && s.player) {
        sfx.thud()
        shake = 0.6
      }
    }
    if (course && (racing || state === 'countdown')) {
      s.progress = course.nearest(s.group.position.x, s.group.position.z, s.progress)
      if (racing) checkGate(s, prev)
    }
    if (s.player && s.boosting && !s.wasBoosting) sfx.whoosh()
    s.wasBoosting = s.boosting
  }
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) Ship.separate(active[i], active[j])
  for (const s of active) {
    s.float(worldTime, dt)
    wake.trail(s, dt)
  }

  // Fish treasure out of the water
  if (sailing) {
    const got = world.collect(player.group.position.x, player.group.position.z)
    if (got) {
      save.gold += got * 10
      storeSave(save)
      sfx.coin()
      const loot = $('loot')
      loot.textContent = `+${got * 10} doubloons`
      loot.classList.remove('pop')
      void loot.offsetWidth
      loot.classList.add('pop')
    }
  }

  // Wrong way warning
  if (state === 'racing' && !player.finished) {
    const tan = course.tangents[player.progress]
    const wrong = player.forward.dot(tan) < -0.2 && Math.abs(player.speed) > 3
    player.wrongWay = wrong ? player.wrongWay + dt : 0
  } else player.wrongWay = 0
}

// ---------------------------------------------------------------- HUD

const mini = $('minimap').getContext('2d')

/** Draws the chart centred on (cx, cz), turned so `heading` points up. */
function drawChart(cx, cz, heading, range) {
  const scale = 78 / range
  const f = { x: Math.sin(heading), z: Math.cos(heading) }
  const r = { x: -Math.cos(heading), z: Math.sin(heading) } // screen right
  const X = (x, z) => 90 + ((x - cx) * r.x + (z - cz) * r.z) * scale
  const Y = (x, z) => 90 - ((x - cx) * f.x + (z - cz) * f.z) * scale
  mini.clearRect(0, 0, 180, 180)
  mini.save()
  mini.beginPath()
  mini.arc(90, 90, 88, 0, Math.PI * 2)
  mini.clip()

  const dot = (x, z, rad, color) => {
    mini.fillStyle = color
    mini.beginPath()
    mini.arc(X(x, z), Y(x, z), Math.max(1.5, rad * scale), 0, Math.PI * 2)
    mini.fill()
  }
  for (const feat of world.features) {
    const color = feat.kind === 'rocks' || feat.kind === 'wreck' ? '#8a8f94' : '#e9cf8f'
    for (const c of feat.colliders) dot(c.x, c.z, c.r, color)
  }
  if (course) {
    for (const isl of course.islands) dot(isl.x, isl.z, isl.r, '#e9cf8f')
    mini.strokeStyle = inRace() ? 'rgba(255,255,255,0.6)' : 'rgba(255,211,90,0.5)'
    mini.lineWidth = 2.5
    mini.beginPath()
    course.samples.forEach((p, i) => (i ? mini.lineTo(X(p.x, p.z), Y(p.x, p.z)) : mini.moveTo(X(p.x, p.z), Y(p.x, p.z))))
    mini.closePath()
    mini.stroke()
    if (inRace()) {
      const g = course.gates[player.nextGate].pos
      mini.fillStyle = '#ffc233'
      mini.beginPath()
      mini.arc(X(g.x, g.z), Y(g.x, g.z), 4, 0, Math.PI * 2)
      mini.fill()
    }
  }
  for (const t of world.treasures) {
    mini.fillStyle = '#ffc233'
    mini.fillRect(X(t.x, t.z) - 2.5, Y(t.x, t.z) - 2.5, 5, 5)
  }
  mini.restore()

  // The nearest regatta's beacon; when it's far off it sits on the rim, pointing the way
  if (!inRace()) {
    for (const reg of [world.nearestRegatta(cx, cz).regatta]) {
      let sx = X(reg.x, reg.z) - 90
      let sy = Y(reg.x, reg.z) - 90
      const d = Math.hypot(sx, sy)
      if (d > 80) {
        sx = (sx / d) * 80
        sy = (sy / d) * 80
      }
      mini.fillStyle = '#ffc233'
      mini.strokeStyle = '#3b2412'
      mini.lineWidth = 1.5
      mini.beginPath()
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2
        const rr = i % 2 ? 3 : 7
        mini.lineTo(90 + sx + Math.cos(a) * rr, 90 + sy + Math.sin(a) * rr)
      }
      mini.closePath()
      mini.fill()
      mini.stroke()
    }
  }

  for (const s of ships) {
    if (!s.group.visible) continue
    const p = s.group.position
    mini.save()
    mini.translate(X(p.x, p.z), Y(p.x, p.z))
    mini.rotate(-(s.heading - heading))
    mini.fillStyle = s.color
    mini.strokeStyle = '#3b2412'
    mini.lineWidth = 1.5
    const k = s.player ? 1.4 : 1
    mini.beginPath()
    mini.moveTo(0, -6 * k)
    mini.lineTo(4 * k, 4 * k)
    mini.lineTo(-4 * k, 4 * k)
    mini.closePath()
    mini.fill()
    mini.stroke()
    mini.restore()
  }
}

function updateHud() {
  const p = player.group.position
  if (inRace()) {
    const lap = THREE.MathUtils.clamp(player.lap, 1, LAPS)
    $('hud-lap').textContent = `${lap}/${LAPS}`
    const place = player.finished ? player.place : standings().indexOf(player) + 1
    $('hud-place').textContent = ordinal(place)
    $('hud-time').textContent = formatTime(player.finished ? player.finishTime : raceTime)
    drawChart(p.x, p.z, player.heading, 360)
    $('prompt').hidden = true
  } else {
    $('hud-gold').textContent = save.gold
    const near = world.nearestRegatta(p.x, p.z)
    $('hud-reg-name').textContent = near.regatta.name
    $('hud-reg-dist').textContent = near.distance < 400 ? 'Here!' : `${Math.round(near.distance / 10) * 10} m`
    drawChart(p.x, p.z, player.heading, 450)
    const prompt = $('prompt')
    const showPrompt = state === 'roam' && nearStart()
    if (showPrompt) prompt.textContent = TOUCH ? `Tap here to race ${regatta.name}` : `Press E to race ${regatta.name}`
    prompt.hidden = !showPrompt
  }
  $('boost-fill').style.width = `${player.boost * 100}%`
  $('boost-fill').parentElement.parentElement.classList.toggle('ready', player.boost > 0.99)
  $('wrong-way').hidden = player.wrongWay < 1.2
}

// ---------------------------------------------------------------- camera

function updateCamera(dt) {
  const p = player.group.position
  if (state === 'menu') {
    // Slow orbit around the ship, waiting in port
    const a = worldTime * 0.1
    tmp.set(p.x + Math.cos(a) * 55, 22, p.z + Math.sin(a) * 55)
    camPos.lerp(tmp, 1 - Math.exp(-2 * dt))
    camLook.lerp(tmp.copy(p).setY(6), 1 - Math.exp(-4 * dt))
  } else {
    const f = player.forward
    const pre = state === 'countdown'
    tmp.copy(p).addScaledVector(f, pre ? -18 : -24).setY(p.y + (pre ? 20 : 13))
    camPos.lerp(tmp, 1 - Math.exp(-5 * dt))
    camLook.lerp(tmp.copy(p).addScaledVector(f, 12).setY(p.y + 3), 1 - Math.exp(-8 * dt))
  }
  camera.position.copy(camPos)
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 2)
    camera.position.x += (Math.random() - 0.5) * shake * 1.6
    camera.position.y += (Math.random() - 0.5) * shake * 1.6
  }
  camera.lookAt(camLook)
  const fov = player.boosting && state !== 'menu' ? 74 : 62
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = THREE.MathUtils.damp(camera.fov, fov, 4, dt)
    camera.updateProjectionMatrix()
  }
  sun.position.copy(camLook).add(SUN_OFFSET)
  sun.target.position.copy(camLook)
}

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock()
function frame() {
  tick(Math.min(clock.getDelta(), 0.05))
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

function tick(dt) {
  if (!world || state === 'paused' || state === 'loading') return
  worldTime += dt
  if (state === 'countdown') {
    countdown -= dt
    const n = Math.ceil(countdown)
    if (n !== lastCount) {
      lastCount = n
      if (n > 0) {
        if (n < 4) banner(String(n))
        sfx.beep()
      } else {
        banner('Set sail!')
        sfx.cannon()
        state = 'racing'
      }
    }
  } else if (state === 'racing' && !player.finished) raceTime += dt

  const p = player.group.position
  world.stream(p.x, p.z)
  manageCourse()
  updateShips(dt)
  if (finishDelay > 0 && (finishDelay -= dt) <= 0) showFinish()
  world.update(worldTime)
  course?.update(worldTime, inRace() ? player.nextGate : -1)
  wake.update(worldTime, dt)
  clouds.update(dt)
  updateCamera(dt)
  sea.update(worldTime, camLook)
  if (!$('hud').hidden) updateHud()
}

// Dev-only hook for play-testing: advance the game by `seconds` in fixed steps
if (import.meta.env.DEV) {
  window.__game = {
    step(seconds, input) {
      if (input) Object.assign(playerInputOverride, input)
      for (let i = 0; i < seconds * 60; i++) tick(1 / 60)
      renderer.render(scene, camera)
      return {
        state,
        raceTime,
        lap: player.lap,
        gate: player.nextGate,
        speed: player.speed,
        pos: [Math.round(player.group.position.x), Math.round(player.group.position.z)],
        regatta: regatta?.name,
        gold: save.gold,
      }
    },
    release: () => Object.keys(playerInputOverride).forEach((k) => delete playerInputOverride[k]),
    teleport(x, z, heading = player.heading) {
      player.reset({ x, z, heading })
    },
    startRace,
    get player() {
      return player
    },
    get course() {
      return course
    },
    get world() {
      return world
    },
  }
}

// ---------------------------------------------------------------- boot

const started = performance.now()
loadAssets((p) => {
  $('load-fill').style.width = `${Math.round(p * 100)}%`
  $('load-text').textContent = `${['Hoisting the sails', 'Loading the cannons', 'Burying the treasure', 'Charting the islands'][Math.min(3, Math.floor(p * 4))]}… ${Math.round(p * 100)}%`
})
  .then(() => document.fonts.ready)
  .then(() => new Promise((r) => setTimeout(r, Math.max(0, 900 - (performance.now() - started)))))
  .then(() => {
    ships = CREWS.map((c) => new Ship(c.model, c))
    player = ships[0]
    rivals = ships.slice(1)
    scene.add(player.group)
    save = loadSave()
    makeWorld()
    toMenu()
    clock.getDelta()
  })
  .catch((err) => {
    console.error(err)
    $('load-text').textContent = 'The map blew overboard. Refresh to try again.'
  })

requestAnimationFrame(frame)
