import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './PomodoroTimer.css';

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

  // Close dropdown when clicking outside
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
    if (isActive) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isActive]);

  useEffect(() => {
    if (timeLeft === 0 && isActive) {
      // Timer just hit zero (and was validly running)
      setIsActive(false);
      setIsFinished(true); // Triggers the overlay states
      
      // Safe audio play
      try {
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.log("Audio play failed:", error);
          });
        }
      } catch (e) {
        console.log("Audio playback error:", e);
      }
      
      // Always ensure overlay is visible when timer finishes
      setShowBreakOverlay(true);
    }
  }, [timeLeft, isActive]);

  useEffect(() => {
    if (!isActive && !isFinished) {
      const timeValue = isBreak ? breakTime : workTime;
      // Only update if it's a valid number greater than 0
      if (timeValue && !isNaN(timeValue) && parseInt(timeValue) > 0) {
        setTimeLeft(timeValue * 60);
      }
    }
  }, [workTime, breakTime, isBreak, isActive, isFinished]);

  const toggleTimer = () => {
    if (isFinished) {
      setIsFinished(false);
      setIsBreak(prev => !prev);
      // Don't close overlay here, manage it in handlers
    } else {
      setIsActive(prev => !prev);
    }
  };

  const resetTimer = () => {
    setIsActive(false);
    setIsBreak(false);
    setIsFinished(false);
    // valid check before resetting
    const resetValue = isBreak ? breakTime : workTime;
    setTimeLeft((resetValue && !isNaN(resetValue) ? resetValue : 25) * 60);
    setShowBreakOverlay(false);
    clearInterval(timerRef.current);
  };

  const formatTime = (seconds) => {
    if (seconds < 0) seconds = 0; // Prevent negative display
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const buttonClass = () => {
    if (isFinished) return 'finished';
    return isActive ? 'active' : '';
  };

  const getButtonText = () => {
    if (isFinished) {
        return isBreak ? "Start Work" : "Start Break";
    }
    return formatTime(timeLeft);
  };

  const handleStartBreak = () => {
    // Explicitly set all state to avoid race conditions
    setIsFinished(false);
    setIsBreak(true);
    // Force time update immediately
    const validBreakTime = (breakTime && !isNaN(breakTime) && parseInt(breakTime) > 0) ? breakTime : 5;
    setTimeLeft(validBreakTime * 60);
    setIsActive(true);
    setShowBreakOverlay(true);
  };

  const handleStartWork = () => {
    // Explicitly set all state
    setIsFinished(false);
    setIsBreak(false);
    // Force time update immediately
    const validWorkTime = (workTime && !isNaN(workTime) && parseInt(workTime) > 0) ? workTime : 25;
    setTimeLeft(validWorkTime * 60);
    setIsActive(true);
    setShowBreakOverlay(false);
  };

  const dismissOverlay = () => {
    setShowBreakOverlay(false);
  };

  const handleTimeChange = (setter) => (e) => {
    const val = e.target.value;
    // Allow empty string or numbers
    if (val === '' || (!isNaN(val) && parseInt(val) >= 0)) {
       setter(val);
    }
  };

  // Render logic for overlay content
  const renderOverlayContent = () => {
    // Case 1: Work just finished (Ready to start break)
    if (isFinished && !isBreak) {
        return (
            <div className="break-overlay-content">
                <div className="break-icon">☕</div>
                <h2 className="break-title">Time for a Break!</h2>
                <p className="break-message">
                  Great work! You've completed your focus session.<br />
                  Take a {breakTime} minute break to recharge.
                </p>
                <div className="break-actions">
                  <button className="break-start-btn" onClick={handleStartBreak}>
                    Start Break Timer
                  </button>
                  <button className="break-dismiss-btn" onClick={dismissOverlay}>
                    Dismiss
                  </button>
                </div>
            </div>
        );
    }

    // Case 2: In Break (Timer Running or Paused during break)
    if (isBreak && !isFinished) {
        return (
            <div className="break-overlay-content">
                <div className="break-icon">🧘</div>
                <h2 className="break-title">Resting...</h2>
                <div className="break-timer-display">
                    {formatTime(timeLeft)}
                </div>
                <p className="break-message">
                  Relax and reset. We'll notify you when it's time to work.
                </p>
                <div className="break-actions">
                  <button className="break-dismiss-btn" onClick={dismissOverlay}>
                    Hide Overlay
                  </button>
                </div>
            </div>
        );
    }

    // Case 3: Break finished (Ready to start work)
    if (isFinished && isBreak) {
        return (
            <div className="break-overlay-content">
                <div className="break-icon">🚀</div>
                <h2 className="break-title">Break Over!</h2>
                <p className="break-message">
                  Hope you're refreshed. Let's get back to it!
                </p>
                <div className="break-actions">
                  <button className="break-start-btn" onClick={handleStartWork}>
                    Start Work Timer
                  </button>
                  <button className="break-dismiss-btn" onClick={dismissOverlay}>
                    Dismiss
                  </button>
                </div>
            </div>
        );
    }

    return null;
  };

  return (
    <>
      <div className="pomodoro-container" ref={containerRef}>
        <button
          className={`pomodoro-button ${buttonClass()}`}
          onClick={() => {
              if(isFinished) {
                  if (isBreak) handleStartWork();
                  else handleStartBreak();
              } else {
                  setDropdownOpen(prev => !prev)
              }
          }}
        >
          {getButtonText()}
        </button>

        {isDropdownOpen && (
          <div className="pomodoro-dropdown">
            <div className="dropdown-section">
              <label>Work</label>
              <input
                type="number"
                value={workTime}
                onChange={handleTimeChange(setWorkTime)}
                min="1"
              />
              <span>mins</span>
            </div>
            <div className="dropdown-section">
              <label>Break</label>
              <input
                type="number"
                value={breakTime}
                onChange={handleTimeChange(setBreakTime)}
                min="1"
              />
              <span>mins</span>
            </div>
            <div className="pomodoro-actions">
              <button onClick={toggleTimer}>{isActive ? 'Pause' : 'Start'}</button>
              <button onClick={resetTimer}>Reset</button>
            </div>
          </div>
        )}
      </div>

      {/* Break Overlay - Rendered in Portal to escape Header stacking context */}
      {showBreakOverlay && ReactDOM.createPortal(
        <div className="break-overlay">
          {renderOverlayContent()}
        </div>,
        document.body
      )}
    </>
  );
};

export default PomodoroTimer;