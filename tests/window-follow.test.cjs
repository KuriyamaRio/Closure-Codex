const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.join(__dirname, '../outputs/closure-companion/main.cjs'), 'utf8')
const followCodex = source.slice(source.indexOf('function followCodex('), source.indexOf('function registerInput('))
const tracker = new EventEmitter()
const lines = new EventEmitter()
const screen = new EventEmitter()
const win = new EventEmitter()
let visible = false
let bounds
let quit = 0
let scale = 1
let trackerStopped = false
tracker.stderr = new EventEmitter()
tracker.kill = () => { trackerStopped = true }
screen.screenToDipRect = (_window, rect) => ({
  x: rect.x, y: rect.y, width: rect.width / scale, height: rect.height / scale,
})
Object.assign(win, {
  getNativeWindowHandle: () => Buffer.alloc(8),
  isDestroyed: () => false,
  isVisible: () => visible,
  showInactive: () => { visible = true },
  hide: () => { visible = false },
  setBounds: (rect) => { bounds = rect },
})
vm.runInNewContext(`${followCodex}\nfollowCodex(win)`, {
  win, screen, path, __dirname, process, console, noTray: true,
  spawn: () => tracker, readline: { createInterface: () => lines }, app: { quit: () => { quit++ } },
})
const report = (state) => lines.emit('line', JSON.stringify(state))
const main = { visible: true, x: 0, y: 0, width: 1200, height: 800 }
report(main)
assert.equal(visible, true)
assert.equal(bounds.width, 1200)
for (const transition of ['picker', 'minimize']) {
  report({ visible: false })
  assert.equal(visible, false, transition)
  report(main)
  assert.equal(visible, true, transition)
}
scale = 1.5
report({ ...main, x: -1600 })
assert.equal(bounds.x, -1600)
assert.equal(bounds.width, 800)
scale = 2
screen.emit('display-metrics-changed')
assert.equal(bounds.width, 600)
tracker.emit('close')
assert.equal(visible, false)
assert.equal(quit, 1)
win.emit('closed')
assert.equal(trackerStopped, true)
assert.equal(screen.listenerCount('display-metrics-changed'), 0)
console.log('Window following, DPI conversion, and tracker failure passed.')
