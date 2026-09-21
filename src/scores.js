// Top 10 times for each regatta, plus the treasure haul, kept in this browser only.
const KEY = 'bd-highscores-v2'
const MAX = 10

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

/** { [regattaId]: { name, list: [{ name, time, bestLap, place, date }] } } */
export function allScores() {
  const all = read(KEY, {})
  return all && typeof all === 'object' ? all : {}
}

export function qualifies(regattaId, time) {
  const list = allScores()[regattaId]?.list ?? []
  return list.length < MAX || time < list[list.length - 1].time
}

/** Adds an entry and returns its rank (0-based), or -1 if it didn't make the log. */
export function addScore(regatta, entry) {
  const all = allScores()
  const board = all[regatta.id] ?? { name: regatta.name, list: [] }
  board.list.push(entry)
  board.list.sort((a, b) => a.time - b.time)
  const rank = board.list.indexOf(entry)
  board.list = board.list.slice(0, MAX)
  all[regatta.id] = board
  write(KEY, all)
  return rank < MAX ? rank : -1
}

// The world: its seed, and which treasures have been fished out
export function loadSave() {
  const save = read('bd-save', null)
  if (save && Number.isFinite(save.seed)) return { seed: save.seed, gold: save.gold || 0, collected: new Set(save.collected || []) }
  return newSave()
}
/** A fresh world. Doubloons come along with you. */
export function newSave(gold = 0) {
  const save = { seed: Math.floor(Math.random() * 2 ** 31), gold, collected: new Set() }
  storeSave(save)
  return save
}
export function storeSave(save) {
  write('bd-save', { seed: save.seed, gold: save.gold, collected: [...save.collected] })
}

export function formatTime(s) {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`
}

export const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th')
