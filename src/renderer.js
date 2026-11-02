const $ = (id) => document.getElementById(id)
const STEPS = [
  ['check', 'Checking your system'],
  ['go', 'Go compiler'],
  ['goclean', 'goclean'],
  ['tools', 'Extra tools (Air)'],
  ['path', 'Updating PATH'],
  ['verify', 'Verifying installation'],
]
const pages = ['license', 'options', 'progress', 'done']
let page = 0
let busy = false

function show(i) {
  page = i
  pages.forEach((p, j) => ($('p-' + p).hidden = j !== i))
  $('back').hidden = i !== 1
  const next = $('next')
  next.disabled = false
  next.textContent = ['Next', 'Install', 'Installing...', 'Close'][i]
  if (i === 0) next.disabled = !$('accept').checked
  if (i === 2) next.disabled = true
}

function addLog(text) {
  const el = $('log')
  el.textContent += text + '\n'
  el.scrollTop = el.scrollHeight
}

function onEvent(ev) {
  if (ev.type === 'log') return addLog(ev.text)
  if (ev.type === 'step') {
    const li = $('s-' + ev.id)
    if (!li) return
    li.className = ev.status
    if (ev.label) li.textContent = ev.label
    const done = STEPS.filter(([id]) => ['done', 'skip'].includes($('s-' + id).className)).length
    $('barfill').style.width = Math.round((done / STEPS.length) * 100) + '%'
  }
  if (ev.type === 'progress') {
    const li = $('s-' + ev.id)
    if (li) li.dataset.pct = ev.pct
    if (li) li.textContent = `${li.dataset.name} (${ev.pct}%)`
  }
}

async function startInstall() {
  show(2)
  $('log').textContent = ''
  $('steps').innerHTML = ''
  STEPS.forEach(([id, name]) => {
    const li = document.createElement('li')
    li.id = 's-' + id
    li.dataset.name = name
    li.textContent = name
    $('steps').appendChild(li)
  })
  const res = await window.setup.install({
    installDir: $('installDir').value.trim(),
    goParent: $('goParent').value.trim(),
    addToPath: $('addToPath').checked,
    installAir: $('installAir').checked,
    forceGo: $('forceGo').checked,
  })
  show(3)
  $('next').textContent = 'Close'
  $('doneLog').textContent = $('log').textContent
  if (res.ok) {
    $('barfill').style.width = '100%'
    $('doneTitle').textContent = 'Setup complete'
    $('doneMsg').textContent = 'goclean was installed successfully.'
    $('welcome').hidden = false
    $('doneLog').hidden = true
  } else {
    $('doneTitle').textContent = 'Setup failed'
    $('doneMsg').textContent = res.error || 'Unknown error'
    $('back').hidden = false
    $('back').textContent = 'Retry'
    busy = 'failed'
  }
}

$('accept').addEventListener('change', () => ($('next').disabled = !$('accept').checked))
$('browse1').onclick = async () => { const d = await window.setup.pickDir($('installDir').value); if (d) $('installDir').value = d }
$('browse2').onclick = async () => { const d = await window.setup.pickDir($('goParent').value); if (d) $('goParent').value = d }
$('back').onclick = () => { $('back').textContent = 'Back'; busy = false; show(1) }
$('next').onclick = () => {
  if (page === 0) show(1)
  else if (page === 1) {
    if (!$('installDir').value.trim() || !$('goParent').value.trim()) return alert('Please choose both folders.')
    startInstall()
  } else if (page === 3) window.setup.quit()
}

document.querySelectorAll('.copy').forEach((b) => {
  b.onclick = async () => {
    try { await navigator.clipboard.writeText($(b.dataset.c).textContent) } catch {}
    b.textContent = 'Copied'
    setTimeout(() => (b.textContent = 'Copy'), 1500)
  }
})
$('docs').onclick = (e) => { e.preventDefault(); window.setup.openUrl('https://github.com/ebinskryfon/goclean') }

window.setup.onEvent(onEvent)
window.setup.init().then((i) => {
  $('license').textContent = i.license
  $('installDir').value = i.defaults.installDir
  $('goParent').value = i.defaults.goParent
  $('ver').textContent = 'v' + i.version
  $('sysinfo').textContent = `${i.platform} · ` + (i.go ? (i.go.ok ? `${i.go.version} found` : `${i.go.version} found (too old, will be replaced)`) : 'Go not found, it will be installed')
  show(0)
})
