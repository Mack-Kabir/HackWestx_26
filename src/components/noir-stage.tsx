"use client";

import { useEffect, useRef } from "react";

const CHAPTERS = [
  { code: "01", title: "The core" },
  { code: "02", title: "Your set" },
  { code: "03", title: "The replay" },
  { code: "04", title: "The proof" },
];

// Decorative 3D backdrop, chapter rail and transition titles. Three.js loads only
// in the browser; the CSS gradient on .stage remains if WebGL is unavailable.
export default function NoirStage() {
  const host = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const cutscene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false,
      dispose = () => {};
    import("./noir-scene")
      .then(({ createStage }) => {
        if (stopped || !host.current || !rail.current || !cutscene.current)
          return;
        dispose = createStage(
          host.current,
          rail.current,
          cutscene.current,
          CHAPTERS,
        );
      })
      .catch(() => {});
    return () => {
      stopped = true;
      dispose();
    };
  }, []);
  return (
    <>
      <div ref={host} className="stage" aria-hidden="true" />
      <div className="stage-veil" aria-hidden="true" />
      <div ref={rail} className="chapter-rail" aria-hidden="true">
        {CHAPTERS.map((chapter, i) => (
          <div
            key={chapter.code}
            className={"chapter-tick" + (i === 0 ? " is-active" : "")}
          >
            <span>{chapter.code}</span>
          </div>
        ))}
      </div>
      <div ref={cutscene} className="cutscene" aria-hidden="true">
        <span className="cutscene-code" />
        <strong className="cutscene-title" />
      </div>
    </>
  );
}
