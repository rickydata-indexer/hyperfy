import 'dotenv-flow/config'
import fs from 'fs-extra'
import path from 'path'
import { fork, execSync } from 'child_process'
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'

const dev = process.argv.includes('--dev')
const dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(dirname, './')
const buildDir = path.join(rootDir, 'build')

await fs.emptyDir(buildDir)

/**
 * Build Client
 */

const clientPublicDir = path.join(rootDir, 'src/client/public')
const clientBuildDir = path.join(rootDir, 'build/public')
const clientHtmlSrc = path.join(rootDir, 'src/client/public/index.html')
const clientHtmlDest = path.join(rootDir, 'build/public/index.html')

{
  const clientCtx = await esbuild.context({
    entryPoints: ['src/client/index.js'],
    entryNames: '/[name]-[hash]',
    outdir: clientBuildDir,
    platform: 'browser',
    format: 'esm',
    bundle: true,
    treeShaking: true,
    minify: false,
    sourcemap: true,
    metafile: true,
    jsx: 'automatic',
    jsxImportSource: '@firebolt-dev/jsx',
    define: {
      // 'process.env.NODE_ENV': '"development"',
    },
    loader: {
      '.js': 'jsx',
    },
    alias: {
      react: 'react', // always use our own local react (jsx)
    },
    plugins: [
      {
        name: 'client-finalize-plugin',
        setup(build) {
          build.onEnd(async result => {
            try {
              // copy over public files
              await fs.copy(clientPublicDir, clientBuildDir)
              // find js output file
              const metafile = result.metafile
              const outputFiles = Object.keys(metafile.outputs)
              const jsFile = outputFiles.find(file => file.endsWith('.js'))?.split('build/public')[1]
              if (!jsFile) {
                throw new Error('Could not find output JS file')
              }
              // inject into html and copy over
              let htmlContent = await fs.readFile(clientHtmlSrc, 'utf-8')
              htmlContent = htmlContent.replace('{jsFile}', jsFile)
              htmlContent = htmlContent.replaceAll('{buildId}', Date.now())
              await fs.writeFile(clientHtmlDest, htmlContent)
            } catch (err) {
              console.error('Client build error:', err)
              if (!dev) process.exit(1)
            }
          })
        },
      },
    ],
  })
  if (dev) {
    await clientCtx.watch()
  } else {
    await clientCtx.rebuild()
  }
}

/**
 * Build Server
 */

let spawn

{
  const serverCtx = await esbuild.context({
    entryPoints: ['src/server/index.js'],
    outfile: 'build/index.js',
    platform: 'node',
    format: 'esm',
    bundle: true,
    treeShaking: true,
    minify: false,
    sourcemap: true,
    packages: 'external',
    define: {
      'process.env.CLIENT': 'false',
      'process.env.SERVER': 'true',
    },
    plugins: [
      {
        name: 'server-finalize-plugin',
        setup(build) {
          build.onEnd(async result => {
            try {
              // make version file
              const version = getVersion()
              if (!version) {
                throw new Error('Could not determine version')
              }
              await fs.writeFile(path.join(rootDir, 'build/version.txt'), version)
              
              // copy over physx wasm
              const physxWasmSrc = path.join(rootDir, 'src/server/physx/physx-js-webidl.wasm')
              const physxWasmDest = path.join(rootDir, 'build/physx-js-webidl.wasm')
              await fs.copy(physxWasmSrc, physxWasmDest)
              
              // start the server or stop here
              if (dev) {
                // (re)start server
                spawn?.kill('SIGTERM')
                spawn = fork(path.join(rootDir, 'build/index.js'))
              } else {
                process.exit(0) // Exit with success code for production builds
              }
            } catch (err) {
              console.error('Server build error:', err)
              if (!dev) process.exit(1)
            }
          })
        },
      },
    ],
    loader: {},
  })
  if (dev) {
    await serverCtx.watch()
  } else {
    await serverCtx.rebuild()
  }
}

export function getVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    let version = packageJson.version;

    let hasUnstagedChanges = false;
    let isMainBranch = false;

    try {
      hasUnstagedChanges = execSync('git status --porcelain', { stdio: 'pipe' }).toString().length > 0;
    } catch {
      console.warn('⚠️ Warning: Unable to check for unstaged changes.');
    }

    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
      isMainBranch = currentBranch === 'main';
    } catch {
      console.warn('⚠️ Warning: Unable to determine current Git branch.');
    }

    if (hasUnstagedChanges || !isMainBranch) {
      version += '-dev';
    }

    return version;
  } catch (error) {
    console.error('⚠️ Error getting version. Using fallback version:', error);
    return 'unknown';
  }
}

