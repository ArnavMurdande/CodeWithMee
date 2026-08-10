import { useEffect, useRef } from 'react';

const CodeEditor = ({
  height = '100%',
  language = 'python',
  onChange,
  onMount,
  options = {},
  theme = 'vs-dark',
  value = '',
  width = '100%',
}) => {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const onMountRef = useRef(onMount);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  onMountRef.current = onMount;
  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    let isCancelled = false;

    const initEditor = () => {
      if (isCancelled || !containerRef.current || editorRef.current) return;
      const monaco = window.monaco;
      if (!monaco || !monaco.editor) return;

      const instance = monaco.editor.create(containerRef.current, {
        value: valueRef.current || '',
        language: language || 'python',
        theme: theme || 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        fontSize: 16,
        ...options,
      });

      editorRef.current = instance;

      try {
        instance.layout();
      } catch {
        // Ignore premature layout call before container render
      }

      requestAnimationFrame(() => {
        if (editorRef.current) {
          try {
            editorRef.current.layout();
          } catch {
            // Ignore unmounted layout calls
          }
        }
      });

      instance.onDidChangeModelContent(() => {
        if (onChangeRef.current) {
          onChangeRef.current(instance.getValue());
        }
      });

      if (onMountRef.current) {
        onMountRef.current(instance, monaco);
      }
    };

    const loadMonaco = () => {
      const monacoVsPath = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.56.0/min/vs';
      if (window.monaco && window.monaco.editor) {
        initEditor();
      } else if (window.require && typeof window.require === 'function' && window.require.config) {
        window.require.config({ paths: { vs: monacoVsPath } });
        window.require(['vs/editor/editor.main'], () => {
          initEditor();
        });
      } else {
        const existingScript = document.querySelector('script[src*="loader.js"]');
        if (!existingScript) {
          const script = document.createElement('script');
          script.src = `${monacoVsPath}/loader.js`;
          script.onload = () => {
            if (window.require) {
              window.require.config({ paths: { vs: monacoVsPath } });
              window.require(['vs/editor/editor.main'], () => {
                initEditor();
              });
            }
          };
          document.head.appendChild(script);
        } else {
          existingScript.addEventListener('load', () => {
            if (window.require) {
              window.require.config({ paths: { vs: monacoVsPath } });
              window.require(['vs/editor/editor.main'], () => {
                initEditor();
              });
            }
          });
        }
      }
    };

    loadMonaco();

    return () => {
      isCancelled = true;
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  // Sync value changes from parent without interrupting active user typing
  useEffect(() => {
    if (editorRef.current) {
      const currentVal = editorRef.current.getValue();
      if (value !== undefined && value !== currentVal) {
        editorRef.current.setValue(value);
        try {
          editorRef.current.layout();
        } catch {
          // Ignore layout errors during unmount
        }
      }
    }
  }, [value]);

  // Sync language changes dynamically
  useEffect(() => {
    if (editorRef.current && window.monaco && window.monaco.editor) {
      const model = editorRef.current.getModel();
      if (model && language) {
        window.monaco.editor.setModelLanguage(model, language);
      }
    }
  }, [language]);

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        minHeight: '0',
        position: 'relative',
        overflow: 'hidden',
      }}
    />
  );
};

export default CodeEditor;
