"use client";

import { useEffect, useRef, useState } from "react";

export type LightboxState = {
  images: string[];
  index: number;
  title: string;
};

const SWIPE_MIN = 48;

export default function Lightbox({
  state,
  onClose,
}: {
  state: LightboxState;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(state.index);
  // Direction of the last step, so the next picture slides in from that side.
  const [dir, setDir] = useState<"next" | "prev" | "open">("open");
  const n = state.images.length;
  const imgRef = useRef<HTMLImageElement>(null);
  const swipe = useRef<{ id: number; x0: number; y0: number; dx: number; active: boolean } | null>(null);
  // A swipe ends with a click on the backdrop — swallow it instead of closing.
  const swallowClick = useRef(false);

  // Reset when a different image set is opened.
  useEffect(() => {
    setIndex(state.index);
    setDir("open");
  }, [state.images, state.index]);

  const go = (step: 1 | -1) => {
    if (n < 2) return;
    setDir(step > 0 ? "next" : "prev");
    setIndex((i) => (i + step + n) % n);
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goRef.current(-1);
      if (e.key === "ArrowRight") goRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasMany = n > 1;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return; // desktop uses arrows / keys
    swipe.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, active: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = swipe.current;
    const img = imgRef.current;
    if (!s || !img || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.active) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      s.active = true;
      img.style.transition = "none";
    }
    // A single picture only wobbles; a set follows the finger.
    s.dx = hasMany ? dx : dx * 0.25;
    img.style.transform = `translateX(${s.dx}px) rotate(${s.dx / 60}deg)`;
  };
  const onPointerEnd = () => {
    const s = swipe.current;
    const img = imgRef.current;
    swipe.current = null;
    if (!s || !img || !s.active) return;
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 60);
    img.style.transition = "transform .45s var(--ease-spring-soft)";
    img.style.transform = "";
    if (hasMany && Math.abs(s.dx) > SWIPE_MIN) go(s.dx < 0 ? 1 : -1);
  };

  return (
    <div
      className="jkk-lightbox"
      onClick={() => {
        if (swallowClick.current) return;
        onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,.93)",
        display: "flex",
        flexDirection: "column",
        touchAction: "pan-y",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
          color: "#fff",
          flex: "none",
        }}
      >
        <div
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {state.title}
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)", fontVariantNumeric: "tabular-nums" }}>
          {index + 1} / {n}
        </div>
        <button
          onClick={onClose}
          aria-label="Tutup"
          style={{
            border: "none",
            background: "rgba(255,255,255,.15)",
            color: "#fff",
            width: 44,
            height: 44,
            borderRadius: "50%",
            fontSize: 18,
            cursor: "pointer",
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          ✕
        </button>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "0 12px",
          minHeight: 0,
        }}
      >
        {hasMany && (
          <button
            onClick={(e) => {
              stop(e);
              go(-1);
            }}
            aria-label="Gambar sebelumnya"
            style={arrowStyle}
          >
            ‹
          </button>
        )}
        {/* The <img> hugs its rendered size, so the surrounding letterbox belongs
            to the overlay — tapping anywhere outside the picture (or on it)
            closes. Only the nav controls stop propagation. Keyed on the index
            so every step plays its slide-in. */}
        <img
          key={index}
          ref={imgRef}
          src={state.images[index]}
          alt={state.title}
          draggable={false}
          className={`jkk-lightbox-img jkk-lb-${dir}`}
          style={{
            maxWidth: hasMany ? "calc(100vw - 130px)" : "94vw",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(0,0,0,.5)",
            userSelect: "none",
          }}
        />
        {hasMany && (
          <button
            onClick={(e) => {
              stop(e);
              go(1);
            }}
            aria-label="Gambar berikutnya"
            style={arrowStyle}
          >
            ›
          </button>
        )}
      </div>
      {hasMany && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: 16,
            justifyContent: "center",
            flexWrap: "wrap",
            flex: "none",
          }}
        >
          {state.images.map((url, i) => (
            <button
              key={i}
              onClick={(e) => {
                stop(e);
                if (i === index) return;
                setDir(i > index ? "next" : "prev");
                setIndex(i);
              }}
              style={{
                width: 52,
                height: 52,
                borderRadius: 8,
                border: `2px solid ${i === index ? "#fff" : "transparent"}`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                cursor: "pointer",
                opacity: i === index ? 1 : 0.55,
                transform: i === index ? "scale(1.06)" : "none",
                transition: "opacity .25s ease, transform .35s var(--ease-spring), border-color .25s ease",
                backgroundImage: `url('${url}')`,
              }}
            />
          ))}
        </div>
      )}
      {!hasMany && (
        <div
          style={{
            padding: "12px 16px 18px",
            textAlign: "center",
            fontSize: 12.5,
            color: "rgba(255,255,255,.5)",
            flex: "none",
          }}
        >
          Ketuk di luar gambar untuk menutup
        </div>
      )}
      {hasMany && (
        <div
          className="jkk-touch-only"
          style={{
            padding: "0 16px 14px",
            textAlign: "center",
            fontSize: 12,
            color: "rgba(255,255,255,.42)",
            flex: "none",
          }}
        >
          Geser untuk berpindah gambar
        </div>
      )}
    </div>
  );
}

const arrowStyle: React.CSSProperties = {
  border: "none",
  background: "rgba(255,255,255,.15)",
  color: "#fff",
  width: 44,
  height: 44,
  borderRadius: "50%",
  fontSize: 22,
  cursor: "pointer",
  flex: "none",
};
