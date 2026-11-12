import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Link2, MessageSquare } from 'lucide-react';
import type {
  DetectedTextBlock,
  EditorAnnotation,
  EditorPageState,
  EditorToolMode,
  FontFamilyChoice,
  ShapeAnnotation,
} from '../../types/pdf';
import { normalizeAngle } from '../../utils/pdfCoords';
import {
  extractDetectedTextBlocks,
  renderPageToCanvas,
} from '../../utils/pdfRenderer';

export interface ActiveToolDefaults {
  fontFamily: FontFamilyChoice;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
  whiteoutColor: string;
  highlightColor: string;
}

interface EditorPageCanvasProps {
  pageState: EditorPageState;
  pageNumber: number;
  pdfDocs: Array<PDFDocumentProxy | null>;
  zoom: number;
  toolMode: EditorToolMode;
  defaults: ActiveToolDefaults;
  selectedAnnotationId: string | null;
  editingTextId: string | null;
  highlightMatchRects?: Array<{ x: number; y: number; width: number; height: number }>;
  onSelectPage: (index: number) => void;
  onSelectAnnotation: (id: string | null) => void;
  onStartEditText: (id: string | null) => void;
  onAddAnnotation: (pageIndex: number, ann: EditorAnnotation, autoSelect?: boolean, autoEdit?: boolean) => void;
  onUpdateAnnotation: (pageIndex: number, annId: string, patch: Partial<EditorAnnotation>, pushHistory?: boolean) => void;
  onRegisterPageRef: (pageIndex: number, el: HTMLDivElement | null) => void;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getFontCss(family: FontFamilyChoice): string {
  if (family === 'Times') return '"Times New Roman", Georgia, serif';
  if (family === 'Courier') return '"Courier New", Consolas, monospace';
  return '"Segoe UI", Arial, Helvetica, sans-serif';
}

export const EditorPageCanvas: React.FC<EditorPageCanvasProps> = ({
  pageState,
  pageNumber,
  pdfDocs,
  zoom,
  toolMode,
  defaults,
  selectedAnnotationId,
  editingTextId,
  highlightMatchRects = [],
  onSelectPage,
  onSelectAnnotation,
  onStartEditText,
  onAddAnnotation,
  onUpdateAnnotation,
  onRegisterPageRef,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [detectedBlocks, setDetectedBlocks] = useState<DetectedTextBlock[]>([]);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

  // Drag-create / freehand draft state
  const [draftShape, setDraftShape] = useState<{
    startX: number;
    startY: number;
    currX: number;
    currY: number;
  } | null>(null);
  const [draftFreehand, setDraftFreehand] = useState<Array<{ x: number; y: number }>>([]);

  const normRot = normalizeAngle(pageState.rotation);
  const swapped = normRot === 90 || normRot === 270;
  const visualW = swapped ? pageState.baseHeight : pageState.baseWidth;
  const visualH = swapped ? pageState.baseWidth : pageState.baseHeight;
  const stageW = Math.max(100, Math.round(visualW * zoom));
  const stageH = Math.max(100, Math.round(visualH * zoom));

  useEffect(() => {
    onRegisterPageRef(pageNumber - 1, stageRef.current);
    return () => onRegisterPageRef(pageNumber - 1, null);
  }, [pageNumber, onRegisterPageRef]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
        }
      },
      { rootMargin: '420px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const canvas = canvasRef.current;

    if (pageState.sourcePageIndex < 0 || pageState.sourceDocIndex < 0) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(stageW * dpr);
      canvas.height = Math.floor(stageH * dpr);
      canvas.style.width = `${stageW}px`;
      canvas.style.height = `${stageH}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, stageW, stageH);
      }
      setDetectedBlocks([]);
      return;
    }

    const pdfDoc = pdfDocs[pageState.sourceDocIndex];
    if (!pdfDoc) return;

    let cancelled = false;
    (async () => {
      try {
        const pdfPage = await pdfDoc.getPage(pageState.sourcePageIndex + 1);
        if (cancelled || !canvasRef.current) return;
        await renderPageToCanvas({
          page: pdfPage,
          canvas: canvasRef.current,
          scale: zoom,
          rotationDelta: pageState.rotation,
        });
        if (cancelled || !canvasRef.current) return;
        const blocks = await extractDetectedTextBlocks({
          page: pdfPage,
          canvas: canvasRef.current,
          scale: zoom,
          rotationDelta: pageState.rotation,
        });
        if (!cancelled) {
          setDetectedBlocks(blocks);
        }
      } catch {
        // Ignore cancellation errors when zoom changes quickly
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    visible,
    pdfDocs,
    pageState.sourceDocIndex,
    pageState.sourcePageIndex,
    pageState.rotation,
    zoom,
    stageW,
    stageH,
  ]);

  const toVisualPoint = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(visualW, (clientX - rect.left) / zoom)),
      y: Math.max(0, Math.min(visualH, (clientY - rect.top) / zoom)),
    };
  };

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    onSelectPage(pageNumber - 1);

    // Ignore clicks originating inside existing annotation elements
    if ((e.target as HTMLElement).closest('[data-annotation-item="true"]')) {
      return;
    }

    if (toolMode === 'select') {
      onSelectAnnotation(null);
      onStartEditText(null);
      return;
    }

    const pt = toVisualPoint(e.clientX, e.clientY);

    if (toolMode === 'text') {
      const id = makeId('txt');
      onAddAnnotation(
        pageNumber - 1,
        {
          id,
          kind: 'text',
          x: pt.x,
          y: Math.max(0, pt.y - defaults.fontSize * 0.5),
          width: 190,
          height: Math.max(26, defaults.fontSize * 1.6),
          text: '',
          fontFamily: defaults.fontFamily,
          fontSize: defaults.fontSize,
          bold: defaults.bold,
          italic: defaults.italic,
          color: defaults.textColor,
          align: 'left',
        },
        true,
        true,
      );
      return;
    }

    if (toolMode === 'note') {
      const id = makeId('note');
      onAddAnnotation(
        pageNumber - 1,
        {
          id,
          kind: 'note',
          x: pt.x,
          y: pt.y,
          width: 24,
          height: 24,
          text: 'Review note...',
          color: '#facc15',
        },
        true,
        true,
      );
      return;
    }

    if (toolMode === 'draw') {
      setDraftFreehand([pt]);
      const onMove = (ev: MouseEvent) => {
        const nextPt = toVisualPoint(ev.clientX, ev.clientY);
        setDraftFreehand((prev) => [...prev, nextPt]);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setDraftFreehand((currentPts) => {
          if (currentPts.length >= 2) {
            onAddAnnotation(
              pageNumber - 1,
              {
                id: makeId('draw'),
                kind: 'freehand',
                points: currentPts,
                color: defaults.strokeColor,
                strokeWidth: defaults.strokeWidth,
                opacity: defaults.opacity,
                isHighlighter: false,
              },
              false,
            );
          }
          return [];
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    if (
      toolMode === 'whiteout' ||
      toolMode === 'highlight' ||
      toolMode === 'rect' ||
      toolMode === 'ellipse' ||
      toolMode === 'line' ||
      toolMode === 'arrow' ||
      toolMode === 'link' ||
      toolMode === 'formText' ||
      toolMode === 'formCheckbox' ||
      toolMode === 'formDropdown'
    ) {
      setDraftShape({ startX: pt.x, startY: pt.y, currX: pt.x, currY: pt.y });
      const onMove = (ev: MouseEvent) => {
        const cur = toVisualPoint(ev.clientX, ev.clientY);
        setDraftShape((prev) => (prev ? { ...prev, currX: cur.x, currY: cur.y } : null));
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const end = toVisualPoint(ev.clientX, ev.clientY);
        setDraftShape(null);

        const rawW = Math.abs(end.x - pt.x);
        const rawH = Math.abs(end.y - pt.y);
        const minX = Math.min(pt.x, end.x);
        const minY = Math.min(pt.y, end.y);
        const isClickOnly = rawW < 8 && rawH < 8;

        if (toolMode === 'whiteout') {
          onAddAnnotation(pageNumber - 1, {
            id: makeId('wo'),
            kind: 'whiteout',
            x: minX,
            y: minY,
            width: isClickOnly ? 150 : rawW,
            height: isClickOnly ? 28 : rawH,
            color: defaults.whiteoutColor,
          });
        } else if (toolMode === 'highlight') {
          onAddAnnotation(pageNumber - 1, {
            id: makeId('hl'),
            kind: 'shape',
            shapeType: 'highlight',
            x: minX,
            y: minY,
            width: isClickOnly ? 160 : rawW,
            height: isClickOnly ? 18 : rawH,
            strokeColor: defaults.highlightColor,
            fillColor: defaults.highlightColor,
            strokeWidth: 0,
            opacity: 0.36,
          });
        } else if (toolMode === 'rect' || toolMode === 'ellipse') {
          onAddAnnotation(pageNumber - 1, {
            id: makeId('shp'),
            kind: 'shape',
            shapeType: toolMode,
            x: minX,
            y: minY,
            width: isClickOnly ? 120 : rawW,
            height: isClickOnly ? 70 : rawH,
            strokeColor: defaults.strokeColor,
            fillColor: defaults.fillColor,
            strokeWidth: defaults.strokeWidth,
            opacity: defaults.opacity,
          });
        } else if (toolMode === 'line' || toolMode === 'arrow') {
          const x2 = isClickOnly ? pt.x + 120 : end.x;
          const y2 = isClickOnly ? pt.y : end.y;
          onAddAnnotation(pageNumber - 1, {
            id: makeId('ln'),
            kind: 'shape',
            shapeType: toolMode,
            x: pt.x,
            y: pt.y,
            width: Math.abs(x2 - pt.x),
            height: Math.abs(y2 - pt.y),
            x2,
            y2,
            strokeColor: defaults.strokeColor,
            fillColor: 'transparent',
            strokeWidth: defaults.strokeWidth,
            opacity: defaults.opacity,
          });
        } else if (toolMode === 'link') {
          onAddAnnotation(pageNumber - 1, {
            id: makeId('lnk'),
            kind: 'link',
            x: minX,
            y: minY,
            width: isClickOnly ? 140 : rawW,
            height: isClickOnly ? 26 : rawH,
            linkType: 'url',
            url: 'https://example.com',
            targetPage: 1,
          });
        } else if (toolMode === 'formText') {
          onAddAnnotation(pageNumber - 1, {
            id: makeId('frm'),
            kind: 'form',
            fieldType: 'text',
            name: 'TextField',
            x: minX,
            y: minY,
            width: isClickOnly ? 170 : rawW,
            height: isClickOnly ? 26 : rawH,
            value: '',
            checked: false,
            options: [],
            fontSize: 12,
          });
        } else if (toolMode === 'formCheckbox') {
          onAddAnnotation(pageNumber - 1, {
            id: makeId('chk'),
            kind: 'form',
            fieldType: 'checkbox',
            name: 'CheckBox',
            x: pt.x,
            y: pt.y,
            width: isClickOnly ? 18 : Math.max(14, Math.min(rawW, rawH)),
            height: isClickOnly ? 18 : Math.max(14, Math.min(rawW, rawH)),
            value: '',
            checked: true,
            options: [],
            fontSize: 12,
          });
        } else if (toolMode === 'formDropdown') {
          onAddAnnotation(pageNumber - 1, {
            id: makeId('dd'),
            kind: 'form',
            fieldType: 'dropdown',
            name: 'Dropdown',
            x: minX,
            y: minY,
            width: isClickOnly ? 160 : rawW,
            height: isClickOnly ? 28 : rawH,
            value: 'Option 1',
            checked: false,
            options: ['Option 1', 'Option 2', 'Option 3'],
            fontSize: 12,
          });
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  };

  const handleClickExistingTextBlock = (e: React.MouseEvent, blk: DetectedTextBlock) => {
    e.stopPropagation();
    onSelectPage(pageNumber - 1);
    const id = makeId('txt');
    onAddAnnotation(
      pageNumber - 1,
      {
        id,
        kind: 'text',
        x: blk.x,
        y: blk.y,
        width: Math.max(blk.width + 24, 90),
        height: Math.max(blk.height + 6, 22),
        text: blk.text,
        fontFamily: blk.fontFamily,
        fontSize: blk.fontSize,
        bold: blk.bold,
        italic: blk.italic,
        color: blk.color,
        align: 'left',
        isReplacedExisting: true,
        coverRect: {
          x: blk.x,
          y: blk.y,
          width: blk.width,
          height: blk.height,
          color: blk.backgroundColor,
        },
      },
      true,
      true,
    );
  };

  const startDragAnnotation = (e: React.MouseEvent, ann: EditorAnnotation) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectPage(pageNumber - 1);
    onSelectAnnotation(ann.id);
    if (editingTextId === ann.id) return;

    const startMouse = { x: e.clientX, y: e.clientY };

    if (ann.kind === 'freehand') {
      const origPts = ann.points.map((p) => ({ ...p }));
      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startMouse.x) / zoom;
        const dy = (ev.clientY - startMouse.y) / zoom;
        onUpdateAnnotation(
          pageNumber - 1,
          ann.id,
          { points: origPts.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
          false,
        );
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const dx = (ev.clientX - startMouse.x) / zoom;
        const dy = (ev.clientY - startMouse.y) / zoom;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          onUpdateAnnotation(
            pageNumber - 1,
            ann.id,
            { points: origPts.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
            true,
          );
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    const origX = ann.x;
    const origY = ann.y;
    const origX2 = ann.kind === 'shape' ? ann.x2 : undefined;
    const origY2 = ann.kind === 'shape' ? ann.y2 : undefined;

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startMouse.x) / zoom;
      const dy = (ev.clientY - startMouse.y) / zoom;
      const patch: Partial<EditorAnnotation> = { x: origX + dx, y: origY + dy };
      if (ann.kind === 'shape' && origX2 !== undefined && origY2 !== undefined) {
        (patch as Partial<ShapeAnnotation>).x2 = origX2 + dx;
        (patch as Partial<ShapeAnnotation>).y2 = origY2 + dy;
      }
      onUpdateAnnotation(pageNumber - 1, ann.id, patch, false);
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const dx = (ev.clientX - startMouse.x) / zoom;
      const dy = (ev.clientY - startMouse.y) / zoom;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const patch: Partial<EditorAnnotation> = { x: origX + dx, y: origY + dy };
        if (ann.kind === 'shape' && origX2 !== undefined && origY2 !== undefined) {
          (patch as Partial<ShapeAnnotation>).x2 = origX2 + dx;
          (patch as Partial<ShapeAnnotation>).y2 = origY2 + dy;
        }
        onUpdateAnnotation(pageNumber - 1, ann.id, patch, true);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startResizeAnnotation = (
    e: React.MouseEvent,
    ann: Exclude<EditorAnnotation, { kind: 'freehand' }>,
  ) => {
    e.stopPropagation();
    const startMouse = { x: e.clientX, y: e.clientY };
    const origW = ann.width;
    const origH = ann.height;

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startMouse.x) / zoom;
      const dy = (ev.clientY - startMouse.y) / zoom;
      onUpdateAnnotation(
        pageNumber - 1,
        ann.id,
        {
          width: Math.max(16, origW + dx),
          height: Math.max(14, origH + dy),
        },
        false,
      );
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const dx = (ev.clientX - startMouse.x) / zoom;
      const dy = (ev.clientY - startMouse.y) / zoom;
      onUpdateAnnotation(
        pageNumber - 1,
        ann.id,
        {
          width: Math.max(16, origW + dx),
          height: Math.max(14, origH + dy),
        },
        true,
      );
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const cursorMap: Record<EditorToolMode, string> = {
    select: 'default',
    text: 'text',
    whiteout: 'crosshair',
    image: 'default',
    signature: 'default',
    link: 'crosshair',
    formText: 'crosshair',
    formCheckbox: 'crosshair',
    formDropdown: 'crosshair',
    highlight: 'crosshair',
    draw: 'crosshair',
    rect: 'crosshair',
    ellipse: 'crosshair',
    line: 'crosshair',
    arrow: 'crosshair',
    note: 'pointer',
  };

  return (
    <div
      ref={stageRef}
      className="pdf-page-stage"
      onMouseDown={handleStageMouseDown}
      style={{
        width: stageW,
        height: stageH,
        cursor: cursorMap[toolMode] || 'default',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', pointerEvents: 'none' }} />

      {/* Search match highlights */}
      {highlightMatchRects.map((m, idx) => (
        <div
          key={`match-${idx}`}
          style={{
            position: 'absolute',
            left: m.x * zoom,
            top: m.y * zoom,
            width: m.width * zoom,
            height: m.height * zoom,
            background: 'rgba(250, 204, 21, 0.42)',
            border: '1.5px solid #eab308',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Existing PDF text hover hitboxes when in Text edit mode */}
      {toolMode === 'text' &&
        detectedBlocks.map((blk) => {
          const hovered = hoveredBlockId === blk.id;
          return (
            <div
              key={blk.id}
              data-annotation-item="true"
              onMouseEnter={() => setHoveredBlockId(blk.id)}
              onMouseLeave={() => setHoveredBlockId(null)}
              onClick={(e) => handleClickExistingTextBlock(e, blk)}
              title="Click to edit existing PDF text"
              style={{
                position: 'absolute',
                left: (blk.x - 2) * zoom,
                top: (blk.y - 1) * zoom,
                width: (blk.width + 4) * zoom,
                height: (blk.height + 2) * zoom,
                border: hovered ? '1.5px dashed #0ea96b' : '1px dashed rgba(14, 169, 107, 0.25)',
                background: hovered ? 'rgba(14, 169, 107, 0.08)' : 'transparent',
                borderRadius: 3,
                cursor: 'text',
                zIndex: 5,
              }}
            />
          );
        })}

      {/* Annotations overlay */}
      <svg
        width={stageW}
        height={stageH}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <defs>
          <marker
            id={`arrow-${pageNumber}`}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L7,3 z" fill="context-stroke" />
          </marker>
        </defs>

        {pageState.annotations.map((ann) => {
          if (ann.kind === 'freehand') {
            const ptsStr = ann.points.map((p) => `${p.x * zoom},${p.y * zoom}`).join(' ');
            return (
              <polyline
                key={ann.id}
                data-annotation-item="true"
                points={ptsStr}
                fill="none"
                stroke={ann.color}
                strokeWidth={ann.strokeWidth * zoom}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={ann.opacity}
                style={{ pointerEvents: 'stroke', cursor: 'move' }}
                onMouseDown={(e) => startDragAnnotation(e, ann)}
              />
            );
          }

          if (ann.kind === 'shape' && (ann.shapeType === 'line' || ann.shapeType === 'arrow')) {
            const x1 = ann.x * zoom;
            const y1 = ann.y * zoom;
            const x2 = (ann.x2 ?? ann.x + ann.width) * zoom;
            const y2 = (ann.y2 ?? ann.y + ann.height) * zoom;
            return (
              <line
                key={ann.id}
                data-annotation-item="true"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={ann.strokeColor}
                strokeWidth={ann.strokeWidth * zoom}
                strokeLinecap="round"
                opacity={ann.opacity}
                markerEnd={ann.shapeType === 'arrow' ? `url(#arrow-${pageNumber})` : undefined}
                style={{ pointerEvents: 'stroke', cursor: 'move' }}
                onMouseDown={(e) => startDragAnnotation(e, ann)}
              />
            );
          }
          return null;
        })}

        {/* Draft freehand stroke */}
        {draftFreehand.length > 1 && (
          <polyline
            points={draftFreehand.map((p) => `${p.x * zoom},${p.y * zoom}`).join(' ')}
            fill="none"
            stroke={defaults.strokeColor}
            strokeWidth={defaults.strokeWidth * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={defaults.opacity}
          />
        )}
      </svg>

      {/* Box-based annotations */}
      {pageState.annotations.map((ann) => {
        const isSelected = selectedAnnotationId === ann.id;

        if (ann.kind === 'freehand') return null;
        if (ann.kind === 'shape' && (ann.shapeType === 'line' || ann.shapeType === 'arrow')) {
          return null;
        }

        if (ann.kind === 'whiteout') {
          return (
            <div
              key={ann.id}
              data-annotation-item="true"
              onMouseDown={(e) => startDragAnnotation(e, ann)}
              style={{
                position: 'absolute',
                left: ann.x * zoom,
                top: ann.y * zoom,
                width: ann.width * zoom,
                height: ann.height * zoom,
                background: ann.color || '#ffffff',
                border: isSelected ? '2px solid #0ea96b' : '1px dashed rgba(148,163,184,0.6)',
                cursor: 'move',
                zIndex: 12,
              }}
            >
              {isSelected && (
                <div
                  onMouseDown={(e) => startResizeAnnotation(e, ann)}
                  style={resizeHandleStyle}
                />
              )}
            </div>
          );
        }

        if (ann.kind === 'text') {
          const isEditing = editingTextId === ann.id;
          return (
            <React.Fragment key={ann.id}>
              {ann.coverRect && (
                <div
                  style={{
                    position: 'absolute',
                    left: (ann.coverRect.x - 1) * zoom,
                    top: (ann.coverRect.y - 1) * zoom,
                    width: (ann.coverRect.width + 2) * zoom,
                    height: (ann.coverRect.height + 2) * zoom,
                    background: ann.coverRect.color || '#ffffff',
                    pointerEvents: 'none',
                    zIndex: 11,
                  }}
                />
              )}
              <div
                data-annotation-item="true"
                onMouseDown={(e) => startDragAnnotation(e, ann)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelectAnnotation(ann.id);
                  onStartEditText(ann.id);
                }}
                style={{
                  position: 'absolute',
                  left: ann.x * zoom,
                  top: ann.y * zoom,
                  width: ann.width * zoom,
                  minHeight: ann.height * zoom,
                  border: isSelected || isEditing ? '1.5px solid #0ea96b' : '1px solid transparent',
                  borderRadius: 3,
                  cursor: isEditing ? 'text' : 'move',
                  zIndex: 15,
                  padding: `${2 * zoom}px`,
                }}
              >
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={ann.text}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onUpdateAnnotation(
                        pageNumber - 1,
                        ann.id,
                        { text: e.target.value },
                        false,
                      )
                    }
                    onBlur={() => onStartEditText(null)}
                    placeholder="Type text..."
                    style={{
                      width: '100%',
                      minHeight: Math.max(22, ann.height * zoom),
                      border: 'none',
                      outline: 'none',
                      background: 'rgba(255,255,255,0.72)',
                      resize: 'none',
                      overflow: 'hidden',
                      padding: 0,
                      margin: 0,
                      fontFamily: getFontCss(ann.fontFamily),
                      fontSize: ann.fontSize * zoom,
                      fontWeight: ann.bold ? 700 : 400,
                      fontStyle: ann.italic ? 'italic' : 'normal',
                      color: ann.color,
                      textAlign: ann.align,
                      lineHeight: 1.25,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      fontFamily: getFontCss(ann.fontFamily),
                      fontSize: ann.fontSize * zoom,
                      fontWeight: ann.bold ? 700 : 400,
                      fontStyle: ann.italic ? 'italic' : 'normal',
                      color: ann.color,
                      textAlign: ann.align,
                      lineHeight: 1.25,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {ann.text || (
                      <span style={{ color: '#94a3b8', fontSize: 12 * zoom }}>
                        Double-click to type
                      </span>
                    )}
                  </div>
                )}

                {isSelected && !isEditing && (
                  <div
                    onMouseDown={(e) => startResizeAnnotation(e, ann)}
                    style={resizeHandleStyle}
                  />
                )}
              </div>
            </React.Fragment>
          );
        }

        if (ann.kind === 'image' || ann.kind === 'signature') {
          return (
            <div
              key={ann.id}
              data-annotation-item="true"
              onMouseDown={(e) => startDragAnnotation(e, ann)}
              style={{
                position: 'absolute',
                left: ann.x * zoom,
                top: ann.y * zoom,
                width: ann.width * zoom,
                height: ann.height * zoom,
                border: isSelected ? '2px solid #0ea96b' : '1px solid transparent',
                cursor: 'move',
                zIndex: 14,
              }}
            >
              <img
                src={ann.dataUrl}
                alt=""
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  opacity: ann.opacity ?? 1,
                  pointerEvents: 'none',
                }}
              />
              {isSelected && (
                <div
                  onMouseDown={(e) => startResizeAnnotation(e, ann)}
                  style={resizeHandleStyle}
                />
              )}
            </div>
          );
        }

        if (ann.kind === 'shape') {
          const isHighlight = ann.shapeType === 'highlight';
          return (
            <div
              key={ann.id}
              data-annotation-item="true"
              onMouseDown={(e) => startDragAnnotation(e, ann)}
              style={{
                position: 'absolute',
                left: ann.x * zoom,
                top: ann.y * zoom,
                width: ann.width * zoom,
                height: ann.height * zoom,
                borderRadius: ann.shapeType === 'ellipse' ? '50%' : 2,
                background:
                  ann.fillColor && ann.fillColor !== 'transparent'
                    ? ann.fillColor
                    : 'transparent',
                border: isHighlight
                  ? isSelected
                    ? '1.5px solid #0ea96b'
                    : 'none'
                  : `${Math.max(1, ann.strokeWidth * zoom)}px solid ${ann.strokeColor}`,
                opacity: ann.opacity,
                cursor: 'move',
                zIndex: 12,
                boxShadow: isSelected ? '0 0 0 2px rgba(14, 169, 107, 0.5)' : undefined,
              }}
            >
              {isSelected && (
                <div
                  onMouseDown={(e) => startResizeAnnotation(e, ann)}
                  style={resizeHandleStyle}
                />
              )}
            </div>
          );
        }

        if (ann.kind === 'link') {
          return (
            <div
              key={ann.id}
              data-annotation-item="true"
              onMouseDown={(e) => startDragAnnotation(e, ann)}
              title={ann.linkType === 'url' ? ann.url : `Go to Page ${ann.targetPage}`}
              style={{
                position: 'absolute',
                left: ann.x * zoom,
                top: ann.y * zoom,
                width: ann.width * zoom,
                height: ann.height * zoom,
                background: 'rgba(37, 99, 235, 0.14)',
                border: isSelected ? '2px solid #2563eb' : '1.5px dashed #2563eb',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '0 6px',
                fontSize: 11 * zoom,
                color: '#1d4ed8',
                fontWeight: 600,
                cursor: 'move',
                overflow: 'hidden',
                zIndex: 14,
              }}
            >
              <Link2 size={Math.max(11, 12 * zoom)} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ann.linkType === 'url' ? ann.url : `Page ${ann.targetPage}`}
              </span>
              {isSelected && (
                <div
                  onMouseDown={(e) => startResizeAnnotation(e, ann)}
                  style={resizeHandleStyle}
                />
              )}
            </div>
          );
        }

        if (ann.kind === 'form') {
          return (
            <div
              key={ann.id}
              data-annotation-item="true"
              onMouseDown={(e) => startDragAnnotation(e, ann)}
              style={{
                position: 'absolute',
                left: ann.x * zoom,
                top: ann.y * zoom,
                width: ann.width * zoom,
                height: ann.height * zoom,
                background: 'rgba(239, 246, 255, 0.9)',
                border: isSelected ? '2px solid #0ea96b' : '1px solid #64748b',
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: ann.fieldType === 'checkbox' ? 'center' : 'flex-start',
                padding: ann.fieldType === 'checkbox' ? 0 : '0 6px',
                fontSize: (ann.fontSize || 12) * zoom,
                color: '#0f172a',
                cursor: 'move',
                zIndex: 14,
              }}
            >
              {ann.fieldType === 'checkbox' ? (
                <span style={{ fontWeight: 700, fontSize: ann.height * 0.72 * zoom }}>
                  {ann.checked ? '✓' : ''}
                </span>
              ) : ann.fieldType === 'dropdown' ? (
                <span style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{ann.value || ann.options[0] || 'Select...'}</span>
                  <span>▾</span>
                </span>
              ) : (
                <span style={{ color: ann.value ? '#0f172a' : '#64748b' }}>
                  {ann.value || `[${ann.name}]`}
                </span>
              )}
              {isSelected && (
                <div
                  onMouseDown={(e) => startResizeAnnotation(e, ann)}
                  style={resizeHandleStyle}
                />
              )}
            </div>
          );
        }

        if (ann.kind === 'note') {
          return (
            <div
              key={ann.id}
              data-annotation-item="true"
              onMouseDown={(e) => startDragAnnotation(e, ann)}
              title={ann.text}
              style={{
                position: 'absolute',
                left: ann.x * zoom,
                top: ann.y * zoom,
                width: 26 * zoom,
                height: 26 * zoom,
                borderRadius: 6,
                background: ann.color || '#facc15',
                border: isSelected ? '2px solid #0ea96b' : '1px solid #ca8a04',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#422006',
                boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                cursor: 'move',
                zIndex: 16,
              }}
            >
              <MessageSquare size={14 * zoom} />
            </div>
          );
        }

        return null;
      })}

      {/* Draft shape preview */}
      {draftShape && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(draftShape.startX, draftShape.currX) * zoom,
            top: Math.min(draftShape.startY, draftShape.currY) * zoom,
            width: Math.max(2, Math.abs(draftShape.currX - draftShape.startX) * zoom),
            height: Math.max(2, Math.abs(draftShape.currY - draftShape.startY) * zoom),
            border: '1.5px dashed #0ea96b',
            background:
              toolMode === 'highlight'
                ? 'rgba(250, 204, 21, 0.35)'
                : toolMode === 'whiteout'
                  ? 'rgba(255,255,255,0.85)'
                  : 'rgba(14, 169, 107, 0.08)',
            borderRadius: toolMode === 'ellipse' ? '50%' : 2,
            pointerEvents: 'none',
            zIndex: 20,
          }}
        />
      )}

      {/* Subtle page number watermark tag on bottom-right corner outside page */}
      <div
        style={{
          position: 'absolute',
          right: 8,
          bottom: -20,
          fontSize: 11,
          color: 'var(--text-muted)',
          fontWeight: 600,
          pointerEvents: 'none',
        }}
      >
        Page {pageNumber}
      </div>
    </div>
  );
};

const resizeHandleStyle: React.CSSProperties = {
  position: 'absolute',
  right: -5,
  bottom: -5,
  width: 11,
  height: 11,
  borderRadius: 2,
  background: '#0ea96b',
  border: '2px solid #ffffff',
  cursor: 'nwse-resize',
  boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
};
