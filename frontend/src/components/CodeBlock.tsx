import React, { useState, useEffect } from 'react'
import { Copy, Check, Code, ExternalLink, Eye } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { generateUUID } from '../stores/chatStore'
import { cn, copyTextToClipboard } from '../lib/utils'
import hljs from 'highlight.js'

// Memory cache for highlighted code snippets to make switching chats instantaneous. Capped to prevent memory leak.
const highlightCache = new Map<string, string>()
const MAX_CACHE_SIZE = 100

function getHighlightedHtml(content: string, language: string): string {
  const cacheKey = `${language}:${content}`
  if (highlightCache.has(cacheKey)) {
    const val = highlightCache.get(cacheKey)!
    // Move to end (most recently used)
    highlightCache.delete(cacheKey)
    highlightCache.set(cacheKey, val)
    return val
  }

  let html = ''
  try {
    const lang = language.toLowerCase()
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(content, { language: lang }).value
    } else {
      html = hljs.highlightAuto(content).value
    }
  } catch (err) {
    // Fallback: simple HTML escape
    html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  if (highlightCache.size >= MAX_CACHE_SIZE) {
    const firstKey = highlightCache.keys().next().value
    if (firstKey !== undefined) {
      highlightCache.delete(firstKey)
    }
  }
  highlightCache.set(cacheKey, html)
  return html
}

interface CodeBlockProps {
  language: string
  content: string
  highlighted?: React.ReactNode
}

export function CodeBlock({ language, content, highlighted }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const { setActiveArtifact, setArtifactPanelOpen } = useUIStore()
  const { theme } = useSettingsStore()

  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(() => {
    if (highlighted) return null
    const cacheKey = `${language}:${content}`
    return highlightCache.has(cacheKey) ? highlightCache.get(cacheKey)! : null
  })

  useEffect(() => {
    if (highlighted) return
    const cacheKey = `${language}:${content}`
    if (highlightCache.has(cacheKey)) {
      setHighlightedHtml(highlightCache.get(cacheKey)!)
      return
    }

    const runHighlight = () => {
      const html = getHighlightedHtml(content, language)
      setHighlightedHtml(html)
    }

    // Defer rendering highlighting to keep UI thread responsive
    const timer = setTimeout(runHighlight, 0)
    return () => clearTimeout(timer)
  }, [content, language, highlighted])

  const isPreviewable = ['html', 'svg', 'markdown'].includes(language) || 
    content.includes('<!DOCTYPE html>') || 
    content.includes('<html')

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy code:', error)
    }
  }

  const handleOpenArtifact = () => {
    setActiveArtifact({
      id: generateUUID(),
      type: language === 'svg' ? 'svg' : language === 'markdown' ? 'markdown' : language === 'mermaid' ? 'code' : 'html',
      title: `Artifact ${language}`,
      language,
      content,
      timestamp: Date.now(),
    })
    setArtifactPanelOpen(true)
  }

  // Generate Mermaid frame contents locally - inline with pan/zoom (same UX as artifact but inline)
  const mermaidSrcDoc = React.useMemo(() => {
    if (language !== 'mermaid') return ''
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
            touch-action: none;
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
            padding: 12px;
            font-family: monospace;
            font-size: 12px;
            border-radius: 4px;
            white-space: pre-wrap;
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
          let scale = 1;
          let translateX = 0;
          let translateY = 0;
          function updateTransform() {
            const el = document.getElementById('svg-wrapper');
            if (el) el.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
          }
          function centerAndFit() {
            const container = document.getElementById('container');
            const svgEl = container.querySelector('svg');
            const viewport = document.getElementById('viewport');
            if (svgEl && viewport) {
              const vw = viewport.clientWidth;
              const vh = viewport.clientHeight;
              let svgW = 800, svgH = 400;
              if (svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.width > 0) {
                svgW = svgEl.viewBox.baseVal.width;
                svgH = svgEl.viewBox.baseVal.height;
              } else {
                const r = svgEl.getBoundingClientRect();
                if (r.width > 0) { svgW = r.width; svgH = r.height; }
              }
              let s = Math.min(vw / svgW, vh / svgH) * 0.92;
              s = Math.min(Math.max(0.1, s), 1.4);
              scale = s;
              translateX = (vw - svgW * scale) / 2;
              translateY = (vh - svgH * scale) / 2;
              updateTransform();
            }
          }
          try {
            mermaid.initialize({ startOnLoad: false, theme: '${mermaidTheme}', securityLevel: 'loose', themeVariables: { background: '${bgColor}', primaryColor: '${isDark ? '#1f2937' : '#f3f4f6'}' } });
          } catch(e) {}
          // pan
          let isPanning = false, startX=0, startY=0;
          window.addEventListener('mousedown', function(e){ if(e.button!==0) return; isPanning=true; startX=e.clientX-translateX; startY=e.clientY-translateY; document.body.style.cursor='grabbing'; });
          window.addEventListener('mousemove', function(e){ if(!isPanning) return; translateX=e.clientX-startX; translateY=e.clientY-startY; updateTransform(); });
          window.addEventListener('mouseup', function(){ isPanning=false; document.body.style.cursor='grab'; });
          window.addEventListener('mouseleave', function(){ isPanning=false; document.body.style.cursor='grab'; });
          window.addEventListener('wheel', function(e){ e.preventDefault(); const xs=(e.clientX-translateX)/scale, ys=(e.clientY-translateY)/scale; const z=0.1; if(e.deltaY<0) scale+=scale*z; else scale-=scale*z; scale=Math.min(Math.max(0.05, scale), 15); translateX=e.clientX-xs*scale; translateY=e.clientY-ys*scale; updateTransform(); }, {passive:false});
          // touch pan + pinch
          let lastTouchX=0, lastTouchY=0, isTouching=false, pinchStartDist=0, pinchStartScale=1;
          function getDist(t){ const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.hypot(dx,dy); }
          function getCenter(t){ return { x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2 }; }
          window.addEventListener('touchstart', function(e){
            if(e.touches.length===1){ isTouching=true; lastTouchX=e.touches[0].clientX; lastTouchY=e.touches[0].clientY; }
            else if(e.touches.length===2){ isTouching=false; pinchStartDist=getDist(e.touches); pinchStartScale=scale; }
          }, {passive:false});
          window.addEventListener('touchmove', function(e){
            if(e.touches.length===2){ e.preventDefault(); const d=getDist(e.touches); if(pinchStartDist>0){ const c=getCenter(e.touches); const xs=(c.x-translateX)/scale, ys=(c.y-translateY)/scale; let ns=pinchStartScale*(d/pinchStartDist); ns=Math.min(Math.max(0.05, ns),15); translateX=c.x-xs*ns; translateY=c.y-ys*ns; scale=ns; updateTransform(); } return; }
            if(!isTouching||e.touches.length!==1) return; e.preventDefault(); const dx=e.touches[0].clientX-lastTouchX, dy=e.touches[0].clientY-lastTouchY; translateX+=dx; translateY+=dy; lastTouchX=e.touches[0].clientX; lastTouchY=e.touches[0].clientY; updateTransform();
          }, {passive:false});
          window.addEventListener('touchend', function(e){
            if(e.touches.length===0){ isTouching=false; pinchStartDist=0; }
            else if(e.touches.length===1){ pinchStartDist=0; isTouching=true; lastTouchX=e.touches[0].clientX; lastTouchY=e.touches[0].clientY; }
          });
          function doRender(){
            const id='m-'+Math.floor(Math.random()*1e6);
            mermaid.render(id, \`${content.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`).then(function(r){
              const c=document.getElementById('container');
              c.innerHTML=r.svg;
              if(r.bindFunctions) r.bindFunctions(c);
              centerAndFit();
            }).catch(function(err){
              const e=document.getElementById('error-container');
              if(e){ e.style.display='block'; e.textContent='Mermaid syntax error:\\n'+(err.message||err); }
            });
          }
          // mermaid may not be loaded yet when this script runs via srcDoc
          if (window.mermaid) doRender();
          else window.addEventListener('load', doRender);
        </script>
      </body>
      </html>
    `
  }, [content, language, theme])

  // Mermaid: inline rendered diagram, not a codeblock, no artifact popup
  if (language === 'mermaid') {
    return (
      <div className="my-5 rounded-sm border border-border overflow-hidden bg-card">
        <iframe
          srcDoc={mermaidSrcDoc}
          className="w-full h-[380px] md:h-[420px] border-0 block"
          sandbox="allow-scripts"
          title="Mermaid diagram"
          loading="lazy"
        />
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-secondary/40 border-t border-border text-[11px] text-muted-foreground">
          <span className="font-mono">drag to pan · pinch or scroll to zoom</span>
          <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-background transition-colors">
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy source'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="my-4 rounded-sm border border-border overflow-hidden bg-secondary/50">
      <div className="flex items-center justify-between px-3 py-2 bg-secondary border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground uppercase">{language || 'text'}</span>
          {isPreviewable && (
            <div className="flex items-center gap-0.5 bg-background rounded-sm p-0.5">
              <button
                onClick={() => setViewMode('code')}
                className={cn(
                  'p-1 rounded-sm transition-colors',
                  viewMode === 'code' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Code className="w-3 h-3" />
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={cn(
                  'p-1 rounded-sm transition-colors',
                  viewMode === 'preview' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Eye className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isPreviewable && (
            <button
              onClick={handleOpenArtifact}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded-sm transition-colors"
              title="Open in sidebar"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-background rounded-sm transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {viewMode === 'code' ? (
        <pre className="p-4 overflow-x-auto">
          {highlighted ? (
            <code className={`language-${language} text-sm font-mono`}>
              {highlighted}
            </code>
          ) : highlightedHtml ? (
            <code 
              className={`language-${language} text-sm font-mono hljs`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <code className={`language-${language} text-sm font-mono`}>
              {content}
            </code>
          )}
        </pre>
      ) : (
        <div className="p-4 bg-background">
          {language === 'svg' ? (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <iframe
              srcDoc={content}
              className="w-full h-[300px] border-0 rounded-sm"
              sandbox="allow-scripts"
            />
          )}
        </div>
      )}
    </div>
  )
}
