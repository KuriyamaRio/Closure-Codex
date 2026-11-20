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
      win.setBounds(screen.screenToDipRect(null, bounds))
      if (!win.isVisible()) win.showInactive()
    } else if (win.isVisible()) {
      win.hide()
    }
  }
  lines.on('line', (message) => {
    if (win.isDestroyed()) return
    try {
      const { visible, x, y, width, height } = JSON.parse(message)
      bounds = visible ? { x, y, width, height } : null
      syncWindow()
    } catch (error) {
      console.error('Closure window tracker:', error.message)
    }
  })
  tracker.stderr.on('data', (chunk) => console.error(chunk.toString()))
  tracker.on('error', (error) => console.error('Closure window tracker:', error.message))
  tracker.once('close', () => {
    if (win.isDestroyed()) return
    bounds = null
    syncWindow()
    if (noTray) app.quit()
  })
  if (!noTray) {
    const tray = new Tray(path.join(__dirname, 'upstream', 'icon.png'))
    tray.setToolTip('可露希尔 · Codex 桌宠')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示桌宠', type: 'checkbox', checked: true, click: (item) => { paused = !item.checked; syncWindow() } },
      { label: '退出可露希尔桌宠', click: () => app.quit() },
    ]))
    win.once('closed', () => tray.destroy())
  }
  screen.on('display-metrics-changed', syncWindow)
  win.once('closed', () => {
    screen.removeListener('display-metrics-changed', syncWindow)
    tracker.kill()
  })
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
    const quota = [{ minutes: 300, remaining: 85.5 }]
    const tokenUsage = { total: 12480, turn: 900 }
    const state = (mode = 'idle', turnStartSeq = 0, seq = 0, kind = 'completed') => ({
      closureCompanion: { source: 'official', quota, credits: { balance: '3.25' }, tokenUsage },
      work: { mode, active: mode !== 'idle' },
      turnStartSeq, turnEnd: { seq, kind },
    })
    pet.applyState(state())
    click()
    const bubble = document.querySelector('#dsh-closure-pet-bubble')
    const bubbleText = () => bubble.textContent.replace(/\\s+/g, '')
    const clicked = bubble.style.opacity === '1' && bubbleText().includes('不许砍价') &&
      !bubbleText().includes('85.5%') && !bubbleText().includes('Token') &&
      await waitFor(() => pet.voice?.id === 'a02')
    pet.applyState({ ...state(), userInput: { seq: 1, scene: 'question' } })
    const questionVoice = await waitFor(() => pet.voice?.id === 'b10') && bubbleText().includes('有晋升的机会')
    const answerVoices = []
    for (const [index, id] of ['b12', 'b13', 'b14', 'b15', 'b12'].entries()) {
      pet.applyState({ ...state(), userInput: { seq: index + 2, scene: 'answer' } })
      answerVoices.push(await waitFor(() => pet.voice?.id === id))
    }
    const answerRotation = answerVoices.every(Boolean)
    pet.hideBubble()
    document.dispatchEvent(new MouseEvent('contextmenu', { clientX: point.x, clientY: point.y, cancelable: true }))
    const settings = document.querySelector('#dsh-closure-pet-settings')
    const panelOpened = getComputedStyle(settings).display === 'block'
    const notification = [...settings.querySelectorAll('details')].find((item) => item.querySelector('summary').textContent === '提醒与播报')
    notification.open = true
    const quotaOption = notification.querySelector('button[data-minutes="0"]')
    quotaOption.click()
    const toolNotice = notification.querySelector('input[type=checkbox]')
    toolNotice.click()
    const getSavedSettings = () => JSON.parse(localStorage.getItem('dshcl-settings'))
    const notificationsSaved = quotaOption.getAttribute('aria-pressed') === 'true' &&
      getSavedSettings().quotaReminderMinutes === 0 && !getSavedSettings().toolFailureNotice

    const editor = settings.querySelector('#dsh-closure-voice-queues')
    editor.querySelector('summary').click()
    const defaultMode = editor.querySelector('[data-queue-mode="default"]')
    const personalMode = editor.querySelector('[data-queue-mode="personal"]')
    const scenes = [...editor.querySelectorAll('[data-scene]')]
    const selectScene = (scene) => editor.querySelector('[data-scene="' + scene + '"]').click()
    const add = (id) => editor.querySelector('[data-add-voice="' + id + '"]').click()
    const remove = (id) => editor.querySelector('[data-queued-voice="' + id + '"] button:last-child').click()
    const list = () => [...editor.querySelectorAll('[data-queued-voice]')].map((row) => row.dataset.queuedVoice)
    const visibleClips = () => editor.querySelectorAll('[data-clip]:not([hidden])').length
    const expectedQueues = {
      start: 'a18,a19,a21,a23,a24',
      working: 'a02,a03,a04,a07,a08,a09,a11,a12,a20,a22,a25,a28,a33,a34,a36,a42,a06,a13,a14,b08',
      completion: 'a01,a05,a17,a29,a30,a44,b01,b02,b03,b04,b05,b07,b09,b18',
      startup: 'a37', idle: 'a10,b16', toolFailure: 'a31,a32',
      question: 'b10', answer: 'b12,b13,b14,b15',
    }
    const defaultQueues = await waitFor(() => defaultMode.getAttribute('aria-pressed') === 'true') &&
      scenes.length === Object.keys(expectedQueues).length && scenes.every((tab) => {
      tab.click()
      return list().join() === expectedQueues[tab.dataset.scene]
    })
    const fullCatalog = visibleClips() === 57
    editor.querySelector('[data-group="b"]').click()
    const filterWorks = visibleClips() === 19
    editor.querySelector('[data-group=""]').click()
    personalMode.click()
    const emptyPersonalQueues = scenes.every((tab) => {
      tab.click()
      return list().length === 0
    })
    selectScene('start')
    defaultMode.click()
    pet.applyState(state('thinking', 1))
    const defaultOverridesPersonal = list().join() === expectedQueues.start &&
      getSavedSettings().voiceQueues.start.length === 0 &&
      editor.querySelector('[data-add-voice="a01"]').disabled &&
      await waitFor(() => pet.voice?.id === 'a18')
    personalMode.click()
    pet.hideBubble()
    pet.applyState(state())
    pet.applyState(state('thinking', 1))
    const emptyDoesNotSpeak = !pet.voice && bubble.style.opacity === '0'

    selectScene('start')
    add('a18')
    add('a19')
    add('a01')
    editor.querySelector('[data-queued-voice="a19"] button').click()
    const ordered = list().join() === 'a19,a18,a01'
    remove('a01')
    for (const [scene, clip] of Object.entries({ working: 'a23', completion: 'a30', startup: 'b01', idle: 'b03' })) {
      selectScene(scene)
      for (const id of list()) remove(id)
      add(clip)
    }
    selectScene('working')
    add('a34')
    selectScene('start')
    const savedQueues = getSavedSettings().voiceQueues
    const queueEditor = fullCatalog && filterWorks && emptyPersonalQueues && emptyDoesNotSpeak && ordered &&
      list().join() === 'a19,a18' && !editor.querySelector('[data-add-voice="a01"]').disabled &&
      editor.querySelector('[data-add-voice="a19"]').disabled &&
      savedQueues.start.join() === 'a19,a18' && savedQueues.working.join() === 'a23,a34' &&
      savedQueues.completion.join() === 'a30' && savedQueues.startup.join() === 'b01' && savedQueues.idle.join() === 'b03'

    const voiceControl = settings.querySelector('[aria-label="角色配音"]')
    const voiceLanguages = [...settings.querySelectorAll('button[data-voice-language]')]
    const defaultVoice = voiceControl.checked && voiceLanguages.find(
      (button) => button.getAttribute('aria-pressed') === 'true')?.dataset.voiceLanguage === 'zh'
    const toolState = (fail) => ({
      ...state('idle', 1),
      tools: { ok: 0, fail, lastFailName: 'web.search', lastFailReason: '请求频率或额度受限（HTTP 429）' },
    })
    pet.play('Idle', true)
    pet.hideBubble()
    pet.applyState(toolState(0))
    pet.applyState(toolState(1))
    const disabledToolNotice = bubble.style.opacity === '0' && !pet.voice
    toolNotice.click()
    defaultMode.click()
    let toolVoice, toolVoiceRotates, toolTextWithoutVoice
    const clock = Date.now
    try {
      const base = clock()
      Date.now = () => base
      pet.applyState(toolState(2))
      toolVoice = await waitFor(() => pet.voice?.id === 'a31') &&
        bubbleText().includes('web.search报错了') && bubbleText().includes('HTTP429') && bubbleText().includes('追踪设备')
      if (!toolVoice) throw new Error(JSON.stringify({ voice: pet.voice, text: bubbleText(), layers: pet.layers,
        enabled: toolNotice.checked, audioEnabled: voiceControl.checked, hidden: document.hidden, saved: getSavedSettings().voiceQueues.toolFailure }))
      Date.now = () => base + 1500
      pet.play('Idle', true)
      pet.applyState(toolState(3))
      toolVoiceRotates = await waitFor(() => pet.voice?.id === 'a32') && bubbleText().includes('挂钩释放')
      personalMode.click()
      Date.now = () => base + 3000
      pet.play('Idle', true)
      pet.applyState(toolState(4))
      toolTextWithoutVoice = !pet.voice && bubbleText().includes('HTTP429') && !bubbleText().includes('挂钩释放')
    } finally {
      Date.now = clock
    }
    toolNotice.click()
    pet.hideBubble()
    pet.play('Idle', true)
    selectScene('start')

    const listen = (id) => editor.querySelector('[data-clip="' + id + '"] button').click()
    let voicesPlayed = 0
    for (const button of voiceLanguages) {
      button.click()
      if (pet.voice) throw new Error('Changing voice language left the previous line playing')
      listen('a18')
      if (await waitFor(() => pet.voice?.language === button.dataset.voiceLanguage)) voicesPlayed++
    }
    listen('b01')
    const languageFallback = await waitFor(() => pet.voice?.language === 'zh' && pet.voice.id === 'b01')
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
    pet.closePanel()
    const previewStops = !pet.voice
    const voiceVolumeWorks = mutedVoice && liveVoiceVolume && separateVolumes &&
      getSavedSettings().voiceVolume === 0.25 && getSavedSettings().volume === 0.5
    pet.applyState(state('thinking', 2))
    const startVoice = await waitFor(() => pet.voice?.id === 'a19' && pet.voice.language === 'ko')
    const startText = bubbleText()
    click(hitPoint())
    const clickKeepsDialogue = bubbleText() === startText && pet.voice?.id === 'a19'
    pet.applyState(state('thinking', 3))
    const startRotates = await waitFor(() => pet.voice?.id === 'a18')
    pet.openPanel()
    voiceControl.click()
    const voiceSettings = defaultVoice && voicesPlayed === 4 && languageFallback && previewStops && !pet.voice &&
      !voiceControl.checked && getSavedSettings().voice === false && getSavedSettings().voiceLanguage === 'ko'
    editor.open = false
    const startupScheduled = pet.startup.pending
    const expressions = [...settings.querySelectorAll('details')].find((item) => item.querySelector('summary').textContent === '预览表情')
    expressions.open = true
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
    const now = Date.now
    let workingDialogue, workingOnlyOnce, idleDialogue, idleOnlyOnce, completionDialogue, failedTurnSkipsCompletion
    let elapsed = 0
    try {
      const base = now()
      Date.now = () => base + elapsed
      pet.hideBubble()
      pet.applyState(state('thinking', 4))
      const thinking = pet.layers.work === 'Special_B'
      pet.applyState(state('outputting', 4))
      if (!thinking || pet.layers.work !== 'Talk') throw new Error('Work animations did not follow activity')
      pet.hideBubble()
      elapsed = 14_999
      pet.applyState(state('thinking', 4))
      const noEarlyWorking = bubble.style.opacity === '0'
      elapsed++
      pet.applyState(state('thinking', 4))
      workingDialogue = noEarlyWorking && bubbleText().includes('零号油罐')
      pet.hideBubble()
      elapsed += 1_000
      pet.applyState(state('thinking', 4))
      workingOnlyOnce = bubble.style.opacity === '0'

      pet.applyState(state('idle', 4, 1))
      const text = bubbleText()
      completionDialogue = text.includes('奖励一下') && !text.includes('3.25') &&
        !text.includes('85.5%') && !text.includes('Token')
      pet.hideBubble()
      pet.applyState(state('idle', 4, 2, 'error'))
      failedTurnSkipsCompletion = bubble.style.opacity === '0' || !bubbleText().includes('奖励一下')
      pet.hideBubble()
      elapsed += 299_999
      pet.applyState(state('idle', 4, 2))
      const noEarlyIdle = bubble.style.opacity === '0'
      elapsed++
      pet.applyState(state('idle', 4, 2))
      idleDialogue = noEarlyIdle && bubbleText().includes('辅助就交给我吧')
      pet.hideBubble()
      elapsed += 1_000
      pet.applyState(state('idle', 4, 2))
      idleOnlyOnce = bubble.style.opacity === '0'
    } finally {
      Date.now = now
    }
    pet.hideBubble()
    pet.runStartup()
    const startupDialogue = bubbleText().includes('模拟正式开始')
    pet.hideBubble()
    const balanceState = {
      ...state('idle', 4, 2),
      closureCompanion: { source: 'thirdParty', balance: { remaining: 120.5, unit: 'USD' }, quota: [], tokenUsage },
    }
    pet.applyState(balanceState)
    click(hitPoint())
    const text = bubbleText()
    const noQuotaOnClick = !text.includes('账户余额') && !text.includes('Token')
    const clickSharesWorkingQueue = text.includes('别急，我还在算呢。')
    voiceControl.click()
    click(hitPoint())
    const interactionRotates = await waitFor(() => pet.voice?.id === 'a23')
    pet.hideBubble()
    let automaticQuota, noQuotaSticker
    try {
      const base = now()
      Date.now = () => base + 60_000
      pet.applyState(balanceState)
      const reminderOff = bubble.style.opacity === '0'
      notification.querySelector('button[data-minutes="1"]').click()
      pet.applyState(balanceState)
      const quotaText = bubbleText()
      automaticQuota = reminderOff && bubble.style.opacity === '1' &&
        quotaText.includes('账户余额120.50USD') &&
        quotaText.includes('这段对话共用了12,480Token') && quotaText.includes('这轮用了900Token')
      pet.applyState(state('idle', 4, 2))
      pet.showValleySticker()
      noQuotaSticker = !document.querySelector('#dsh-closure-pet-sticker')
    } finally {
      Date.now = now
    }
    defaultMode.click()
    return { dragged, clicked, panelOpened, notificationsSaved, defaultQueues, defaultOverridesPersonal, queueEditor, voiceSettings, voiceVolumeWorks,
      startVoice, clickKeepsDialogue, startRotates, expressionPreview, crtSettingsSaved, startupScheduled,
      workingDialogue, workingOnlyOnce, completionDialogue, failedTurnSkipsCompletion, idleDialogue, idleOnlyOnce,
      startupDialogue, noQuotaOnClick, automaticQuota, noQuotaSticker, clickSharesWorkingQueue, interactionRotates,
      questionVoice, answerRotation,
      disabledToolNotice, toolVoice, toolVoiceRotates, toolTextWithoutVoice }
  })()`)
  if (!Object.values(result).every(Boolean)) {
    throw new Error(`Interaction check failed: ${JSON.stringify(result)}`)
  }
  const preview = await win.webContents.capturePage()
  if (preview.isEmpty()) throw new Error('Spine render is empty.')
  if (process.env.CLOSURE_SMOKE_PNG) await writeFile(process.env.CLOSURE_SMOKE_PNG, preview.toPNG())
  await win.loadURL(win.webContents.getURL())
  const queuesReloaded = await evaluate(`(async () => {
    const { settings } = await import('/dsh-closure/assets/src/core/settings.js')
    const { getVoiceQueues, normalizeSettings } = await import('/dsh-closure/assets/src/shared/protocol.js')
    const queues = settings.voiceQueues
    const oldProfile = normalizeSettings({ voiceQueues: { start: [] } })
    return queues.start.join() === 'a19,a18' && queues.working.join() === 'a23,a34' &&
      queues.completion.join() === 'a30' && queues.startup.join() === 'b01' && queues.idle.join() === 'b03' &&
      queues.toolFailure.length === 0 && settings.voiceQueueMode === 'default' &&
      getVoiceQueues(settings).start.join() === 'a18,a19,a21,a23,a24' &&
      getVoiceQueues(settings).toolFailure.join() === 'a31,a32' &&
      Object.values(oldProfile.voiceQueues).every((queue) => queue.length === 0) && getVoiceQueues(oldProfile).start[0] === 'a18'
  })()`)
  if (!queuesReloaded) throw new Error('Voice queues did not survive reload.')
  console.log(JSON.stringify({ ...result, queuesReloaded }))
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
      if (noTray) win.webContents.once('render-process-gone', () => app.quit())
    }
    await win.loadURL(`${origin}/${canvas ? '?canvas=1' : ''}`)
    if (demo) win.show()
    if (smoke) {
      await runSmoke(win)
      app.exit(0)
    }
  }).catch((error) => {
    console.error(error)
    if (!smoke) dialog.showErrorBox('Closure Companion', '嗯？我这边没启动起来。博士，桌宠初始化失败了。')
    app.exit(1)
  })
}

app.on('window-all-closed', () => app.quit())
