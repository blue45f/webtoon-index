import { ArrowDown, ArrowRight, Box, Brush, Check, Layers, LayoutGrid, MousePointer2, Play, Plus, Square, Type } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CREATOR_FILM_DOWNLOADS, CREATOR_FILM_UI, createCreatorFilmPlayback, creatorFilmChapterAt } from "./creator-film-playback";
import { CREATOR_FILM, HOME_COPY, creatorHomeLocale, type CreatorHomeCopy } from "./creator-home-content";
import { CreatorHomeNavigation, CreatorSectionLink } from "./CreatorHomeNavigation";
import { CreatorWorkflowPicker } from "./CreatorWorkflowPicker";
import "./creator-home.css";
import "./creator-film.css";

import { useI18n } from "@/shared/lib/i18n";
import Link from "@/src/compat/router-link";

const FEATURE_ICONS = [Brush, LayoutGrid, Box, Layers] as const;

function StudioPreview({ copy, stage }: { copy: CreatorHomeCopy; stage: number }) {
  return (
    <figure className={`ch-workspace ch-workspace--${copy.stages[stage].id}`} aria-label={copy.previewNote}>
      <div className="ch-windowbar"><span className="ch-windowdots" aria-hidden="true"><i /><i /><i /></span><span>{copy.preview}</span><span className="ch-window-status"><Check size={12} aria-hidden="true" /> ToonStudio</span></div>
      <div className="ch-editor">
        <div className="ch-tools" aria-hidden="true"><MousePointer2 size={17} /><span><Brush size={17} /></span><Square size={17} /><Type size={17} /><Layers size={17} /><Plus size={17} /></div>
        <div className="ch-canvas"><div className="ch-art-title"><span>CHAPTER 01</span><span>{copy.example}</span></div><img className="ch-scene" src="/brand/studio-scene.svg" alt="" width={720} height={560} fetchPriority="high" /><div className="ch-caption" aria-hidden="true">{stage === 1 ? "Every story starts with a little courage." : "MAKE SOMETHING ONLY YOU CAN MAKE."}</div></div>
        <div className="ch-inspector" aria-hidden="true"><span>{copy.layer}</span><div className="ch-swatches"><i /><i /><i /><i /></div><div className="ch-layer"><span />{copy.scene} 03</div><div className="ch-layer"><span />{copy.scene} 02</div><div className="ch-layer is-selected"><span />{copy.scene} 01</div><div className="ch-inspector-lines"><i /><i /><i /></div></div>
      </div>
      <figcaption className="ch-workspace-footer"><span>{copy.previewNote}</span><span>100%</span></figcaption>
    </figure>
  );
}

export function CreatorBrandFilm({ copy, locale }: { copy: CreatorHomeCopy; locale: "ko" | "en" }) {
  const [mode, setMode] = useState<"poster" | "playing" | "error">("poster");
  const [loading, setLoading] = useState(false);
  const [activeChapter, setActiveChapter] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const posterRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<ReturnType<typeof createCreatorFilmPlayback> | null>(null);
  const requestedStart = useRef(0);
  const focusPlayer = useRef(false);
  const restorePosterFocus = useRef(false);
  const ui = CREATOR_FILM_UI[locale];

  const failPlayback = useCallback(() => {
    // Recover focus only when a disappearing control owns it. An unrelated link or
    // chapter button must not lose focus because media failed in the background.
    restorePosterFocus.current = focusPlayer.current || document.activeElement === videoRef.current;
    focusPlayer.current = false;
    setLoading(false);
    setMode("error");
  }, []);

  useEffect(() => {
    if (mode !== "playing") {
      if (restorePosterFocus.current) {
        posterRef.current?.focus({ preventScroll: true });
        restorePosterFocus.current = false;
      }
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const controller = createCreatorFilmPlayback(video, { duration: CREATOR_FILM.duration, onFailure: failPlayback });
    controllerRef.current = controller;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") controller.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState !== "hidden") controller.seekAndPlay(requestedStart.current);
    if (focusPlayer.current) {
      video.focus({ preventScroll: true });
      focusPlayer.current = false;
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [mode, failPlayback]);

  const playAt = (seconds: number, moveFocus = false) => {
    requestedStart.current = seconds;
    focusPlayer.current = moveFocus;
    setActiveChapter(creatorFilmChapterAt(seconds, CREATOR_FILM.chapters));
    setLoading(!videoRef.current || videoRef.current.readyState < 3);
    if (mode === "playing") {
      controllerRef.current?.seekAndPlay(seconds);
      if (moveFocus) {
        videoRef.current?.focus({ preventScroll: true });
        focusPlayer.current = false;
      }
    } else {
      setMode("playing");
    }
  };
  const closeFilm = () => {
    controllerRef.current?.pause();
    restorePosterFocus.current = true;
    setLoading(false);
    setMode("poster");
  };

  return (
    <section className="ch-film-section" id="creator-film" aria-labelledby="creator-film-title">
      <div className="ch-film-heading"><p className="ch-eyebrow">{copy.filmEyebrow}</p><h2 id="creator-film-title" tabIndex={-1}>{copy.filmTitle}</h2><p>{copy.filmBody}</p></div>
      <div className="ch-film-frame" aria-busy={mode === "playing" && loading}>
        {mode === "playing" ? (
          <video
            id="creator-brand-video"
            ref={videoRef}
            src={CREATOR_FILM.src}
            controls
            muted
            playsInline
            tabIndex={0}
            preload="metadata"
            poster={CREATOR_FILM.poster}
            aria-label={copy.filmLabel}
            onCanPlay={() => setLoading(false)}
            onPlaying={() => setLoading(false)}
            onSeeked={() => setLoading(false)}
            onWaiting={() => setLoading(true)}
            onError={failPlayback}
            onTimeUpdate={(event) => setActiveChapter(creatorFilmChapterAt(event.currentTarget.currentTime, CREATOR_FILM.chapters))}
          >
            <track kind="captions" src={locale === "ko" ? CREATOR_FILM.captions : "/brand/toonstudio-intro.en.vtt"} srcLang={locale} label={locale === "ko" ? "한국어" : "English"} default />
          </video>
        ) : (
          <button ref={posterRef} type="button" className="ch-film-poster" onClick={() => playAt(0, true)} aria-label={copy.filmPlay} data-testid="creator-film-play">
            <img src={CREATOR_FILM.poster} width={1280} height={720} loading="lazy" alt="" />
            <span className="ch-play-disc"><Play size={27} fill="currentColor" aria-hidden="true" /></span>
            <span className="ch-film-caption">TOONSTUDIO BRAND FILM <span>00:24</span></span>
          </button>
        )}
      </div>
      {mode === "playing" && loading && <p className="ch-film-loading" role="status">{ui.loading}</p>}
      {mode === "error" && <p className="ch-film-error" role="alert">{copy.filmError} <button type="button" onClick={() => playAt(0, true)}>{copy.retry}</button></p>}
      <div className="ch-film-chapters" aria-label={copy.filmLabel}>
        {CREATOR_FILM.chapters.map((seconds, index) => (
          <button type="button" key={seconds} onClick={() => playAt(seconds)} aria-controls={mode === "playing" ? "creator-brand-video" : undefined} aria-current={mode === "playing" && activeChapter === index ? "step" : undefined}>
            <span>00:{String(seconds).padStart(2, "0")}</span>{copy.chapterLabels[index]}
          </button>
        ))}
      </div>
      <div className="ch-film-details"><details><summary>{copy.transcript}</summary><p>{copy.transcriptBody}</p></details>{mode === "playing" && <button type="button" onClick={closeFilm}>{copy.filmReset}</button>}</div>
      <details className="ch-film-downloads">
        <summary>{ui.downloads}</summary>
        <div className="ch-film-download-grid">
          {CREATOR_FILM_DOWNLOADS.map((film) => (
            <a key={film.id} href={film.src} download={film.src.split("/").pop()}>
              <span>{ui[film.id]} <ArrowDown size={16} aria-hidden="true" /></span>
              <small>{film.ratio} · {film.size}</small>
            </a>
          ))}
        </div>
        <p>{ui.downloadNote}</p>
      </details>
    </section>
  );
}

export function CreatorHomePage() {
  const language = useI18n((state) => state.lang);
  const locale = creatorHomeLocale(language);
  const copy = HOME_COPY[locale];
  const [stage, setStage] = useState(0);
  const selectedStage = copy.stages[stage];
  return (
    <div className="creator-home" lang={locale} data-creator-home="studio-first">
      <div className="ch-shell">
        <section className="ch-hero" aria-labelledby="creator-home-title">
          <div className="ch-hero-copy"><p className="ch-eyebrow"><span className="ch-live-dot" />{copy.eyebrow}</p><h1 id="creator-home-title">{copy.title[0]}<br /><span>{copy.title[1]}</span></h1><p className="ch-lead">{copy.description}</p><div className="ch-actions"><Link href="/studio" className="ch-button ch-button--primary">{copy.start}<ArrowRight size={19} aria-hidden="true" /></Link><CreatorSectionLink sectionId="creator-film" className="ch-button ch-button--quiet"><Play size={15} aria-hidden="true" />{copy.watch}</CreatorSectionLink></div><p className="ch-hero-note"><Check size={14} aria-hidden="true" />{copy.note}</p></div>
          <div className="ch-hero-visual"><span className="ch-visual-label" aria-hidden="true">A LITTLE IDEA. A WHOLE NEW WORLD.</span><StudioPreview copy={copy} stage={stage} /><CreatorWorkflowPicker copy={copy} stage={stage} onChange={setStage} /></div>
        </section>
        <CreatorHomeNavigation locale={locale} />
        <div className="ch-capabilities" aria-label={copy.tools}><span>ONE CREATIVE SPACE</span>{copy.strip.map((item) => <span key={item}><Check size={14} aria-hidden="true" />{item}</span>)}</div>
        <section className="ch-process" aria-labelledby="creator-process-title"><div><p className="ch-eyebrow">{copy.processEyebrow}</p><h2 id="creator-process-title" tabIndex={-1}>{copy.processTitle}</h2><p className="ch-section-body">{copy.processBody}</p><CreatorWorkflowPicker copy={copy} stage={stage} onChange={setStage} placement="process" /></div><div className="ch-stage-card" id="creator-stage-description" data-creator-stage={selectedStage.id} aria-live="polite"><span className="ch-stage-number" aria-hidden="true">0{stage + 1}</span><div><p className="ch-eyebrow">{selectedStage.label}</p><h3>{selectedStage.title}</h3><p>{selectedStage.body}</p><Link href={selectedStage.href} className="ch-text-link">{selectedStage.action}<ArrowRight size={17} aria-hidden="true" /></Link></div></div></section>
        <section className="ch-toolkit" aria-labelledby="creator-toolkit-title"><div className="ch-section-heading"><div><p className="ch-eyebrow">{copy.toolkitEyebrow}</p><h2 id="creator-toolkit-title" tabIndex={-1}>{copy.toolkitTitle}</h2></div><ArrowDown size={30} aria-hidden="true" /></div><div className="ch-feature-grid">{copy.features.map((feature, index) => { const Icon = FEATURE_ICONS[index]; return <article className="ch-feature" key={feature.tag}><div className="ch-feature-top"><Icon size={25} strokeWidth={1.5} aria-hidden="true" /><span>{feature.tag}</span></div><h3>{feature.title}</h3><p>{feature.body}</p><Link href={feature.href} className="ch-text-link">{feature.action}<ArrowRight size={17} aria-hidden="true" /></Link></article>; })}</div></section>
        <CreatorBrandFilm copy={copy} locale={locale} />
        <section className="ch-inspiration" aria-labelledby="creator-inspiration-title"><p className="ch-eyebrow">{copy.inspirationEyebrow}</p><h2 id="creator-inspiration-title">{copy.inspirationTitle}</h2><div className="ch-discovery-grid"><article><span className="ch-discovery-symbol" aria-hidden="true">✳</span><div><h3>{copy.galleryTitle}</h3><p>{copy.galleryBody}</p><Link href="/create" className="ch-text-link">{copy.galleryAction}<ArrowRight size={17} aria-hidden="true" /></Link></div></article><article><span className="ch-discovery-symbol" aria-hidden="true">↗</span><div><h3>{copy.exploreTitle}</h3><p>{copy.exploreBody}</p><div className="ch-discovery-links"><Link href="/explore" className="ch-text-link">{copy.exploreAction}<ArrowRight size={17} aria-hidden="true" /></Link><Link href="/ranking" className="ch-text-link">{copy.ranking}</Link></div></div></article></div></section>
        <section className="ch-faq" aria-labelledby="creator-faq-title"><h2 id="creator-faq-title" tabIndex={-1}>{copy.faqTitle}</h2><div>{copy.faqs.map((faq) => <details key={faq.q}><summary>{faq.q}</summary><p>{faq.a}</p></details>)}</div></section>
        <section className="ch-closing" aria-labelledby="creator-closing-title"><p className="ch-eyebrow">{copy.closingEyebrow}</p><h2 id="creator-closing-title">{copy.closingTitle}</h2><p>{copy.closingNote}</p><Link href="/studio" className="ch-button ch-button--lime">{copy.start}<ArrowRight size={19} aria-hidden="true" /></Link><span className="ch-closing-star" aria-hidden="true">✳</span></section>
      </div>
    </div>
  );
}
