import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import './NotesWidget.css';

const API = 'http://localhost:5001/api/user/notes';

const formatDate = (d) => {
  const date = new Date(d);
  const diff = Date.now() - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
};

const NotesWidget = () => {
  const { token, isAuthenticated } = useContext(AuthContext);
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const [fabPos, setFabPos] = useState(() => {
    try { const s = localStorage.getItem('notesWidgetFabPos'); return s ? JSON.parse(s) : { bottom: 90, right: 24 }; }
    catch { return { bottom: 90, right: 24 }; }
  });
  const [panelPos, setPanelPos] = useState({ top: 60, left: window.innerWidth - 560 });
  const [panelSize, setPanelSize] = useState({ width: 520, height: 580 });

  const editorRef = useRef(null);
  const saveTimerRef = useRef(null);

  const [fmtState, setFmtState] = useState({
    bold: false, italic: false, underline: false,
    justifyLeft: true, justifyCenter: false, justifyRight: false, justifyFull: false,
    insertUnorderedList: false, insertOrderedList: false,
  });

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');

  const [drawMode, setDrawMode] = useState(false);
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const [drawTool, setDrawTool] = useState('pen');
  const [drawColor, setDrawColor] = useState('#00f8f1');
  const [drawSize, setDrawSize] = useState(3);
  const canvasHistoryRef = useRef([]);
  const drawStateRef = useRef({ tool: 'pen', color: '#00f8f1', size: 3 });
  const eraserIndicatorRef = useRef(null);
  const [textColor, setTextColor] = useState('#e0e0e0');
  const [fontSize, setFontSize] = useState(14);
  const contentInnerRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Internal drag tracking
  const draggedMediaRef = useRef(null);

  const activeNote = notes.find(n => n._id === activeNoteId);

  // ─── Fetch ─────────────────────────────
  const fetchNotes = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await axios.get(API, { headers: { 'x-auth-token': token } });
      setNotes(res.data);
      if (res.data.length > 0 && !activeNoteId) setActiveNoteId(res.data[0]._id);
    } catch (err) { console.error('Fetch notes failed', err); }
    setIsLoading(false);
  }, [token, activeNoteId]);

  useEffect(() => { if (isOpen && isAuthenticated) fetchNotes(); }, [isOpen, isAuthenticated, fetchNotes]);

  // ─── CRUD ──────────────────────────────
  const createNote = async () => {
    try {
      const res = await axios.post(API, { title: 'Untitled Note' }, { headers: { 'x-auth-token': token } });
      setNotes(prev => [...prev, res.data]);
      setActiveNoteId(res.data._id);
      setDrawMode(false);
    } catch (err) { console.error(err); }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await axios.delete(`${API}/${noteId}`, { headers: { 'x-auth-token': token } });
      setNotes(prev => prev.filter(n => n._id !== noteId));
      if (activeNoteId === noteId) {
        const remaining = notes.filter(n => n._id !== noteId);
        setActiveNoteId(remaining.length > 0 ? remaining[0]._id : null);
      }
    } catch (err) { console.error(err); }
  };

  const saveNote = useCallback(async (noteId, data) => {
    try {
      const res = await axios.put(`${API}/${noteId}`, data, { headers: { 'x-auth-token': token } });
      setNotes(prev => prev.map(n => n._id === noteId ? res.data : n));
    } catch (err) { console.error(err); }
  }, [token]);

  const handleContentChange = useCallback(() => {
    if (!editorRef.current || !activeNoteId) return;
    const content = editorRef.current.innerHTML;
    setNotes(prev => prev.map(n => n._id === activeNoteId ? { ...n, content } : n));
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNote(activeNoteId, { content }), 1500);
  }, [activeNoteId, saveNote]);

  const handleTitleSave = () => {
    if (!activeNoteId || !titleInput.trim()) { setEditingTitle(false); return; }
    saveNote(activeNoteId, { title: titleInput.trim() });
    setEditingTitle(false);
  };

  // ─── Detect formatting state ──────────
  const updateFmtState = useCallback(() => {
    try {
      setFmtState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        justifyLeft: document.queryCommandState('justifyLeft'),
        justifyCenter: document.queryCommandState('justifyCenter'),
        justifyRight: document.queryCommandState('justifyRight'),
        justifyFull: document.queryCommandState('justifyFull'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      });
    } catch (e) { /* ignore */ }
  }, []);

  const execCmd = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    updateFmtState();
    handleContentChange();
  };

  // ─── Save / Save As / Share ────────────
  const saveNoteNow = () => {
    if (!activeNoteId || !editorRef.current) return;
    const content = editorRef.current.innerHTML;
    saveNote(activeNoteId, { content });
  };

  const saveAsFile = () => {
    if (!activeNote) return;
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${activeNote.title}</title><style>body{font-family:sans-serif;padding:2rem;max-width:800px;margin:0 auto;}</style></head><body><h1>${activeNote.title}</h1>${activeNote.content || ''}</body></html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeNote.title.replace(/[^a-zA-Z0-9 ]/g, '')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const shareNote = () => {
    alert('Share feature coming soon! You will be able to share notes with other users.');
  };

  // ─── Per-selection font size (FIX #4) ──
  const applyFontSize = (sizeInPx) => {
    setFontSize(sizeInPx);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    if (!sel.isCollapsed) {
      // Apply to selected text
      document.execCommand('fontSize', false, '7');
      const fonts = editorRef.current?.querySelectorAll('font[size="7"]');
      fonts?.forEach(f => {
        const span = document.createElement('span');
        span.style.fontSize = sizeInPx + 'px';
        span.innerHTML = f.innerHTML;
        f.parentNode.replaceChild(span, f);
      });
    } else {
      // No selection — insert a sized span at cursor for next typed text
      const span = document.createElement('span');
      span.style.fontSize = sizeInPx + 'px';
      span.innerHTML = '\u200B'; // zero-width space
      const range = sel.getRangeAt(0);
      range.insertNode(span);
      // Move cursor inside the span after the zero-width space
      range.setStart(span.firstChild, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    editorRef.current?.focus();
    handleContentChange();
  };

  // Alphabetical list — split from existing numbered list
  const insertAlphaList = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { editorRef.current?.focus(); return; }
    // Check if cursor is already in numbered OL
    let cur = sel.anchorNode;
    let existingOl = null;
    while (cur && cur !== editorRef.current) {
      if (cur.tagName === 'OL') { existingOl = cur; break; }
      cur = cur.parentElement;
    }
    if (existingOl && existingOl.style.listStyleType !== 'lower-alpha') {
      // Exit the current numbered list first
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      existingOl.after(p);
      const range = document.createRange();
      range.setStart(p, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('insertOrderedList', false, null);
    let node = sel.anchorNode;
    while (node && node.tagName !== 'OL') node = node.parentElement;
    if (node) node.style.listStyleType = 'lower-alpha';
    editorRef.current?.focus();
    updateFmtState();
    handleContentChange();
  };

  // ─── Media upload ──────────────────────
  const uploadMedia = useCallback(async (file) => {
    if (!activeNoteId) return;
    const formData = new FormData();
    formData.append('noteMedia', file);
    try {
      const res = await axios.post(`${API}/${activeNoteId}/upload`, formData, {
        headers: { 'x-auth-token': token, 'Content-Type': 'multipart/form-data' },
      });
      const att = res.data;
      setNotes(prev => prev.map(n => n._id === activeNoteId
        ? { ...n, attachments: [...(n.attachments || []), att] }
        : n
      ));
      insertMediaInline(att);
    } catch (err) {
      console.error('Upload failed', err);
      alert('Upload failed: ' + (err.response?.data?.msg || err.message));
    }
  }, [activeNoteId, token]);

  const insertMediaInline = (att) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const url = `http://localhost:5001${att.url}`;
    const isAudio = att.fileType === 'audio';
    const blockClass = isAudio ? 'nw-media-block nw-audio-block' : 'nw-media-block';
    let mediaTag = '';
    let resizeTri = '<div class="nw-media-resize-tri"></div>';
    if (att.fileType === 'image') {
      mediaTag = `<img src="${url}" alt="${att.name}" />`;
    } else if (att.fileType === 'video') {
      mediaTag = `<video controls src="${url}"></video>`;
    } else if (att.fileType === 'audio') {
      mediaTag = `<audio controls src="${url}"></audio><div class="nw-media-label">${att.name}</div>`;
      resizeTri = ''; // no resize for audio
    }
    const html = `<div class="${blockClass}" data-att-id="${att._id}" contenteditable="false" draggable="true">${mediaTag}<div class="nw-media-toolbar"><button class="nw-ma nw-ma-left" title="Align left">◀</button><button class="nw-ma nw-ma-center" title="Center">■</button><button class="nw-ma nw-ma-right" title="Align right">▶</button><button class="nw-ma nw-ma-delete" title="Delete">✕</button></div>${resizeTri}</div><p><br></p>`;
    document.execCommand('insertHTML', false, html);
    handleContentChange();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) uploadMedia(file);
    e.target.value = '';
  };

  // Delete attachment
  const deleteAttachment = async (attId, element) => {
    if (element) { element.remove(); handleContentChange(); }
    if (!activeNoteId || !attId) return;
    try {
      await axios.delete(`${API}/${activeNoteId}/attachments/${attId}`, { headers: { 'x-auth-token': token } });
      setNotes(prev => prev.map(n => n._id === activeNoteId
        ? { ...n, attachments: (n.attachments || []).filter(a => a._id !== attId) }
        : n
      ));
    } catch (err) { console.error(err); }
  };

  // ─── Editor event delegation ──────────
  const handleEditorMouseDown = (e) => {
    const target = e.target;

    // Delete button
    if (target.classList.contains('nw-ma-delete')) {
      e.preventDefault(); e.stopPropagation();
      const block = target.closest('.nw-media-block');
      deleteAttachment(block?.getAttribute('data-att-id'), block);
      return;
    }

    // Alignment buttons
    if (target.classList.contains('nw-ma-left') || target.classList.contains('nw-ma-center') || target.classList.contains('nw-ma-right')) {
      e.preventDefault(); e.stopPropagation();
      const block = target.closest('.nw-media-block');
      if (!block) return;
      // Reset
      block.style.float = '';
      block.style.marginLeft = '';
      block.style.marginRight = '';
      block.style.textAlign = '';

      if (target.classList.contains('nw-ma-left')) {
        block.style.float = 'left';
        block.style.marginRight = '12px';
        block.style.marginBottom = '8px';
      } else if (target.classList.contains('nw-ma-right')) {
        block.style.float = 'right';
        block.style.marginLeft = '12px';
        block.style.marginBottom = '8px';
      } else {
        block.style.float = 'none';
        block.style.marginLeft = 'auto';
        block.style.marginRight = 'auto';
      }
      handleContentChange();
      return;
    }

    // Resize handle (triangle) on media
    if (target.classList.contains('nw-media-resize-tri')) {
      e.preventDefault(); e.stopPropagation();
      const block = target.closest('.nw-media-block');
      const resizable = block?.querySelector('img, video');
      if (!resizable) return;
      const startX = e.clientX;
      const startW = block.offsetWidth;
      const onMove = (ev) => {
        const newW = Math.max(80, startW + (ev.clientX - startX));
        block.style.width = newW + 'px';
        resizable.style.width = '100%';
        resizable.style.height = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handleContentChange();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      return;
    }
  };

  // ─── Drag & drop (external files + internal media reposition) ─────────
  const handleEditorDragStart = (e) => {
    const block = e.target.closest('.nw-media-block');
    if (block) {
      draggedMediaRef.current = block;
      block.classList.add('nw-dragging');
      e.dataTransfer.setData('text/plain', 'nw-move');
      e.dataTransfer.effectAllowed = 'move';
    }
  };
  const handleEditorDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = draggedMediaRef.current ? 'move' : 'copy';
  };
  const handleEditorDragEnd = () => {
    if (draggedMediaRef.current) {
      draggedMediaRef.current.classList.remove('nw-dragging');
      draggedMediaRef.current = null;
    }
  };
  const handleEditorDrop = useCallback((e) => {
    // Internal media move
    if (draggedMediaRef.current) {
      e.preventDefault();
      const original = draggedMediaRef.current;
      original.classList.remove('nw-dragging');
      draggedMediaRef.current = null;
      // Find drop position using caretRangeFromPoint
      let range;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
      if (range) {
        original.parentNode.removeChild(original);
        range.insertNode(original);
        // Ensure paragraph after the moved block
        if (!original.nextElementSibling) {
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          original.parentNode.insertBefore(p, original.nextSibling);
        }
      }
      handleContentChange();
      return;
    }
    // External file drop
    if (e.dataTransfer.files?.length > 0) {
      e.preventDefault();
      Array.from(e.dataTransfer.files).forEach(file => {
        if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) uploadMedia(file);
      });
    }
  }, [uploadMedia, handleContentChange]);

  // ─── Audio recording ──────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
        await uploadMedia(file);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) { alert('Microphone access is required'); }
  };
  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  // ─── Canvas ───────────────────────────
  const canvasReadyRef = useRef(false);

  const initCanvas = useCallback((isResize = false) => {
    const canvas = canvasRef.current;
    const editor = editorRef.current;
    const inner = contentInnerRef.current;
    if (!canvas || !editor || !inner) return;
    const w = inner.clientWidth;
    const h = Math.max(editor.scrollHeight, inner.clientHeight);
    // On resize only: preserve current live strokes
    let preservedData = null;
    if (isResize && canvasReadyRef.current && canvas.width > 0 && canvas.height > 0) {
      try { preservedData = canvas.toDataURL('image/png'); } catch (e) { /* */ }
    }
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // Fresh mount: load saved canvasData. Resize: restore live strokes.
    const src = isResize ? preservedData : activeNote?.canvasData;
    if (src) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = src;
    }
    canvasReadyRef.current = true;
    canvasHistoryRef.current = [];
  }, [activeNote?.canvasData]);

  // Resize canvas when editor content changes height (debounced)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (drawMode && canvasRef.current) initCanvas(true);
      }, 150);
    });
    ro.observe(editor);
    return () => { ro.disconnect(); if (resizeTimer) clearTimeout(resizeTimer); };
  }, [drawMode, initCanvas]);

  // Init canvas on entering draw mode or switching notes
  useEffect(() => {
    if (drawMode && canvasRef.current) {
      canvasReadyRef.current = false;
      setTimeout(() => initCanvas(false), 50);
    }
  }, [drawMode, activeNoteId, initCanvas]);

  const getCanvasPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  };

  // Sync draw state refs when UI state changes
  useEffect(() => { drawStateRef.current = { tool: drawTool, color: drawColor, size: drawSize }; }, [drawTool, drawColor, drawSize]);

  const lastUndoSaveRef = useRef(0);

  const startDraw = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getCanvasPos(e);
    const ds = drawStateRef.current;
    const now = Date.now();
    if (now - lastUndoSaveRef.current > 500) {
      canvasHistoryRef.current.push(canvas.toDataURL('image/png'));
      if (canvasHistoryRef.current.length > 25) canvasHistoryRef.current.shift();
      lastUndoSaveRef.current = now;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ds.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = ds.size * 5;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ds.color;
      ctx.lineWidth = ds.size;
    }
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    isDrawingRef.current = true;
  };

  const draw = (e) => {
    if (!isDrawingRef.current || !canvasRef.current) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const ds = drawStateRef.current;
    const ctx = canvasRef.current.getContext('2d');
    if (ds.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = ds.size * 5;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ds.color;
      ctx.lineWidth = ds.size;
    }
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  // Show eraser indicator on ANY mouse movement over canvas
  const handleCanvasMouseMove = (e) => {
    draw(e);
    if (eraserIndicatorRef.current && drawStateRef.current.tool === 'eraser' && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const sz = drawStateRef.current.size * 5;
      eraserIndicatorRef.current.style.left = (cx - sz / 2) + 'px';
      eraserIndicatorRef.current.style.top = (cy - sz / 2) + 'px';
      eraserIndicatorRef.current.style.width = sz + 'px';
      eraserIndicatorRef.current.style.height = sz + 'px';
      eraserIndicatorRef.current.style.display = 'block';
    } else if (eraserIndicatorRef.current && drawStateRef.current.tool !== 'eraser') {
      eraserIndicatorRef.current.style.display = 'none';
    }
  };

  const handleCanvasMouseLeave = (e) => {
    endDraw(e);
    if (eraserIndicatorRef.current) eraserIndicatorRef.current.style.display = 'none';
  };

  const endDraw = () => {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.closePath(); ctx.globalCompositeOperation = 'source-over'; }
    isDrawingRef.current = false;
    if (eraserIndicatorRef.current) eraserIndicatorRef.current.style.display = 'none';
  };

  // Save canvas data to DB when exiting draw mode
  const saveCanvasData = () => {
    const canvas = canvasRef.current;
    if (!canvas || !activeNoteId) return;
    const dataUrl = canvas.toDataURL('image/png');
    saveNote(activeNoteId, { canvasData: dataUrl });
    // Update local notes state so the <img> layer shows it immediately
    setNotes(prev => prev.map(n => n._id === activeNoteId ? { ...n, canvasData: dataUrl } : n));
    if (eraserIndicatorRef.current) eraserIndicatorRef.current.style.display = 'none';
  };

  const clearCanvas = () => {
    const c = canvasRef.current; if (!c) return;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    if (activeNoteId) {
      saveNote(activeNoteId, { canvasData: '' });
      setNotes(prev => prev.map(n => n._id === activeNoteId ? { ...n, canvasData: '' } : n));
    }
  };

  const undoCanvas = () => {
    if (canvasHistoryRef.current.length < 1) return;
    const prev = canvasHistoryRef.current.pop();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (prev) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = prev;
    }
  };

  // ─── FAB drag ─────────────────────────
  const handleFabMouseDown = (e) => {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX || e.touches?.[0]?.clientX;
    const startY = e.clientY || e.touches?.[0]?.clientY;
    const startPos = { ...fabPos };
    let moved = false;
    const onMove = (ev) => {
      const cx = ev.clientX || ev.touches?.[0]?.clientX;
      const cy = ev.clientY || ev.touches?.[0]?.clientY;
      if (Math.abs(cx - startX) > 3 || Math.abs(cy - startY) > 3) moved = true;
      setFabPos({ right: Math.max(0, startPos.right - (cx - startX)), bottom: Math.max(0, startPos.bottom - (cy - startY)) });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if (!moved) setIsOpen(prev => !prev);
      localStorage.setItem('notesWidgetFabPos', JSON.stringify(fabPos));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };

  const handlePanelDragStart = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY, sp = { ...panelPos };
    const onMove = (ev) => {
      const maxTop = window.innerHeight - 60;
      const maxLeft = window.innerWidth - 60;
      setPanelPos({
        top: Math.min(maxTop, Math.max(0, sp.top + ev.clientY - startY)),
        left: Math.min(maxLeft, Math.max(0, sp.left + ev.clientX - startX))
      });
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleResizeStart = (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY, ss = { ...panelSize }, sp = { ...panelPos };
    const onMove = (ev) => {
      const maxW = Math.min(window.innerWidth * 0.9, window.innerWidth - sp.left - 20);
      const maxH = Math.min(window.innerHeight * 0.9, window.innerHeight - sp.top - 20);
      setPanelSize({
        width: Math.min(maxW, Math.max(520, ss.width + ev.clientX - startX)),
        height: Math.min(maxH, Math.max(460, ss.height + ev.clientY - startY))
      });
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Sync editor — also re-sync when panel reopens
  useEffect(() => {
    if (editorRef.current && activeNote) {
      if (editorRef.current.innerHTML !== activeNote.content) editorRef.current.innerHTML = activeNote.content || '';
    }
    setDrawMode(false);
  }, [activeNoteId, isOpen]);

  if (!isAuthenticated) return null;

  // ─── RENDER ────────────────────────────
  return (
    <>
      {/* FAB */}
      <div className="nw-fab" style={{ bottom: fabPos.bottom, right: fabPos.right }} onMouseDown={handleFabMouseDown} onTouchStart={handleFabMouseDown} title="Notes">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </div>

      {isOpen && (
        <div className="nw-panel" style={{ top: panelPos.top, left: panelPos.left, width: panelSize.width, height: panelSize.height }}>
          {/* Title Bar */}
          <div className="nw-titlebar" onMouseDown={handlePanelDragStart}>
            <div className="nw-titlebar-left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00f8f1" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>Notes</span>
            </div>
            <div className="nw-titlebar-right">
              <button onClick={() => setSidebarOpen(p => !p)} title="Toggle sidebar" className="nw-tb-btn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              </button>
              <button onClick={() => setIsOpen(false)} title="Close" className="nw-tb-btn nw-close-btn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div className="nw-body">
            {/* Sidebar */}
            {sidebarOpen && (
              <div className="nw-sidebar">
                <button className="nw-newbtn" onClick={createNote}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Note
                </button>
                <div className="nw-filelist">
                  {isLoading && <div className="nw-loading">Loading...</div>}
                  {notes.map(note => (
                    <div key={note._id} className={`nw-fileitem ${note._id === activeNoteId ? 'active' : ''}`} onClick={() => setActiveNoteId(note._id)}>
                      <div className="nw-fileinfo">
                        <span className="nw-filename">{note.title}</span>
                        <span className="nw-filedate">{formatDate(note.updatedAt || note.createdAt)}</span>
                      </div>
                      <button className="nw-filedel" onClick={(e) => { e.stopPropagation(); deleteNote(note._id); }} title="Delete">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                  {!isLoading && notes.length === 0 && <div className="nw-empty">No notes yet</div>}
                </div>
              </div>
            )}

            {/* Editor */}
            <div className="nw-editor-area">
              {activeNote ? (
                <>
                  {/* Note Title + Actions */}
                  <div className="nw-notetitle">
                    {editingTitle ? (
                      <div className="nw-notetitle-editrow">
                        <input className="nw-notetitle-input" value={titleInput} onChange={e => setTitleInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleTitleSave()} autoFocus />
                        <button className="nw-notetitle-save" onClick={handleTitleSave} title="Save title">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                      </div>
                    ) : (
                      <div className="nw-notetitle-row">
                        <span className="nw-notetitle-text">{activeNote.title}</span>
                        <button className="nw-notetitle-edit" onClick={() => { setEditingTitle(true); setTitleInput(activeNote.title); }} title="Rename">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
                        </button>
                        <div className="nw-title-spacer" />
                        <div className="nw-title-actions">
                          <button className="nw-btn nw-action-btn" onClick={saveNoteNow} title="Save note">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                            <span className="nw-action-label">Save</span>
                          </button>
                          <button className="nw-btn nw-action-btn" onClick={saveAsFile} title="Save as file">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            <span className="nw-action-label">Save As</span>
                          </button>
                          <button className="nw-btn nw-action-btn" onClick={shareNote} title="Share note">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                            <span className="nw-action-label">Share</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ═══ FORMAT TOOLBAR ═══ */}
                  <div className="nw-toolbar">
                    {/* Row 1: Text formatting */}
                    <div className="nw-toolbar-row">

                      <button className={`nw-btn ${fmtState.bold ? 'active' : ''}`} onClick={() => execCmd('bold')} title="Bold">
                        <strong>B</strong>
                      </button>
                      <button className={`nw-btn ${fmtState.italic ? 'active' : ''}`} onClick={() => execCmd('italic')} title="Italic">
                        <em>I</em>
                      </button>
                      <button className={`nw-btn ${fmtState.underline ? 'active' : ''}`} onClick={() => execCmd('underline')} title="Underline">
                        <u>U</u>
                      </button>

                      <div className="nw-sep" />

                      {/* Font size — applies to selected text or cursor */}
                      <select className="nw-select" value={fontSize} onChange={e => applyFontSize(Number(e.target.value))} title="Font size">
                        {[12, 14, 16, 18, 20, 24, 28, 32].map(s => <option key={s} value={s}>{s}px</option>)}
                      </select>
                      <input type="color" className="nw-color" value={textColor} onChange={e => { setTextColor(e.target.value); document.execCommand('foreColor', false, e.target.value); editorRef.current?.focus(); handleContentChange(); }} title="Text color" />
                    </div>

                    {/* Row 2: Alignment, Lists, Draw */}
                    <div className="nw-toolbar-row">
                      <button className={`nw-btn ${fmtState.justifyLeft ? 'active' : ''}`} onClick={() => execCmd('justifyLeft')} title="Align left">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                      </button>
                      <button className={`nw-btn ${fmtState.justifyCenter ? 'active' : ''}`} onClick={() => execCmd('justifyCenter')} title="Center">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
                      </button>
                      <button className={`nw-btn ${fmtState.justifyRight ? 'active' : ''}`} onClick={() => execCmd('justifyRight')} title="Align right">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
                      </button>
                      <button className={`nw-btn ${fmtState.justifyFull ? 'active' : ''}`} onClick={() => execCmd('justifyFull')} title="Justify">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                      </button>

                      <div className="nw-sep" />

                      {/* Lists — with clear labels */}
                      <button className={`nw-btn nw-btn-label ${fmtState.insertUnorderedList ? 'active' : ''}`} onClick={() => execCmd('insertUnorderedList')} title="Bullet list">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="2" fill="currentColor"/><circle cx="4" cy="12" r="2" fill="currentColor"/><circle cx="4" cy="18" r="2" fill="currentColor"/></svg>
                      </button>
                      <button className={`nw-btn nw-btn-label ${fmtState.insertOrderedList ? 'active' : ''}`} onClick={() => execCmd('insertOrderedList')} title="Numbered list (1, 2, 3)">
                        <span className="nw-list-icon">1.</span>
                      </button>
                      <button className="nw-btn nw-btn-label" onClick={insertAlphaList} title="Alphabetical list (a, b, c)">
                        <span className="nw-list-icon">a.</span>
                      </button>

                      <div className="nw-sep" />

                      <button className={`nw-btn nw-draw-toggle ${drawMode ? 'active' : ''}`} onClick={() => { if (drawMode) saveCanvasData(); setDrawMode(p => !p); }} title={drawMode ? 'Stop drawing' : 'Draw'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
                      </button>
                    </div>
                  </div>

                  {/* Draw toolbar */}
                  {drawMode && (
                    <div className="nw-draw-toolbar">
                      <button className={`nw-btn ${drawTool === 'pen' ? 'active' : ''}`} onClick={() => setDrawTool('pen')} title="Pen">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
                      </button>
                      <button className={`nw-btn ${drawTool === 'eraser' ? 'active' : ''}`} onClick={() => setDrawTool('eraser')} title="Eraser">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.5 4.5l1 1a2.83 2.83 0 010 4L12 17H7l-2 2"/><path d="M20 20H7"/><path d="M5 17l4.5-4.5"/><rect x="7.5" y="7.5" width="11" height="5" rx="1" transform="rotate(45 13 10)"/></svg>
                      </button>
                      <input type="color" className="nw-color" value={drawColor} onChange={e => setDrawColor(e.target.value)} title="Pen color" />
                      <select className="nw-select" value={drawSize} onChange={e => setDrawSize(Number(e.target.value))}>
                        {[1, 2, 3, 5, 8, 12].map(s => <option key={s} value={s}>{s}px</option>)}
                      </select>
                      <button className="nw-btn" onClick={undoCanvas} title="Undo">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>
                      </button>
                      <button className="nw-btn nw-btn-danger" onClick={clearCanvas} title="Clear all drawing">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      </button>
                    </div>
                  )}

                  {/* Content */}
                  <div className="nw-content-wrap">
                    <div className="nw-content-inner" ref={contentInnerRef}>
                      <div
                        ref={editorRef}
                        className="nw-editor"
                        contentEditable={!drawMode}
                        suppressContentEditableWarning
                        onInput={() => { handleContentChange(); updateFmtState(); }}
                        onKeyUp={updateFmtState}
                        onMouseUp={updateFmtState}
                        onMouseDown={handleEditorMouseDown}
                        onDragStart={handleEditorDragStart}
                        onDragOver={handleEditorDragOver}
                        onDrop={handleEditorDrop}
                        onDragEnd={handleEditorDragEnd}
                        style={{ color: activeNote.formatting?.color || '#e0e0e0' }}
                        data-placeholder="Start typing your notes…"
                      />
                      {/* Saved drawing layer — always visible, scrolls with content */}
                      {activeNote?.canvasData && !drawMode && (
                        <img src={activeNote.canvasData} className="nw-canvas-saved" alt="" />
                      )}
                      {/* Interactive canvas — always rendered in draw mode, covers full content */}
                      {drawMode && (
                        <canvas ref={canvasRef} className={`nw-canvas-overlay ${drawTool === 'eraser' ? 'nw-eraser-active' : ''}`}
                          onMouseDown={startDraw} onMouseMove={handleCanvasMouseMove} onMouseUp={endDraw} onMouseLeave={handleCanvasMouseLeave}
                          onTouchStart={startDraw} onTouchMove={handleCanvasMouseMove} onTouchEnd={endDraw} />
                      )}
                      {/* Eraser indicator */}
                      <div ref={eraserIndicatorRef} className="nw-eraser-indicator" style={{ display: 'none' }} />
                    </div>
                  </div>

                  {/* Media bar */}
                  <div className="nw-mediabar">
                    <label className="nw-mediabtn" title="Upload image">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                      <span>Image</span>
                      <input type="file" accept="image/*" hidden onChange={handleFileUpload} />
                    </label>
                    <label className="nw-mediabtn" title="Upload video">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                      <span>Video</span>
                      <input type="file" accept="video/*" hidden onChange={handleFileUpload} />
                    </label>
                    <label className="nw-mediabtn" title="Upload audio">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                      <span>Audio</span>
                      <input type="file" accept="audio/*" hidden onChange={handleFileUpload} />
                    </label>
                    <div className="nw-msep" />
                    {isRecording ? (
                      <button className="nw-mediabtn recording" onClick={stopRecording} title="Stop recording">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                        <span className="rec-dot" /> Stop
                      </button>
                    ) : (
                      <button className="nw-mediabtn" onClick={startRecording} title="Record audio">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        <span>Record</span>
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="nw-empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  <p>Select a note or create a new one</p>
                </div>
              )}
            </div>
          </div>

          {/* Panel resize triangle (FIX #6) */}
          <div className="nw-resize-tri" onMouseDown={handleResizeStart} />
        </div>
      )}
    </>
  );
};

export default NotesWidget;
