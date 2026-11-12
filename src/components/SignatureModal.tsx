import React, { useEffect, useRef, useState } from 'react';
import { Check, Eraser, PenTool, Trash2, Type, Upload, X } from 'lucide-react';
import type { SavedSignature } from '../types/pdf';
import { bytesToDataUrl, pickFiles } from '../utils/fileBridge';

const SAVED_SIGS_KEY = 'jadepdf_saved_signatures_v1';

interface SignatureModalProps {
  onSelectSignature: (dataUrl: string) => void;
  onClose: () => void;
}

const SCRIPT_FONTS = [
  { label: 'Classic Script', css: '"Brush Script MT", "Segoe Script", cursive' },
  { label: 'Elegant Serif', css: 'Georgia, "Times New Roman", serif' },
  { label: 'Clean Hand', css: '"Segoe Print", "Comic Sans MS", cursive' },
  { label: 'Formal Mono', css: '"Courier New", monospace' },
];

export const SignatureModal: React.FC<SignatureModalProps> = ({
  onSelectSignature,
  onClose,
}) => {
  const [tab, setTab] = useState<'draw' | 'type' | 'upload' | 'saved'>('draw');
  const [inkColor, setInkColor] = useState('#0f172a');
  const [strokeSize, setStrokeSize] = useState(3);
  const [typedName, setTypedName] = useState('');
  const [selectedFontIdx, setSelectedFontIdx] = useState(0);
  const [savedList, setSavedList] = useState<SavedSignature[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_SIGS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const hasStrokesRef = useRef(false);

  const persistSaved = (next: SavedSignature[]) => {
    setSavedList(next);
    try {
      localStorage.setItem(SAVED_SIGS_KEY, JSON.stringify(next.slice(0, 12)));
    } catch {
      // Ignore quota
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokesRef.current = false;
  }, [tab]);

  const getPointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const pos = getPointerPos(e);
    isDrawingRef.current = true;
    hasStrokesRef.current = true;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = strokeSize * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const pos = getPointerPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const onPointerUp = () => {
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokesRef.current = false;
  };

  const trimTransparentCanvas = (srcCanvas: HTMLCanvasElement): string => {
    const ctx = srcCanvas.getContext('2d');
    if (!ctx) return srcCanvas.toDataURL('image/png');
    const { width, height } = srcCanvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return srcCanvas.toDataURL('image/png');

    const pad = 12;
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(width - sx, maxX - minX + pad * 2);
    const sh = Math.min(height - sy, maxY - minY + pad * 2);

    const out = document.createElement('canvas');
    out.width = Math.max(10, sw);
    out.height = Math.max(10, sh);
    const outCtx = out.getContext('2d')!;
    outCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return out.toDataURL('image/png');
  };

  const handleUseDrawn = () => {
    if (!canvasRef.current || !hasStrokesRef.current) return;
    const dataUrl = trimTransparentCanvas(canvasRef.current);
    const next: SavedSignature = {
      id: `sig-${Date.now()}`,
      label: 'Drawn Signature',
      dataUrl,
      createdAt: Date.now(),
    };
    persistSaved([next, ...savedList]);
    onSelectSignature(dataUrl);
  };

  const handleUseTyped = () => {
    if (!typedName.trim()) return;
    const c = document.createElement('canvas');
    c.width = 760;
    c.height = 220;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = inkColor;
    ctx.font = `italic 74px ${SCRIPT_FONTS[selectedFontIdx].css}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(typedName.trim(), c.width / 2, c.height / 2);

    const dataUrl = trimTransparentCanvas(c);
    const next: SavedSignature = {
      id: `sig-${Date.now()}`,
      label: typedName.trim(),
      dataUrl,
      createdAt: Date.now(),
    };
    persistSaved([next, ...savedList]);
    onSelectSignature(dataUrl);
  };

  const handleUploadImage = async () => {
    const files = await pickFiles({
      title: 'Select Signature Image',
      accept: 'image/png,image/jpeg,image/webp',
      filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (!files.length) return;
    const f = files[0];
    const ext = f.name.toLowerCase();
    const mime = ext.endsWith('.jpg') || ext.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    const dataUrl = await bytesToDataUrl(f.bytes, mime);
    const next: SavedSignature = {
      id: `sig-${Date.now()}`,
      label: f.name,
      dataUrl,
      createdAt: Date.now(),
    };
    persistSaved([next, ...savedList]);
    onSelectSignature(dataUrl);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PenTool size={18} style={{ color: 'var(--brand)' }} />
            <h3>Create or Pick Signature</h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="category-tabs" style={{ marginBottom: 14 }}>
            <button
              className={`cat-tab ${tab === 'draw' ? 'active' : ''}`}
              onClick={() => setTab('draw')}
            >
              <PenTool size={13} style={{ marginRight: 5 }} /> Draw
            </button>
            <button
              className={`cat-tab ${tab === 'type' ? 'active' : ''}`}
              onClick={() => setTab('type')}
            >
              <Type size={13} style={{ marginRight: 5 }} /> Type
            </button>
            <button
              className={`cat-tab ${tab === 'upload' ? 'active' : ''}`}
              onClick={() => setTab('upload')}
            >
              <Upload size={13} style={{ marginRight: 5 }} /> Upload Image
            </button>
            <button
              className={`cat-tab ${tab === 'saved' ? 'active' : ''}`}
              onClick={() => setTab('saved')}
            >
              Saved ({savedList.length})
            </button>
          </div>

          {(tab === 'draw' || tab === 'type') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                Ink Color:
              </span>
              {['#0f172a', '#1d4ed8', '#047857', '#b91c1c'].map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setInkColor(col)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: col,
                    border: inkColor === col ? '3px solid var(--brand)' : '2px solid var(--border)',
                    cursor: 'pointer',
                  }}
                />
              ))}
              {tab === 'draw' && (
                <>
                  <span style={{ marginLeft: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
                    Thickness:
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    value={strokeSize}
                    onChange={(e) => setStrokeSize(Number(e.target.value))}
                  />
                </>
              )}
            </div>
          )}

          {tab === 'draw' && (
            <div>
              <canvas
                ref={canvasRef}
                width={800}
                height={300}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                style={{
                  width: '100%',
                  height: 200,
                  background: '#ffffff',
                  border: '1.5px dashed var(--border-strong)',
                  borderRadius: 8,
                  cursor: 'crosshair',
                  touchAction: 'none',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                <button type="button" className="btn btn-sm" onClick={clearCanvas}>
                  <Eraser size={14} /> Clear Pad
                </button>
                <button type="button" className="btn btn-primary" onClick={handleUseDrawn}>
                  <Check size={15} /> Save & Place Signature
                </button>
              </div>
            </div>
          )}

          {tab === 'type' && (
            <div>
              <input
                type="text"
                className="input"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Type your full name..."
                style={{ marginBottom: 12 }}
              />
              <div className="option-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
                {SCRIPT_FONTS.map((sf, idx) => (
                  <button
                    key={sf.label}
                    type="button"
                    className={`option-card ${selectedFontIdx === idx ? 'selected' : ''}`}
                    onClick={() => setSelectedFontIdx(idx)}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      {sf.label}
                    </div>
                    <div
                      style={{
                        fontFamily: sf.css,
                        fontSize: 24,
                        fontStyle: 'italic',
                        color: inkColor,
                        minHeight: 32,
                      }}
                    >
                      {typedName || 'Jane Doe'}
                    </div>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!typedName.trim()}
                  onClick={handleUseTyped}
                >
                  <Check size={15} /> Save & Place Signature
                </button>
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div style={{ textAlign: 'center', padding: '26px 12px' }}>
              <p style={{ color: 'var(--text-muted)', marginBottom: 14 }}>
                Upload a transparent PNG or clean JPG signature scan from your computer.
              </p>
              <button type="button" className="btn btn-primary" onClick={handleUploadImage}>
                <Upload size={15} /> Choose Image File
              </button>
            </div>
          )}

          {tab === 'saved' && (
            <div>
              {savedList.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
                  No saved signatures yet. Draw or type a signature to save it here automatically.
                </p>
              ) : (
                <div className="option-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {savedList.map((sig) => (
                    <div
                      key={sig.id}
                      className="option-card"
                      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    >
                      <div
                        onClick={() => onSelectSignature(sig.dataUrl)}
                        style={{
                          height: 64,
                          background: '#ffffff',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          padding: 6,
                        }}
                      >
                        <img
                          src={sig.dataUrl}
                          alt={sig.label}
                          style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{sig.label}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => onSelectSignature(sig.dataUrl)}
                          >
                            Use
                          </button>
                          <button
                            className="icon-btn"
                            style={{ color: 'var(--danger)' }}
                            onClick={() =>
                              persistSaved(savedList.filter((item) => item.id !== sig.id))
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
