import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Waves,
} from 'lucide-react'
import './App.css'

const PRESETS = [
  { label: 'Standart', focus: 25, rest: 5 },
  { label: 'Dərin İş', focus: 50, rest: 10 },
  { label: 'Sprint', focus: 15, rest: 3 },
]

const AMBIENT_OPTIONS = [
  { value: 'off', label: 'Səssiz' },
  { value: 'white', label: 'White Noise' },
  { value: 'rain', label: 'Yağış' },
  { value: 'forest', label: 'Meşə tonu' },
]

const STORAGE_KEY = 'deep-focus-state-v1'

function clampNumber(value, min, max, fallback) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(Math.max(value, min), max)
}

function getInitialState() {
  const defaults = {
    focusMinutes: 25,
    breakMinutes: 5,
    mode: 'focus',
    secondsLeft: 25 * 60,
    completedSessions: 0,
    tasks: [],
    ambient: 'off',
    volume: 40,
  }

  try {
    const rawState = window.localStorage.getItem(STORAGE_KEY)
    if (!rawState) {
      return defaults
    }

    const parsed = JSON.parse(rawState)
    const ambientValues = AMBIENT_OPTIONS.map((option) => option.value)
    const safeMode = parsed.mode === 'break' ? 'break' : 'focus'
    const safeFocus = clampNumber(parsed.focusMinutes, 5, 120, defaults.focusMinutes)
    const safeBreak = clampNumber(parsed.breakMinutes, 1, 45, defaults.breakMinutes)
    const maxSeconds = (safeMode === 'focus' ? safeFocus : safeBreak) * 60
    const safeTasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter(
            (task) =>
              task && typeof task.id === 'string' && typeof task.title === 'string',
          )
          .map((task) => ({ ...task, done: Boolean(task.done) }))
      : defaults.tasks

    return {
      focusMinutes: safeFocus,
      breakMinutes: safeBreak,
      mode: safeMode,
      secondsLeft: clampNumber(parsed.secondsLeft, 0, maxSeconds, maxSeconds),
      completedSessions: clampNumber(parsed.completedSessions, 0, 100000, 0),
      tasks: safeTasks,
      ambient: ambientValues.includes(parsed.ambient) ? parsed.ambient : defaults.ambient,
      volume: clampNumber(parsed.volume, 0, 100, defaults.volume),
    }
  } catch {
    return defaults
  }
}

function formatTime(totalSeconds) {
  const safeValue = Math.max(totalSeconds, 0)
  const minutes = Math.floor(safeValue / 60)
  const seconds = safeValue % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function App() {
  const initialState = useMemo(() => getInitialState(), [])

  const [focusMinutes, setFocusMinutes] = useState(initialState.focusMinutes)
  const [breakMinutes, setBreakMinutes] = useState(initialState.breakMinutes)
  const [mode, setMode] = useState(initialState.mode)
  const [secondsLeft, setSecondsLeft] = useState(initialState.secondsLeft)
  const [isRunning, setIsRunning] = useState(false)
  const [completedSessions, setCompletedSessions] = useState(initialState.completedSessions)

  const [taskInput, setTaskInput] = useState('')
  const [tasks, setTasks] = useState(initialState.tasks)

  const [ambient, setAmbient] = useState(initialState.ambient)
  const [volume, setVolume] = useState(initialState.volume)
  const audioRef = useRef({ ctx: null, source: null, nodes: [] })
  const modeRef = useRef(mode)
  const focusRef = useRef(focusMinutes)
  const breakRef = useRef(breakMinutes)

  const cycleDuration = mode === 'focus' ? focusMinutes * 60 : breakMinutes * 60
  const progress = useMemo(() => {
    if (!cycleDuration) {
      return 0
    }

    return Math.min(Math.max((cycleDuration - secondsLeft) / cycleDuration, 0), 1)
  }, [cycleDuration, secondsLeft])

  const stopAmbient = useCallback(() => {
    if (!audioRef.current.source) {
      return
    }

    try {
      audioRef.current.source.stop()
    } catch {
      // Source may already be stopped.
    }

    audioRef.current.nodes.forEach((node) => {
      if (node && typeof node.disconnect === 'function') {
        node.disconnect()
      }
    })

    audioRef.current.source = null
    audioRef.current.nodes = []
  }, [])

  const startAmbient = useCallback(async () => {
    if (ambient === 'off') {
      stopAmbient()
      return
    }

    let ctx = audioRef.current.ctx

    if (!ctx) {
      ctx = new window.AudioContext()
      audioRef.current.ctx = ctx
    }

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    stopAmbient()

    const frameCount = ctx.sampleRate * 2
    const noiseBuffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
    const channelData = noiseBuffer.getChannelData(0)

    for (let i = 0; i < frameCount; i += 1) {
      channelData[i] = Math.random() * 2 - 1
    }

    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer
    source.loop = true

    const gainNode = ctx.createGain()
    gainNode.gain.value = volume / 100

    if (ambient === 'white') {
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      audioRef.current.nodes = [source, gainNode]
    }

    if (ambient === 'rain') {
      const highPass = ctx.createBiquadFilter()
      highPass.type = 'highpass'
      highPass.frequency.value = 800

      const lowPass = ctx.createBiquadFilter()
      lowPass.type = 'lowpass'
      lowPass.frequency.value = 7000

      source.connect(highPass)
      highPass.connect(lowPass)
      lowPass.connect(gainNode)
      gainNode.connect(ctx.destination)
      audioRef.current.nodes = [source, highPass, lowPass, gainNode]
    }

    if (ambient === 'forest') {
      const lowPass = ctx.createBiquadFilter()
      lowPass.type = 'lowpass'
      lowPass.frequency.value = 1200

      const peak = ctx.createBiquadFilter()
      peak.type = 'peaking'
      peak.frequency.value = 300
      peak.Q.value = 0.9
      peak.gain.value = 2

      source.connect(lowPass)
      lowPass.connect(peak)
      peak.connect(gainNode)
      gainNode.connect(ctx.destination)
      audioRef.current.nodes = [source, lowPass, peak, gainNode]
    }

    source.start()
    audioRef.current.source = source
  }, [ambient, stopAmbient, volume])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    focusRef.current = focusMinutes
  }, [focusMinutes])

  useEffect(() => {
    breakRef.current = breakMinutes
  }, [breakMinutes])

  useEffect(() => {
    const stateToStore = {
      focusMinutes,
      breakMinutes,
      mode,
      secondsLeft,
      completedSessions,
      tasks,
      ambient,
      volume,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToStore))
  }, [
    ambient,
    breakMinutes,
    completedSessions,
    focusMinutes,
    mode,
    secondsLeft,
    tasks,
    volume,
  ])

  useEffect(() => {
    if (!isRunning) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev > 1) {
          return prev - 1
        }

        const nextMode = modeRef.current === 'focus' ? 'break' : 'focus'
        const nextDuration =
          (nextMode === 'focus' ? focusRef.current : breakRef.current) * 60

        if (modeRef.current === 'focus') {
          setCompletedSessions((sessions) => sessions + 1)
        }

        modeRef.current = nextMode
        setMode(nextMode)
        return nextDuration
      })
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [isRunning])

  useEffect(() => {
    if (ambient === 'off') {
      stopAmbient()
      return undefined
    }

    startAmbient()
    return () => stopAmbient()
  }, [ambient, startAmbient, stopAmbient])

  useEffect(() => {
    const audioState = audioRef.current

    return () => {
      if (audioState.source) {
        try {
          audioState.source.stop()
        } catch {
          // Source may already be stopped.
        }

        audioState.nodes.forEach((node) => {
          if (node && typeof node.disconnect === 'function') {
            node.disconnect()
          }
        })

        audioState.source = null
        audioState.nodes = []
      }

      if (audioState.ctx) {
        audioState.ctx.close()
        audioState.ctx = null
      }
    }
  }, [])

  const handlePreset = (focus, rest) => {
    setIsRunning(false)
    setFocusMinutes(focus)
    setBreakMinutes(rest)
    setMode('focus')
    setSecondsLeft(focus * 60)
  }

  const handleToggleMode = (nextMode) => {
    setIsRunning(false)
    setMode(nextMode)
    setSecondsLeft((nextMode === 'focus' ? focusMinutes : breakMinutes) * 60)
  }

  const handleResetTimer = () => {
    setIsRunning(false)
    setMode('focus')
    setSecondsLeft(focusMinutes * 60)
  }

  const handleAddTask = (event) => {
    event.preventDefault()

    const cleanedText = taskInput.trim()
    if (!cleanedText) {
      return
    }

    setTasks((prev) => [
      {
        id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        title: cleanedText,
        done: false,
      },
      ...prev,
    ])
    setTaskInput('')
  }

  const toggleTask = (taskId) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, done: !task.done } : task,
      ),
    )
  }

  const removeTask = (taskId) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId))
  }

  const handleResetAllData = () => {
    window.localStorage.removeItem(STORAGE_KEY)
    setIsRunning(false)
    setFocusMinutes(25)
    setBreakMinutes(5)
    setMode('focus')
    setSecondsLeft(25 * 60)
    setCompletedSessions(0)
    setTasks([])
    setTaskInput('')
    setAmbient('off')
    setVolume(40)
  }

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-left" aria-hidden="true" />
      <div className="backdrop backdrop-right" aria-hidden="true" />

      <main className="layout">
        <section className="panel hero-panel">
          <div className="hero-top">
            <span className="pill">
              <Clock3 size={14} /> Deep Focus
            </span>
            <span className="session-count">Tam fokus seansı: {completedSessions}</span>
          </div>

          <h1>Diqqəti dağıtmadan dərin iş rejiminə keç.</h1>
          <p>
            Pomodoro ritmini özünə uyğunlaşdır, tapşırıqları izləyərək diqqətini bir
            nöqtədə saxla.
          </p>

          <div className="preset-list">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="ghost-btn"
                onClick={() => handlePreset(preset.focus, preset.rest)}
                type="button"
              >
                {preset.label} {preset.focus}/{preset.rest}
              </button>
            ))}
            <button className="ghost-btn" onClick={handleResetAllData} type="button">
              Məlumatları sıfırla
            </button>
          </div>

          <div className="time-controls">
            <label>
              Fokus (dəqiqə)
              <input
                type="number"
                min="5"
                max="120"
                value={focusMinutes}
                onChange={(event) =>
                  {
                    const nextFocus = Math.min(
                      Math.max(Number(event.target.value) || 5, 5),
                      120,
                    )

                    setFocusMinutes(nextFocus)

                    if (!isRunning && mode === 'focus') {
                      setSecondsLeft(nextFocus * 60)
                    }
                  }
                }
              />
            </label>
            <label>
              Fasilə (dəqiqə)
              <input
                type="number"
                min="1"
                max="45"
                value={breakMinutes}
                onChange={(event) =>
                  {
                    const nextBreak = Math.min(
                      Math.max(Number(event.target.value) || 1, 1),
                      45,
                    )

                    setBreakMinutes(nextBreak)

                    if (!isRunning && mode === 'break') {
                      setSecondsLeft(nextBreak * 60)
                    }
                  }
                }
              />
            </label>
          </div>
        </section>

        <section className="panel timer-panel">
          <div className="mode-switch">
            <button
              type="button"
              className={mode === 'focus' ? 'mode-btn active' : 'mode-btn'}
              onClick={() => handleToggleMode('focus')}
            >
              Fokus
            </button>
            <button
              type="button"
              className={mode === 'break' ? 'mode-btn active' : 'mode-btn'}
              onClick={() => handleToggleMode('break')}
            >
              Fasilə
            </button>
          </div>

          <div className="timer-ring" style={{ '--progress': progress }}>
            <div className="timer-content">
              <span className="timer-label">
                {mode === 'focus' ? 'Fokus seansı' : 'Bərpa fasiləsi'}
              </span>
              <strong>{formatTime(secondsLeft)}</strong>
            </div>
          </div>

          <div className="timer-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={() => setIsRunning((prev) => !prev)}
            >
              {isRunning ? <Pause size={16} /> : <Play size={16} />} {isRunning ? 'Dayandır' : 'Başlat'}
            </button>
            <button type="button" className="ghost-btn" onClick={handleResetTimer}>
              <RotateCcw size={16} /> Sıfırla
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <Waves size={16} /> Ambient səslər
          </div>
          <div className="ambient-options">
            {AMBIENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={ambient === option.value ? 'chip active' : 'chip'}
                onClick={() => setAmbient(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="slider-row">
            Səs gücü
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            <span>{volume}%</span>
          </label>
        </section>

        <section className="panel task-panel">
          <div className="panel-title">Tapşırıq siyahısı</div>

          <form className="task-form" onSubmit={handleAddTask}>
            <input
              value={taskInput}
              onChange={(event) => setTaskInput(event.target.value)}
              placeholder="Məs: API endpointlərini tamamlamaq"
            />
            <button type="submit" className="primary-btn">
              Əlavə et
            </button>
          </form>

          <ul className="task-list">
            {tasks.length === 0 && (
              <li className="empty-state">Bu gün üçün fokus tapşırığını əlavə et.</li>
            )}

            {tasks.map((task) => (
              <li key={task.id} className={task.done ? 'task-item done' : 'task-item'}>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => toggleTask(task.id)}
                  aria-label="Tapşırığı tamamla"
                >
                  <Circle size={18} />
                </button>
                <span>{task.title}</span>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={() => removeTask(task.id)}
                  aria-label="Tapşırığı sil"
                >
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}

export default App
