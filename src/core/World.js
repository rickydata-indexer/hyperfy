import * as THREE from './extras/three'
import EventEmitter from 'eventemitter3'

import { Events } from './systems/Events'
import { Chat } from './systems/Chat'
import { Blueprints } from './systems/Blueprints'
import { Entities } from './systems/Entities'
import { Physics } from './systems/Physics'
import { Stage } from './systems/Stage'
import { Scripts } from './systems/Scripts'

export class World extends EventEmitter {
  constructor() {
    super()

    this.maxDeltaTime = 1 / 30 // 0.33333
    this.fixedDeltaTime = 1 / 50 // 0.01666
    this.frame = 0
    this.time = 0
    this.accumulator = 0
    this.systems = []
    this.networkRate = 1 / 8 // 8Hz
    this.hot = new Set()

    this.rig = new THREE.Object3D()
    this.camera = new THREE.PerspectiveCamera(70, 0, 0.01, 2000)
    this.rig.add(this.camera)

    this.register('events', Events)
    this.register('scripts', Scripts)
    this.register('chat', Chat)
    this.register('blueprints', Blueprints)
    this.register('entities', Entities)
    this.register('physics', Physics)
    this.register('stage', Stage)
  }

  register(key, System) {
    const system = new System(this)
    this.systems.push(system)
    this[key] = system
    return system
  }

  async init(options) {
    for (const system of this.systems) {
      await system.init(options)
    }
    this.start()
  }

  start() {
    for (const system of this.systems) {
      system.start()
    }
  }

  tick = time => {
    // begin any stats/performance monitors
    this.preTick()
    // update time, delta, frame and accumulator
    time /= 1000
    let delta = time - this.time
    if (delta > this.maxDeltaTime) {
      delta = this.maxDeltaTime
    }
    this.frame++
    this.time = time
    this.accumulator += delta
    // prepare physics
    const willFixedStep = this.accumulator >= this.fixedDeltaTime
    this.preFixedUpdate(willFixedStep)
    // run as many fixed updates as we can for this ticks delta
    while (this.accumulator >= this.fixedDeltaTime) {
      // run all fixed updates
      this.fixedUpdate(this.fixedDeltaTime)
      // step physics
      this.postFixedUpdate(this.fixedDeltaTime)
      // decrement accumulator
      this.accumulator -= this.fixedDeltaTime
    }
    // interpolate physics for remaining delta time
    const alpha = this.accumulator / this.fixedDeltaTime
    this.preUpdate(alpha)
    // run all updates
    this.update(delta, alpha)
    // run post updates, eg cleaning all node matrices
    this.postUpdate(delta)
    // run all late updates
    this.lateUpdate(delta, alpha)
    // run post late updates, eg cleaning all node matrices
    this.postLateUpdate(delta)
    // commit all changes, eg render on the client
    this.commit()
    // end any stats/performance monitors
    this.postTick()
  }

  preTick() {
    for (const system of this.systems) {
      system.preTick()
    }
  }

  preFixedUpdate(willFixedStep) {
    for (const system of this.systems) {
      system.preFixedUpdate(willFixedStep)
    }
  }

  fixedUpdate(delta) {
    for (const item of this.hot) {
      item.fixedUpdate?.(delta)
    }
    for (const system of this.systems) {
      system.fixedUpdate(delta)
    }
  }

  postFixedUpdate(delta) {
    for (const system of this.systems) {
      system.postFixedUpdate(delta)
    }
  }

  preUpdate(alpha) {
    for (const system of this.systems) {
      system.preUpdate(alpha)
    }
  }

  update(delta) {
    for (const item of this.hot) {
      item.update?.(delta)
    }
    for (const system of this.systems) {
      system.update(delta)
    }
  }

  postUpdate(delta) {
    for (const system of this.systems) {
      system.postUpdate(delta)
    }
  }

  lateUpdate(delta) {
    for (const item of this.hot) {
      item.lateUpdate?.(delta)
    }
    for (const system of this.systems) {
      system.lateUpdate(delta)
    }
  }

  postLateUpdate(delta) {
    for (const item of this.hot) {
      item.postLateUpdate?.(delta)
    }
    for (const system of this.systems) {
      system.postLateUpdate(delta)
    }
  }

  commit() {
    for (const system of this.systems) {
      system.commit()
    }
  }

  postTick() {
    for (const system of this.systems) {
      system.postTick()
    }
  }

  setupMaterial = material => {
    this.environment?.csm.setupMaterial(material)
  }

  setHot(item, hot) {
    if (hot) {
      this.hot.add(item)
    } else {
      this.hot.delete(item)
    }
  }
}
