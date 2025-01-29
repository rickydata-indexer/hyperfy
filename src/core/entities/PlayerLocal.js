import { Entity } from './Entity'
import { clamp } from '../utils'
import * as THREE from '../extras/three'
import { Layers } from '../extras/Layers'
import { DEG2RAD, RAD2DEG } from '../extras/general'
import { createNode } from '../extras/createNode'
import { bindRotations } from '../extras/bindRotations'
import { simpleCamLerp } from '../extras/simpleCamLerp'
import { Emotes, emotes } from '../extras/playerEmotes'
import { ControlPriorities } from '../extras/ControlPriorities'
import { createPlayerProxy } from '../extras/createPlayerProxy'
import { isNumber } from 'lodash-es'

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)
const FORWARD = new THREE.Vector3(0, 0, -1)
const BACKWARD = new THREE.Vector3(0, 0, 1)
const SCALE_IDENTITY = new THREE.Vector3(1, 1, 1)
const POINTER_LOOK_SPEED = 0.1
const PAN_LOOK_SPEED = 0.4
const ZOOM_SPEED = 2
const MIN_ZOOM = 2
const MAX_ZOOM = 100 // 16
const STICK_MAX_DISTANCE = 50

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const v3 = new THREE.Vector3()
const v4 = new THREE.Vector3()
const v5 = new THREE.Vector3()
const v6 = new THREE.Vector3()
const e1 = new THREE.Euler(0, 0, 0, 'YXZ')
const q1 = new THREE.Quaternion()
const q2 = new THREE.Quaternion()
const q3 = new THREE.Quaternion()
const q4 = new THREE.Quaternion()
const m1 = new THREE.Matrix4()
const m2 = new THREE.Matrix4()
const m3 = new THREE.Matrix4()

export class PlayerLocal extends Entity {
  constructor(world, data, local) {
    super(world, data, local)
    this.isPlayer = true
    this.init()
  }

  async init() {
    if (this.world.loader.preloader) {
      await this.world.loader.preloader
    }
    this.mass = 1
    this.gravity = 20
    this.effectiveGravity = this.gravity * this.mass
    this.jumpHeight = 1.5

    this.capsuleRadius = 0.3
    this.capsuleHeight = 1.6

    this.grounded = false
    this.groundAngle = 0
    this.groundNormal = new THREE.Vector3().copy(UP)
    this.groundSweepRadius = this.capsuleRadius - 0.01 // slighty smaller than player
    this.groundSweepGeometry = new PHYSX.PxSphereGeometry(this.groundSweepRadius)

    this.slipping = false

    this.jumped = false
    this.jumping = false
    this.justLeftGround = false

    this.fallTimer = 0
    this.falling = false

    this.moveDir = new THREE.Vector3()
    this.moving = false

    this.platform = {
      actor: null,
      prevTransform: new THREE.Matrix4(),
    }

    this.lastSendAt = 0

    this.base = createNode({ name: 'group' })
    this.base.position.fromArray(this.data.position)
    this.base.quaternion.fromArray(this.data.quaternion)

    // this.nametag = createNode({ name: 'nametag', label: this.data.user.name, active: false })
    // this.base.add(this.nametag)

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

    this.base.activate({ world: this.world, physics: true, entity: this.entity })

    this.applyAvatar()

    this.cam = {}
    this.cam.position = new THREE.Vector3().copy(this.base.position)
    this.cam.position.y += 1.6
    this.cam.quaternion = new THREE.Quaternion()
    this.cam.rotation = new THREE.Euler(0, 0, 0, 'YXZ')
    bindRotations(this.cam.quaternion, this.cam.rotation)
    this.cam.quaternion.copy(this.base.quaternion)
    this.cam.rotation.x += -15 * DEG2RAD
    this.cam.zoom = 4

    this.initCapsule()
    this.initControl()

    this.world.setHot(this, true)
  }

  applyAvatar() {
    const avatarUrl = this.data.user.avatar || 'asset://avatar.vrm'
    if (this.avatarUrl === avatarUrl) return
    this.world.loader
      .load('avatar', avatarUrl)
      .then(src => {
        if (this.avatar) this.avatar.deactivate()
        this.avatar = src.toNodes().get('avatar')
        this.base.add(this.avatar)
        // this.nametag.position.y = this.avatar.height + 0.2
        this.bubble.position.y = this.avatar.height + 0.2
        // if (!this.bubble.active) {
        //   this.nametag.active = true
        // }
        this.avatarUrl = avatarUrl
      })
      .catch(err => {
        console.error(err)
      })
  }

  initCapsule() {
    const radius = this.capsuleRadius
    const height = this.capsuleHeight
    const halfHeight = (height - radius - radius) / 2
    const geometry = new PHYSX.PxCapsuleGeometry(radius, halfHeight)
    // frictionless material (the combine mode ensures we always use out min=0 instead of avging)
    // we use eMIN when in the air so that we don't stick to walls etc
    // and eMAX on the ground so that we don't constantly slip off physics objects we're pushing
    this.material = this.world.physics.physics.createMaterial(0, 0, 0)
    // material.setFrictionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
    // material.setRestitutionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
    const flags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE | PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE) // prettier-ignore
    const shape = this.world.physics.physics.createShape(geometry, this.material, true, flags)
    const localPose = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    // rotate to stand up
    q1.set(0, 0, 0).setFromAxisAngle(BACKWARD, Math.PI / 2)
    q1.toPxTransform(localPose)
    // move capsule up so its base is at 0,0,0
    v1.set(0, halfHeight + radius, 0)
    v1.toPxTransform(localPose)
    shape.setLocalPose(localPose)
    const filterData = new PHYSX.PxFilterData(
      Layers.player.group,
      Layers.player.mask,
      PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND |
        PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_LOST |
        PHYSX.PxPairFlagEnum.eNOTIFY_CONTACT_POINTS |
        PHYSX.PxPairFlagEnum.eDETECT_CCD_CONTACT |
        PHYSX.PxPairFlagEnum.eSOLVE_CONTACT |
        PHYSX.PxPairFlagEnum.eDETECT_DISCRETE_CONTACT,
      0
    )
    shape.setContactOffset(0.08) // just enough to fire contacts (because we muck with velocity sometimes standing on a thing doesn't contact)
    // shape.setFlag(PHYSX.PxShapeFlagEnum.eUSE_SWEPT_BOUNDS, true)
    shape.setQueryFilterData(filterData)
    shape.setSimulationFilterData(filterData)
    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    v1.copy(this.base.position).toPxTransform(transform)
    q1.set(0, 0, 0, 1).toPxTransform(transform)
    this.capsule = this.world.physics.physics.createRigidDynamic(transform)
    this.capsule.setMass(this.mass)
    // this.capsule.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, false)
    this.capsule.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eENABLE_CCD, true)
    this.capsule.setRigidDynamicLockFlag(PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_X, true)
    // this.capsule.setRigidDynamicLockFlag(PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_Y, true)
    this.capsule.setRigidDynamicLockFlag(PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_Z, true)
    // disable gravity we'll add it ourselves
    this.capsule.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_GRAVITY, true)
    this.capsule.attachShape(shape)
    // There's a weird issue where running directly at a wall the capsule won't generate contacts and instead
    // go straight through it. It has to be almost perfectly head on, a slight angle and everything works fine.
    // I spent days trying to figure out why, it's not CCD, it's not contact offsets, its just straight up bugged.
    // For now the best solution is to just add a sphere right in the center of our capsule to keep that problem at bay.
    let shape2
    {
      const geometry = new PHYSX.PxSphereGeometry(radius)
      shape2 = this.world.physics.physics.createShape(geometry, this.material, true, flags)
      shape2.setQueryFilterData(filterData)
      shape2.setSimulationFilterData(filterData)
      const pose = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
      v1.set(0, halfHeight + radius, 0).toPxTransform(pose)
      shape2.setLocalPose(pose)
      this.capsule.attachShape(shape2)
    }
    this.capsuleHandle = this.world.physics.addActor(this.capsule, {
      tag: null,
      player: this.getProxy(),
      onInterpolate: position => {
        this.base.position.copy(position)
      },
    })
  }

  initControl() {
    this.control = this.world.controls.bind({
      priority: ControlPriorities.PLAYER,
      onPress: code => {
        if (code === 'MouseRight') {
          this.control.pointer.lock()
        }
      },
      onRelease: code => {
        if (code === 'MouseRight') {
          this.control.pointer.unlock()
        }
      },
      onTouch: touch => {
        if (!this.stick && touch.position.x < this.control.screen.width / 2) {
          this.stick = {
            center: touch.position.clone(),
            touch,
          }
        } else if (!this.pan) {
          this.pan = touch
        }
      },
      onTouchEnd: touch => {
        if (this.stick?.touch === touch) {
          this.stick = null
        }
        if (this.pan === touch) {
          this.pan = null
        }
      },
    })
    this.control.camera.claim()
    this.control.camera.position.copy(this.cam.position)
    this.control.camera.quaternion.copy(this.cam.quaternion)
    this.control.camera.zoom = this.cam.zoom
  }

  fixedUpdate(delta) {
    // if grounded last update, check for moving platforms and move with them
    if (this.grounded) {
      // find any potentially moving platform
      const pose = this.capsule.getGlobalPose()
      const origin = v1.copy(pose.p)
      origin.y += 0.2
      const hitMask = Layers.environment.group | Layers.prop.group | Layers.tool.group
      const hit = this.world.physics.raycast(origin, DOWN, 2, hitMask)
      let actor = hit?.actor || null
      if (actor) {
        actor = this.world.physics.handles.get(actor.ptr)?.actor || null
      }
      // if we found a new platform, set it up for tracking
      if (this.platform.actor !== actor) {
        this.platform.actor = actor
        if (actor) {
          const platformPose = this.platform.actor.getGlobalPose()
          v1.copy(platformPose.p)
          q1.copy(platformPose.q)
          this.platform.prevTransform.compose(v1, q1, SCALE_IDENTITY)
        }
      }
      // move with platform
      if (this.platform.actor) {
        // get current platform transform
        const currTransform = m1
        const platformPose = this.platform.actor.getGlobalPose()
        v1.copy(platformPose.p)
        q1.copy(platformPose.q)
        currTransform.compose(v1, q1, SCALE_IDENTITY)
        // get delta transform
        const deltaTransform = m2.multiplyMatrices(currTransform, this.platform.prevTransform.clone().invert())
        // extract delta position and quaternion
        const deltaPosition = v2
        const deltaQuaternion = q2
        const deltaScale = v3
        deltaTransform.decompose(deltaPosition, deltaQuaternion, deltaScale)
        // apply delta to player
        const playerPose = this.capsule.getGlobalPose()
        v4.copy(playerPose.p)
        q3.copy(playerPose.q)
        const playerTransform = m3
        playerTransform.compose(v4, q3, SCALE_IDENTITY)
        playerTransform.premultiply(deltaTransform)
        const newPosition = v5
        const newQuaternion = q4
        playerTransform.decompose(newPosition, newQuaternion, v6)
        const newPose = this.capsule.getGlobalPose()
        newPosition.toPxTransform(newPose)
        // newQuaternion.toPxTransform(newPose) // capsule doesn't rotate
        this.capsule.setGlobalPose(newPose)
        // rotate ghost by Y only
        e1.setFromQuaternion(deltaQuaternion).reorder('YXZ')
        e1.x = 0
        e1.z = 0
        q1.setFromEuler(e1)
        this.base.quaternion.multiply(q1)
        this.base.updateTransform()
        // store current transform for next frame
        this.platform.prevTransform.copy(currTransform)
      }
    } else {
      this.platform.actor = null
    }

    // sweep down to see if we hit ground
    let sweepHit
    {
      const geometry = this.groundSweepGeometry
      const pose = this.capsule.getGlobalPose()
      const origin = v1.copy(pose.p /*this.ghost.position*/)
      origin.y += this.groundSweepRadius + 0.12 // move up inside player + a bit
      const direction = DOWN
      const maxDistance = 0.12 + 0.1 // outside player + a bit more
      const hitMask = Layers.environment.group | Layers.prop.group | Layers.tool.group
      sweepHit = this.world.physics.sweep(geometry, origin, direction, maxDistance, hitMask)
    }

    // update grounded info
    if (sweepHit) {
      this.justLeftGround = false
      this.grounded = true
      this.groundNormal.copy(sweepHit.normal)
      this.groundAngle = UP.angleTo(this.groundNormal) * RAD2DEG
    } else {
      this.justLeftGround = !!this.grounded
      this.grounded = false
      this.groundNormal.copy(UP)
      this.groundAngle = 0
    }

    // if on a steep slope, unground and track slipping
    if (this.grounded && this.groundAngle > 60) {
      this.justLeftGround = false
      this.grounded = false
      this.groundNormal.copy(UP)
      this.groundAngle = 0
      this.slipping = true
    } else {
      this.slipping = false
    }

    // our capsule material has 0 friction
    // we use eMIN when in the air so that we don't stick to walls etc (zero friction)
    // and eMAX on the ground so that we don't constantly slip off physics objects we're pushing (absorb objects friction)
    if (this.grounded) {
      if (this.materialMax !== true) {
        this.material.setFrictionCombineMode(PHYSX.PxCombineModeEnum.eMAX)
        this.material.setRestitutionCombineMode(PHYSX.PxCombineModeEnum.eMAX)
        this.materialMax = true
      }
    } else {
      if (this.materialMax !== false) {
        this.material.setFrictionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
        this.material.setRestitutionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
        this.materialMax = false
      }
    }

    // if we jumped and have now left the ground, progress to jumping
    if (this.jumped && !this.grounded) {
      this.jumped = false
      this.jumping = true
    }

    // if not grounded and our velocity is downward, start timing our falling
    if (!this.grounded && this.capsule.getLinearVelocity().y < 0) {
      this.fallTimer += delta
    } else {
      this.fallTimer = 0
    }
    // if we've been falling for a bit then progress to actual falling
    // this is to prevent animation jitter when only falling for a very small amount of time
    if (this.fallTimer > 0.1) {
      this.jumping = false
      this.falling = true
    }

    // if falling and we're now on the ground, clear it
    if (this.falling && this.grounded) {
      this.falling = false
    }

    // if jumping and we're now on the ground, clear it
    if (this.jumping && this.grounded) {
      this.jumping = false
    }

    // if we're grounded we don't need gravity.
    // more importantly we disable it so that we don't slowly slide down ramps while standing still.
    // even more importantly, if the platform we are on is dynamic we apply a force to it to compensate for our gravity being off.
    // this allows things like see-saws to move down when we stand on them etc.
    if (this.grounded) {
      // gravity is disabled but we need to check our platform
      if (this.platform.actor) {
        const isStatic = this.platform.actor instanceof PHYSX.PxRigidStatic
        const isKinematic = this.platform.actor.getRigidBodyFlags?.().isSet(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC)
        // if its dynamic apply downward force!
        if (!isKinematic && !isStatic) {
          // this feels like the right amount of force but no idea why 0.2
          const amount = -9.81 * 0.2
          const force = v1.set(0, amount, 0)
          PHYSX.PxRigidBodyExt.prototype.addForceAtPos(
            this.platform.actor,
            force.toPxVec3(),
            this.capsule.getGlobalPose().p,
            PHYSX.PxForceModeEnum.eFORCE,
            true
          )
        }
      }
    } else {
      const force = v1.set(0, -this.effectiveGravity, 0)
      this.capsule.addForce(force.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)
    }

    // update velocity
    const velocity = v1.copy(this.capsule.getLinearVelocity())
    // apply drag, orientated to ground normal
    // this prevents ice-skating & yeeting us upward when going up ramps
    const dragCoeff = 10 * delta
    let perpComponent = v2.copy(this.groundNormal).multiplyScalar(velocity.dot(this.groundNormal))
    let parallelComponent = v3.copy(velocity).sub(perpComponent)
    parallelComponent.multiplyScalar(1 - dragCoeff)
    velocity.copy(parallelComponent.add(perpComponent))
    // cancel out velocity in ground normal direction (up oriented to ground normal)
    // this helps us stick to elevators
    if (this.grounded && !this.jumping) {
      const projectedLength = velocity.dot(this.groundNormal)
      const projectedVector = v2.copy(this.groundNormal).multiplyScalar(projectedLength)
      velocity.sub(projectedVector)
    }
    // when walking off an edge or over the top of a ramp, attempt to snap down to a surface
    if (this.justLeftGround && !this.jumping) {
      velocity.y = -5
    }
    // if slipping ensure we can't gain upward velocity
    if (this.slipping) {
      // increase downward velocity to prevent sliding upward when walking at a slope
      velocity.y -= 0.5
    }
    this.capsule.setLinearVelocity(velocity.toPxVec3())

    // apply move force, projected onto ground normal
    if (this.moving) {
      let moveSpeed = (this.running ? 8 : 4) * this.mass // run
      const slopeRotation = q1.setFromUnitVectors(UP, this.groundNormal)
      const moveForce = v1.copy(this.moveDir).multiplyScalar(moveSpeed * 10).applyQuaternion(slopeRotation) // prettier-ignore
      this.capsule.addForce(moveForce.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)
      // alternative (slightly different projection)
      // let moveSpeed = 10
      // const slopeMoveDir = v1.copy(this.moveDir).projectOnPlane(this.groundNormal).normalize()
      // const moveForce = v2.copy(slopeMoveDir).multiplyScalar(moveSpeed * 10)
      // this.capsule.addForce(moveForce.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)
    }

    // apply jump
    if (this.grounded && !this.jumping && this.control.buttons.Space) {
      // calc velocity needed to reach jump height
      let jumpVelocity = Math.sqrt(2 * this.effectiveGravity * this.jumpHeight)
      jumpVelocity = jumpVelocity * (1 / Math.sqrt(this.mass))
      // update velocity
      const velocity = this.capsule.getLinearVelocity()
      velocity.y = jumpVelocity
      this.capsule.setLinearVelocity(velocity)
      // set jumped (we haven't left the ground yet)
      this.jumped = true
    }
  }

  update(delta) {
    // rotate camera when looking (holding right mouse + dragging)
    if (this.control.pointer.locked) {
      this.cam.rotation.y += -this.control.pointer.delta.x * POINTER_LOOK_SPEED * delta
      this.cam.rotation.x += -this.control.pointer.delta.y * POINTER_LOOK_SPEED * delta
    }
    // or when touch panning
    if (this.pan) {
      this.cam.rotation.y += -this.pan.delta.x * PAN_LOOK_SPEED * delta
      this.cam.rotation.x += -this.pan.delta.y * PAN_LOOK_SPEED * delta
    }

    // ensure we can't look too far up/down
    this.cam.rotation.x = clamp(this.cam.rotation.x, -90 * DEG2RAD, 90 * DEG2RAD)

    // zoom camera if scrolling wheel (and not moving an object)
    this.cam.zoom += -this.control.scroll.delta * ZOOM_SPEED * delta
    this.cam.zoom = clamp(this.cam.zoom, MIN_ZOOM, MAX_ZOOM)

    // get our movement direction
    this.moveDir.set(0, 0, 0)
    if (this.stick) {
      // if we have a touch joystick use that
      const touchX = this.stick.touch.position.x
      const touchY = this.stick.touch.position.y
      const centerX = this.stick.center.x
      const centerY = this.stick.center.y
      const dx = centerX - touchX
      const dy = centerY - touchY
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > STICK_MAX_DISTANCE) {
        this.stick.center.x = touchX + (STICK_MAX_DISTANCE * dx) / distance
        this.stick.center.y = touchY + (STICK_MAX_DISTANCE * dy) / distance
      }
      const stickX = (touchX - this.stick.center.x) / STICK_MAX_DISTANCE
      const stickY = (touchY - this.stick.center.y) / STICK_MAX_DISTANCE
      this.moveDir.x = stickX
      this.moveDir.z = stickY
    } else {
      // otherwise use keyboard
      if (this.control.buttons.KeyW || this.control.buttons.ArrowUp) this.moveDir.z -= 1
      if (this.control.buttons.KeyS || this.control.buttons.ArrowDown) this.moveDir.z += 1
      if (this.control.buttons.KeyA || this.control.buttons.ArrowLeft) this.moveDir.x -= 1
      if (this.control.buttons.KeyD || this.control.buttons.ArrowRight) this.moveDir.x += 1
    }

    // we're moving if any keys are down
    this.moving = this.moveDir.length() > 0

    // we're running if holding shift or full throttle joystick
    if (this.stick) {
      this.running = this.moving && this.moveDir.length() > 0.5
    } else {
      this.running = this.moving && (this.control.buttons.ShiftLeft || this.control.buttons.ShiftRight)
    }

    // normalize direction (also prevents surfing)
    this.moveDir.normalize()

    // rotate direction to face camera Y direction
    const yQuaternion = q1.setFromAxisAngle(UP, this.cam.rotation.y)
    this.moveDir.applyQuaternion(yQuaternion)

    // if we're moving continually rotate ourselves toward the direction we are moving
    if (this.moving) {
      const alpha = 1 - Math.pow(0.00000001, delta)
      q1.setFromUnitVectors(FORWARD, this.moveDir)
      this.base.quaternion.slerp(q1, alpha)
    }

    // make camera follow our position horizontally
    // and vertically at our vrm model height
    this.cam.position.copy(this.base.position)
    this.cam.position.y += 1.6

    // emote
    if (this.jumping) {
      this.emote = Emotes.FLOAT
    } else if (this.falling) {
      this.emote = Emotes.FLOAT
    } else if (this.moving) {
      this.emote = this.running ? Emotes.RUN : Emotes.WALK
    } else {
      this.emote = Emotes.IDLE
    }
    this.avatar?.setEmote(emotes[this.emote])

    // send network updates
    this.lastSendAt += delta
    if (this.lastSendAt >= this.world.networkRate) {
      this.world.network.send('entityModified', {
        id: this.data.id,
        p: this.base.position.toArray(),
        q: this.base.quaternion.toArray(),
        e: this.emote,
      })
      this.lastSendAt = 0
    }

    // TODO: this feels like ClientEditor stuff not PlayerLocal
    // handle node hover enter/leave
    if (!this.pointerState) this.pointerState = new PointerState()
    // console.time('pointer')
    const hit = this.control.pointer.locked ? null : this.world.stage.raycastPointer(this.control.pointer.position)[0]
    this.pointerState.update(hit, this.control.pressed.MouseLeft, this.control.released.MouseLeft)
    // console.timeEnd('pointer')
  }

  lateUpdate(delta) {
    // interpolate camera towards target (snaps if just teleported)
    simpleCamLerp(this.world, this.control.camera, this.cam, delta)
  }

  teleport({ position, rotationY }) {
    position = position.isVector3 ? position : new THREE.Vector3().fromArray(position)
    const hasRotation = isNumber(rotationY)
    // snap to position
    const pose = this.capsule.getGlobalPose()
    position.toPxTransform(pose)
    this.capsuleHandle.snap(pose)
    this.base.position.copy(position)
    if (hasRotation) this.base.rotation.y = rotationY
    // send network update
    this.world.network.send('entityModified', {
      id: this.data.id,
      p: this.base.position.toArray(),
      q: this.base.quaternion.toArray(),
      t: true,
    })
    // snap camera
    this.cam.position.copy(this.base.position)
    this.cam.position.y += 1.6
    if (hasRotation) this.cam.rotation.y = rotationY
    this.control.camera.position.copy(this.cam.position)
    this.control.camera.quaternion.copy(this.cam.quaternion)
  }

  chat(msg) {
    // this.nametag.active = false
    this.bubbleText.value = msg
    this.bubble.active = true
    clearTimeout(this.chatTimer)
    this.chatTimer = setTimeout(() => {
      this.bubble.active = false
      // this.nametag.active = true
    }, 5000)
  }

  modify(data) {
    if (data.hasOwnProperty('user')) {
      this.data.user = data.user
      // this.nametag.label = data.user.name
      this.applyAvatar()
    }
  }

  getProxy() {
    if (!this.proxy) {
      this.proxy = createPlayerProxy(this)
    }
    return this.proxy
  }
}

const PointerEvents = {
  ENTER: 'pointerenter',
  LEAVE: 'pointerleave',
  DOWN: 'pointerdown',
  UP: 'pointerup',
}

const CURSOR_DEFAULT = 'default'

class PointerEvent {
  constructor() {
    this.type = null
    this._propagationStopped = false
  }

  set(type) {
    this.type = type
    this._propagationStopped = false
  }

  stopPropagation() {
    this._propagationStopped = true
  }
}

class PointerState {
  constructor() {
    this.activePath = new Set()
    this.event = new PointerEvent()
    this.cursor = CURSOR_DEFAULT
    this.pressedNodes = new Set()
  }

  update(hit, pointerPressed, pointerReleased) {
    const newPath = hit ? this.getAncestorPath(hit) : []
    const oldPath = Array.from(this.activePath)

    // find divergence point
    let i = 0
    while (i < newPath.length && i < oldPath.length && newPath[i] === oldPath[i]) i++

    // pointer leave events bubble up from leaf
    for (let j = oldPath.length - 1; j >= i; j--) {
      if (oldPath[j].onPointerLeave) {
        this.event.set(PointerEvents.LEAVE)
        oldPath[j].onPointerLeave?.(this.event)
        // if (this.event._propagationStopped) break
      }
      this.activePath.delete(oldPath[j])
    }

    // pointer enter events bubble down from divergence
    for (let j = i; j < newPath.length; j++) {
      if (newPath[j].onPointerEnter) {
        this.event.set(PointerEvents.ENTER)
        newPath[j].onPointerEnter?.(this.event)
        if (this.event._propagationStopped) break
      }
      this.activePath.add(newPath[j])
    }

    // set cursor - check from leaf to root for first defined cursor
    let cursor = CURSOR_DEFAULT
    if (newPath.length > 0) {
      for (let i = newPath.length - 1; i >= 0; i--) {
        if (newPath[i].cursor) {
          cursor = newPath[i].cursor
          break
        }
      }
    }
    if (cursor !== this.cursor) {
      document.body.style.cursor = cursor
      this.cursor = cursor
    }

    // handle pointer down events
    if (pointerPressed) {
      for (let i = newPath.length - 1; i >= 0; i--) {
        const node = newPath[i]
        if (node.onPointerDown) {
          this.event.set(PointerEvents.DOWN)
          node.onPointerDown(this.event)
          this.pressedNodes.add(node)
          if (this.event._propagationStopped) break
        }
      }
    }

    // handle pointer up events
    if (pointerReleased) {
      for (const node of this.pressedNodes) {
        if (node.onPointerUp) {
          this.event.set(PointerEvents.UP)
          node.onPointerUp(this.event)
          if (this.event._propagationStopped) break
        }
      }
      this.pressedNodes.clear()
    }
  }

  getAncestorPath(hit) {
    const path = []
    let node = hit.node?.resolveHit?.(hit) || hit.node
    while (node) {
      path.unshift(node)
      node = node.parent
    }
    return path
  }
}
