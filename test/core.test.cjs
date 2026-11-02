const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { install } = require('../src/core.cjs')
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-core-test-'))
  const events = []
  const res = await install(
    { installDir: path.join(root, 'bin'), goParent: path.join(root, 'sdk'), addToPath: false, installAir: false, forceGo: true },
    (e) => { events.push(e); if (e.type === 'step') console.log('STEP', e.id, e.status, e.label || ''); if (e.type === 'log') console.log('  ', e.text) },
  )
  console.log('RESULT', res, fs.existsSync(path.join(root, 'sdk', 'go', 'bin', 'go' + (process.platform === 'win32' ? '.exe' : ''))))
  fs.rmSync(root, { recursive: true, force: true })
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
