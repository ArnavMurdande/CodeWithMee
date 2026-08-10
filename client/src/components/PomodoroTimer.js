import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { AccessibleDialog } from './ui/AccessibleDialog';

const TimeInput = ({ id, label, value, onChange, onBlur, setter, max = 999, min = 0, unit }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      setter((prev) => {
        const curr = Number.parseInt(prev, 10) || 0;
        return Math.max(min, Math.min(max, curr + delta));
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [setter, max, min]);

  const increment = () => {
    setter((prev) => {
      const curr = Number.parseInt(prev, 10) || 0;
      return Math.min(max, curr + 1);
    });
  };

  const decrement = () => {
    setter((prev) => {
      const curr = Number.parseInt(prev, 10) || 0;
      return Math.max(min, curr - 1);
    });
  };

  return (
    <div className="input-field" ref={containerRef}>
      <input
        id={id}
        max={max}
        min={min}
        onBlur={onBlur}
        onChange={onChange}
        type="number"
        value={value}
      />
      <span className="unit-tag">{unit}</span>
      <div className="stepper-arrows">
        <button
          aria-label={`Increase ${label}`}
          className="stepper-btn"
          onClick={increment}
          type="button"
        >
          ▲
        </button>
        <button
          aria-label={`Decrease ${label}`}
          className="stepper-btn"
          onClick={decrement}
          type="button"
        >
          ▼
        </button>
      </div>
    </div>
  );
};

const PomodoroTimer = () => {
  const [workMins, setWorkMins] = useState(25);
  const [workSecs, setWorkSecs] = useState(0);
  const [breakMins, setBreakMins] = useState(5);
  const [breakSecs, setBreakSecs] = useState(0);

  const [isActive, setIsActive] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [showBreakOverlay, setShowBreakOverlay] = useState(false);
  const [isDropdownOpen, setDropdownOpen] = useState(false);

  const getSessionDuration = useCallback(
    (forBreak = isBreak) => {
      const m = Math.max(0, Number.parseInt(forBreak ? breakMins : workMins, 10) || 0);
      const s = Math.max(0, Number.parseInt(forBreak ? breakSecs : workSecs, 10) || 0);
      const total = m * 60 + s;
      return Math.max(5, total); // Minimum 5 seconds constraint
    },
    [breakMins, breakSecs, workMins, workSecs, isBreak],
  );

  const [totalDuration, setTotalDuration] = useState(() => getSessionDuration(false));
  const [timeLeft, setTimeLeft] = useState(() => getSessionDuration(false));

  const timerRef = useRef(null);
  const audioRef = useRef(new Audio('/notification.mp3'));
  const containerRef = useRef(null);

  const handleClickOutside = useCallback((event) => {
    if (containerRef.current && !containerRef.current.contains(event.target)) {
      setDropdownOpen(false);
    }
  }, []);

  useEffect(() => {
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isDropdownOpen, handleClickOutside]);

  useEffect(() => {
    if (!isDropdownOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isActive && !isFinished) {
      const duration = getSessionDuration(isBreak);
      setTotalDuration(duration);
      setTimeLeft(duration);
    }
  }, [workMins, workSecs, breakMins, breakSecs, isBreak, isActive, isFinished, getSessionDuration]);

  useEffect(() => {
    if (isActive) {
      timerRef.current = setInterval(() => {
        setTimeLeft((previous) => {
          if (previous <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return previous - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isActive]);

  useEffect(() => {
    if (timeLeft === 0 && isActive) {
      setIsActive(false);
      setIsFinished(true);

      try {
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            console.log('Audio play failed:', error);
          });
        }
      } catch (error) {
        console.log('Audio playback error:', error);
      }

      setShowBreakOverlay(true);
    }
  }, [timeLeft, isActive]);

  const toggleTimer = () => {
    if (isFinished) {
      setIsFinished(false);
      if (isBreak) handleStartWork();
      else handleStartBreak();
    } else {
      if (!isActive) {
        const duration = getSessionDuration(isBreak);
        if (duration < 5) {
          if (isBreak) setBreakSecs(5);
          else setWorkSecs(5);
        }
      }
      setIsActive((previous) => !previous);
    }
  };

  const resetTimer = () => {
    setIsActive(false);
    setIsFinished(false);
    setShowBreakOverlay(false);
    clearInterval(timerRef.current);
    const duration = getSessionDuration(isBreak);
    setTotalDuration(duration);
    setTimeLeft(duration);
  };

  const switchMode = () => {
    setIsActive(false);
    setIsFinished(false);
    const nextIsBreak = !isBreak;
    setIsBreak(nextIsBreak);
    const duration = getSessionDuration(nextIsBreak);
    setTotalDuration(duration);
    setTimeLeft(duration);
  };

  const handleStartBreak = () => {
    setIsFinished(false);
    setIsBreak(true);
    const duration = getSessionDuration(true);
    setTotalDuration(duration);
    setTimeLeft(duration);
    setIsActive(true);
    setShowBreakOverlay(true);
  };

  const handleStartWork = () => {
    setIsFinished(false);
    setIsBreak(false);
    const duration = getSessionDuration(false);
    setTotalDuration(duration);
    setTimeLeft(duration);
    setIsActive(true);
    setShowBreakOverlay(false);
  };

  const applyPreset = (wM, wS, bM, bS) => {
    setWorkMins(wM);
    setWorkSecs(wS);
    setBreakMins(bM);
    setBreakSecs(bS);
    setIsActive(false);
    setIsFinished(false);
    const duration = isBreak ? Math.max(5, bM * 60 + bS) : Math.max(5, wM * 60 + wS);
    setTotalDuration(duration);
    setTimeLeft(duration);
  };

  const formatTime = (seconds) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes < 10 ? '0' : ''}${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  const dismissOverlay = () => setShowBreakOverlay(false);

  const handleNumberInput = (setter, max = 999) => (event) => {
    const value = event.target.value;
    if (value === '') {
      setter('');
      return;
    }
    const num = Number.parseInt(value, 10);
    if (!Number.isNaN(num) && num >= 0) {
      setter(Math.min(max, num));
    }
  };

  const handleBlurWork = () => {
    setWorkMins((prevM) => {
      const m = prevM === '' || Number.isNaN(Number(prevM)) ? 0 : Math.max(0, Number.parseInt(prevM, 10));
      setWorkSecs((prevS) => {
        const s = prevS === '' || Number.isNaN(Number(prevS)) ? 0 : Math.max(0, Number.parseInt(prevS, 10));
        if (m === 0 && s < 5) return 5;
        return s;
      });
      return m;
    });
  };

  const handleBlurBreak = () => {
    setBreakMins((prevM) => {
      const m = prevM === '' || Number.isNaN(Number(prevM)) ? 0 : Math.max(0, Number.parseInt(prevM, 10));
      setBreakSecs((prevS) => {
        const s = prevS === '' || Number.isNaN(Number(prevS)) ? 0 : Math.max(0, Number.parseInt(prevS, 10));
        if (m === 0 && s < 5) return 5;
        return s;
      });
      return m;
    });
  };

  // Progress percentage calculation
  const elapsedTime = Math.max(0, totalDuration - timeLeft);
  const fillPercentage = totalDuration > 0 ? Math.min(100, (elapsedTime / totalDuration) * 100) : 0;

  const buttonModeClass = isBreak ? 'break-mode' : 'work-mode';
  const buttonStateClass = isFinished ? 'finished' : isActive ? 'active' : 'paused';

  const renderOverlayContent = () => {
    if (isFinished && !isBreak) {
      return (
        <>
          <div aria-hidden="true" className="break-icon">
            ☕
          </div>
          <h2 className="break-title">Time for a Break!</h2>
          <p className="break-message">
            Great work! You've completed your focus session.
            <br />
            Take a {breakMins}m {breakSecs ? `${breakSecs}s` : ''} break to recharge.
          </p>
          <div className="break-actions">
            <button className="break-start-btn" onClick={handleStartBreak} type="button">
              Start Break Timer
            </button>
            <button className="break-dismiss-btn" onClick={dismissOverlay} type="button">
              Dismiss
            </button>
          </div>
        </>
      );
    }

    if (isBreak && !isFinished) {
      return (
        <>
          <div aria-hidden="true" className="break-icon">
            🧘
          </div>
          <h2 className="break-title">Resting...</h2>
          <div className="break-timer-display">{formatTime(timeLeft)}</div>
          <p className="break-message">Relax and reset. We'll notify you when it's time to work.</p>
          <div className="break-actions">
            <button className="break-dismiss-btn" onClick={dismissOverlay} type="button">
              Hide Overlay
            </button>
          </div>
        </>
      );
    }

    if (isFinished && isBreak) {
      return (
        <>
          <div aria-hidden="true" className="break-icon">
            🚀
          </div>
          <h2 className="break-title">Break Over!</h2>
          <p className="break-message">Hope you're refreshed. Let's get back to it!</p>
          <div className="break-actions">
            <button className="break-start-btn" onClick={handleStartWork} type="button">
              Start Work Timer
            </button>
            <button className="break-dismiss-btn" onClick={dismissOverlay} type="button">
              Dismiss
            </button>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <>
      <div className="pomodoro-container" ref={containerRef}>
        <button
          aria-controls="pomodoro-settings"
          aria-expanded={isDropdownOpen}
          aria-haspopup="true"
          aria-label={`${isBreak ? 'Break' : 'Focus'} timer: ${
            isFinished ? (isBreak ? 'Start Work' : 'Start Break') : formatTime(timeLeft)
          }`}
          className={`pomodoro-button ${buttonModeClass} ${buttonStateClass}`}
          onClick={() => {
            if (isFinished) {
              if (isBreak) handleStartWork();
              else handleStartBreak();
            } else {
              setDropdownOpen((previous) => !previous);
            }
          }}
          type="button"
        >
          <div className="pomodoro-progress-fill" style={{ width: `${fillPercentage}%` }} />
          <div className="pomodoro-button-content">
            <span className={`status-dot ${isActive ? 'pulse' : ''}`} />
            {!isFinished && <span className="mode-label">{isBreak ? 'Break' : 'Focus'}</span>}
            <span className="time-display">
              {isFinished ? (isBreak ? 'Start Work' : 'Start Break') : formatTime(timeLeft)}
            </span>
          </div>
        </button>

        {isDropdownOpen && (
          <div
            aria-label="Focus timer settings"
            className="pomodoro-dropdown"
            id="pomodoro-settings"
            role="region"
          >
            <div className="dropdown-header">
              <div className="header-title">
                <span className={`header-dot ${isBreak ? 'break' : 'work'}`} />
                <span>{isBreak ? 'Break Settings' : 'Work Settings'}</span>
              </div>
              <button
                className="mode-switch-btn"
                onClick={switchMode}
                title="Switch mode"
                type="button"
              >
                {isBreak ? 'Switch to Work' : 'Switch to Break'}
              </button>
            </div>

            <div className="dropdown-section-group">
              <label htmlFor="pomodoro-work-time" className="section-label">Work Duration</label>
              <div className="time-inputs-row">
                <TimeInput
                  id="pomodoro-work-time"
                  label="Work Minutes"
                  max={999}
                  min={0}
                  onBlur={handleBlurWork}
                  onChange={handleNumberInput(setWorkMins, 999)}
                  setter={setWorkMins}
                  unit="m"
                  value={workMins}
                />
                <TimeInput
                  id="pomodoro-work-secs"
                  label="Work Seconds"
                  max={59}
                  min={0}
                  onBlur={handleBlurWork}
                  onChange={handleNumberInput(setWorkSecs, 59)}
                  setter={setWorkSecs}
                  unit="s"
                  value={workSecs}
                />
              </div>
            </div>

            <div className="dropdown-section-group">
              <label htmlFor="pomodoro-break-time" className="section-label">Break Duration</label>
              <div className="time-inputs-row">
                <TimeInput
                  id="pomodoro-break-time"
                  label="Break Minutes"
                  max={999}
                  min={0}
                  onBlur={handleBlurBreak}
                  onChange={handleNumberInput(setBreakMins, 999)}
                  setter={setBreakMins}
                  unit="m"
                  value={breakMins}
                />
                <TimeInput
                  id="pomodoro-break-secs"
                  label="Break Seconds"
                  max={59}
                  min={0}
                  onBlur={handleBlurBreak}
                  onChange={handleNumberInput(setBreakSecs, 59)}
                  setter={setBreakSecs}
                  unit="s"
                  value={breakSecs}
                />
              </div>
            </div>

            <div className="presets-group">
              <div className="presets-label">Quick Presets</div>
              <div className="presets-buttons">
                <button onClick={() => applyPreset(25, 0, 5, 0)} type="button">
                  25m / 5m
                </button>
                <button onClick={() => applyPreset(50, 0, 10, 0)} type="button">
                  50m / 10m
                </button>
                <button onClick={() => applyPreset(15, 0, 3, 0)} type="button">
                  15m / 3m
                </button>
                <button onClick={() => applyPreset(0, 30, 0, 5)} type="button">
                  30s / 5s
                </button>
              </div>
            </div>

            <div className="pomodoro-actions">
              <button
                className={`action-btn start-btn ${isActive ? 'active' : ''}`}
                onClick={toggleTimer}
                type="button"
              >
                {isActive ? 'Pause' : 'Start'}
              </button>
              <button className="action-btn reset-btn" onClick={resetTimer} type="button">
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {showBreakOverlay &&
        ReactDOM.createPortal(
          <AccessibleDialog
            label="Focus timer notification"
            onClose={dismissOverlay}
            overlayClassName="break-overlay"
            surfaceClassName="break-overlay-content"
          >
            {renderOverlayContent()}
          </AccessibleDialog>,
          document.body,
        )}
    </>
  );
};

export default PomodoroTimer;
