export default async function exec(world, app) {
  // Load and execute the transform test script
  const script = await world.loader.load('script', 'asset://test-transform.js')
  script.exec(world, app)
}
