import { System } from './System'

import * as THREE from '../extras/three'
import { DEG2RAD, RAD2DEG } from '../extras/general'
import { clamp, num, uuid } from '../utils'
import { LerpVector3 } from '../extras/LerpVector3'
import { LerpQuaternion } from '../extras/LerpQuaternion'

/**
 * Script System
 *
 * - Runs on both the server and client.
 * - Executes scripts inside secure compartments
 *
 */

export class Scripts extends System {
  constructor(world) {
    super(world)
    this.compartment = new Compartment({
      console: {
        log: (...args) => console.log(...args),
        error: (...args) => console.error(...args),
        time: (...args) => console.time(...args),
        timeEnd: (...args) => console.timeEnd(...args),
      },
      eval: undefined,
      harden: undefined,
      lockdown: undefined,
      num,
      clamp,
      // Layers,
      Object3D: THREE.Object3D,
      Quaternion: THREE.Quaternion,
      Vector3: THREE.Vector3,
      Euler: THREE.Euler,
      Matrix4: THREE.Matrix4,
      LerpVector3,
      LerpQuaternion,
      // Material: Material,
      // Curve: Curve,
      // Gradient: Gradient,
      DEG2RAD,
      RAD2DEG,
      uuid,
      // pause: () => this.world.pause(),
    })
  }

  evaluate(code) {
    let value
    const result = {
      exec: (...args) => {
        if (!value) value = this.compartment.evaluate(wrapRawCode(code))
        return value(...args)
      },
      code,
    }
    return result
  }
}

function wrapRawCode(code) {
  return `
  (function() {
    const shared = {}
    return (world, app, fetch) => {
      ${code}
    }
  })()
  `
}
