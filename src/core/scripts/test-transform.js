export default async function exec(world, app) {
  const blueprint = {
    id: 'test-cube',
    version: 0,
    model: 'asset://crash-block.glb',
    script: null,
    config: {},
    preload: false,
  }
  
  world.blueprints.add(blueprint, true)
  
  const data = {
    id: 'test-cube-instance',
    type: 'app',
    blueprint: blueprint.id,
    position: [0, 1, 0],
    quaternion: [0, 0, 0, 1],
    state: {},
  }
  
  world.entities.add(data, true)
}
