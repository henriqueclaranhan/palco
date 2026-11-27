import { useEffect, useRef, useState } from 'react';
import type { PdfEngine } from '@/infrastructure/pdfEngine';

interface PdfStageProps {
  engine: PdfEngine;
  docId: string;
  pageNumber: number;
  totalPages: number;
  onNext: () => void;
  onPrev: () => void;
  swipeHandlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
}

export function PdfStage({
  engine,
  docId,
  pageNumber,
  totalPages,
  onNext,
  onPrev,
  swipeHandlers,
}: PdfStageProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => {
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (prev.width === w && prev.height === h) return prev;
        return { width: w, height: h };
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0 || !docId) return;

    void engine.renderPage(pageNumber, canvas, size);
  }, [engine, docId, pageNumber, size]);

  const canPrev = pageNumber > 1;
  const canNext = pageNumber < totalPages;

  return (
    <div
      className="stage-container"
      onTouchStart={swipeHandlers.onTouchStart}
      onTouchEnd={swipeHandlers.onTouchEnd}
    >
      <button
        type="button"
        className="stage-nav-zone stage-nav-zone-prev"
        aria-label="Página anterior"
        aria-disabled={!canPrev}
        onClick={() => {
          if (canPrev) onPrev();
        }}
      />

      <div className="stage-canvas-frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          className="pdf-canvas"
          role="img"
          aria-label={`Slide ${pageNumber} de ${totalPages}`}
        />
      </div>

      <button
        type="button"
        className="stage-nav-zone stage-nav-zone-next"
        aria-label="Próxima página"
        aria-disabled={!canNext}
        onClick={() => {
          if (canNext) onNext();
        }}
      />
    </div>
  );
}
