const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, Tray } = require('electron')
const { spawn } = require('node:child_process')
const { mkdir, readFile, rename, writeFile } = require('node:fs/promises')
const readline = require('node:readline')
const path = require('node:path')
const os = require('node:os')
const { createActivity } = require('./activity.cjs')
const { createQuota } = require('./quota.cjs')

const scheme = 'closure-pet'
const origin = `${scheme}://local`
const demo = process.argv.includes('--demo')
const smoke = process.argv.includes('--smoke')
const canvas = process.argv.includes('--canvas')
const noTray = process.argv.includes('--no-tray')
const dev = demo || smoke
const profile = process.env.CLOSURE_STATE_DIR || path.join(__dirname, '.closure-profile')
const assets = path.join(__dirname, 'upstream', 'assets')
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const crtSettingsPath = process.env.CLOSURE_CRT_SETTINGS_FILE || path.resolve(__dirname, '../../work/crt-settings.ini')
const defaultCrt = { scanlines: true, vignette: true, strength: 100, appearance: 'system', dshChrome: true }
let crtWrite = Promise.resolve()

app.setName('Closure Companion')
app.setPath('userData', profile)
app.setPath('sessionData', path.join(profile, 'chromium'))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.atlas': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
}
const staticPaths = { '/': 'index.html', '/bridge.js': 'bridge.js' }

function validCrt(value) {
  return value && typeof value.scanlines === 'boolean' && typeof value.vignette === 'boolean' && typeof value.dshChrome === 'boolean' &&
    Number.isInteger(value.strength) && value.strength >= 0 && value.strength <= 150 &&
    ['system', 'dark', 'light'].includes(value.appearance)
}

async function readCrt() {
  try {
    const values = (await readFile(crtSettingsPath, 'utf8')).trim().split(/\r?\n/)
    const value = { scanlines: values[0] === '1', vignette: values[1] === '1', strength: Number(values[2]), appearance: values[3], dshChrome: values[4] !== '0' }
    if (/^[01]$/.test(values[0]) && /^[01]$/.test(values[1]) && (values.length === 4 ||
        (values.length === 5 && /^[01]$/.test(values[4]))) && validCrt(value)) return value
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return defaultCrt
}

async function updateCrt(request) {
  const value = await request.json().catch(() => null)
  if (!validCrt(value)) return new Response(null, { status: 400 })
  const task = crtWrite.then(async () => {
    await mkdir(path.dirname(crtSettingsPath), { recursive: true })
    const temporary = `${crtSettingsPath}.${process.pid}.tmp`
    await writeFile(temporary, `${Number(value.scanlines)}\n${Number(value.vignette)}\n${value.strength}\n${value.appearance}\n${Number(value.dshChrome)}\n`, 'utf8')
    await rename(temporary, crtSettingsPath)
  })
  crtWrite = task.catch(() => {})
  await task
  return Response.json(value)
}

function registerProtocol(activity, quota) {
  protocol.handle(scheme, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'local') return new Response(null, { status: 404 })
    if (url.pathname === '/dsh-closure/crt') {
      try {
        if (request.method === 'GET') { await crtWrite; return Response.json(await readCrt()) }
        if (request.method === 'PUT') return await updateCrt(request)
        return new Response(null, { status: 405 })
      } catch (error) {
        console.error('Closure CRT settings:', error.message)
        return new Response(null, { status: 500 })
      }
    }
    if (url.pathname === '/dsh-closure/config' && request.method === 'PUT') return new Response(null, { status: 204 })
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    if (url.pathname === '/dsh-closure/state') {
      const snapshot = activity.snapshot()
      if (quota) Object.assign(snapshot.closureCompanion, quota.snapshot())
      return Response.json(snapshot)
    }
    if (url.pathname === '/dsh-closure/config') return Response.json({})

    let file
    if (Object.hasOwn(staticPaths, url.pathname)) {
      file = path.join(__dirname, staticPaths[url.pathname])
    } else {
      const src = url.pathname.match(/^\/dsh-closure\/(?:assets\/)?((?:src|spine|vendor|audio|fonts)\/[a-z0-9/_-]+\.[a-z0-9]+)$/i)
      if (!src || !Object.hasOwn(mime, path.extname(src[1]))) return new Response(null, { status: 404 })
      file = path.join(assets, src[1])
    }
    try {
      return new Response(await readFile(file), { headers: { 'content-type': mime[path.extname(file)] } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

function followCodex(win) {
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const handle = win.getNativeWindowHandle()
  const overlayHandle = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()
  const tracker = spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'follow-codex.ps1'),
    '-OverlayHandle', String(overlayHandle),
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = readline.createInterface({ input: tracker.stdout })
  let bounds
  let paused = false
  function syncWindow() {
    if (win.isDestroyed()) return
    if (bounds && !paused) {
      win.setBounds(bounds)
      if (!win.isVisible()) win.showInactive()
    } else if (win.isVisible()) {
      win.hide()
    }
  }
  lines.on('line', (message) => {
    if (win.isDestroyed()) return
    try {
      const { visible, x, y, width, height } = JSON.parse(message)
      bounds = visible ? screen.screenToDipRect(null, { x, y, width, height }) : null
      syncWindow()
    } catch (error) {
      console.error('Closure window tracker:', error.message)
    }
  })
  tracker.stderr.on('data', (chunk) => console.error(chunk.toString()))
  tracker.on('error', (error) => console.error('Closure window tracker:', error.message))
  tracker.once('exit', () => { bounds = null; syncWindow() })
  if (!noTray) {
    const tray = new Tray(path.join(__dirname, 'upstream', 'icon.png'))
    tray.setToolTip('可露希尔 · Codex 桌宠')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示桌宠', type: 'checkbox', checked: true, click: (item) => { paused = !item.checked; syncWindow() } },
      { label: '退出可露希尔桌宠', click: () => app.quit() },
    ]))
    win.once('closed', () => tray.destroy())
  }
  win.once('closed', () => tracker.kill())
}

function registerInput(win) {
  let interactive = false
  win.setIgnoreMouseEvents(true)
  ipcMain.on('closure:interactive', (event, enabled) => {
    if (win.isDestroyed() || event.sender !== win.webContents || enabled === interactive) return
    interactive = enabled
    win.setIgnoreMouseEvents(!interactive)
  })
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return
    const pointer = screen.getCursorScreenPoint()
    const bounds = win.getContentBounds()
    win.webContents.send('closure:cursor', { x: pointer.x - bounds.x, y: pointer.y - bounds.y })
  }, 24)
  win.once('closed', () => clearInterval(timer))
}

async function runSmoke(win) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const evaluate = (source) => win.webContents.executeJavaScript(source)
  let phase
  for (let n = 0; n < 40; n++) {
    phase = await evaluate('window.__dshClosurePet?.phase')
    if (phase === 'running' || phase === 'failed') break
    await delay(200)
  }
  if (phase !== 'running') throw new Error(`Spine failed to start: ${await evaluate('window.__dshClosurePet?.error') || phase}`)

  const result = await evaluate(`(async () => {
    const pet = window.__dshClosurePet
    const screenPet = document.querySelector('#dsh-closure-pet canvas')
    const hitPoint = () => {
      const bounds = screenPet.getBoundingClientRect()
      for (let y = Math.floor(bounds.top) + 3; y < bounds.bottom; y += 6) {
        for (let x = Math.floor(bounds.left) + 3; x < bounds.right; x += 6) {
          if (pet.hitTest(x, y)) return { x, y }
        }
      }
      throw new Error('Hit mask is empty.')
    }
    const before = screenPet.getBoundingClientRect()
    const point = hitPoint()
    const pointer = (type, x, y) => screenPet.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true,
    }))
    pointer('pointerdown', point.x, point.y)
    pointer('pointermove', point.x - 70, point.y - 50)
    pointer('pointerup', point.x - 70, point.y - 50)
    await new Promise((done) => setTimeout(done, 300))
    const after = screenPet.getBoundingClientRect()
    const dragged = after.left < before.left - 30 && after.top < before.top - 25
    pet.resetPosition()
    await new Promise((done) => setTimeout(done, 260))
    const click = (target = point) => {
      pointer('pointerdown', target.x, target.y)
      pointer('pointerup', target.x, target.y)
    }
    const waitFor = async (condition) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await condition()) return true
        await new Promise((done) => setTimeout(done, 20))
      }
      return false
    }
    pet.showBubble('测试事件气泡')
    const clickWithRandom = (value) => {
      const random = Math.random
      try {
        Math.random = () => value
        click()
      } finally {
        Math.random = random
      }
    }
    clickWithRandom(0)
    await new Promise((done) => setTimeout(done, 650))
    const bubble = document.querySelector('#dsh-closure-pet-bubble')
    const clicked = bubble.style.opacity === '1'
    const bubbleText = bubble.textContent
    const dialogueCues = ['黑眼圈', '我还在算', '烧烤味饼干', '巧克力', '滞销', '不许砍价', '奖励一下']
    const idleDialogueCount = dialogueCues.length
    const idleLines = [bubbleText]
    for (let i = 1; i < idleDialogueCount; i++) {
      click()
      idleLines.push(bubble.textContent)
    }
    // 0.2 would select the previous round's last line as the next first line.
    clickWithRandom(0.2)
    const secondRound = [bubble.textContent]
    for (let i = 1; i < idleDialogueCount; i++) {
      click()
      secondRound.push(bubble.textContent)
    }
    const dialogueCycles = new Set(idleLines).size === idleDialogueCount &&
      dialogueCues.every((cue) => idleLines.some((line) => line.replace(/\\s+/g, '').includes(cue))) &&
      new Set(secondRound).size === idleDialogueCount && secondRound.every((line) => idleLines.includes(line)) &&
      idleLines.join('\u0001') !== secondRound.join('\u0001') && idleLines.at(-1) !== secondRound[0]
    const lineBeforeRefresh = bubble.textContent
    await new Promise((done) => setTimeout(done, 1100))
    const dialogueSurvivesRefresh = bubble.textContent === lineBeforeRefresh
    document.dispatchEvent(new MouseEvent('contextmenu', { clientX: point.x, clientY: point.y, cancelable: true }))
    const settings = document.querySelector('#dsh-closure-pet-settings')
    const panelOpened = getComputedStyle(settings).display === 'block'
    const voiceControl = settings.querySelector('[aria-label="角色配音"]')
    const voiceLanguages = [...settings.querySelectorAll('button[data-voice-language]')]
    const defaultVoice = voiceControl.checked && voiceLanguages.find(
      (button) => button.getAttribute('aria-pressed') === 'true')?.dataset.voiceLanguage === 'zh'
    let voicesPlayed = 0
    for (const button of voiceLanguages) {
      pet.openPanel()
      button.click()
      if (pet.voice) throw new Error('Changing voice language left the previous line playing')
      pet.closePanel()
      click(hitPoint())
      if (await waitFor(() => pet.voice?.language === button.dataset.voiceLanguage)) voicesPlayed++
    }
    const previousVoice = pet.voice?.id
    click(hitPoint())
    const interruptedVoice = await waitFor(() => pet.voice?.language === 'ko' && pet.voice.id !== previousVoice)
    pet.openPanel()
    const voiceVolume = settings.querySelector('input[aria-label="配音音量"]')
    const effectsVolume = settings.querySelector('input[aria-label="音效音量"]')
    const setVolume = (slider, value) => {
      slider.value = value
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const effectsBefore = pet.sounds.volume
    setVolume(voiceVolume, '0')
    const mutedVoice = pet.voice?.volume === 0
    setVolume(voiceVolume, '0.25')
    const liveVoiceVolume = pet.voice?.volume === 0.25 && pet.sounds.volume === effectsBefore
    setVolume(effectsVolume, '0.5')
    const separateVolumes = pet.sounds.volume === 0.5 && pet.voice?.volume === 0.25
    voiceControl.click()
    const stoppedImmediately = !pet.voice
    pet.closePanel()
    click(hitPoint())
    await new Promise((done) => setTimeout(done, 150))
    const savedSettings = JSON.parse(localStorage.getItem('dshcl-settings'))
    const voiceVolumeWorks = mutedVoice && liveVoiceVolume && separateVolumes &&
      savedSettings?.voiceVolume === 0.25 && savedSettings?.volume === 0.5
    const voiceSettings = defaultVoice && voicesPlayed === 4 && interruptedVoice && stoppedImmediately && !pet.voice &&
      !voiceControl.checked && savedSettings?.voice === false && savedSettings?.voiceLanguage === 'ko'
    pet.openPanel()
    const startupScheduled = pet.startup.pending
    settings.querySelector('details').open = true
    const previewButton = [...settings.querySelectorAll('details button')].find((button) => button.textContent === '哭脸')
    previewButton.click()
    const expressionPreview = pet.animation === 'Sad_Begin' && getComputedStyle(settings).display === 'none'
    pet.openPanel()
    const crtPanel = [...settings.querySelectorAll('details')].find((item) => item.querySelector('summary').textContent === 'CRT 显示效果')
    crtPanel.open = true
    const crtFields = crtPanel.querySelector('fieldset')
    const crtUrl = '/dsh-closure/crt'
    if (!await waitFor(() => !crtFields.disabled)) throw new Error('CRT controls failed to load')
    const [scanlines, vignette, dshChrome] = crtFields.querySelectorAll('input[type=checkbox]')
    const slider = crtFields.querySelector('input[type=range]')
    scanlines.checked = false
    vignette.checked = true
    dshChrome.checked = false
    slider.value = '135'
    crtFields.querySelector('input[value=light]').checked = true
    slider.dispatchEvent(new Event('change', { bubbles: true }))
    const crtSettingsSaved = await waitFor(async () => {
      if (crtFields.disabled) return false
      const response = await fetch(crtUrl)
      const saved = await response.json()
      return !saved.scanlines && saved.vignette && !saved.dshChrome && saved.strength === 135 && saved.appearance === 'light'
    })
    pet.closePanel()
    pet.play('Idle', true)
    const quota = [{ minutes: 300, remaining: 85.5 }]
    pet.applyState({ closureCompanion: { quota }, work: { mode: 'thinking' } })
    const thinking = pet.layers.work === 'Special_B'
    pet.applyState({ closureCompanion: { quota }, work: { mode: 'outputting' } })
    const talking = pet.layers.work === 'Talk'
    click(hitPoint())
    const workText = bubble.textContent.replace(/\\s+/g, '')
    const workDialogueWithQuota = dialogueCues.some((cue) => workText.includes(cue)) && workText.includes('85.5%')
    pet.applyState({ closureCompanion: { source: 'heju', balance: { remaining: 120.5, unit: 'USD' }, quota: [] }, work: { mode: 'idle' } })
    const hasBalanceInRotation = Array.from({ length: idleDialogueCount + 1 }, () => {
      click(hitPoint())
      return bubble.textContent.replace(/\\s+/g, '').includes('合聚账号余额120.50USD')
    }).filter(Boolean).length === 1
    pet.play('Idle', true)
    pet.applyState({ closureCompanion: { quota, completed: true }, work: { mode: 'idle' }, turnEnd: { seq: 1, kind: 'completed' } })
    const completionText = bubble.textContent.replace(/\\s+/g, '')
    const completionDialogue = completionText.includes('奖励一下') && completionText.includes('85.5%')
    pet.applyState({ closureCompanion: { quota }, work: { mode: 'outputting' } })
    pet.showValleySticker()
    const sticker = document.querySelector('#dsh-closure-pet-sticker canvas')
    const stickerPainted = Boolean(sticker?.getContext('2d').getImageData(20, 20, 1, 1).data[3])
    return { dragged, clicked, panelOpened, voiceSettings, voiceVolumeWorks, voicesPlayed, expressionPreview, crtSettingsSaved, startupScheduled, thinking, talking, stickerPainted, dialogueCycles,
      dialogueSurvivesRefresh, workDialogueWithQuota, hasBalanceInRotation, completionDialogue, completionText, bubbleText, workText, animations: pet.animations, sounds: pet.sounds }
  })()`)
  if (!result.dragged || !result.clicked || !result.panelOpened || !result.voiceSettings || !result.voiceVolumeWorks || !result.expressionPreview || !result.crtSettingsSaved || !result.startupScheduled || !result.thinking ||
      !result.talking || !result.stickerPainted || !result.dialogueCycles || !result.dialogueSurvivesRefresh || !result.workDialogueWithQuota ||
      !result.hasBalanceInRotation || !result.completionDialogue) {
    throw new Error(`Interaction check failed: ${JSON.stringify(result)}`)
  }
  const preview = await win.webContents.capturePage()
  if (preview.isEmpty()) throw new Error('Spine render is empty.')
  if (process.env.CLOSURE_SMOKE_PNG) await writeFile(process.env.CLOSURE_SMOKE_PNG, preview.toPNG())
  console.log(JSON.stringify(result))
}

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    const followActivity = !dev && process.argv.includes('--follow-activity')
    const activity = createActivity(followActivity, path.join(codexHome, 'sessions'))
    const quota = followActivity ? createQuota({ enabled: true, home: codexHome }) : null
    app.once('before-quit', () => { activity.stop(); quota?.stop() })
    registerProtocol(activity, quota)
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: new URL(details.url).protocol !== `${scheme}:` }))
    const win = new BrowserWindow({
      width: 900, height: 620, frame: demo, transparent: !demo, show: false,
      resizable: demo, alwaysOnTop: !dev, focusable: dev, skipTaskbar: !demo, hasShadow: false,
      backgroundColor: demo ? '#151424' : '#00000000',
      title: '可露希尔 · Codex 桌宠',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
        nodeIntegration: false, offscreen: smoke, backgroundThrottling: !smoke,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    if (!dev) {
      registerInput(win)
      followCodex(win)
    }
    await win.loadURL(`${origin}/${canvas ? '?canvas=1' : ''}`)
    if (demo) win.show()
    if (smoke) {
      await runSmoke(win)
      app.exit(0)
    }
  }).catch((error) => {
    console.error(error)
    if (!smoke) dialog.showErrorBox('Closure Companion', error.message)
    app.exit(1)
  })
}

app.on('window-all-closed', () => app.quit())
