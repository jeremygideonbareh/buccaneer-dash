import * as THREE from 'three'

/** Height of the sea surface at (x, z) and time t. Ships use this to bob and tilt. */
export function waveHeight(x, z, t) {
  return (
    0.55 * Math.sin(x * 0.045 + t * 1.1) +
    0.4 * Math.sin(z * 0.06 - t * 0.85) +
    0.25 * Math.sin((x + z) * 0.1 + t * 1.6)
  )
}

const SIZE = 1400
const SEGMENTS = 110
const CELL = SIZE / SEGMENTS

/**
 * A faceted low-poly sea. The mesh follows the camera, snapped to its grid so
 * the facets don't swim, and fog hides the edge.
 */
export function createSea() {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  geo.rotateX(-Math.PI / 2)
  const base = geo.attributes.position.array.slice()
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1c86a8,
    roughness: 0.35,
    metalness: 0.05,
    flatShading: true,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true

  function update(t, focus) {
    const ox = Math.round(focus.x / CELL) * CELL
    const oz = Math.round(focus.z / CELL) * CELL
    mesh.position.set(ox, 0, oz)
    const pos = geo.attributes.position.array
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] = waveHeight(base[i] + ox, base[i + 2] + oz, t)
    }
    geo.attributes.position.needsUpdate = true
  }

  return { mesh, update }
}
