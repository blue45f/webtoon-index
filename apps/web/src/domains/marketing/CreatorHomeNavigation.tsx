import { type ReactNode, useEffect } from "react";

import { CREATOR_HOME_SECTIONS, bindCreatorSectionNavigation, focusCreatorSection, isPlainCreatorJump } from "./creator-home-navigation";
import "./creator-home-navigation.css";

export function CreatorSectionLink({ sectionId, className, children }: {
  sectionId: (typeof CREATOR_HOME_SECTIONS)[number]["id"];
  className?: string;
  children: ReactNode;
}) {
  const href = `#${sectionId}`;
  return (
    <a href={href} className={className} onClick={(event) => {
      if (!isPlainCreatorJump(event) || window.location.hash !== href) return;
      // An identical fragment does not emit hashchange. Handle only that case;
      // leave all changed URLs and modifier clicks to the browser's history.
      if (focusCreatorSection(href, (id) => document.getElementById(id), true)) event.preventDefault();
    }}>
      {children}
    </a>
  );
}

export function CreatorHomeNavigation({ locale }: { locale: "ko" | "en" }) {
  useEffect(() => bindCreatorSectionNavigation({
    getHash: () => window.location.hash,
    findTarget: (id) => document.getElementById(id),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    subscribe: (callback) => {
      window.addEventListener("hashchange", callback);
      return () => window.removeEventListener("hashchange", callback);
    },
  }), []);

  const label = locale === "ko" ? "툰스튜디오 소개 바로가기" : "Explore the ToonStudio introduction";
  return (
    <nav className="ch-jump-nav" aria-label={label}>
      <span className="ch-jump-label">{locale === "ko" ? "어떤 창작을 시작해 볼까요?" : "Find your way to create."}</span>
      <div className="ch-jump-links">
        {CREATOR_HOME_SECTIONS.map((section) => (
          <CreatorSectionLink key={section.id} sectionId={section.id}>
            {section[locale]}<span aria-hidden="true">↘</span>
          </CreatorSectionLink>
        ))}
      </div>
    </nav>
  );
}
