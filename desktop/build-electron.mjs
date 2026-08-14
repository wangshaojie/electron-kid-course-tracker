import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(__dirname, 'dist-electron')
fs.mkdirSync(outDir, { recursive: true })

async function run() {
  await build({
    entryPoints: [path.resolve(__dirname, 'electron/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(outDir, 'main.mjs'),
    external: ['electron'],
    sourcemap: true,
  })
  await build({
    entryPoints: [path.resolve(__dirname, 'electron/preload.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(outDir, 'preload.mjs'),
    external: ['electron'],
    sourcemap: true,
  })
  console.log('[build-electron] OK ->', outDir)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
