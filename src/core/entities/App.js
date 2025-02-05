import { isString } from 'lodash-es'
import * as THREE from '../extras/three'
import moment from 'moment'

import { Entity } from './Entity'
import { glbToNodes } from '../extras/glbToNodes'
import { createNode } from '../extras/createNode'
import { LerpVector3 } from '../extras/LerpVector3'
import { LerpQuaternion } from '../extras/LerpQuaternion'
import { ControlPriorities } from '../extras/ControlPriorities'
import { getRef } from '../nodes/Node'

const hotEventNames = ['fixedUpdate', 'update', 'lateUpdate']
const internalEvents = ['fixedUpdate', 'updated', 'lateUpdate', 'enter', 'leave', 'chat']

const Modes = {
  ACTIVE: 'active',
  MOVING: 'moving',
  ROTATING: 'rotating',
  SCALING: 'scaling',
  LOADING: 'loading',
  CRASHED: 'crashed',
}

export class App extends Entity {
  constructor(world, data, local) {
    super(world, data, local)
    this.isApp = true
    this.n = 0
    this.worldNodes = new Set()
    this.hotEvents = 0
    this.worldListeners = new Map()
    this.listeners = {}
    this.eventQueue = []
    this.build()
  }

  createNode(name) {
    const node = createNode({ name })
    return node
  }

  async build(crashed) {
    this.building = true
    const n = ++this.n
    // fetch blueprint
    const blueprint = this.world.blueprints.get(this.data.blueprint)
    // fetch script (if any)
    let script
    if (blueprint.script) {
      try {
        script = this.world.loader.get('script', blueprint.script)
        if (!script) script = await this.world.loader.load('script', blueprint.script)
      } catch (err) {
        console.error(err)
        crashed = true
      }
    }
    let root
    // if someone else is uploading glb, show a loading indicator
    if (this.data.uploader && this.data.uploader !== this.world.network.id) {
      root = createNode({ name: 'mesh' })
      root.type = 'box'
      root.width = 1
      root.height = 1
      root.depth = 1
    }
    // otherwise we can load the actual glb
    else {
      try {
        const type = blueprint.model.endsWith('vrm') ? 'avatar' : 'model'
        let glb = this.world.loader.get(type, blueprint.model)
        if (!glb) glb = await this.world.loader.load(type, blueprint.model)
        root = glb.toNodes()
      } catch (err) {
        console.error(err)
        // no model, will use crash block below
      }
    }
    // if script crashed (or failed to load model), show crash-block
    if (crashed || !root) {
      let glb = this.world.loader.get('model', 'asset://crash-block.glb')
      if (!glb) glb = await this.world.loader.load('model', 'asset://crash-block.glb')
      root = glb.toNodes()
    }
    // if a new build happened while we were fetching, stop here
    if (this.n !== n) return
    // unbuild any previous version
    this.unbuild()
    // mode
    this.mode = Modes.ACTIVE
    if (this.data.mover) {
      if (this.data.transformMode === 'rotate') this.mode = Modes.ROTATING
      else if (this.data.transformMode === 'scale') this.mode = Modes.SCALING
      else this.mode = Modes.MOVING
    }
    if (this.data.uploader && this.data.uploader !== this.world.network.id) this.mode = Modes.LOADING
    // setup
    this.blueprint = blueprint
    this.root = root
    this.root.position.fromArray(this.data.position)
    this.root.quaternion.fromArray(this.data.quaternion)
    if (this.data.scale) this.root.scale.fromArray(this.data.scale)
    // activate
    this.root.activate({ world: this.world, entity: this, physics: !this.data.mover })
    // execute script
    if (this.mode === Modes.ACTIVE && script && !crashed) {
      this.abortController = new AbortController()
      this.script = script
      try {
        this.script.exec(this.getWorldProxy(), this.getAppProxy(), this.fetch)
      } catch (err) {
        console.error('script crashed')
        console.error(err)
        return this.crash()
      }
    }
    // if transforming we need updates
    if ([Modes.MOVING, Modes.ROTATING, Modes.SCALING].includes(this.mode)) {
      this.world.setHot(this, true)
    }
    // if we're the mover lets bind controls
    if (this.data.mover === this.world.network.id) {
      this.lastMoveSendTime = 0
      this.control = this.world.controls.bind({
        priority: ControlPriorities.ENTITY,
        onScroll: () => {
          return true
        },
      })
    }
    // if remote is moving, set up to receive network updates
    this.networkPos = new LerpVector3(root.position, this.world.networkRate)
    this.networkQuat = new LerpQuaternion(root.quaternion, this.world.networkRate)
    // execute any events we collected while building
    while (this.eventQueue.length) {
      const event = this.eventQueue[0]
      if (event.version > this.blueprint.version) break // ignore future versions
      this.eventQueue.shift()
      this.emit(event.name, event.data, event.networkId)
    }
    // finished!
    this.building = false
  }

  unbuild() {
    // deactivate local node
    this.root?.deactivate()
    // deactivate world nodes
    for (const node of this.worldNodes) {
      node.deactivate()
    }
    this.worldNodes.clear()
    // clear script event listeners
    this.clearEventListeners()
    this.hotEvents = 0
    // release control
    if (this.control) {
      this.control?.release()
      this.control = null
    }
    // cancel update tracking
    this.world.setHot(this, false)
    // abort fetch's etc
    this.abortController?.abort()
    this.abortController = null
  }

  fixedUpdate(delta) {
    // script fixedUpdate()
    if (this.mode === Modes.ACTIVE && this.script) {
      try {
        this.emit('fixedUpdate', delta)
      } catch (err) {
        console.error('script fixedUpdate crashed', this)
        console.error(err)
        this.crash()
        return
      }
    }
  }

  update(delta) {
    // Handle transformations if we're the mover
    if (this.data.mover === this.world.network.id) {
      if (this.mode === Modes.MOVING) {
        this.handleMove(delta)
      } else if (this.mode === Modes.ROTATING) {
        this.handleRotate(delta)
      } else if (this.mode === Modes.SCALING) {
        this.handleScale(delta)
      }

      // Periodically send updates
      this.lastMoveSendTime += delta
      if (this.lastMoveSendTime > this.world.networkRate) {
        const update = {
          id: this.data.id,
          position: this.root.position.toArray(),
          quaternion: this.root.quaternion.toArray(),
        }
        if (this.mode === Modes.SCALING) {
          update.scale = this.root.scale.toArray()
        }
        this.world.network.send('entityModified', update)
        this.lastMoveSendTime = 0
      }

      // If we left clicked, place the app
      if (this.control.pressed.MouseLeft) {
        this.data.mover = null
        this.data.position = this.root.position.toArray()
        this.data.quaternion = this.root.quaternion.toArray()
        if (this.mode === Modes.SCALING) {
          this.data.scale = this.root.scale.toArray()
        }
        this.data.transformMode = null
        this.data.state = {}
        this.world.network.send('entityModified', {
          id: this.data.id,
          mover: null,
          position: this.data.position,
          quaternion: this.data.quaternion,
          scale: this.data.scale,
          transformMode: null,
          state: this.data.state,
        })
        this.build()
      }
    }
    // if someone else is moving the app, interpolate updates
    if (this.data.mover && this.data.mover !== this.world.network.id) {
      this.networkPos.update(delta)
      this.networkQuat.update(delta)
    }
    // script update()
    if (this.mode === Modes.ACTIVE && this.script) {
      try {
        this.emit('update', delta)
      } catch (err) {
        console.error('script update() crashed', this)
        console.error(err)
        this.crash()
        return
      }
    }
  }

  handleMove(delta) {
    if (this.control.buttons.ShiftLeft) {
      // If shift is down we're raising and lowering the app
      this.root.position.y -= this.world.controls.pointer.delta.y * delta * 0.5
    } else {
      // Otherwise move with the cursor
      const position = this.world.controls.pointer.position
      const hits = this.world.stage.raycastPointer(position)
      let hit
      for (const _hit of hits) {
        const entity = _hit.getEntity?.()
        // Ignore self and players
        if (entity === this || entity?.isPlayer) continue
        hit = _hit
        break
      }
      if (hit) {
        this.root.position.copy(hit.point)
      }
    }
  }

  handleRotate(delta) {
    // Use mouse X movement for Y-axis rotation
    const rotationSpeed = 2.0
    this.root.rotation.y += this.world.controls.pointer.delta.x * delta * rotationSpeed

    // Use shift + mouse Y movement for X-axis rotation
    if (this.control.buttons.ShiftLeft) {
      this.root.rotation.x += this.world.controls.pointer.delta.y * delta * rotationSpeed
    }
  }

  handleScale(delta) {
    const scaleSpeed = 1.0
    if (this.control.buttons.ShiftLeft) {
      // Uniform scaling with shift
      const scaleDelta = -this.world.controls.pointer.delta.y * delta * scaleSpeed
      this.root.scale.addScalar(scaleDelta)
      // Clamp scale to reasonable values
      this.root.scale.clampScalar(0.1, 10)
    } else {
      // Non-uniform scaling without shift
      this.root.scale.x += this.world.controls.pointer.delta.x * delta * scaleSpeed
      this.root.scale.y += -this.world.controls.pointer.delta.y * delta * scaleSpeed
      // Clamp individual axis scales
      this.root.scale.x = THREE.MathUtils.clamp(this.root.scale.x, 0.1, 10)
      this.root.scale.y = THREE.MathUtils.clamp(this.root.scale.y, 0.1, 10)
    }
  }

  lateUpdate(delta) {
    if (this.mode === Modes.ACTIVE && this.script) {
      try {
        this.emit('lateUpdate', delta)
      } catch (err) {
        console.error('script lateUpdate() crashed', this)
        console.error(err)
        this.crash()
        return
      }
    }
  }

  onUploaded() {
    this.data.uploader = null
    this.world.network.send('entityModified', { id: this.data.id, uploader: null })
  }

  modify(data) {
    let rebuild
    if (data.hasOwnProperty('blueprint')) {
      this.data.blueprint = data.blueprint
      rebuild = true
    }
    if (data.hasOwnProperty('uploader')) {
      this.data.uploader = data.uploader
      rebuild = true
    }
    if (data.hasOwnProperty('mover')) {
      this.data.mover = data.mover
      rebuild = true
    }
    if (data.hasOwnProperty('transformMode')) {
      this.data.transformMode = data.transformMode
      rebuild = true
    }
    if (data.hasOwnProperty('position')) {
      this.data.position = data.position
      this.networkPos.pushArray(data.position)
    }
    if (data.hasOwnProperty('quaternion')) {
      this.data.quaternion = data.quaternion
      this.networkQuat.pushArray(data.quaternion)
    }
    if (data.hasOwnProperty('scale')) {
      this.data.scale = data.scale
    }
    if (data.hasOwnProperty('state')) {
      this.data.state = data.state
      rebuild = true
    }
    if (rebuild) {
      this.build()
    }
  }

  move() {
    this.data.mover = this.world.network.id
    this.data.transformMode = 'move'
    this.build()
    this.world.network.send('entityModified', { 
      id: this.data.id, 
      mover: this.data.mover,
      transformMode: this.data.transformMode 
    })
  }

  rotate() {
    this.data.mover = this.world.network.id
    this.data.transformMode = 'rotate'
    this.build()
    this.world.network.send('entityModified', { 
      id: this.data.id, 
      mover: this.data.mover,
      transformMode: this.data.transformMode 
    })
  }

  scale() {
    this.data.mover = this.world.network.id
    this.data.transformMode = 'scale'
    this.build()
    this.world.network.send('entityModified', { 
      id: this.data.id, 
      mover: this.data.mover,
      transformMode: this.data.transformMode 
    })
  }

  crash() {
    this.build(true)
  }

  destroy(local) {
    if (this.dead) return
    this.dead = true

    this.unbuild()

    this.world.entities.remove(this.data.id)
    // if removed locally we need to broadcast to server/clients
    if (local) {
      this.world.network.send('entityRemoved', this.data.id)
    }
  }

  on(name, callback) {
    if (!this.listeners[name]) {
      this.listeners[name] = new Set()
    }
    this.listeners[name].add(callback)
    if (hotEventNames.includes(name)) {
      this.hotEvents++
      this.world.setHot(this, this.hotEvents > 0)
    }
  }

  off(name, callback) {
    if (!this.listeners[name]) return
    this.listeners[name].delete(callback)
    if (hotEventNames.includes(name)) {
      this.hotEvents--
      this.world.setHot(this, this.hotEvents > 0)
    }
  }

  emit(name, a1, a2) {
    if (!this.listeners[name]) return
    for (const callback of this.listeners[name]) {
      callback(a1, a2)
    }
  }

  onWorldEvent(name, callback) {
    this.worldListeners.set(callback, name)
    this.world.events.on(name, callback)
  }

  offWorldEvent(name, callback) {
    this.worldListeners.delete(callback)
    this.world.events.off(name, callback)
  }

  clearEventListeners() {
    // local
    this.listeners = {}
    // world
    for (const [callback, name] of this.worldListeners) {
      this.world.events.off(name, callback)
    }
    this.worldListeners.clear()
  }

  onEvent(version, name, data, networkId) {
    if (this.building || version > this.blueprint.version) {
      this.eventQueue.push({ version, name, data, networkId })
    } else {
      this.emit(name, data, networkId)
    }
  }

  fetch = async (url, options = {}) => {
    try {
      const resp = await fetch(url, {
        ...options,
        signal: this.abortController.signal,
      })
      const secureResp = {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
        headers: Object.fromEntries(resp.headers.entries()),
        json: async () => await resp.json(),
        text: async () => await resp.text(),
        blob: async () => await resp.blob(),
      }
      return secureResp
    } catch (err) {
      console.error(err)
      // this.crash()
    }
  }

  getWorldProxy() {
    const entity = this
    const world = this.world
    return {
      get networkId() {
        return world.network.id
      },
      get isServer() {
        return world.network.isServer
      },
      get isClient() {
        return world.network.isClient
      },
      add(pNode) {
        const node = getRef(pNode)
        if (!node) return
        if (node.parent) {
          node.parent.remove(node)
        }
        entity.worldNodes.add(node)
        node.activate({ world, entity, physics: true })
      },
      remove(pNode) {
        const node = getRef(pNode)
        if (!node) return
        if (node.parent) return // its not in world
        if (!entity.worldNodes.has(node)) return
        entity.worldNodes.delete(node)
        node.deactivate()
      },
      attach(pNode) {
        const node = getRef(pNode)
        if (!node) return
        const parent = node.parent
        if (!parent) return
        parent.remove(node)
        node.matrix.copy(node.matrixWorld)
        node.matrix.decompose(node.position, node.quaternion, node.scale)
        node.activate({ world, entity, physics: true })
        entity.worldNodes.add(node)
      },
      on(name, callback) {
        entity.onWorldEvent(name, callback)
      },
      off(name, callback) {
        entity.offWorldEvent(name, callback)
      },
      emit(name, data) {
        if (internalEvents.includes(name)) {
          return console.error(`apps cannot emit internal events (${name})`)
        }
        warn('world.emit() is deprecated, use app.emit() instead')
        world.events.emit(name, data)
      },
      getTime() {
        return world.network.getTime()
      },
      getTimestamp(format) {
        if (!format) return moment().toISOString()
        return moment().format(format)
      },
      chat(msg, broadcast) {
        if (!msg) return
        world.chat.add(msg, broadcast)
      },
      getPlayer(playerId) {
        const player = world.entities.getPlayer(playerId || world.entities.player?.data.id)
        return player?.getProxy()
      },
    }
  }

  getAppProxy() {
    const entity = this
    const world = this.world
    let proxy = {
      get instanceId() {
        return entity.data.id
      },
      get version() {
        return entity.blueprint.version
      },
      get state() {
        return entity.data.state
      },
      set state(value) {
        entity.data.state = value
      },
      on(name, callback) {
        entity.on(name, callback)
      },
      off(name, callback) {
        entity.off(name, callback)
      },
      send(name, data, ignoreSocketId) {
        if (internalEvents.includes(name)) {
          return console.error(`apps cannot send internal events (${name})`)
        }
        // NOTE: on the client ignoreSocketId is a no-op because it can only send events to the server
        const event = [entity.data.id, entity.blueprint.version, name, data]
        world.network.send('entityEvent', event, ignoreSocketId)
      },
      emit(name, data) {
        if (internalEvents.includes(name)) {
          return console.error(`apps cannot emit internal events (${name})`)
        }
        world.events.emit(name, data)
      },
      get(id) {
        const node = entity.root.get(id)
        if (!node) return null
        return node.getProxy()
      },
      create(name) {
        const node = entity.createNode(name)
        return node.getProxy()
      },
      control(options) {
        // TODO: only allow on user interaction
        // TODO: show UI with a button to release()
        entity.control = world.controls.bind({
          ...options,
          priority: ControlPriorities.APP,
          object: entity,
        })
        return entity.control
      },
      configure(fn) {
        entity.getConfig = fn
        entity.onConfigure?.(fn)
      },
      get config() {
        return entity.blueprint.config
      },
    }
    proxy = Object.defineProperties(proxy, Object.getOwnPropertyDescriptors(this.root.getProxy())) // inherit root Node properties
    return proxy
  }
}

const warned = new Set()
function warn(str) {
  if (warned.has(str)) return
  console.warn(str)
  warned.add(str)
}
