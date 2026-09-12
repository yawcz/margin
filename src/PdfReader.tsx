import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { ChevronLeft, ChevronRight, Minus, Plus, TextSelect, X } from 'lucide-react';
import { pageLabel, type Paper, type Passage } from '../shared/types';
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({
  paper,
  page,
  pageJump,
  onPage,
  onNavigate,
  selection,
  onSelection,
  onExplain,
}: {
  paper: Paper;
  page: number;
  pageJump: number;
  onPage: (page: number) => void;
  onNavigate: (page: number) => void;
  selection: Passage | null;
  onSelection: (selection: Passage | null) => void;
  onExplain: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [zoom, setZoom] = useState(1);
  const container = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const viewer = useRef<PDFViewer | null>(null);
  const fit = useRef<() => void>(() => {});
  const current = useRef({ page, zoom, onPage, onSelection });
  current.current = { page, zoom, onPage, onSelection };

  useEffect(() => {
    const root = container.current!,
      content = pages.current!;
    const abort = new AbortController();
    let stopped = false,
      ready = false,
      fitting = false;
    let selectionTimer: ReturnType<typeof setTimeout>;
    let resizeFrame = 0;
    setError('');
    setBusy(true);
    const eventBus = new EventBus();
    const options = {
      container: root,
      viewer: content,
      eventBus,
      annotationMode: 0,
      enableAutoLinking: false,
      enableSelectionRendering: false,
      maxCanvasPixels: 8_000_000,
      abortSignal: abort.signal,
    };
    const reader = new PDFViewer(options);
    viewer.current = reader;
    fit.current = () => {
      if (!ready || !root.clientWidth) return;
      fitting = true;
      reader.currentScaleValue = 'page-width';
      reader.currentScale *= current.current.zoom;
      reader.update();
      fitting = false;
    };
    eventBus.on('pagesinit', () => {
      if (stopped) return;
      const resumePage = current.current.page;
      ready = true;
      fit.current();
      reader.currentPageNumber = resumePage;
    });
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      if (ready && !fitting && !stopped) current.current.onPage(pageNumber);
    });
    eventBus.on('textlayerrendered', ({ error: renderError }: { error?: Error }) => {
      if (stopped) return;
      setBusy(false);
      if (renderError)
        setError('Some text could not be prepared for selection. Try reloading the paper.');
    });
    const task = getDocument({ url: `/api/papers/${paper.id}/pdf` });
    void task.promise
      .then((pdf) => {
        if (!stopped) reader.setDocument(pdf);
      })
      .catch((e) => {
        if (!stopped) {
          setError(e.message);
          setBusy(false);
        }
      });
    let lastWidth = 0;
    const observer = new ResizeObserver(() => {
      if (!root.clientWidth) return; // A hidden phone panel must not resize the PDF to zero.
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (root.clientWidth !== lastWidth) {
          lastWidth = root.clientWidth;
          fit.current();
        }
        if (ready) {
          reader.currentPageNumber = current.current.page;
          reader.update();
        }
      });
    });
    observer.observe(root);
    const changed = () => {
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        const selected = window.getSelection();
        if (!selected?.rangeCount || selected.isCollapsed) return;
        const range = selected.getRangeAt(0);
        const textPage = (node: Node) => {
          const element =
            node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
          if (!element?.closest('.textLayer') || !content.contains(element)) return null;
          return element.closest<HTMLElement>('[data-page-number]');
        };
        const start = textPage(range.startContainer),
          end = textPage(range.endContainer);
        if (!start || !end) return;
        const firstPage = Number(start.dataset.pageNumber),
          lastPage = Number(end.dataset.pageNumber);
        const parts: string[] = [];
        // Read each text layer separately so a page break remains a text boundary.
        for (let p = firstPage; p <= lastPage; p++) {
          const layer = content.querySelector(`[data-page-number="${p}"] .textLayer`);
          if (!layer) continue;
          const part = document.createRange();
          part.selectNodeContents(layer);
          if (p === firstPage) part.setStart(range.startContainer, range.startOffset);
          if (p === lastPage) part.setEnd(range.endContainer, range.endOffset);
          parts.push(part.toString().trim());
        }
        const text = parts.join('\n\n').trim();
        if (text.length > 1)
          current.current.onSelection({
            text: text.slice(0, 18000),
            page: firstPage,
            endPage: lastPage,
          });
      }, 120);
    };
    document.addEventListener('selectionchange', changed);
    return () => {
      stopped = true;
      clearTimeout(selectionTimer);
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      document.removeEventListener('selectionchange', changed);
      // @ts-expect-error PDF.js supports null for teardown; its declaration omits it.
      reader.setDocument(null);
      abort.abort();
      viewer.current = null;
      fit.current = () => {};
      void task.destroy();
    };
  }, [paper.id]);
  useEffect(() => {
    const reader = viewer.current;
    if (reader?.pagesCount) reader.currentPageNumber = current.current.page;
  }, [pageJump]);
  useEffect(() => {
    fit.current();
  }, [zoom]);

  return (
    <section className="pdf-reader" aria-label="Paper reader">
      <div className="pdf-toolbar">
        <span className="muted toolbar-hint">
          <TextSelect size={15} /> Select across pages
        </span>
        <div className="page-controls">
          <button
            className="icon-button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onNavigate(page - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <label>
            <span className="sr-only">Page</span>
            <select
              aria-label="Page"
              value={page}
              onChange={(e) => onNavigate(Number(e.target.value))}
            >
              {Array.from({ length: paper.pages }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">/ {paper.pages}</span>
          <button
            className="icon-button"
            aria-label="Next page"
            disabled={page >= paper.pages}
            onClick={() => onNavigate(page + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="zoom-controls">
          <button
            className="icon-button"
            aria-label="Zoom out"
            disabled={zoom <= 0.75}
            onClick={() => setZoom((z) => z - 0.25)}
          >
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            aria-label="Zoom in"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => z + 0.25)}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      <div className="pdf-viewport">
        <div className="pdf-scroll" ref={container}>
          <div className="pdfViewer" ref={pages} />
        </div>
        {busy && !error && (
          <div className="pdf-loading" role="status">
            Opening paper…
          </div>
        )}
        {error && (
          <div className="error-banner pdf-error" role="alert">
            {error}
          </div>
        )}
      </div>
      {selection && (
        <div className="selection-bar">
          <span title={selection.text}>
            <TextSelect size={17} />
            <span>
              {pageLabel(selection.page, selection.endPage)} · {selection.text.slice(0, 70)}
              {selection.text.length > 70 ? '…' : ''}
            </span>
          </span>
          <button className="primary small" onClick={onExplain}>
            Explain selection
          </button>
          <button
            className="icon-button"
            aria-label="Clear selection"
            onClick={() => {
              onSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
