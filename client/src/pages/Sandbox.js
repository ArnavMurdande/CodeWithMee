import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import { AuthContext } from '../context/AuthContext';
import './Sandbox.css';

// --- Custom Dropdown Component ---
const CustomDropdown = ({ options, selected, onSelect }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    const handleSelect = (option) => {
        onSelect(option);
        setIsOpen(false);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="custom-dropdown-sandbox" ref={dropdownRef}>
            <button type="button" className="dropdown-button-sandbox" onClick={() => setIsOpen(!isOpen)}>
                {selected}
            </button>
            {isOpen && (
                <ul className="dropdown-menu-sandbox">
                    {options.map((option) => (
                        <li
                            key={option.value}
                            onClick={() => handleSelect(option)}
                            className={selected === option.label ? 'selected' : ''}
                        >
                            {option.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};


// --- Markdown Parser for AI Chat ---
const parseMarkdown = (text) => {
  text = text || '';
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const languageClass = lang ? `language-${lang}` : '';
    const escapedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="${languageClass}">${escapedCode}</code></pre>`;
  });
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/^\s*-\s+(.*)/gm, '<li>$1</li>');
  text = text.replace(/(\<li\>.*\<\/li\>)/gs, '<ul>$1</ul>');
  return text.replace(/\n/g, '<br />');
};

const Sandbox = ({ setPageTitle }) => {
  const { token } = useContext(AuthContext);
  const [searchParams] = useSearchParams();
  const topic = searchParams.get('topic');
  const youtubeQuery = searchParams.get('q');

  // --- Layout State ---
  const [verticalSplit, setVerticalSplit] = useState(50);
  const [leftHorizontalSplit, setLeftHorizontalSplit] = useState(60);
  const [rightHorizontalSplit, setRightHorizontalSplit] = useState(70);
  const [isDragging, setIsDragging] = useState(null); // 'vertical', 'left', 'right'

  // --- Component State ---
  const [videoId, setVideoId] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [output, setOutput] = useState('');
  const [isCodeRunning, setIsCodeRunning] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const chatHistoryRef = useRef(null);
  const sandboxContainerRef = useRef(null);

  // Monaco editor ref
  const monacoEditorRef = useRef(null);

  // rAF throttling refs
  const rafRef = useRef(null);
  const pendingMoveRef = useRef(null);

  const languageOptions = [
    { value: 'python', label: 'Python' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'java', label: 'Java' },
    { value: 'cpp', label: 'C++' },
    { value: 'c', label: 'C' }
  ];

  const boilerplate = {
    python: `# Welcome to the Python sandbox!\n# Happy coding!\n\nprint("Hello, CodeWithMee!")`,
    javascript: `// Welcome to the JavaScript sandbox!\n// Happy coding!\n\nconsole.log("Hello, CodeWithMee!");`,
    java: `// Welcome to the Java sandbox!\n// Happy coding!\n\nclass Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, CodeWithMee!");\n    }\n}`,
    cpp: `// Welcome to the C++ sandbox!\n// Happy coding!\n\n#include <iostream>\n\nint main() {\n    std::cout << "Hello, CodeWithMee!";\n    return 0;\n}`,
    c: `// Welcome to the C sandbox!\n// Happy coding!\n\n#include <stdio.h>\n\nint main() {\n   printf("Hello, CodeWithMee!");\n   return 0;\n}`
  };

  useEffect(() => {
    const title = topic || 'General Sandbox';
    setPageTitle(title);
    return () => setPageTitle('');
  }, [topic, setPageTitle]);

  useEffect(() => {
    setCode(boilerplate[language] || '');
  }, [language]);

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    const fetchData = async () => {
      if (!token) return;
      if (youtubeQuery) {
        setIsVideoLoading(true);
        try {
          const res = await axios.get(`http://localhost:5001/api/youtube/search?q=${encodeURIComponent(youtubeQuery)}`);
          // backend provides videoId - store that
          const vid = res.data?.videoId || '';
          setVideoId(vid);
        } catch (err) {
          console.error('Failed to fetch video', err);
          setVideoId('');
        } finally {
          setIsVideoLoading(false);
        }
      } else {
        setIsVideoLoading(false);
      }
      try {
        const res = await axios.get('http://localhost:5001/api/ai/chat-history', { headers: { 'x-auth-token': token } });
        const history = res.data.flatMap(conv => [{ sender: 'user', message: conv.prompt }, { sender: 'ai', message: parseMarkdown(conv.response) }]);
        setChatHistory(history);
      } catch (err) {
        console.error('Failed to fetch chat history', err);
      }
    };
    fetchData();
  }, [youtubeQuery, token]);

  const handleRunCode = async () => {
    setIsCodeRunning(true);
    setOutput('Running code...');
    try {
      const res = await axios.post('http://localhost:5001/api/code/run', { code, language }, { headers: { 'x-auth-token': token } });
      setOutput(res.data.output || 'Code executed with no output.');
    } catch (err) {
      setOutput(err.response?.data?.error || 'Failed to run code.');
    }
    setIsCodeRunning(false);
  };

  const handleAskAI = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isAiLoading) return;
    const newHistory = [...chatHistory, { sender: 'user', message: chatInput }];
    setChatHistory(newHistory);
    const currentInput = chatInput;
    setChatInput('');
    setIsAiLoading(true);
    try {
      const res = await axios.post('http://localhost:5001/api/ai/chat', { question: currentInput, code }, { headers: { 'x-auth-token': token } });
      const formattedAnswer = parseMarkdown(res.data.answer);
      setChatHistory([...newHistory, { sender: 'ai', message: formattedAnswer }]);
    } catch (err) {
      setChatHistory([...newHistory, { sender: 'ai', message: "Sorry, I'm having trouble connecting right now." }]);
    }
    setIsAiLoading(false);
  };

  // --- Resizing Logic with rAF throttling ---
  const handleMouseDown = (dividerType) => (e) => {
    e.preventDefault();
    setIsDragging(dividerType);
    document.body.style.cursor = dividerType === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';

    // clear any pending rAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      pendingMoveRef.current = null;
    }

    // After resize finished, trigger Monaco layout safely
    try {
      if (monacoEditorRef.current && typeof monacoEditorRef.current.layout === 'function') {
        monacoEditorRef.current.layout();
      }
    } catch (err) {
      // important: swallow errors to avoid React ErrorOverlay complaining
      console.warn('Error during editor.layout():', err);
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;

    // Store the latest mouse event values and schedule a rAF update
    pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY, dragType: isDragging };

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        const move = pendingMoveRef.current;
        rafRef.current = null;
        pendingMoveRef.current = null;
        if (!move) return;

        if (move.dragType === 'vertical') {
          const newSplit = (move.clientX / window.innerWidth) * 100;
          if (newSplit > 20 && newSplit < 80) setVerticalSplit(newSplit);
        } else if (move.dragType === 'left') {
          const container = sandboxContainerRef.current?.querySelector('.left-pane');
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const newSplit = ((move.clientY - rect.top) / rect.height) * 100;
          if (newSplit > 15 && newSplit < 85) setLeftHorizontalSplit(newSplit);
        } else if (move.dragType === 'right') {
          const container = sandboxContainerRef.current?.querySelector('.right-pane');
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const newSplit = ((move.clientY - rect.top) / rect.height) * 100;
          if (newSplit > 15 && newSplit < 85) setRightHorizontalSplit(newSplit);
        }
      });
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // When window size changes, request layout on the editor safely
  useEffect(() => {
    const onResize = () => {
      try {
        if (monacoEditorRef.current && typeof monacoEditorRef.current.layout === 'function') {
          monacoEditorRef.current.layout();
        }
      } catch (err) {
        console.warn('Error during editor.layout() on window resize:', err);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Monaco onMount: capture editor instance (so we can call layout)
  const handleEditorMount = (editor, monaco) => {
    monacoEditorRef.current = editor;
    // avoid automaticLayout to reduce ResizeObserver churn
    try {
      editor.updateOptions({ automaticLayout: false });
    } catch (err) {
      // ignore if updateOptions not available for some reason
    }
  };

  return (
    <div className="sandbox-page-container">
      <div className="sandbox-container" ref={sandboxContainerRef}>
        <div className="left-pane" style={{ width: `calc(${verticalSplit}% - 10px)` }}>
          <div className="video-pane" style={{ height: `calc(${leftHorizontalSplit}% - 10px)` }}>
            {isVideoLoading ? (
              <p className="loading-video">Loading video...</p>
            ) : videoId ? (
              <div className="youtube-embed-wrapper">
                <iframe
                  title="YouTube player"
                  src={`https://www.youtube.com/embed/${videoId}`}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="loading-video">No video found for this topic.</p>
            )}
          </div>
          <div className="horizontal-divider" onMouseDown={handleMouseDown('left')} />
          <div className="ai-assistant" style={{ height: `calc(${100 - leftHorizontalSplit}% - 10px)` }}>
            <div className="chat-history" ref={chatHistoryRef}>
              {chatHistory.map((chat, index) => (
                <div key={index} className={`chat-message ${chat.sender}`}>
                  <div dangerouslySetInnerHTML={{ __html: chat.message }} />
                </div>
              ))}
              {isAiLoading && <div className="chat-message ai"><div className="thinking-indicator">Mee is thinking...</div></div>}
            </div>
            <form className="chat-input-form" onSubmit={handleAskAI}>
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask Mee a question..." disabled={isAiLoading} />
              <button type="submit" disabled={isAiLoading}>Send</button>
            </form>
          </div>
        </div>
        <div className="vertical-divider" onMouseDown={handleMouseDown('vertical')} />
        <div className="right-pane" style={{ width: `calc(${100 - verticalSplit}% - 10px)` }}>
          <div className="editor-pane" style={{ height: `calc(${rightHorizontalSplit}% - 10px)` }}>
            <div className="editor-header">
              <CustomDropdown options={languageOptions} selected={languageOptions.find(opt => opt.value === language)?.label || 'Select'} onSelect={(option) => setLanguage(option.value)} />
              <button onClick={handleRunCode} className="run-button" disabled={isCodeRunning}>{isCodeRunning ? 'Running...' : 'Run Code'}</button>
            </div>
            <Editor
              height="calc(100% - 40px)"
              language={language}
              value={code}
              theme="vs-dark"
              onChange={(value) => setCode(value || '')}
              onMount={handleEditorMount}
              options={{
                fontSize: 16,
                minimap: { enabled: false },
                automaticLayout: false, // disabled - we'll call layout() manually when needed
                scrollBeyondLastLine: false,
                wordWrap: 'on'
              }}
            />
          </div>
          <div className="horizontal-divider" onMouseDown={handleMouseDown('right')} />
          <div className="terminal-pane" style={{ height: `calc(${100 - rightHorizontalSplit}% - 10px)` }}>
            <h3>Terminal</h3>
            <pre className="output-text">{output || 'Click "Run Code" to see the output here...'}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sandbox;
