// Install engine: no Electron dependencies, so it can be tested from plain Node.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const REPO = 'skryfon-org/gostrata'
const MIN_GO = [1, 22]
const IS_WIN = process.platform === 'win32'
const GOOS = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform]
const GOARCH = { x64: 'amd64', arm64: 'arm64' }[process.arch]
const EXE = IS_WIN ? '.exe' : ''
const SEP = path.delimiter

function defaults() {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  return IS_WIN
    ? { installDir: path.join(local, 'Programs', 'gostrata'), goParent: path.join(local, 'Programs') }
    : { installDir: path.join(home, '.local', 'bin'), goParent: path.join(home, '.local') }
}

const goBinDirs = (goParent) => [path.join(goParent, 'go', 'bin')]
const commonGoDirs = () =>
  IS_WIN
    ? ['C:\\Program Files\\Go\\bin', path.join(defaults().goParent, 'go', 'bin')]
    : ['/usr/local/go/bin', '/usr/lib/go/bin', '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'go', 'bin'), path.join(os.homedir(), 'go', 'bin')]

function run(cmd, args, { env, cwd, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: env || process.env, cwd, windowsHide: true })
    let out = ''
    const feed = (b) => {
      const t = b.toString()
      out += t
      if (onLine) t.split(/\r?\n/).filter(Boolean).forEach(onLine)
    }
    p.stdout.on('data', feed)
    p.stderr.on('data', feed)
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with code ${code}\n${out.trim()}`))))
  })
}

const withPath = (dirs) => ({ ...process.env, PATH: [...dirs, process.env.PATH || ''].join(SEP) })

async function detectGo(extraDirs = []) {
  try {
    const env = withPath([...extraDirs, ...commonGoDirs()])
    const out = await run('go', ['version'], { env })
    const m = /go(\d+)\.(\d+)(?:\.(\d+))?/.exec(out)
    if (!m) return null
    const [maj, min] = [Number(m[1]), Number(m[2])]
    const ok = maj > MIN_GO[0] || (maj === MIN_GO[0] && min >= MIN_GO[1])
    return { version: out.trim(), ok, raw: m[0] }
  } catch {
    return null
  }
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'gostrata-setup', Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`)
  return res.json()
}

async function download(url, dest, onPct) {
  const res = await fetch(url, { headers: { 'User-Agent': 'gostrata-setup' }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  let got = 0
  let lastPct = -1
  const src = Readable.fromWeb(res.body)
  src.on('data', (chunk) => {
    hash.update(chunk)
    got += chunk.length
    if (total && onPct) {
      const pct = Math.floor((got / total) * 100)
      if (pct !== lastPct) { lastPct = pct; onPct(pct) }
    }
  })
  await pipeline(src, fs.createWriteStream(dest))
  return hash.digest('hex')
}

const extract = (archive, dest) => run('tar', ['-xf', archive, '-C', dest])

async function latestGo() {
  const releases = await getJSON('https://go.dev/dl/?mode=json')
  const rel = releases.find((r) => r.stable)
  if (!rel) throw new Error('Could not find a stable Go release')
  const kind = 'archive'
  const file = rel.files.find((f) => f.os === GOOS && f.arch === GOARCH && f.kind === kind)
  if (!file) throw new Error(`No Go build available for ${GOOS}/${GOARCH}`)
  return { version: rel.version, file }
}

async function latestGostrata() {
  const rel = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`)
  const num = rel.tag_name.replace(/^v/, '')
  const name = `gostrata_${num}_${GOOS}_${GOARCH}.${IS_WIN ? 'zip' : 'tar.gz'}`
  const base = `https://github.com/${REPO}/releases/download/${rel.tag_name}`
  return { tag: rel.tag_name, name, url: `${base}/${name}`, sumsUrl: `${base}/checksums.txt` }
}

const MARK_START = '# >>> gostrata setup >>>'
const MARK_END = '# <<< gostrata setup <<<'

async function addToPath(dirs, log) {
  if (IS_WIN) {
    const script =
      "$p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $p){$p=''};" +
      "foreach($d in ($env:GC_DIRS -split ';')){ if($d -and (($p -split ';') -notcontains $d)){ $p=($p.TrimEnd(';')+';'+$d) } };" +
      "[Environment]::SetEnvironmentVariable('Path',$p,'User')"
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, GC_DIRS: dirs.join(';') } })
    log('Added to your user PATH. Open a new terminal to use it.')
    return
  }
  const block = `${MARK_START}\nexport PATH="$PATH:${dirs.join(':')}"\n${MARK_END}\n`
  const re = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}\\n?`, 'g')
  const home = os.homedir()
  const targets = ['.profile', '.bashrc', '.zshrc'].map((f) => path.join(home, f))
  for (const f of targets) {
    const exists = fs.existsSync(f)
    if (!exists && !f.endsWith('.profile')) continue
    const cur = exists ? fs.readFileSync(f, 'utf8') : ''
    const next = (cur.replace(re, '').replace(/\n*$/, '\n') + '\n' + block).replace(/^\n+/, '')
    fs.writeFileSync(f, next)
    log(`Updated ${f}`)
  }
  log('Open a new terminal (or run: source ~/.profile) to use it.')
}

/**
 * opts: { installDir, goParent, addToPath, installAir, forceGo }
 * emit: ({type:'step'|'log'|'progress', ...})
 */
async function install(opts, emit) {
  const step = (id, status, label) => emit({ type: 'step', id, status, label })
  const log = (text) => emit({ type: 'log', text })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gostrata-setup-'))
  const pathDirs = []
  try {
    // 1. System check
    step('check', 'run')
    log(`Platform: ${GOOS}/${GOARCH}`)
    if (!GOOS || !GOARCH) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)
    fs.mkdirSync(opts.installDir, { recursive: true })
    fs.accessSync(opts.installDir, fs.constants.W_OK)
    step('check', 'done')

    // 2. Go toolchain
    step('go', 'run')
    const existing = opts.forceGo ? null : await detectGo(goBinDirs(opts.goParent))
    let goDirs = []
    if (existing && existing.ok) {
      log(`Found ${existing.version}. Skipping download.`)
      step('go', 'skip', 'Go compiler already installed')
    } else {
      if (existing) log(`Found ${existing.raw}, but gostrata needs Go ${MIN_GO.join('.')} or newer.`)
      else log('Go was not found on this computer.')
      const { version, file } = await latestGo()
      log(`Downloading ${version} (${(file.size / 1e6).toFixed(0)} MB) from go.dev...`)
      const archive = path.join(tmp, file.filename)
      const sum = await download(`https://go.dev/dl/${file.filename}`, archive, (pct) => emit({ type: 'progress', id: 'go', pct }))
      if (sum !== file.sha256) throw new Error('Go checksum verification failed. Download was discarded.')
      log('Checksum verified.')
      fs.mkdirSync(opts.goParent, { recursive: true })
      const target = path.join(opts.goParent, 'go')
      if (fs.existsSync(target)) {
        log(`Replacing existing ${target}`)
        fs.rmSync(target, { recursive: true, force: true })
      }
      log(`Extracting to ${target} ...`)
      await extract(archive, opts.goParent)
      goDirs = goBinDirs(opts.goParent)
      step('go', 'done', `Go ${version.replace(/^go/, '')} installed`)
    }
    pathDirs.push(...goDirs)

    // 3. gostrata
    step('gostrata', 'run')
    const gc = await latestGostrata()
    log(`Downloading gostrata ${gc.tag} ...`)
    const archive = path.join(tmp, gc.name)
    const sum = await download(gc.url, archive, (pct) => emit({ type: 'progress', id: 'gostrata', pct }))
    const sums = await (await fetch(gc.sumsUrl, { headers: { 'User-Agent': 'gostrata-setup' } })).text()
    const line = sums.split('\n').find((l) => l.trim().endsWith(` ${gc.name}`))
    if (!line || line.split(/\s+/)[0] !== sum) throw new Error('gostrata checksum verification failed. Download was discarded.')
    log('Checksum verified.')
    const ex = path.join(tmp, 'gc')
    fs.mkdirSync(ex)
    await extract(archive, ex)
    const dest = path.join(opts.installDir, `gostrata${EXE}`)
    fs.copyFileSync(path.join(ex, `gostrata${EXE}`), dest)
    if (!IS_WIN) fs.chmodSync(dest, 0o755)
    log(`Installed ${dest}`)
    pathDirs.push(opts.installDir)
    step('gostrata', 'done', `gostrata ${gc.tag} installed`)

    // 4. Optional tools (Air hot reload)
    if (opts.installAir) {
      step('tools', 'run')
      const env = withPath([...goDirs, ...commonGoDirs()])
      try {
        await run('go', ['install', 'github.com/air-verse/air@latest'], { env, onLine: log })
        const gopath = (await run('go', ['env', 'GOPATH'], { env })).trim()
        pathDirs.push(path.join(gopath, 'bin'))
        step('tools', 'done')
      } catch (e) {
        log(`Air could not be installed: ${e.message.split('\n')[0]}`)
        step('tools', 'skip', 'Air hot reload (skipped, see log)')
      }
    } else {
      step('tools', 'skip')
    }

    // 5. PATH
    if (opts.addToPath) {
      step('path', 'run')
      await addToPath([...new Set(pathDirs)], log)
      step('path', 'done')
    } else {
      step('path', 'skip')
      log(`PATH not changed. Add ${opts.installDir} to your PATH manually.`)
    }

    // 6. Verify
    step('verify', 'run')
    const env = withPath([...new Set(pathDirs)])
    await run(dest, ['version'], { env, onLine: log })
    await run(dest, ['doctor'], { env, onLine: log }).catch((e) => log(`doctor: ${e.message.split('\n')[0]}`))
    step('verify', 'done')
    return { ok: true, binary: dest }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

module.exports = { install, detectGo, defaults, latestGo, latestGostrata, goBinDirs, GOOS, GOARCH }
