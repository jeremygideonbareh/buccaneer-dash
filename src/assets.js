import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Kenney Pirate Kit (CC0), see public/models/LICENSE-kenney.txt
const NAMES = [
  'ship-pirate-large',
  'ship-pirate-medium',
  'ship-pirate-small',
  'ship-ghost',
  'patch-sand',
  'patch-sand-foliage',
  'patch-grass-foliage',
  'palm-bend',
  'palm-straight',
  'palm-detailed-bend',
  'palm-detailed-straight',
  'rocks-a',
  'rocks-b',
  'rocks-c',
  'rocks-sand-a',
  'rocks-sand-b',
  'rocks-sand-c',
  'chest',
  'barrel',
  'crate',
  'tower-complete-small',
  'ship-wreck',
  'structure-platform-dock',
  'flag-pirate',
  'flag-pirate-high',
  'flag-pennant',
  'grass-plant',
  'cannon',
  'tower-complete-large',
  'tower-watch',
  'structure',
  'structure-roof',
  'structure-platform',
  'structure-fence',
  'castle-wall',
  'castle-gate',
  'boat-row-small',
  'crate-bottles',
  'bottle-large',
  'platform-planks',
]

const models = {}

/** Loads every model, reporting 0..1 progress. */
export function loadAssets(onProgress) {
  const manager = new THREE.LoadingManager()
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total)
  const loader = new GLTFLoader(manager)
  const base = import.meta.env.BASE_URL
  return Promise.all(
    NAMES.map((name) =>
      loader.loadAsync(`${base}models/${name}.glb`).then((gltf) => {
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        models[name] = gltf.scene
      }),
    ),
  )
}

/** A fresh copy of a loaded model (materials are shared, which is fine: nothing recolours them). */
export function model(name) {
  const m = models[name]
  if (!m) throw new Error(`Unknown model: ${name}`)
  return m.clone(true)
}
