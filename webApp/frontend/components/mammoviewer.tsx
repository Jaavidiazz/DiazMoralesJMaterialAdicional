"use client";

import React, { useEffect, useRef, useState } from "react";

type MammoViewerProps = {
  baseSrc: string;
  heatmapSrc?: string;
  showHeatmap?: boolean;
  alt?: string;
};

type SizeState = {
  baseW: number;
  baseH: number;
};

export function MammoViewer({
  baseSrc,
  heatmapSrc,
  showHeatmap = false,
  alt = "Mamografía procesada",
}: MammoViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [sizes, setSizes] = useState<SizeState>({ baseW: 0, baseH: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [imgError, setImgError] = useState(false);

  const minScale = 1;
  const maxScale = 3; // zoom máximo

  // Medimos el tamaño real de la imagen a escala 1 (una sola vez al cargar)
  const measureSizes = () => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    if (rect.width && rect.height) {
      setSizes({ baseW: rect.width, baseH: rect.height });
    }
  };

  useEffect(() => {
    measureSizes();
    window.addEventListener("resize", measureSizes);
    return () => window.removeEventListener("resize", measureSizes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Limita el offset para que nunca se vea fuera de la imagen
  const clampOffset = (x: number, y: number, s: number) => {
    if (!sizes.baseW || !sizes.baseH || s <= 1) {
      // sin tamaños aún o zoom mínimo → sin desplazamiento
      return { x: 0, y: 0 };
    }

    const maxX = (sizes.baseW * (s - 1)) / 2;
    const maxY = (sizes.baseH * (s - 1)) / 2;

    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  // Zoom con rueda, centrado en el ratón
  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();

    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;

    const zoomFactor = 0.1;
    const prevScale = scale;
    let newScale = scale;

    if (e.deltaY < 0) {
      newScale = Math.min(maxScale, scale + zoomFactor);
    } else {
      newScale = Math.max(minScale, scale - zoomFactor);
    }

    if (newScale === prevScale) return;

    // Si volvemos al mínimo → centramos del todo
    if (newScale === minScale) {
      setScale(newScale);
      setOffset({ x: 0, y: 0 });
      return;
    }

    // Mantener el punto bajo el cursor
    const p = { x: cx, y: cy };
    const t = offset;
    const s1 = prevScale;
    const s2 = newScale;

    let newOffset = {
      x: p.x - (p.x - t.x) * (s2 / s1),
      y: p.y - (p.y - t.y) * (s2 / s1),
    };

    newOffset = clampOffset(newOffset.x, newOffset.y, s2);

    setScale(newScale);
    setOffset(newOffset);
  };

  // Pan con arrastre, respetando límites
  const handleMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    setIsPanning(true);
    setStart({
      x: e.clientX - offset.x,
      y: e.clientY - offset.y,
    });
  };

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isPanning) return;
    const rawX = e.clientX - start.x;
    const rawY = e.clientY - start.y;
    const clamped = clampOffset(rawX, rawY, scale);
    setOffset(clamped);
  };

  const handleMouseUpOrLeave = () => {
    setIsPanning(false);
  };

  const handleDoubleClick = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const transform = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: "center center",
    cursor: isPanning ? "grabbing" : scale > 1 ? "grab" : "default",
  } as const;

  if (imgError) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        No se pudo cargar la imagen del estudio.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative max-h-[500px] w-auto overflow-hidden bg-black rounded-xl"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      onDoubleClick={handleDoubleClick}
    >
      <div className="relative inline-block" style={transform}>
        {/* Imagen base, MISMAS clases que la original */}
        <img
          ref={imgRef}
          src={baseSrc}
          alt={alt}
          className="max-h-[500px] w-auto object-contain block select-none"
          draggable={false}
          onLoad={measureSizes}
          onError={() => setImgError(true)}
        />

        {/* Heatmap encima */}
        {showHeatmap && heatmapSrc && (
          <img
            src={heatmapSrc}
            alt="Mapa de calor Grad-CAM"
            className="absolute inset-0 max-h-[500px] w-auto object-contain pointer-events-none"
            style={{
              mixBlendMode: "screen",
              opacity: 0.9,
            }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
