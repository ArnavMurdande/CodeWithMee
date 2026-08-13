import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import axios, { assetUrl } from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { getUserStorageKey } from '../lib/cache-isolation';
import {
  plainTextDocument,
  readRestrictedDocument,
  safeHttpUrl,
} from '../lib/restricted-content';
import { uploadSecureFile } from '../lib/secure-file-upload';
import './NotesWidget.css';

const API = '/api/v1/learning/notes';

const formatDate = (d) => {
  const date = new Date(d);
  const diff = Date.now() - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
};

const noteText = (note) => readRestrictedDocument(note?.contentDocument, note?.content).text;

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const EDITOR_TAGS = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'SPAN', 'FONT', 'H1', 'H2', 'H3']);

function serializeEditorNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return { type: 'text', value: node.textContent || '' };
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  if (node.classList.contains('nw-media-block')) {
    return {
      type: 'media',
      attachmentId: node.dataset.attId || '',
      style: {
        float: node.style.float || '',
        marginBottom: node.style.marginBottom || '',
        marginLeft: node.style.marginLeft || '',
        marginRight: node.style.marginRight || '',
        width: node.style.width || '',
      },
    };
  }
  if (!EDITOR_TAGS.has(node.tagName)) return null;
  const children = [...node.childNodes].map(serializeEditorNode).filter(Boolean);
  return {
    type: 'element',
    tag: node.tagName.toLowerCase(),
    style: {
      color: node.style.color || node.getAttribute('color') || '',
      fontSize: node.style.fontSize || '',
      listStyleType: node.style.listStyleType || '',
      textAlign: node.style.textAlign || '',
    },
    children,
  };
}

function serializeEditorDocument(editor) {
  return { version: 1, children: [...editor.childNodes].map(serializeEditorNode).filter(Boolean) };
}

function createMediaElement(att) {
  const url = safeHttpUrl(assetUrl(att.url));
  const fileType = att.fileType || att.kind;
  if (!url || !['image', 'video', 'audio'].includes(fileType)) return null;
  const block = document.createElement('div');
  block.className = fileType === 'audio' ? 'nw-media-block nw-audio-block' : 'nw-media-block';
  block.dataset.attId = String(att._id || att.id || '');
  block.contentEditable = 'false';
  block.draggable = true;
  const media = document.createElement(fileType === 'image' ? 'img' : fileType);
  if (fileType === 'image') media.alt = String(att.name || 'Note attachment');
  else media.controls = true;
  media.src = url;
  block.appendChild(media);
  if (fileType === 'audio') {
    const label = document.createElement('div');
    label.className = 'nw-media-label';
    label.textContent = String(att.name || 'Audio attachment');
    block.appendChild(label);
  } else {
    const resize = document.createElement('div');
    resize.className = 'nw-media-resize-tri';
    block.appendChild(resize);
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'nw-media-toolbar';
  for (const [className, title, label] of [
    ['nw-ma-left', 'Align left', '←'],
    ['nw-ma-center', 'Center', '■'],
    ['nw-ma-right', 'Align right', '→'],
    ['nw-ma-delete', 'Delete', '×'],
  ]) {
    const button = document.createElement('button');
    button.className = `nw-ma ${className}`;
    button.title = title;
    button.type = 'button';
    button.textContent = label;
    toolbar.appendChild(button);
  }
  block.appendChild(toolbar);
  return block;
}

function restoreEditorNode(spec, attachments) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.type === 'text') return document.createTextNode(String(spec.value || '').slice(0, 100_000));
  if (spec.type === 'media') {
    const attachment = attachments.find((item) => String(item._id || item.id) === String(spec.attachmentId));
    const block = attachment ? createMediaElement(attachment) : null;
    if (block && spec.style) {
      for (const property of ['float', 'marginBottom', 'marginLeft', 'marginRight', 'width']) {
        const value = String(spec.style[property] || '');
        if (/^[a-z0-9.%-]{0,24}$/i.test(value)) block.style[property] = value;
      }
    }
    return block;
  }
  const tag = String(spec.tag || '').toUpperCase();
  if (spec.type !== 'element' || !EDITOR_TAGS.has(tag)) return null;
  const element = document.createElement(tag.toLowerCase());
  const style = spec.style || {};
  if (/^#[0-9a-f]{6}$|^rgb\([0-9, ]+\)$/i.test(style.color || '')) element.style.color = style.color;
  if (/^(?:1[0-9]|2[0-9]|3[0-2])px$/.test(style.fontSize || '')) element.style.fontSize = style.fontSize;
  if (['left', 'center', 'right', 'justify'].includes(style.textAlign)) element.style.textAlign = style.textAlign;
  if (['lower-alpha', 'decimal', 'disc'].includes(style.listStyleType)) element.style.listStyleType = style.listStyleType;
  for (const child of Array.isArray(spec.children) ? spec.children.slice(0, 5000) : []) {
    const restored = restoreEditorNode(child, attachments);
    if (restored) element.appendChild(restored);
  }
  return element;
}

const NotesWidget = () => {
  const { isAuthenticated, user } = useContext(AuthContext);
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [notesLoadRevision, setNotesLoadRevision] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [_isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const isMobileRef = useRef(window.innerWidth <= 768);


  const [fabPos, setFabPos] = useState(() => {
    try {
      const s = localStorage.getItem('notesWidgetFabPos');
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed.bottom === 'number' && typeof parsed.right === 'number') {
          return parsed;
        }
      }
      return { bottom: 24, right: 24 };
    } catch {
      return { bottom: 24, right: 24 };
    }
  });
  const [panelPos, setPanelPos] = useState({ top: 60, left: window.innerWidth - 560 });
  const [panelSize, setPanelSize] = useState({ width: 520, height: 580 });

  const editorRef = useRef(null);
  const selectionRangeRef = useRef(null);
  const pendingMediaRangeRef = useRef(null);
  const saveTimerRef = useRef(null);
  const canvasSaveTimerRef = useRef(null);

  const [fmtState, setFmtState] = useState({
    bold: false,
    italic: false,
    underline: false,
    justifyLeft: true,
    justifyCenter: false,
    justifyRight: false,
    justifyFull: false,
    insertUnorderedList: false,
    insertOrderedList: false,
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

  // Internal drag tracking
  const draggedMediaRef = useRef(null);

  const activeNote = notes.find((n) => n._id === activeNoteId);

  // ─── Fetch ─────────────────────────────
  const fetchNotes = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const res = await axios.get(API);
      const fetchedNotes = Array.isArray(res.data) ? res.data : [];
      setNotes(fetchedNotes);
      if (fetchedNotes.length > 0) {
        setActiveNoteId((current) => current || fetchedNotes[0]._id || fetchedNotes[0].id);
      }
      const hydrated = await Promise.all(
        fetchedNotes.map(async (note) => ({
          ...note,
          attachments: await Promise.all(
            (note.attachments || []).map(async (attachment) => {
              if (!attachment.fileId) return attachment;
              try {
                const download = await axios.post(`/api/v1/files/${attachment.fileId}/download`, {});
                return {
                  ...attachment,
                  _id: attachment._id || attachment.id,
                  fileType: attachment.fileType || attachment.kind,
                  url: download.data.download.url,
                };
              } catch {
                return attachment;
              }
            }),
          ),
        })),
      );
      setNotes(hydrated);
      setNotesLoadRevision((revision) => revision + 1);
    } catch (err) {
      console.error('Fetch notes failed', err);
    }
    setIsLoading(false);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isOpen || !isAuthenticated) return;
    if (notes.length === 0) {
      try {
        const cached = JSON.parse(
          localStorage.getItem(getUserStorageKey(user?.id, 'saved_notes')) || '[]',
        );
        if (Array.isArray(cached) && cached.length > 0) {
          setNotes(cached);
          setActiveNoteId((current) => current || cached[0]._id || cached[0].id);
        }
      } catch {
        /* ignore invalid cache */
      }
    }
  }, [isOpen, isAuthenticated, notes.length, user?.id]);

  useEffect(() => {
    if (isOpen && isAuthenticated) fetchNotes();
  }, [isOpen, isAuthenticated, fetchNotes]);

  useEffect(() => {
    if (Array.isArray(notes) && notes.length > 0) {
      try {
        const notesStorageKey = getUserStorageKey(user?.id, 'saved_notes');
        localStorage.setItem(notesStorageKey, JSON.stringify(notes));
      } catch {
        /* ignore */
      }
    }
  }, [notes, user?.id]);

  // ─── Mobile detection ────
  // Clean up stale storage keys from previous versions
  useEffect(() => {
    localStorage.removeItem('notesDesktopOnlyDismissed');
    localStorage.removeItem('mobileWarningDismissed');
    sessionStorage.removeItem('mobileWarningDismissed');
  }, []);
  // Dual detection: matchMedia (reliable for CSS viewport) + resize (fallback)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const syncMobile = (mobile) => {
      setIsMobile(mobile);
      isMobileRef.current = mobile;
      if (mobile) {
        setDrawMode(false);
        setSidebarOpen(false);
      }
    };
    const handleMqChange = (e) => syncMobile(e.matches);
    const handleResize = () => syncMobile(window.innerWidth <= 768);
    // Sync on mount
    syncMobile(mq.matches);
    mq.addEventListener('change', handleMqChange);
    window.addEventListener('resize', handleResize);
    return () => {
      mq.removeEventListener('change', handleMqChange);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // ─── Enforce boundaries when opened or resized ───
  useEffect(() => {
    if (isOpen) {
      setPanelPos((prev) => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        // strictly ensure panel stays within screen bounds dynamically
        const newLeft = Math.max(0, Math.min(prev.left, w - panelSize.width));
        const newTop = Math.max(0, Math.min(prev.top, h - panelSize.height));
        if (newLeft === prev.left && newTop === prev.top) return prev;
        return { top: newTop, left: newLeft };
      });
    }
  }, [isOpen, panelSize.width, panelSize.height]);

  // ─── CRUD ──────────────────────────────
  const createNote = async () => {
    try {
      const res = await axios.post(API, { title: 'Untitled Note' });
      setNotes((prev) => [...prev, res.data]);
      setActiveNoteId(res.data._id);
      setDrawMode(false);
    } catch (err) {
      console.error(err);
    }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await axios.delete(`${API}/${noteId}`);
      setNotes((prev) => prev.filter((n) => n._id !== noteId));
      if (activeNoteId === noteId) {
        const remaining = notes.filter((n) => n._id !== noteId);
        setActiveNoteId(remaining.length > 0 ? remaining[0]._id : null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveNote = useCallback(async (noteId, data) => {
    try {
      const res = await axios.put(`${API}/${noteId}`, data);
      setNotes((prev) =>
        prev.map((n) =>
          n._id === noteId
            ? { ...n, ...res.data, attachments: res.data.attachments?.length ? res.data.attachments : n.attachments }
            : n,
        ),
      );
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleContentChange = useCallback(() => {
    if (!editorRef.current || !activeNoteId) return;
    const contentDocument = plainTextDocument(editorRef.current.innerText || '');
    const formatting = {
      ...(activeNote?.formatting || {}),
      editorDocumentV1: serializeEditorDocument(editorRef.current),
    };
    setNotes((prev) =>
      prev.map((n) =>
        n._id === activeNoteId ? { ...n, content: contentDocument.text, contentDocument, formatting } : n,
      ),
    );
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNote(activeNoteId, { contentDocument, formatting }), 500);
  }, [activeNote?.formatting, activeNoteId, saveNote]);

  const handleTitleSave = () => {
    if (!activeNoteId || !titleInput.trim()) {
      setEditingTitle(false);
      return;
    }
    saveNote(activeNoteId, { title: titleInput.trim() });
    setEditingTitle(false);
  };

  // ─── Detect formatting state ──────────
  const updateFmtState = useCallback(() => {
    try {
      const selection = window.getSelection();
      if (selection?.rangeCount && editorRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        selectionRangeRef.current = selection.getRangeAt(0).cloneRange();
      }
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
    } catch {
      /* ignore */
    }
  }, []);

  const restoreEditorSelection = () => {
    const range = selectionRangeRef.current;
    if (!range || !editorRef.current?.contains(range.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const execCmd = (cmd, val = null) => {
    editorRef.current?.focus();
    restoreEditorSelection();
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    updateFmtState();
    handleContentChange();
  };

  // ─── Save / Save As ────────────────────
  const saveNoteNow = () => {
    if (!activeNoteId || !editorRef.current) return;
    saveNote(activeNoteId, {
      contentDocument: plainTextDocument(editorRef.current.innerText || ''),
      formatting: {
        ...(activeNote?.formatting || {}),
        editorDocumentV1: serializeEditorDocument(editorRef.current),
      },
    });
  };

  const saveAsFile = async () => {
    if (!activeNote || !editorRef.current) return;
    const exportDocument = document.implementation.createHTMLDocument(activeNote.title);
    const meta = exportDocument.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    exportDocument.head.appendChild(meta);
    const style = exportDocument.createElement('style');
    style.textContent = 'body{max-width:900px;margin:40px auto;padding:0 24px;font-family:system-ui,sans-serif;line-height:1.65;color:#191919} .note{white-space:pre-wrap} img,video{max-width:100%;height:auto} audio,video{display:block;margin:12px 0} ul,ol{white-space:normal}';
    exportDocument.head.appendChild(style);
    const title = exportDocument.createElement('h1');
    title.textContent = activeNote.title;
    exportDocument.body.appendChild(title);
    const content = editorRef.current.cloneNode(true);
    content.className = 'note';
    content.removeAttribute('contenteditable');
    content.style.removeProperty('color');
    content.querySelectorAll('.nw-media-toolbar,.nw-media-resize-tri').forEach((node) => node.remove());
    const originalMedia = [...editorRef.current.querySelectorAll('img,video,audio')];
    const exportedMedia = [...content.querySelectorAll('img,video,audio')];
    await Promise.all(exportedMedia.map(async (media, index) => {
      try {
        const response = await fetch(originalMedia[index].currentSrc || originalMedia[index].src);
        if (response.ok) media.src = await blobDataUrl(await response.blob());
      } catch {
        // Keep the signed online URL when the storage provider disallows client-side embedding.
      }
      media.removeAttribute('controlslist');
    }));
    exportDocument.body.appendChild(exportDocument.importNode(content, true));
    if (activeNote.canvasData) {
      const drawingTitle = exportDocument.createElement('h2');
      drawingTitle.textContent = 'Drawing';
      const drawing = exportDocument.createElement('img');
      drawing.alt = 'Note drawing';
      drawing.src = activeNote.canvasData;
      exportDocument.body.append(drawingTitle, drawing);
    }
    const blob = new Blob([`<!doctype html>${exportDocument.documentElement.outerHTML}`], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeNote.title.replace(/[^a-zA-Z0-9 ]/g, '') || 'note'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ─── Per-selection font size (FIX #4) ──
  const applyFontSize = (sizeInPx) => {
    setFontSize(sizeInPx);
    editorRef.current?.focus();
    restoreEditorSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    if (!sel.isCollapsed) {
      // Apply to selected text
      document.execCommand('fontSize', false, '7');
      const fonts = editorRef.current?.querySelectorAll('font[size="7"]');
      fonts?.forEach((f) => {
        const span = document.createElement('span');
        span.style.fontSize = sizeInPx + 'px';
        while (f.firstChild) span.appendChild(f.firstChild);
        f.parentNode.replaceChild(span, f);
      });
    } else {
      // No selection — insert a sized span at cursor for next typed text
      const span = document.createElement('span');
      span.style.fontSize = sizeInPx + 'px';
      span.appendChild(document.createTextNode('\u200B')); // zero-width space
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
    if (!sel || !sel.rangeCount) {
      editorRef.current?.focus();
      return;
    }
    // Check if cursor is already in numbered OL
    let cur = sel.anchorNode;
    let existingOl = null;
    while (cur && cur !== editorRef.current) {
      if (cur.tagName === 'OL') {
        existingOl = cur;
        break;
      }
      cur = cur.parentElement;
    }
    if (existingOl && existingOl.style.listStyleType !== 'lower-alpha') {
      // Exit the current numbered list first
      const p = document.createElement('p');
      p.appendChild(document.createElement('br'));
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
  const uploadMedia = useCallback(
    async (file, insertionRange = pendingMediaRangeRef.current?.cloneRange()) => {
      if (!activeNoteId) return;
      try {
        const fileId = await uploadSecureFile(file, 'note_attachment');
        const linked = await axios.post(`${API}/${activeNoteId}/attachments`, { fileId });
        const download = await axios.post(`/api/v1/files/${fileId}/download`, {});
        const att = { ...linked.data, url: download.data.download.url };
        setNotes((prev) =>
          prev.map((n) =>
            n._id === activeNoteId ? { ...n, attachments: [...(n.attachments || []), att] } : n,
          ),
        );
        if (insertionRange && editorRef.current?.contains(insertionRange.commonAncestorContainer)) {
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(insertionRange);
        }
        insertMediaInline(att);
        pendingMediaRangeRef.current = null;
      } catch (err) {
        console.error('Upload failed', err);
        alert('Upload failed: ' + (err.response?.data?.error?.code || err.message));
      }
    },
    [activeNoteId],
  );

  const captureMediaInsertionPoint = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : selectionRangeRef.current;
    if (range && editorRef.current?.contains(range.commonAncestorContainer)) {
      pendingMediaRangeRef.current = range.cloneRange();
    }
  };

  const insertMediaInline = (att) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const url = safeHttpUrl(assetUrl(att.url));
    if (!url) return;
    const isAudio = att.fileType === 'audio';
    const blockClass = isAudio ? 'nw-media-block nw-audio-block' : 'nw-media-block';
    const block = document.createElement('div');
    block.className = blockClass;
    block.dataset.attId = String(att._id || '');
    block.contentEditable = 'false';
    block.draggable = true;
    let media;
    if (att.fileType === 'image') {
      media = document.createElement('img');
      media.alt = String(att.name || 'Note attachment');
    } else if (att.fileType === 'video') {
      media = document.createElement('video');
      media.controls = true;
    } else if (att.fileType === 'audio') {
      media = document.createElement('audio');
      media.controls = true;
    } else {
      return;
    }
    media.src = url;
    block.appendChild(media);
    if (isAudio) {
      const label = document.createElement('div');
      label.className = 'nw-media-label';
      label.textContent = String(att.name || 'Audio attachment');
      block.appendChild(label);
    } else {
      const resize = document.createElement('div');
      resize.className = 'nw-media-resize-tri';
      block.appendChild(resize);
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'nw-media-toolbar';
    for (const [className, title, label] of [
      ['nw-ma-left', 'Align left', '◀'],
      ['nw-ma-center', 'Center', '■'],
      ['nw-ma-right', 'Align right', '▶'],
      ['nw-ma-delete', 'Delete', '✕'],
    ]) {
      const button = document.createElement('button');
      button.className = `nw-ma ${className}`;
      button.title = title;
      button.type = 'button';
      button.textContent = label;
      toolbar.appendChild(button);
    }
    block.appendChild(toolbar);
    const selection = window.getSelection();
    const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const range = document.createRange();
    if (selectedRange && editorRef.current.contains(selectedRange.commonAncestorContainer)) {
      range.setStart(selectedRange.startContainer, selectedRange.startOffset);
    } else {
      range.selectNodeContents(editorRef.current);
    }
    range.collapse(false);
    range.insertNode(block);
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    block.after(paragraph);
    range.setStart(paragraph, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    handleContentChange();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) uploadMedia(file);
    e.target.value = '';
  };

  // Delete attachment
  const deleteAttachment = async (attId, element) => {
    if (element) {
      element.remove();
      handleContentChange();
    }
    if (!activeNoteId || !attId) return;
    try {
      await axios.delete(`${API}/${activeNoteId}/attachments/${attId}`);
      setNotes((prev) =>
        prev.map((n) =>
          n._id === activeNoteId
            ? { ...n, attachments: (n.attachments || []).filter((a) => a._id !== attId) }
            : n,
        ),
      );
    } catch (err) {
      console.error(err);
    }
  };

  // ─── Editor event delegation ──────────
  const handleEditorMouseDown = (e) => {
    const target = e.target;

    // Delete button
    if (target.classList.contains('nw-ma-delete')) {
      e.preventDefault();
      e.stopPropagation();
      const block = target.closest('.nw-media-block');
      deleteAttachment(block?.getAttribute('data-att-id'), block);
      return;
    }

    // Alignment buttons
    if (
      target.classList.contains('nw-ma-left') ||
      target.classList.contains('nw-ma-center') ||
      target.classList.contains('nw-ma-right')
    ) {
      e.preventDefault();
      e.stopPropagation();
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
      e.preventDefault();
      e.stopPropagation();
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
  const handleEditorDrop = useCallback(
    (e) => {
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
            p.appendChild(document.createElement('br'));
            original.parentNode.insertBefore(p, original.nextSibling);
          }
        }
        handleContentChange();
        return;
      }
      // External file drop
      if (e.dataTransfer.files?.length > 0) {
        e.preventDefault();
        let dropRange = null;
        if (document.caretRangeFromPoint) {
          dropRange = document.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (document.caretPositionFromPoint) {
          const position = document.caretPositionFromPoint(e.clientX, e.clientY);
          dropRange = document.createRange();
          dropRange.setStart(position.offsetNode, position.offset);
          dropRange.collapse(true);
        }
        Array.from(e.dataTransfer.files).forEach((file) => {
          if (
            file.type.startsWith('image/') ||
            file.type.startsWith('video/') ||
            file.type.startsWith('audio/')
          )
            uploadMedia(file, dropRange?.cloneRange());
        });
      }
    },
    [uploadMedia, handleContentChange],
  );

  // ─── Audio recording ──────────────────
  // ─── Canvas ───────────────────────────
  const canvasReadyRef = useRef(false);

  const initCanvas = useCallback(
    (isResize = false) => {
      const canvas = canvasRef.current;
      const editor = editorRef.current;
      const inner = contentInnerRef.current;
      if (!canvas || !editor || !inner) return;
      const w = inner.clientWidth;
      const h = Math.max(editor.scrollHeight, inner.clientHeight);
      // On resize only: preserve current live strokes
      let preservedData = null;
      if (isResize && canvasReadyRef.current && canvas.width > 0 && canvas.height > 0) {
        try {
          preservedData = canvas.toDataURL('image/png');
        } catch {
          /* */
        }
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
      if (!isResize) canvasHistoryRef.current = [];
    },
    [activeNote?.canvasData],
  );

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
    return () => {
      ro.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
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
  useEffect(() => {
    drawStateRef.current = { tool: drawTool, color: drawColor, size: drawSize };
  }, [drawTool, drawColor, drawSize]);

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
      eraserIndicatorRef.current.style.left = cx - sz / 2 + 'px';
      eraserIndicatorRef.current.style.top = cy - sz / 2 + 'px';
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
    if (ctx) {
      ctx.closePath();
      ctx.globalCompositeOperation = 'source-over';
    }
    isDrawingRef.current = false;
    if (eraserIndicatorRef.current) eraserIndicatorRef.current.style.display = 'none';
    if (canvasSaveTimerRef.current) clearTimeout(canvasSaveTimerRef.current);
    canvasSaveTimerRef.current = setTimeout(saveCanvasData, 300);
  };

  // Save canvas data to DB when exiting draw mode
  const saveCanvasData = () => {
    const canvas = canvasRef.current;
    if (!canvas || !activeNoteId) return;
    const dataUrl = canvas.toDataURL('image/png');
    saveNote(activeNoteId, { canvasData: dataUrl });
    // Update local notes state so the <img> layer shows it immediately
    setNotes((prev) =>
      prev.map((n) => (n._id === activeNoteId ? { ...n, canvasData: dataUrl } : n)),
    );
    if (eraserIndicatorRef.current) eraserIndicatorRef.current.style.display = 'none';
  };

  const clearCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    if (activeNoteId) {
      saveNote(activeNoteId, { canvasData: '' });
      setNotes((prev) => prev.map((n) => (n._id === activeNoteId ? { ...n, canvasData: '' } : n)));
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
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        saveCanvasData();
      };
      img.src = prev;
    } else {
      saveCanvasData();
    }
  };

  // ─── FAB drag (Supports Desktop, Tablet, and Mobile) ─────────────────────────
  const handleFabMouseDown = (e) => {
    if (e.type === 'mousedown' && e.button && e.button !== 0) return;

    const getCoords = (event) => {
      if (event.touches && event.touches.length > 0) {
        return { cx: event.touches[0].clientX, cy: event.touches[0].clientY };
      }
      if (event.changedTouches && event.changedTouches.length > 0) {
        return { cx: event.changedTouches[0].clientX, cy: event.changedTouches[0].clientY };
      }
      return { cx: event.clientX, cy: event.clientY };
    };

    const { cx: startX, cy: startY } = getCoords(e);
    if (startX === undefined || startY === undefined) return;

    const startPos = { ...fabPos };
    let moved = false;

    const onMove = (ev) => {
      const { cx, cy } = getCoords(ev);
      if (cx === undefined || cy === undefined) return;

      const deltaX = cx - startX;
      const deltaY = cy - startY;

      if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
        moved = true;
        if (ev.cancelable) ev.preventDefault();
      }

      const maxRight = Math.max(10, window.innerWidth - 65);
      const maxBottom = Math.max(10, window.innerHeight - 65);

      setFabPos({
        right: Math.min(maxRight, Math.max(10, startPos.right - deltaX)),
        bottom: Math.min(maxBottom, Math.max(10, startPos.bottom - deltaY)),
      });
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);

      if (!moved) {
        setIsOpen((prev) => {
          if (prev && drawMode) saveCanvasData();
          return !prev;
        });
      } else {
        if (ev && ev.cancelable) ev.preventDefault();
        setFabPos((prev) => {
          try {
            localStorage.setItem('notesWidgetFabPos', JSON.stringify(prev));
          } catch {
            // ignore storage quota errors
          }
          return prev;
        });
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
  };

  const handlePanelDragStart = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select'))
      return;
    e.preventDefault();
    let startX = e.clientX,
      startY = e.clientY;
    let currentLeft = panelPos.left,
      currentTop = panelPos.top;

    const onMove = (ev) => {
      const maxTop = Math.max(0, window.innerHeight - panelSize.height);
      const maxLeft = Math.max(0, window.innerWidth - panelSize.width);

      let desiredLeft = currentLeft + ev.clientX - startX;
      let desiredTop = currentTop + ev.clientY - startY;

      let actualLeft = Math.min(maxLeft, Math.max(0, desiredLeft));
      let actualTop = Math.min(maxTop, Math.max(0, desiredTop));

      // Dynamically reset the drag anchor if we hit a boundary,
      // ensuring instant response the moment the mouse reverses direction
      if (desiredLeft !== actualLeft) {
        startX = ev.clientX;
        currentLeft = actualLeft;
      }
      if (desiredTop !== actualTop) {
        startY = ev.clientY;
        currentTop = actualTop;
      }

      setPanelPos({ top: actualTop, left: actualLeft });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    let startX = e.clientX,
      startY = e.clientY;
    let currentW = panelSize.width,
      currentH = panelSize.height;

    const onMove = (ev) => {
      const maxW = Math.max(300, window.innerWidth - panelPos.left);
      const maxH = Math.max(300, window.innerHeight - panelPos.top);

      let desiredW = currentW + ev.clientX - startX;
      let desiredH = currentH + ev.clientY - startY;

      let actualW = Math.min(maxW, Math.max(300, desiredW));
      let actualH = Math.min(maxH, Math.max(300, desiredH));

      // Reset resize anchor on boundary collisions
      if (desiredW !== actualW) {
        startX = ev.clientX;
        currentW = actualW;
      }
      if (desiredH !== actualH) {
        startY = ev.clientY;
        currentH = actualH;
      }

      setPanelSize({ width: actualW, height: actualH });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Sync editor — also re-sync when panel reopens
  useEffect(() => {
    if (editorRef.current && activeNote) {
      const structured = activeNote.formatting?.editorDocumentV1;
      if (structured?.version === 1 && Array.isArray(structured.children)) {
        const nodes = structured.children
          .slice(0, 5000)
          .map((spec) => restoreEditorNode(spec, activeNote.attachments || []))
          .filter(Boolean);
        editorRef.current.replaceChildren(...nodes);
      } else {
        editorRef.current.textContent = noteText(activeNote);
        for (const attachment of activeNote.attachments || []) {
          const block = createMediaElement({ ...attachment, fileType: attachment.fileType || attachment.kind });
          if (block) editorRef.current.appendChild(block);
        }
      }
    }
    setDrawMode(false);
  }, [activeNoteId, isOpen, notesLoadRevision]);

  if (!isAuthenticated) return null;

  // ─── RENDER ────────────────────────────
  return (
    <>
      {/* FAB */}
      <button
        aria-controls="notes-panel"
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close notes' : 'Open notes'}
        className="nw-fab"
        style={{ bottom: fabPos.bottom, right: fabPos.right }}
        onMouseDown={handleFabMouseDown}
        onTouchStart={handleFabMouseDown}
        onClick={(e) => e.preventDefault()}
        title="Notes"
        type="button"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="nw-panel"
          id="notes-panel"
          style={{
            top: panelPos.top,
            left: panelPos.left,
            width: panelSize.width,
            height: panelSize.height,
          }}
        >
          {/* Title Bar */}
          <div className="nw-titlebar" onMouseDown={handlePanelDragStart}>
            <div className="nw-titlebar-left">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00f8f1"
                strokeWidth="2"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>Notes</span>
            </div>
            <div className="nw-titlebar-right">
              <button
                onClick={() => setSidebarOpen((p) => !p)}
                title="Toggle sidebar"
                className="nw-tb-btn"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              </button>
              <button
                onClick={() => {
                  if (drawMode) saveCanvasData();
                  setIsOpen(false);
                }}
                title="Close"
                className="nw-tb-btn nw-close-btn"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="nw-body">
            {/* Sidebar */}
            {sidebarOpen && (
              <div className="nw-sidebar">
                <button className="nw-newbtn" onClick={createNote}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New Note
                </button>
                <div className="nw-filelist">
                  {isLoading && <div className="nw-loading">Loading...</div>}
                  {notes.map((note) => (
                    <div
                      key={note._id}
                      className={`nw-fileitem ${note._id === activeNoteId ? 'active' : ''}`}
                    >
                      <button
                        aria-pressed={note._id === activeNoteId}
                        className="nw-fileopen"
                        onClick={() => setActiveNoteId(note._id)}
                        type="button"
                      >
                        <span className="nw-fileinfo">
                          <span className="nw-filename">{note.title}</span>
                          <span className="nw-filedate">
                            {formatDate(note.updatedAt || note.createdAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        aria-label={`Delete ${note.title}`}
                        className="nw-filedel"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNote(note._id);
                        }}
                        title="Delete"
                        type="button"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
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
                        <input
                          aria-label="Note title"
                          className="nw-notetitle-input"
                          value={titleInput}
                          onChange={(e) => setTitleInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
                          autoFocus
                        />
                        <button
                          className="nw-notetitle-save"
                          onClick={handleTitleSave}
                          title="Save title"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="nw-notetitle-row">
                        <span className="nw-notetitle-text">{activeNote.title}</span>
                        <button
                          className="nw-notetitle-edit"
                          onClick={() => {
                            setEditingTitle(true);
                            setTitleInput(activeNote.title);
                          }}
                          title="Rename"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z" />
                          </svg>
                        </button>
                        <div className="nw-title-spacer" />
                        <div className="nw-title-actions">
                          <button
                            className="nw-btn nw-action-btn"
                            onClick={saveNoteNow}
                            title="Save note"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                              <polyline points="17 21 17 13 7 13 7 21" />
                              <polyline points="7 3 7 8 15 8" />
                            </svg>
                            <span className="nw-action-label">Save</span>
                          </button>
                          <button
                            className="nw-btn nw-action-btn"
                            onClick={saveAsFile}
                            title="Save as file"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span className="nw-action-label">Save As</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ═══ FORMAT TOOLBAR ═══ */}
                  <div className="nw-toolbar">
                    {/* Row 1: Text formatting */}
                    <div className="nw-toolbar-row">
                      <button
                        className={`nw-btn ${fmtState.bold ? 'active' : ''}`}
                        onClick={() => execCmd('bold')}
                        title="Bold"
                      >
                        <strong>B</strong>
                      </button>
                      <button
                        className={`nw-btn ${fmtState.italic ? 'active' : ''}`}
                        onClick={() => execCmd('italic')}
                        title="Italic"
                      >
                        <em>I</em>
                      </button>
                      <button
                        className={`nw-btn ${fmtState.underline ? 'active' : ''}`}
                        onClick={() => execCmd('underline')}
                        title="Underline"
                      >
                        <u>U</u>
                      </button>

                      <div className="nw-sep" />

                      {/* Font size — applies to selected text or cursor */}
                      <select
                        aria-label="Note text size"
                        className="nw-select"
                        value={fontSize}
                        onChange={(e) => applyFontSize(Number(e.target.value))}
                        title="Font size"
                      >
                        {[12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                          <option key={s} value={s}>
                            {s}px
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Note text color"
                        type="color"
                        className="nw-color"
                        value={textColor}
                        onChange={(e) => {
                          setTextColor(e.target.value);
                          editorRef.current?.focus();
                          restoreEditorSelection();
                          document.execCommand('foreColor', false, e.target.value);
                          handleContentChange();
                        }}
                        title="Text color"
                      />
                    </div>

                    {/* Row 2: Alignment, Lists, Draw */}
                    <div className="nw-toolbar-row">
                      <button
                        className={`nw-btn ${fmtState.justifyLeft ? 'active' : ''}`}
                        onClick={() => execCmd('justifyLeft')}
                        title="Align left"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="3" y1="12" x2="14" y2="12" />
                          <line x1="3" y1="18" x2="18" y2="18" />
                        </svg>
                      </button>
                      <button
                        className={`nw-btn ${fmtState.justifyCenter ? 'active' : ''}`}
                        onClick={() => execCmd('justifyCenter')}
                        title="Center"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="6" y1="12" x2="18" y2="12" />
                          <line x1="4" y1="18" x2="20" y2="18" />
                        </svg>
                      </button>
                      <button
                        className={`nw-btn ${fmtState.justifyRight ? 'active' : ''}`}
                        onClick={() => execCmd('justifyRight')}
                        title="Align right"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="10" y1="12" x2="21" y2="12" />
                          <line x1="6" y1="18" x2="21" y2="18" />
                        </svg>
                      </button>
                      <button
                        className={`nw-btn ${fmtState.justifyFull ? 'active' : ''}`}
                        onClick={() => execCmd('justifyFull')}
                        title="Justify"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="3" y1="12" x2="21" y2="12" />
                          <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                      </button>

                      <div className="nw-sep" />

                      {/* Lists — with clear labels */}
                      <button
                        className={`nw-btn nw-btn-label ${fmtState.insertUnorderedList ? 'active' : ''}`}
                        onClick={() => execCmd('insertUnorderedList')}
                        title="Bullet list"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="9" y1="6" x2="20" y2="6" />
                          <line x1="9" y1="12" x2="20" y2="12" />
                          <line x1="9" y1="18" x2="20" y2="18" />
                          <circle cx="4" cy="6" r="2" fill="currentColor" />
                          <circle cx="4" cy="12" r="2" fill="currentColor" />
                          <circle cx="4" cy="18" r="2" fill="currentColor" />
                        </svg>
                      </button>
                      <button
                        className={`nw-btn nw-btn-label ${fmtState.insertOrderedList ? 'active' : ''}`}
                        onClick={() => execCmd('insertOrderedList')}
                        title="Numbered list (1, 2, 3)"
                      >
                        <span className="nw-list-icon">1.</span>
                      </button>
                      <button
                        className="nw-btn nw-btn-label"
                        onClick={insertAlphaList}
                        title="Alphabetical list (a, b, c)"
                      >
                        <span className="nw-list-icon">a.</span>
                      </button>

                      <div className="nw-sep" />

                      <button
                        className={`nw-btn nw-draw-toggle ${drawMode ? 'active' : ''}`}
                        onClick={() => {
                          if (drawMode) saveCanvasData();
                          setDrawMode((p) => !p);
                        }}
                        title={drawMode ? 'Stop drawing' : 'Draw'}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Draw toolbar */}
                  {drawMode && (
                    <div className="nw-draw-toolbar">
                      <button
                        className={`nw-btn ${drawTool === 'pen' ? 'active' : ''}`}
                        onClick={() => setDrawTool('pen')}
                        title="Pen"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z" />
                        </svg>
                      </button>
                      <button
                        className={`nw-btn ${drawTool === 'eraser' ? 'active' : ''}`}
                        onClick={() => setDrawTool('eraser')}
                        title="Eraser"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18.5 4.5l1 1a2.83 2.83 0 010 4L12 17H7l-2 2" />
                          <path d="M20 20H7" />
                          <path d="M5 17l4.5-4.5" />
                          <rect
                            x="7.5"
                            y="7.5"
                            width="11"
                            height="5"
                            rx="1"
                            transform="rotate(45 13 10)"
                          />
                        </svg>
                      </button>
                      <input
                        aria-label="Drawing pen color"
                        type="color"
                        className="nw-color"
                        value={drawColor}
                        onChange={(e) => setDrawColor(e.target.value)}
                        title="Pen color"
                      />
                      <select
                        aria-label="Drawing pen size"
                        className="nw-select"
                        value={drawSize}
                        onChange={(e) => setDrawSize(Number(e.target.value))}
                      >
                        {[1, 2, 3, 5, 8, 12].map((s) => (
                          <option key={s} value={s}>
                            {s}px
                          </option>
                        ))}
                      </select>
                      <button className="nw-btn" onClick={undoCanvas} title="Undo">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="9 14 4 9 9 4" />
                          <path d="M20 20v-7a4 4 0 00-4-4H4" />
                        </svg>
                      </button>
                      <button
                        className="nw-btn nw-btn-danger"
                        onClick={clearCanvas}
                        title="Clear all drawing"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Content */}
                  <div className="nw-content-wrap">
                    <div className="nw-content-inner" ref={contentInnerRef}>
                      <div
                        aria-label="Note content"
                        aria-multiline="true"
                        ref={editorRef}
                        className="nw-editor"
                        contentEditable={!drawMode}
                        role="textbox"
                        suppressContentEditableWarning
                        onInput={() => {
                          handleContentChange();
                          updateFmtState();
                        }}
                        onPaste={(event) => {
                          event.preventDefault();
                          document.execCommand(
                            'insertText',
                            false,
                            event.clipboardData.getData('text/plain').slice(0, 100_000),
                          );
                          handleContentChange();
                        }}
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
                        <canvas
                          aria-label="Note drawing canvas; drawing requires a pointer"
                          ref={canvasRef}
                          className={`nw-canvas-overlay ${drawTool === 'eraser' ? 'nw-eraser-active' : ''}`}
                          role="img"
                          onMouseDown={startDraw}
                          onMouseMove={handleCanvasMouseMove}
                          onMouseUp={endDraw}
                          onMouseLeave={handleCanvasMouseLeave}
                          onTouchStart={startDraw}
                          onTouchMove={handleCanvasMouseMove}
                          onTouchEnd={endDraw}
                        />
                      )}
                      {/* Eraser indicator */}
                      <div
                        ref={eraserIndicatorRef}
                        className="nw-eraser-indicator"
                        style={{ display: 'none' }}
                      />
                    </div>
                  </div>

                  {/* Media bar */}
                  <div className="nw-mediabar">
                    <label className="nw-mediabtn" title="Upload image" onMouseDown={captureMediaInsertionPoint}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                      <span>Image</span>
                      <input type="file" accept="image/*" hidden onChange={handleFileUpload} />
                    </label>
                    <label className="nw-mediabtn" title="Upload video" onMouseDown={captureMediaInsertionPoint}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" />
                      </svg>
                      <span>Video</span>
                      <input type="file" accept="video/*" hidden onChange={handleFileUpload} />
                    </label>
                    <label className="nw-mediabtn" title="Upload audio" onMouseDown={captureMediaInsertionPoint}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                      <span>Audio</span>
                      <input type="file" accept="audio/*" hidden onChange={handleFileUpload} />
                    </label>
                  </div>
                </>
              ) : (
                <div className="nw-empty-state">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="1.5"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
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
