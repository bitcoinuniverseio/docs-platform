#!/usr/bin/env node
/**
 * Build a byte-deterministic npm package archive for @universe/inscribe-learning.
 *
 * Consumers vendor this archive with file: and CI regenerates it from the
 * declared docs-platform commit and byte-compares. tar metadata is fixed with
 * GNU tar determinism flags and the gzip header is written here with zeroed
 * timestamps and OS byte 255, so identical inputs produce identical bytes on
 * any platform.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { deflateRawSync, crc32 } from 'node:zlib'
import { createHash } from 'node:crypto'

const pkgDir = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''))
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

function gzipDeterministic(data) {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff])
  const body = deflateRawSync(data, { level: 9 })
  const trailer = Buffer.alloc(8)
  trailer.writeUInt32LE(crc32(data), 0)
  trailer.writeUInt32LE(data.length >>> 0, 4)
  return Buffer.concat([header, body, trailer])
}

const stage = mkdtempSync(join(tmpdir(), 'inscribe-learning-pack-'))
const packageDir = join(stage, 'package')
try {
  mkdirSync(packageDir)
  const include = ['package.json', 'README.md', ...(pkg.files ?? [])]
  for (const pattern of include) {
    const full = join(pkgDir, pattern)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) cpSync(full, join(packageDir, pattern), { recursive: true })
    else cpSync(full, join(packageDir, pattern))
  }

  const tarBuffer = execFileSync(
    'tar',
    ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--format=gnu', '-cf', '-', 'package'],
    { cwd: stage, maxBuffer: 256 * 1024 * 1024 },
  )

  const archive = gzipDeterministic(tarBuffer)
  const outName = `inscribe-learning-${pkg.version}.tgz`
  writeFileSync(join(pkgDir, outName), archive)

  const sha256 = createHash('sha256').update(archive).digest('hex')
  const sourceCommit = execFileSync('git', ['-C', pkgDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const listed = spawnSync('tar', ['-tzf', outName], { cwd: pkgDir, encoding: 'utf8' })
  const fileCount = listed.stdout.split('\n').filter(Boolean).length
  const meta = {
    package: pkg.name,
    version: pkg.version,
    sourceCommit,
    archive: outName,
    archiveSha256: sha256,
    files: fileCount,
  }
  writeFileSync(join(pkgDir, `${outName}.meta.json`), JSON.stringify(meta, null, 2) + '\n')
  console.log(`${outName} written: ${fileCount} entries, sha256 ${sha256}`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}

