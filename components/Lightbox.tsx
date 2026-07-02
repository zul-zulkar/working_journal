"use client";

import { useEffect, useState } from "react";

export type LightboxState = {
  images: string[];
  index: number;
  title: string;
};

export default function Lightbox({
  state,
  onClose,
}: {
  state: LightboxState;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(state.index);
  const n = state.images.length;

  // Reset when a different image set is opened.
  useEffect(() => setIndex(state.index), [state.images, state.index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + n) % n);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, onClose]);

  const hasMany = n > 1;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,.93)",
        display: "flex",
        flexDirection: "column",
        animation: "jkk-fade .2s ease",
        touchAction: "manipulation",
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
        <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)" }}>
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
              setIndex((i) => (i - 1 + n) % n);
            }}
            style={arrowStyle}
          >
            ‹
          </button>
        )}
        {/* The <img> hugs its rendered size, so the surrounding letterbox belongs
            to the overlay — tapping anywhere outside the picture (or on it)
            closes. Only the nav controls below stop propagation. */}
        <img
          src={state.images[index]}
          alt={state.title}
          style={{
            maxWidth: hasMany ? "calc(100vw - 130px)" : "94vw",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(0,0,0,.5)",
          }}
        />
        {hasMany && (
          <button
            onClick={(e) => {
              stop(e);
              setIndex((i) => (i + 1) % n);
            }}
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
