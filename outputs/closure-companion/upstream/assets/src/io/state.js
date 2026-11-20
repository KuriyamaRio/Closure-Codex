// dsh-closure-pet — 宿主状态轮询与事件分发
//
// 每秒拉 /dsh-closure/state；用计数器（而非布尔）识别事件，轮询丢帧也不会漏。
// applyState 负责把状态映射成：动画层、气泡反馈、音效、开屏时序。
// 依赖注入：layers / playOverlay / syncAnimation / showBubble / refreshBubble / playSound /
// scheduleStartup / settings / saveSettings / layout / repositionForAnchor / resolveFlip /
// applyOpacity / isBubbleShown。

import { PREFIX, SIZE_MIN, SIZE_MAX } from '../core/env.js'
import { HAPPY_CHANCE } from '../anim/library.js'

export function createState(deps) {
  var layers = deps.layers
  var playOverlay = deps.playOverlay
  var syncAnimation = deps.syncAnimation
  var showBubble = deps.showBubble
  var refreshBubble = deps.refreshBubble
  var playSound = deps.playSound
  var scheduleStartup = deps.scheduleStartup
  var settings = deps.settings
  var saveSettings = deps.saveSettings
  var layout = deps.layout
  var repositionForAnchor = deps.repositionForAnchor
  var resolveFlip = deps.resolveFlip
  var applyOpacity = deps.applyOpacity
  var isBubbleShown = deps.isBubbleShown

  // ————————————————————— P4：宿主状态轮询 —————————————————————
  // 每秒拉 /dsh-closure/state；用计数器增量识别事件（轮询丢帧也不会漏）。
  var pollTimer = 0
  var pollTimerMs = 0
  var lastState = null
  var toolPlayTimes = []
  var TOOL_MIN_GAP = 1200      // 同类事件最小间隔
  var TOOL_WINDOW = 10000      // 限流窗口
  var TOOL_WINDOW_MAX = 3      // 窗口内最多播几次
  var lowBalance = false
  var lowQuotaWindows = new Set()
  var nextQuotaReminder = Date.now() + 60000

  function react(name, message, sound, duration) {
    return playOverlay(name, undefined, function () {
      if (message) showBubble(message, duration)
      if (sound) playSound(sound)
    })
  }

  function toolOverlay(name, message, sound) {
    var now = Date.now()
    toolPlayTimes = toolPlayTimes.filter(function (t) { return now - t < TOOL_WINDOW })
    var last = toolPlayTimes.length ? toolPlayTimes[toolPlayTimes.length - 1] : 0
    if (now - last < TOOL_MIN_GAP) return false
    if (toolPlayTimes.length >= TOOL_WINDOW_MAX) return false
    toolPlayTimes.push(now)
    react(name, message, sound)
    return true
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return
    var prev = lastState
    lastState = s
    var first = !prev
    if (prev?.closureCompanion?.source !== s.closureCompanion?.source) lowQuotaWindows.clear()

    var mode = s.work && s.work.mode
    layers.work = mode === 'outputting' ? 'Talk' : (mode === 'thinking' ? 'Special_B' : null)

    if (s.closureCompanion) {
      var quota = s.closureCompanion.quota
      var quotaIsLow = quota.some(function (quotaWindow) { return quotaWindow.remaining <= 10 })
      layers.base = quotaIsLow ? 'Sad_Idle' : 'Idle'
      var wasLow = lowQuotaWindows.size > 0
      for (const entry of quota) {
        if (entry.remaining <= 10) lowQuotaWindows.add(entry.minutes)
        else lowQuotaWindows.delete(entry.minutes)
      }
      if (first) {
        scheduleStartup(false, quotaIsLow, true)
      } else if (quotaIsLow && !wasLow) {
        react('Sad_Begin', '博士！额度快见底了！', 'fail')
      } else if (wasLow && !lowQuotaWindows.size) {
        react('Special_A', '额度恢复了\n可露希尔继续为你效力~', 'coin')
      }
    } else if (first) {
      var low = !!(s.balance && s.balance.low)
      lowBalance = low
      layers.base = low ? 'Sad_Idle' : 'Idle'
      // 启动时序延迟播放：等客户端首屏稳定后再演（默认 10s，
      // localStorage 的 dshcl-startup-delay 可覆盖，方便调试）
      scheduleStartup(s.period === 'peak', low)
    } else if (s.balance && s.balance.ok && Boolean(s.balance.low) !== lowBalance) {
      var low = Boolean(s.balance.low)
      lowBalance = low
      layers.base = low ? 'Sad_Idle' : 'Idle'
      // 变低 → 难过一次；恢复 → 充值成功式（Special_A），不是难过
      // 若同一轮还带 topUpSeq，交给下面的"充值到账"分支报，避免两句话打架
      var sameTickTopUp = s.topUpSeq > ((prev && prev.topUpSeq) || 0)
      if (low || !sameTickTopUp) react(low ? 'Sad_Begin' : 'Special_A',
        low ? '博士！预算快见底了\n该批经费啦！' : '经费到账\n可露希尔继续为你效力~', low ? 'fail' : 'coin')
    }

    if (prev) {
      var prevTurnEnd = (prev.turnEnd && prev.turnEnd.seq) || 0
      var curTurnEnd = (s.turnEnd && s.turnEnd.seq) || 0
      var kind = (s.turnEnd && s.turnEnd.kind) || 'completed'
      var terminalFailure = curTurnEnd > prevTurnEnd && kind !== 'completed'
      var prevErrCount = (prev.errors && prev.errors.count) || 0
      var curErrCount = (s.errors && s.errors.count) || 0
      if (s.tools && prev.tools) {
        // 工具成功：只保留概率性的 Happy 动画，不出气泡、不播音效
        if (s.tools.fail > prev.tools.fail && !terminalFailure && curErrCount <= prevErrCount) {
          toolOverlay('Sad_Begin', '工具调用失败' + (s.tools.lastFailName ? '：' + s.tools.lastFailName : ''), 'fail')
        } else if (s.tools.fail === prev.tools.fail && s.tools.ok > prev.tools.ok) {
          var successCount = s.tools.ok - prev.tools.ok
          // 一次轮询合并了多次成功时，保留每次工具成功原有的庆祝概率。
          if (Math.random() < 1 - Math.pow(1 - HAPPY_CHANCE, successCount)) toolOverlay('Happy')
        }
      }
      // 模型/轮次级错误：只报反馈内容（气泡此时不显示余额/花费）
      if (curErrCount > prevErrCount && !terminalFailure) {
        var errMsg = String((s.errors && s.errors.message) || '').slice(0, 40)
        react('Sad_Begin', '出错了' + (errMsg ? '：' + errMsg : ''), 'fail', 4600)
      }
      if (s.topUpSeq > prev.topUpSeq) {
        react('Special_A', '感谢惠顾~\n采购部随时欢迎下次光临！', 'coin')
      }
      // 本轮结束（turn/end）：完成 / 中断 / 出错各给一句反馈
      if (curTurnEnd > prevTurnEnd) {
        if (kind === 'completed') {
          if (!layers.overlay && curErrCount <= prevErrCount && !(s.tools?.fail > prev.tools?.fail)) {
            if (s.closureCompanion) deps.showCompletion()
            else showBubble()
          }
        } else if (kind === 'error') {
          react('Sad_Begin', '啧，这次出错了博士……', 'turnfail')
        } else {
          react('Sad_Begin', '欸？怎么突然掐断了？', 'turnfail')
        }
      }
      if (s.periodSeq > prev.periodSeq) {
        react(s.period === 'peak' ? 'Sad_Begin' : 'Special_A',
          s.period === 'peak' ? '开始按原价收费了哦博士~' : '可露希尔大减价时间到~\n冲啊博士！')
      }
    }
    // 气泡开着的时候顺带刷新数字（余额 / 倒计时）
    if (isBubbleShown()) refreshBubble()
    else if (deps.showQuota && s.closureCompanion?.source && !document.hidden && Date.now() >= nextQuotaReminder && deps.showQuota()) {
      nextQuotaReminder = Date.now() + 60000
    }
    syncAnimation(false)
  }

  function pollState() {
    fetch(PREFIX + '/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (s) { try { applyState(s) } catch (err) {} })
      .catch(function () { /* 路由不可用就纯待机，不报错 */ })
  }

  function startPolling() {
    pollState()
    setPollInterval(1000)
  }

  // 前台 1s 轮询；后台降到 5s（省电，且后台本来就看不到）
  function setPollInterval(ms) {
    if (pollTimer && pollTimerMs === ms) return
    if (pollTimer) clearInterval(pollTimer)
    pollTimerMs = ms
    pollTimer = setInterval(pollState, ms)
  }

  // 宿主侧持久化设置（$DSH_HOME/.dshcl.json）优先于 localStorage
  function loadHostConfig() {
    fetch(PREFIX + '/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (cfg) {
        var s = cfg && cfg.settings
        if (!s) return
        if (s.mirror === 'auto' || s.mirror === 'always' || s.mirror === 'never') settings.mirror = s.mirror
        if (isFinite(Number(s.size))) settings.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(s.size)))
        if (typeof s.bubble === 'boolean') settings.bubble = s.bubble
        if (isFinite(Number(s.opacity))) settings.opacity = Math.min(1, Math.max(0.3, Number(s.opacity)))
        if (typeof s.sound === 'boolean') settings.sound = s.sound
        if (isFinite(Number(s.volume))) settings.volume = Math.min(1, Math.max(0, Number(s.volume)))
        layout()
        repositionForAnchor()
        resolveFlip()
        applyOpacity()
        saveSettings(true)
      })
      .catch(function () { /* 宿主不可用就沿用 localStorage */ })
  }

  function dispose() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
    pollTimerMs = 0
  }

  return {
    applyState: applyState,
    pollState: pollState,
    startPolling: startPolling,
    setPollInterval: setPollInterval,
    loadHostConfig: loadHostConfig,
    getState: function () { return lastState },
    dispose: dispose,
  }
}
