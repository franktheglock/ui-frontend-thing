import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Code, ExternalLink, Copy, Check, Eye, Maximize2, Minimize2 } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'katex/dist/katex.min.css'

export function ArtifactPanel() {
  const { activeArtifact, artifactPanelOpen, setArtifactPanelOpen, setActiveArtifact } = useUIStore()
  const { theme } = useSettingsStore()
  
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code')
  const [panelWidth, setPanelWidth] = useState<'normal' | 'wide' | 'full'>('normal')
  const [copied, setCopied] = useState(false)
  const [svgBg, setSvgBg] = useState<'dark' | 'light' | 'transparent'>('transparent')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const [customWidth, setCustomWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const currentWidth = customWidth !== null
    ? customWidth
    : panelWidth === 'full'
    ? windowWidth
    : panelWidth === 'wide'
    ? 800
    : 500

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    
    const startX = e.clientX
    const startWidth = currentWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX
      const newWidth = Math.max(300, Math.min(window.innerWidth, startWidth + deltaX))
      setCustomWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [currentWidth])

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isMobile = windowWidth < 768

  // Detect preview support
  const previewSupported = useMemo(() => {
    if (!activeArtifact) return false
    const type = activeArtifact.type.toLowerCase()
    const lang = (activeArtifact.language || '').toLowerCase()
    const content = activeArtifact.content.trim()

    if (type === 'html' || type === 'svg' || type === 'markdown' || type === 'mermaid') return true
    if (lang === 'html' || lang === 'svg' || lang === 'markdown' || lang === 'mermaid') return true

    // Mermaid syntax match
    if (
      content.startsWith('graph ') ||
      content.startsWith('flowchart ') ||
      content.startsWith('sequenceDiagram') ||
      content.startsWith('gantt') ||
      content.startsWith('classDiagram') ||
      content.startsWith('stateDiagram') ||
      content.startsWith('erDiagram') ||
      content.startsWith('pie') ||
      content.startsWith('journey') ||
      content.startsWith('gitGraph')
    ) {
      return true
    }

    return false
  }, [activeArtifact])

  const lastArtifactIdRef = useRef<string | null>(null)

  // Automatically switch tab when artifact changes
  useEffect(() => {
    if (!activeArtifact) return
    if (activeArtifact.id !== lastArtifactIdRef.current) {
      lastArtifactIdRef.current = activeArtifact.id
      if (previewSupported) {
        setActiveTab('preview')
      } else {
        setActiveTab('code')
      }
    }
  }, [activeArtifact, previewSupported])

  const type = activeArtifact ? activeArtifact.type.toLowerCase() : ''
  const lang = activeArtifact ? (activeArtifact.language || '').toLowerCase() : ''
  const isMermaid = activeArtifact ? (type === 'mermaid' || lang === 'mermaid' || activeArtifact.content.trim().startsWith('graph') || activeArtifact.content.trim().startsWith('flowchart')) : false

  // Send content updates to iframe programmatically to prevent full iframe reloads
  useEffect(() => {
    if (activeArtifact && isMermaid && iframeRef.current) {
      const iframe = iframeRef.current
      const isStreaming = activeArtifact.id.includes('-artifact-')
      
      const sendContent = () => {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            content: activeArtifact.content,
            isStreaming,
            artifactId: activeArtifact.id
          }, '*')
        }
      }

      sendContent()
    }
  }, [activeArtifact?.content, isMermaid, activeArtifact?.id])

  // Syntax highlighting
  const highlightedCode = useMemo(() => {
    if (!activeArtifact) return ''
    const content = activeArtifact.content
    const lang = activeArtifact.language || activeArtifact.type || 'plaintext'
    try {
      if (hljs.getLanguage(lang)) {
        return hljs.highlight(content, { language: lang }).value
      }
      return hljs.highlightAuto(content).value
    } catch (e) {
      return content
    }
  }, [activeArtifact])

  const handleCopy = async () => {
    if (!activeArtifact) return
    try {
      await navigator.clipboard.writeText(activeArtifact.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const handleOpenInNewWindow = () => {
    if (!activeArtifact) return
    const newWindow = window.open('', '_blank', 'width=800,height=600')
    if (!newWindow) return

    const type = activeArtifact.type.toLowerCase()
    const isMermaid = type === 'mermaid' || activeArtifact.language === 'mermaid' || activeArtifact.content.trim().startsWith('graph')

    if (type === 'html') {
      newWindow.document.write(activeArtifact.content)
      newWindow.document.close()
    } else if (type === 'svg') {
      newWindow.document.write(`<!DOCTYPE html><html><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1e1e1e;">${activeArtifact.content}</body></html>`)
      newWindow.document.close()
    } else if (isMermaid) {
      newWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <script src="/mermaid.min.js"></script>
          <style>
            body { margin:0; padding:20px; background:#121212; color:#fff; display:flex; justify-content:center; align-items:center; min-height:100vh; font-family:sans-serif; }
          </style>
        </head>
        <body>
          <div class="mermaid">${activeArtifact.content}</div>
          <script>
            mermaid.initialize({ startOnLoad: true, theme: 'dark' });
          </script>
        </body>
        </html>
      `)
      newWindow.document.close()
    } else {
      newWindow.document.write(`<!DOCTYPE html><html><body style="background:#0d1117;color:#c9d1d9;padding:20px;"><pre>${activeArtifact.content}</pre></body></html>`)
      newWindow.document.close()
    }
  }

  // Generate Mermaid frame contents statically (reloaded only on theme change)
  const mermaidSrcDoc = useMemo(() => {
    const isDark = theme !== 'light'
    const mermaidTheme = isDark ? 'dark' : 'default'
    const bgColor = isDark ? '#121212' : '#ffffff'
    const textColor = isDark ? '#e0e0e0' : '#1a1a1a'

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="/mermaid.min.js"></script>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background-color: ${bgColor};
            color: ${textColor};
            font-family: system-ui, -apple-system, sans-serif;
            box-sizing: border-box;
            cursor: grab;
            user-select: none;
            -webkit-user-select: none;
          }
          #viewport {
            width: 100%;
            height: 100%;
            position: relative;
            overflow: hidden;
          }
          #svg-wrapper {
            transform-origin: 0 0;
            position: absolute;
            top: 0;
            left: 0;
            display: inline-block;
          }
          #container {
            display: inline-block;
          }
          #container svg {
            max-width: none !important;
            max-height: none !important;
            display: block;
          }
          #error-container {
            position: absolute;
            top: 16px;
            left: 16px;
            right: 16px;
            z-index: 10;
            display: none;
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.1);
            padding: 16px;
            font-family: monospace;
            font-size: 13px;
            border-radius: 4px;
            white-space: pre-wrap;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div id="error-container"></div>
        <div id="viewport">
          <div id="svg-wrapper">
            <div id="container"></div>
          </div>
        </div>
        <script>
          let lastValidSvg = '';
          let currentArtifactId = '';
          let needsCentering = false;

          let scale = 1;
          let translateX = 0;
          let translateY = 0;

          function updateTransform() {
            const el = document.getElementById('svg-wrapper');
            if (el) {
              el.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
            }
          }

          function centerAndFit() {
            const container = document.getElementById('container');
            const svgEl = container.querySelector('svg');
            const viewport = document.getElementById('viewport');
            if (svgEl && viewport) {
              const vw = viewport.clientWidth;
              const vh = viewport.clientHeight;
              
              let svgW = 800;
              let svgH = 600;
              if (svgEl.viewBox && svgEl.viewBox.baseVal) {
                const vb = svgEl.viewBox.baseVal;
                if (vb.width > 0 && vb.height > 0) {
                  svgW = vb.width;
                  svgH = vb.height;
                }
              } else {
                const rect = svgEl.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  svgW = rect.width;
                  svgH = rect.height;
                }
              }

              const scaleX = vw / svgW;
              const scaleY = vh / svgH;
              let newScale = Math.min(scaleX, scaleY) * 0.9;
              newScale = Math.min(Math.max(0.1, newScale), 1.5);
              
              scale = newScale;
              translateX = (vw - svgW * scale) / 2;
              translateY = (vh - svgH * scale) / 2;
              updateTransform();
            }
          }
          
          try {
            mermaid.initialize({
              startOnLoad: false,
              theme: '${mermaidTheme}',
              securityLevel: 'loose',
              themeVariables: {
                background: '${bgColor}',
                primaryColor: '${isDark ? '#1f2937' : '#f3f4f6'}',
              }
            });
          } catch (err) {
            console.error('Failed to initialize Mermaid:', err);
          }

          // Pan zoom events
          let isPanning = false;
          let startX = 0;
          let startY = 0;

          window.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            isPanning = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
            document.body.style.cursor = 'grabbing';
          });

          window.addEventListener('mousemove', function(e) {
            if (!isPanning) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform();
          });

          window.addEventListener('mouseup', function() {
            isPanning = false;
            document.body.style.cursor = 'grab';
          });

          window.addEventListener('mouseleave', function() {
            isPanning = false;
            document.body.style.cursor = 'grab';
          });

          // Zoom
          window.addEventListener('wheel', function(e) {
            e.preventDefault();
            const zoomIntensity = 0.1;
            const mouseX = e.clientX;
            const mouseY = e.clientY;

            const xs = (mouseX - translateX) / scale;
            const ys = (mouseY - translateY) / scale;

            if (e.deltaY < 0) {
              scale += scale * zoomIntensity;
            } else {
              scale -= scale * zoomIntensity;
            }
            scale = Math.min(Math.max(0.05, scale), 15);

            translateX = mouseX - xs * scale;
            translateY = mouseY - ys * scale;

            updateTransform();
          }, { passive: false });

          // Touch support
          let lastTouchX = 0;
          let lastTouchY = 0;
          let isTouching = false;

          window.addEventListener('touchstart', function(e) {
            if (e.touches.length === 1) {
              isTouching = true;
              lastTouchX = e.touches[0].clientX;
              lastTouchY = e.touches[0].clientY;
            }
          });

          window.addEventListener('touchmove', function(e) {
            if (!isTouching || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - lastTouchX;
            const dy = e.touches[0].clientY - lastTouchY;
            translateX += dx;
            translateY += dy;
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
            updateTransform();
          });

          window.addEventListener('touchend', function() {
            isTouching = false;
          });

          // Message listener
          window.addEventListener('message', function(event) {
            const data = event.data;
            if (!data || typeof data.content !== 'string') return;
            
            const content = data.content;
            const isStreaming = !!data.isStreaming;
            const artifactId = data.artifactId || '';
            
            if (artifactId !== currentArtifactId) {
              currentArtifactId = artifactId;
              needsCentering = true;
            }
            
            const renderId = 'mermaid-svg-' + Math.floor(Math.random() * 1000000);
            
            mermaid.render(renderId, content)
              .then(function(result) {
                const container = document.getElementById('container');
                const errDiv = document.getElementById('error-container');
                if (container) {
                  container.innerHTML = result.svg;
                  if (result.bindFunctions) {
                    result.bindFunctions(container);
                  }
                  lastValidSvg = result.svg;
                  
                  if (needsCentering) {
                    centerAndFit();
                    needsCentering = false;
                  }
                }
                if (errDiv) {
                  errDiv.style.display = 'none';
                }
              })
              .catch(function(err) {
                const errDiv = document.getElementById('error-container');
                if (errDiv) {
                  if (!isStreaming) {
                    errDiv.style.display = 'block';
                    errDiv.textContent = 'Mermaid syntax error:\\n' + (err.message || err);
                  }
                }
                const container = document.getElementById('container');
                if (container && lastValidSvg) {
                  container.innerHTML = lastValidSvg;
                }
              });
          });
        </script>
      </body>
      </html>
    `
  }, [theme])

  if (!artifactPanelOpen || !activeArtifact) return null

  const widthValue = isMobile ? '100vw' : `${currentWidth}px`

  return (
    <AnimatePresence>
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: widthValue, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ duration: isResizing ? 0 : 0.2, ease: 'easeInOut' }}
        className="flex-shrink-0 border-l border-border bg-card/95 backdrop-blur-md flex flex-col overflow-hidden h-full relative z-20"
      >
        {/* Resize Handle */}
        {!isMobile && (
          <div
            onMouseDown={handleMouseDown}
            className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-all z-50 group ${
              isResizing ? 'bg-accent w-1.5' : ''
            }`}
          />
        )}
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border h-12">
          <div className="flex items-center gap-2 min-w-0">
            <Code className="w-4 h-4 text-accent flex-shrink-0" />
            <span className="text-xs font-semibold truncate max-w-[150px] text-foreground">{activeArtifact.title}</span>
            <span className="text-[10px] bg-secondary/80 border border-border px-1.5 py-0.5 font-mono text-muted-foreground uppercase rounded-sm">
              {activeArtifact.language || activeArtifact.type}
            </span>
          </div>

          {/* Tabs */}
          {previewSupported && (
            <div className="flex items-center bg-secondary/50 border border-border p-0.5 rounded-sm">
              <button
                onClick={() => setActiveTab('preview')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors rounded-sm ${
                  activeTab === 'preview'
                    ? 'bg-card text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
              <button
                onClick={() => setActiveTab('code')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors rounded-sm ${
                  activeTab === 'code'
                    ? 'bg-card text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                Code
              </button>
            </div>
          )}

          {/* Window Control Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
              title="Copy code"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleOpenInNewWindow}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
              title="Open in new window"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <div className="h-4 w-px bg-border mx-0.5" />
            {currentWidth !== 500 && (
              <button
                onClick={() => {
                  setCustomWidth(null)
                  setPanelWidth('normal')
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors hidden md:block"
                title="Collapse panel"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            )}
            {currentWidth !== 800 && (
              <button
                onClick={() => {
                  setCustomWidth(null)
                  setPanelWidth('wide')
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors hidden md:block"
                title="Expand panel"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => {
                setArtifactPanelOpen(false)
                setActiveArtifact(null)
              }}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
              title="Close panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Panel Content Area */}
        <div className="flex-1 overflow-hidden relative bg-card">
          {activeTab === 'preview' ? (
            <div className="w-full h-full">
              {type === 'html' ? (
                <iframe
                  srcDoc={activeArtifact.content}
                  className={`w-full h-full border-0 bg-white ${isResizing ? 'pointer-events-none' : ''}`}
                  sandbox="allow-scripts"
                  title="HTML Preview"
                />
              ) : isMermaid ? (
                <iframe
                  ref={iframeRef}
                  srcDoc={mermaidSrcDoc}
                  className={`w-full h-full border-0 ${isResizing ? 'pointer-events-none' : ''}`}
                  sandbox="allow-scripts"
                  title="Mermaid Flowchart Preview"
                  onLoad={() => {
                    if (iframeRef.current && iframeRef.current.contentWindow && activeArtifact) {
                      const isStreaming = activeArtifact.id.includes('-artifact-')
                      iframeRef.current.contentWindow.postMessage({
                        content: activeArtifact.content,
                        isStreaming,
                        artifactId: activeArtifact.id
                      }, '*')
                    }
                  }}
                />
              ) : type === 'svg' || lang === 'svg' ? (
                <div className="w-full h-full flex flex-col">
                  {/* SVG background picker */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/35 border-b border-border text-[11px] text-muted-foreground">
                    <span>Background:</span>
                    <button
                      onClick={() => setSvgBg('transparent')}
                      className={`px-2 py-0.5 rounded-sm border ${
                        svgBg === 'transparent' ? 'border-accent text-foreground bg-accent/10' : 'border-border'
                      }`}
                    >
                      Checker
                    </button>
                    <button
                      onClick={() => setSvgBg('light')}
                      className={`px-2 py-0.5 rounded-sm border ${
                        svgBg === 'light' ? 'border-accent text-foreground bg-white text-black' : 'border-border bg-white text-black'
                      }`}
                    >
                      Light
                    </button>
                    <button
                      onClick={() => setSvgBg('dark')}
                      className={`px-2 py-0.5 rounded-sm border ${
                        svgBg === 'dark' ? 'border-accent text-foreground bg-black text-white' : 'border-border bg-black text-white'
                      }`}
                    >
                      Dark
                    </button>
                  </div>
                  <div 
                    className={`flex-1 flex items-center justify-center p-8 overflow-auto ${
                      svgBg === 'transparent' 
                        ? 'bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px]'
                        : svgBg === 'light'
                        ? 'bg-white'
                        : 'bg-black'
                    }`}
                  >
                    <div 
                      className="max-w-full max-h-full transition-all duration-300"
                      dangerouslySetInnerHTML={{ __html: activeArtifact.content }} 
                    />
                  </div>
                </div>
              ) : type === 'markdown' || lang === 'markdown' ? (
                <div className="w-full h-full overflow-auto p-6 bg-background">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm, remarkMath]} 
                      rehypePlugins={[rehypeKatex, rehypeHighlight]}
                    >
                      {activeArtifact.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                  No preview available for this file type.
                </div>
              )}
            </div>
          ) : (
            /* Code Tab view */
            <div className="w-full h-full overflow-auto font-mono text-xs flex flex-col bg-[#0d1117]">
              <pre className="p-4 leading-relaxed overflow-x-auto select-text flex-1">
                <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
              </pre>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
