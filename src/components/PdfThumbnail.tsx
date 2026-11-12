import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface PdfThumbnailProps {
  pdfDoc: PDFDocumentProxy | null;
  pageNumber: number; // 1-based; < 1 means blank page placeholder
  rotationDelta?: number;
  width?: number;
  maxHeight?: number;
}

export const PdfThumbnail: React.FC<PdfThumbnailProps> = ({
  pdfDoc,
  pageNumber,
  rotationDelta = 0,
  width = 140,
  maxHeight = 180,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
        }
      },
      { rootMargin: '180px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdfDoc || pageNumber < 1) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const effectiveRot = ((page.rotate + rotationDelta) % 360 + 360) % 360;
        const vp1 = page.getViewport({ scale: 1, rotation: effectiveRot });
        const scale = Math.min(width / vp1.width, maxHeight / vp1.height);
        const vp = page.getViewport({ scale, rotation: effectiveRot });

        const canvas = canvasRef.current;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(vp.width * dpr));
        canvas.height = Math.max(1, Math.floor(vp.height * dpr));
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, vp.width, vp.height);

        renderTask = page.render({ canvasContext: ctx, viewport: vp });
        await renderTask.promise;
      } catch {
        // Ignore cancellation errors on fast scroll
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Ignore
      }
    };
  }, [visible, pdfDoc, pageNumber, rotationDelta, width, maxHeight]);

  if (pageNumber < 1) {
    return (
      <div
        ref={containerRef}
        style={{
          width: width * 0.72,
          height: width,
          background: '#ffffff',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: '#94a3b8',
        }}
      >
        Blank Page
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 80,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          background: '#ffffff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        }}
      />
    </div>
  );
};
