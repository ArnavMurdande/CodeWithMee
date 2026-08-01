import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { AccessibleDialog } from './ui/AccessibleDialog';

const PomodoroTimer = () => {
  const [workTime, setWorkTime] = useState(30);
  const [breakTime, setBreakTime] = useState(5);
  const [isActive, setIsActive] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  const [timeLeft, setTimeLeft] = useState(workTime * 60);
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [showBreakOverlay, setShowBreakOverlay] = useState(false);

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

  useEffect(() => {
    if (!isActive && !isFinished) {
      const timeValue = isBreak ? breakTime : workTime;
      if (timeValue && !Number.isNaN(Number(timeValue)) && Number.parseInt(timeValue, 10) > 0) {
        setTimeLeft(timeValue * 60);
      }
    }
  }, [workTime, breakTime, isBreak, isActive, isFinished]);

  const toggleTimer = () => {
    if (isFinished) {
      setIsFinished(false);
      setIsBreak((previous) => !previous);
    } else {
      setIsActive((previous) => !previous);
    }
  };

  const resetTimer = () => {
    setIsActive(false);
    setIsBreak(false);
    setIsFinished(false);
    const resetValue = isBreak ? breakTime : workTime;
    setTimeLeft((resetValue && !Number.isNaN(Number(resetValue)) ? resetValue : 25) * 60);
    setShowBreakOverlay(false);
    clearInterval(timerRef.current);
  };

  const formatTime = (seconds) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `${minutes < 10 ? '0' : ''}${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  const getButtonText = () => {
    if (isFinished) return isBreak ? 'Start Work' : 'Start Break';
    return formatTime(timeLeft);
  };

  const handleStartBreak = () => {
    setIsFinished(false);
    setIsBreak(true);
    const validBreakTime =
      breakTime && !Number.isNaN(Number(breakTime)) && Number.parseInt(breakTime, 10) > 0
        ? breakTime
        : 5;
    setTimeLeft(validBreakTime * 60);
    setIsActive(true);
    setShowBreakOverlay(true);
  };

  const handleStartWork = () => {
    setIsFinished(false);
    setIsBreak(false);
    const validWorkTime =
      workTime && !Number.isNaN(Number(workTime)) && Number.parseInt(workTime, 10) > 0
        ? workTime
        : 25;
    setTimeLeft(validWorkTime * 60);
    setIsActive(true);
    setShowBreakOverlay(false);
  };

  const dismissOverlay = () => setShowBreakOverlay(false);

  const handleTimeChange = (setter) => (event) => {
    const value = event.target.value;
    if (value === '' || (!Number.isNaN(Number(value)) && Number.parseInt(value, 10) >= 0)) {
      setter(value);
    }
  };

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
            Take a {breakTime} minute break to recharge.
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

  const buttonClass = isFinished ? 'finished' : isActive ? 'active' : '';

  return (
    <>
      <div className="pomodoro-container" ref={containerRef}>
        <button
          aria-controls="pomodoro-settings"
          aria-expanded={isDropdownOpen}
          aria-haspopup="true"
          aria-label={`${isBreak ? 'Break' : 'Focus'} timer: ${getButtonText()}`}
          className={`pomodoro-button ${buttonClass}`}
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
          {getButtonText()}
        </button>

        {isDropdownOpen && (
          <div
            aria-label="Focus timer settings"
            className="pomodoro-dropdown"
            id="pomodoro-settings"
            role="region"
          >
            <div className="dropdown-section">
              <label htmlFor="pomodoro-work-time">Work</label>
              <input
                id="pomodoro-work-time"
                min="1"
                onChange={handleTimeChange(setWorkTime)}
                type="number"
                value={workTime}
              />
              <span>mins</span>
            </div>
            <div className="dropdown-section">
              <label htmlFor="pomodoro-break-time">Break</label>
              <input
                id="pomodoro-break-time"
                min="1"
                onChange={handleTimeChange(setBreakTime)}
                type="number"
                value={breakTime}
              />
              <span>mins</span>
            </div>
            <div className="pomodoro-actions">
              <button onClick={toggleTimer} type="button">
                {isActive ? 'Pause' : 'Start'}
              </button>
              <button onClick={resetTimer} type="button">
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
