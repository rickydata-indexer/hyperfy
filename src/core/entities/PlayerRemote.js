import * as THREE from '../extras/three'
import { Entity } from './Entity'
import { createNode } from '../extras/createNode'
import { LerpQuaternion } from '../extras/LerpQuaternion'
import { LerpVector3 } from '../extras/LerpVector3'
import { emotes } from '../extras/playerEmotes'
import { createPlayerProxy } from '../extras/createPlayerProxy'

const colliderGeometry = new THREE.BoxGeometry(0.6, 2.2, 0.6).translate(0, 1.1, 0) // matches PlayerLocal capsule size

export class PlayerRemote extends Entity {
  constructor(world, data, local) {
    super(world, data, local)
    this.isPlayer = true
    this.init()
  }

  async init() {
    this.base = createNode({ name: 'group' })
    this.base.position.fromArray(this.data.position)
    this.base.quaternion.fromArray(this.data.quaternion)

    if (this.world.network.isServer) {
      this.body = createNode({ name: 'rigidbody', type: 'kinematic' })
      this.collider = createNode({ name: 'collider', convex: true, geometry: colliderGeometry })
      this.body.add(this.collider)
      this.base.add(this.body)
    }

    this.nametag = createNode({ name: 'nametag', label: this.data.user.name, active: false })
    this.base.add(this.nametag)

    this.bubble = createNode({
      name: 'ui',
      width: 300,
      height: 512,
      size: 0.005,
      pivot: 'bottom-center',
      billboard: 'full',
      justifyContent: 'flex-end',
      alignItems: 'center',
      active: false,
    })
    this.bubbleBox = createNode({
      name: 'uiview',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderRadius: 10,
      padding: 10,
    })
    this.bubbleText = createNode({
      name: 'uitext',
      color: 'white',
      fontWeight: 100,
      lineHeight: 1.4,
      fontSize: 16,
    })
    this.bubble.add(this.bubbleBox)
    this.bubbleBox.add(this.bubbleText)
    this.base.add(this.bubble)

    this.base.activate({ world: this.world, entity: this, physics: true })

    this.applyAvatar()

    this.position = new LerpVector3(this.base.position, this.world.networkRate)
    this.quaternion = new LerpQuaternion(this.base.quaternion, this.world.networkRate)
    this.emote = 'asset://emote-idle.glb'
    this.teleport = 0

    this.world.setHot(this, true)
    this.world.events.emit('enter', { player: this.getProxy() })
  }

  applyAvatar() {
    const avatarUrl = this.data.user.avatar || 'asset://avatar.vrm'
    if (this.avatarUrl === avatarUrl) return
    this.world.loader.load('avatar', avatarUrl).then(src => {
      if (this.avatar) this.avatar.deactivate()
      this.avatar = src.toNodes().get('avatar')
      this.base.add(this.avatar)
      this.nametag.position.y = this.avatar.height + 0.2
      this.bubble.position.y = this.avatar.height + 0.2
      if (!this.bubble.active) {
        this.nametag.active = true
      }
      this.avatarUrl = avatarUrl
    })
  }

  update(delta) {
    this.position.update(delta)
    this.quaternion.update(delta)
    this.avatar?.setEmote(emotes[this.emote])
  }

  modify(data) {
    if (data.hasOwnProperty('t')) {
      this.teleport++
    }
    if (data.hasOwnProperty('p')) {
      this.data.position = data.p
      this.position.pushArray(data.p, this.teleport)
    }
    if (data.hasOwnProperty('q')) {
      this.data.quaternion = data.q
      this.quaternion.pushArray(data.q, this.teleport)
    }
    if (data.hasOwnProperty('e')) {
      this.data.emote = data.e
      this.emote = data.e
    }
    if (data.hasOwnProperty('user')) {
      this.data.user = data.user
      this.nametag.label = data.user.name
      this.applyAvatar()
    }
  }

  chat(msg) {
    this.nametag.active = false
    this.bubbleText.value = msg
    this.bubble.active = true
    clearTimeout(this.chatTimer)
    this.chatTimer = setTimeout(() => {
      this.bubble.active = false
      this.nametag.active = true
    }, 5000)
  }

  destroy(local) {
    if (this.dead) return
    this.dead = true

    clearTimeout(this.chatTimer)
    this.base.deactivate()
    this.avatar = null
    this.world.setHot(this, false)
    this.world.events.emit('leave', { player: this.getProxy() })

    this.world.entities.remove(this.data.id)
    // if removed locally we need to broadcast to server/clients
    if (local) {
      this.world.network.send('entityRemoved', this.data.id)
    }
  }

  getProxy() {
    if (!this.proxy) {
      this.proxy = createPlayerProxy(this)
    }
    return this.proxy
  }
}
