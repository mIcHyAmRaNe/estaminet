import { useState, useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import type { Tavern } from "../../lib/types";
import { t } from "../../lib/i18n";
import { ChevronLeft, ChevronRight, Filter, CheckboxChecked, CheckboxUnchecked } from "../../lib/utils/icons";
import { normalizeText } from "../../lib/utils/text-utils";

// Night tavern interior: shared visual for the cards
// (taverns have no image of their own).
const TAVERN_CARD_IMAGE = "/assets/tavern-night.jpg";

// Displayed city vs filter value: "Montpellier (Comté de Languedoc)"
// → city "Montpellier", county "Languedoc". The filter keeps the full
// value (tav.ville); only the display is cleaned up.
// No separate county field on the backend (types.ts: Tavern.ville,
// taverne.rs: ville = city.name) — everything comes from the parenthesis.
function splitVille(ville: string): { city: string; countyRaw: string } {
  const m = ville.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { city: ville.trim(), countyRaw: "" };
  return { city: (m[1] ?? "").trim() || ville.trim(), countyRaw: (m[2] ?? "").trim() };
}

// "Comté de Languedoc" / "Comté du Languedoc" → "Languedoc",
// "Comté de Provence" → "Provence", "Comté Lyonnais" → "Lyonnais".
// Grouping on the short form merges the variants ("de" vs "du").
function shortCounty(raw: string): string {
  const rawTrimmed = raw.trim();
  if (!rawTrimmed) return t("tavern.otherCounty");
  const m = rawTrimmed.match(/^comt[ée]\s+(?:de\s+|du\s+|des\s+|d'|de\s+l'|l')?(.+)$/i);
  const short = (m?.[1] ?? rawTrimmed).trim();
  return short || rawTrimmed;
}

function countyOf(ville: string): string {
  return shortCounty(splitVille(ville).countyRaw);
}

function displayCity(ville: string): string {
  return splitVille(ville).city;
}

type Props = {
  taverns: Tavern[];
  selectedId: number;
  onSelect: (id: number) => void;
};

export default function TavernCarousel({ taverns, selectedId, onSelect }: Props) {
  // Town multi-select filter: empty set = all towns.
  const [cityFilter, setCityFilter] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [centerIndex, setCenterIndex] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");

  // Anti-spam lock held by ref: re-armable and cleared on unmount.
  const unlockTimer = useRef<number | null>(null);
  const lockBriefly = useCallback(() => {
    setAnimating(true);
    if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current);
    unlockTimer.current = window.setTimeout(() => {
      unlockTimer.current = null;
      setAnimating(false);
    }, 500); // match .tavern-card transition duration (0.5s)
  }, []);

  useEffect(
    () => () => {
      if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current);
    },
    []
  );

  const villes = useMemo(
    () => [...new Set(taverns.map((tav) => tav.ville))].sort((a, b) => a.localeCompare(b, "fr")),
    [taverns]
  );

  // County groups → full town lists sorted (counties then towns, fr).
  // The inner search filters towns (displayed name + county, normalizeText
  // case/accent-insensitive); a county header only renders if ≥1 town
  // is visible in its group.
  const groupedVisibleCities = useMemo(() => {
    const cq = normalizeText(cityQuery);
    const byCounty = new Map<string, string[]>();
    for (const ville of villes) {
      const { city } = splitVille(ville);
      const county = countyOf(ville);
      if (cq && !normalizeText(city).includes(cq) && !normalizeText(county).includes(cq)) continue;
      const list = byCounty.get(county);
      if (list) list.push(ville);
      else byCounty.set(county, [ville]);
    }
    return [...byCounty.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "fr"))
      .map(([county, list]) => ({
        county,
        villes: list.sort((a, b) => displayCity(a).localeCompare(displayCity(b), "fr")),
      }));
  }, [villes, cityQuery]);

  const visibleCityCount = useMemo(
    () => groupedVisibleCities.reduce((n, g) => n + g.villes.length, 0),
    [groupedVisibleCities]
  );

  const filtered = useMemo(() => {
    const q = normalizeText(query);
    return taverns.filter((tav) => {
      if (cityFilter.size > 0 && !cityFilter.has(tav.ville)) return false;
      if (q && !normalizeText(tav.name).includes(q)) return false;
      return true;
    });
  }, [taverns, cityFilter, query]);

  // Filter menu: refs of the button, popover and search field.
  const filterWrapRef = useRef<HTMLDivElement | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement | null>(null);
  const citySearchRef = useRef<HTMLInputElement | null>(null);

  // Apply a new town selection then recenter the view:
  // if the current tavern stays in the result, keep the selection and
  // recenter on it; otherwise pick the first available.
  const applyCityFilter = useCallback(
    (next: ReadonlySet<string>) => {
      setCityFilter(new Set(next));
      const q = normalizeText(query);
      const nextList = taverns.filter((tav) => {
        if (next.size > 0 && !next.has(tav.ville)) return false;
        if (q && !normalizeText(tav.name).includes(q)) return false;
        return true;
      });
      if (nextList.length === 0) {
        setCenterIndex(0);
        return;
      }
      const idx = nextList.findIndex((tav) => tav.id === selectedId);
      if (idx >= 0) {
        setCenterIndex(idx);
        return;
      }
      setCenterIndex(0);
      const first = nextList[0];
      if (first) onSelect(first.id);
    },
    [query, taverns, selectedId, onSelect]
  );

  // Init: center on the already-chosen tavern, else the first.
  const [didInit, setDidInit] = useState(false);
  useEffect(() => {
    if (!didInit && taverns.length > 0) {
      const idx = filtered.findIndex((tav) => tav.id === selectedId);
      setCenterIndex(idx >= 0 ? idx : 0);
      setDidInit(true);
    }
  }, [didInit, taverns, filtered, selectedId]);

  // Safety net: if the filtered list shrinks, stay in bounds.
  // Keep the selection if still visible (recenter on it), otherwise
  // pick the last visible entry.
  useEffect(() => {
    if (filtered.length === 0) {
      setCenterIndex(0);
      return;
    }
    if (centerIndex >= filtered.length) {
      const idx = filtered.findIndex((tav) => tav.id === selectedId);
      if (idx >= 0) {
        setCenterIndex(idx);
        return;
      }
      const last = filtered.length - 1;
      setCenterIndex(last);
      const tav = filtered[last];
      if (tav) onSelect(tav.id);
    }
  }, [filtered, centerIndex, selectedId, onSelect]);

  // External selection (recent chip): recenter on the newly selected
  // tavern. Without this, centerIndex stays on the old card: the label
  // moves but the carousel view does not, and arrows/side-cards keep
  // navigating from the stale center. No onSelect here (no loop).
  useEffect(() => {
    const idx = filtered.findIndex((tav) => tav.id === selectedId);
    if (idx >= 0 && idx !== centerIndex) setCenterIndex(idx);
  }, [filtered, selectedId, centerIndex]);

  const selectAt = useCallback(
    (index: number) => {
      const tav = filtered[index];
      if (!tav) return;
      setCenterIndex(index);
      if (tav.id !== selectedId) onSelect(tav.id);
    },
    [filtered, selectedId, onSelect]
  );

  // Infinite loop: from the first, "previous" wraps to the last.
  const goPrev = useCallback(() => {
    if (animating || filtered.length === 0 || filtered.length === 1) return;
    lockBriefly();
    selectAt((centerIndex - 1 + filtered.length) % filtered.length);
  }, [animating, filtered.length, centerIndex, selectAt, lockBriefly]);

  // Infinite loop: from the last, "next" restarts at the first.
  const goNext = useCallback(() => {
    if (animating || filtered.length === 0 || filtered.length === 1) return;
    lockBriefly();
    selectAt((centerIndex + 1) % filtered.length);
  }, [animating, filtered.length, centerIndex, selectAt, lockBriefly]);

  // Click on a side card: center + select right away.
  const handleSideCardClick = useCallback(
    (index: number) => {
      if (index === centerIndex || animating || filtered.length === 0) return;
      lockBriefly();
      selectAt(index);
    },
    [animating, centerIndex, filtered.length, selectAt, lockBriefly]
  );

  const applyQuery = useCallback(
    (value: string) => {
      setQuery(value);
      const q = normalizeText(value);
      const nextList = taverns.filter((tav) => {
        if (cityFilter.size > 0 && !cityFilter.has(tav.ville)) return false;
        if (q && !normalizeText(tav.name).includes(q)) return false;
        return true;
      });
      if (nextList.length === 0) {
        setCenterIndex(0);
        return;
      }
      const idx = nextList.findIndex((tav) => tav.id === selectedId);
      if (idx >= 0) {
        setCenterIndex(idx);
        return;
      }
      setCenterIndex(0);
      const first = nextList[0];
      if (first) onSelect(first.id);
    },
    [cityFilter, taverns, selectedId, onSelect]
  );

  const clearFilters = useCallback(() => {
    setQuery("");
    setCityQuery("");
    setCityFilter(new Set());
    setCenterIndex(0);
    if (taverns.length > 0 && taverns[0].id !== selectedId) onSelect(taverns[0].id);
  }, [taverns, selectedId, onSelect]);

  // Filter popover: toggle, outside click, Escape, focus handling.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    filterBtnRef.current?.focus();
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((open) => !open);
  }, []);

  // Outside click (capture) + Escape: close and return focus to the button.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!filterWrapRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen, closeMenu]);

  // Focus the town search directly on open.
  useEffect(() => {
    if (menuOpen) citySearchRef.current?.focus();
  }, [menuOpen]);

  // Toggle a town (whole-row click): stay open to check others.
  const toggleCity = useCallback(
    (ville: string) => {
      const next = new Set(cityFilter);
      if (next.has(ville)) next.delete(ville);
      else next.add(ville);
      applyCityFilter(next);
    },
    [cityFilter, applyCityFilter]
  );

  const clearCityFilter = useCallback(() => {
    applyCityFilter(new Set());
  }, [applyCityFilter]);

  // Keyboard navigation (ignored while typing and while the menu is open).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (menuOpen) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goPrev, goNext, menuOpen]);

  const cardStyle = (cardIndex: number): Record<string, string | number> => {
    const total = filtered.length;
    if (total === 0) return {};

    let diff = cardIndex - centerIndex;
    if (diff > total / 2) diff -= total;
    if (diff < -total / 2) diff += total;
    const abs = Math.abs(diff);

    const transform =
      diff === 0
        ? "translateX(0) translateZ(60px) scale(1)"
        : abs === 1
          ? `translateX(calc(var(--tx1) * ${diff})) translateZ(0) scale(0.85) rotateY(${diff * -25}deg)`
          : abs === 2
            ? `translateX(calc(var(--tx2) * ${diff})) translateZ(-80px) scale(0.65) rotateY(${diff * -40}deg)`
            : `translateX(calc(var(--tx1) * ${diff})) translateZ(-120px) scale(0.5)`;

    return {
      transform,
      opacity: abs === 0 ? 1 : abs === 1 ? 0.7 : abs === 2 ? 0.4 : 0.15,
      zIndex: 100 - abs * 10,
      filter: diff === 0 ? "none" : "brightness(0.7)",
      pointerEvents: abs > 2 ? "none" : "auto",
    };
  };

  // Visible window with wrap: at index 0, the previous neighbor is the last.
  const visibleIndices = useMemo(() => {
    if (filtered.length === 0) return [];
    if (filtered.length <= 3) return filtered.map((_, i) => i);
    const total = filtered.length;
    return [
      (centerIndex - 1 + total) % total,
      centerIndex,
      (centerIndex + 1) % total,
    ];
  }, [filtered, centerIndex]);

  // Single source of truth: App's idLieu (selectedId). The centered card
  // follows it via the sync effect above; the label reads it directly so
  // a recent click updates the label even before the recenter lands.
  const selectedTavern = taverns.find((tav) => tav.id === selectedId) ?? filtered[centerIndex];

  return (
    <div class="field tavern-carousel">
      <div class="tavern-carousel-head">
        <div class="tavern-carousel-titles">
          <label>{t("auth.tavern")}</label>
        </div>
        <span class="tavern-carousel-count">
          {filtered.length} / {taverns.length}
        </span>
      </div>

      <div class="tavern-search-row">
        <input
          id="tavern-search"
          type="search"
          class="tavern-search-input"
          value={query}
          onInput={(e: Event) => applyQuery((e.currentTarget as HTMLInputElement).value)}
          placeholder={t("auth.tavernSearch")}
          aria-label={t("auth.tavernSearchLabel")}
          autoComplete="off"
        />
        <div class="tavern-filter-wrap" ref={filterWrapRef}>
          <button
            type="button"
            ref={filterBtnRef}
            class={`tavern-filter-btn${cityFilter.size > 0 ? " has-cities" : ""}`}
            onClick={toggleMenu}
            aria-label={cityFilter.size > 0 ? t("auth.tavernFiltersCount", { n: cityFilter.size }) : t("auth.tavernFilters")}
            title={t("auth.tavernFilters")}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="tavern-filter-menu"
          >
            <Filter size={16} />
            {cityFilter.size > 0 && (
              <span class="tavern-filter-badge" aria-hidden="true">
                {cityFilter.size}
              </span>
            )}
          </button>

          {menuOpen && (
            <div
              class="tavern-filter-menu"
              id="tavern-filter-menu"
              role="dialog"
              aria-label={t("auth.tavernFiltersLabel")}
            >
              <input
                ref={citySearchRef}
                type="search"
                class="tavern-filter-search"
                value={cityQuery}
                onInput={(e: Event) => setCityQuery((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e: KeyboardEvent) => {
                  // Enter must not submit the login form.
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder={t("auth.tavernFiltersSearch")}
                aria-label={t("auth.tavernFiltersSearch")}
                autoComplete="off"
              />
              <div class="tavern-filter-list" role="group" aria-label={t("auth.tavernFiltersLabel")}>
                {visibleCityCount === 0 ? (
                  <p class="tavern-filter-empty">{t("auth.tavernFiltersEmpty")}</p>
                ) : (
                  groupedVisibleCities.map((group) => (
                    <div key={group.county} class="tavern-filter-group" role="group" aria-label={group.county}>
                      <p class="tavern-filter-group-title" aria-hidden="true">
                        {group.county}
                      </p>
                      {group.villes.map((ville) => {
                        const checked = cityFilter.has(ville);
                        const CheckIcon = checked ? CheckboxChecked : CheckboxUnchecked;
                        return (
                          <label
                            key={ville}
                            class={`tavern-filter-option${checked ? " is-checked" : ""}`}
                            title={ville}
                          >
                            <input
                              type="checkbox"
                              class="tavern-filter-checkbox"
                              checked={checked}
                              onChange={() => toggleCity(ville)}
                            />
                            <span class="tavern-filter-check" aria-hidden="true">
                              <CheckIcon size={19} />
                            </span>
                            <span class="tavern-filter-name">{displayCity(ville)}</span>
                          </label>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
              <div class="tavern-filter-actions">
                <button
                  type="button"
                  class="tavern-filter-action"
                  onClick={clearCityFilter}
                  disabled={cityFilter.size === 0}
                >
                  {t("auth.tavernFiltersNone")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div class="tavern-empty">
          <p>{t("auth.tavernEmptySearch")}</p>
          <button type="button" class="tavern-clear" onClick={clearFilters}>
            {t("auth.tavernClear")}
          </button>
        </div>
      ) : (
        <>
          <div class="tavern-carousel-container">
            <button
              type="button"
              class="tavern-arrow tavern-arrow--left"
              onClick={goPrev}
              disabled={animating || filtered.length === 0}
              aria-label={t("auth.tavernPrev")}
            >
              <ChevronLeft size={22} />
            </button>

            <div
              class="tavern-track"
              role="listbox"
              aria-label={t("auth.tavernList")}
              style={{ perspective: "1000px" }}
            >
              {visibleIndices.map((i) => {
                const tav = filtered[i];
                const isCenter = i === centerIndex;
                const isSelected = tav.id === selectedId;
                return (
                  <div
                    key={tav.id}
                    role="option"
                    aria-selected={isSelected}
                    class={`tavern-card${isCenter ? " is-center" : ""}${isSelected ? " is-selected" : ""}`}
                    style={cardStyle(i)}
                    onClick={isCenter ? undefined : () => handleSideCardClick(i)}
                  >
                    <div
                      class="tavern-card-bg"
                      style={{ backgroundImage: `url(${TAVERN_CARD_IMAGE})` }}
                    />
                    <div class="tavern-card-body">
                      <div class="tavern-card-top">
                        <span class="tavern-badge" title={tav.ville}>{displayCity(tav.ville)}</span>
                        <span class="tavern-id">#{tav.id}</span>
                      </div>
                      <span class="tavern-name">{tav.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              class="tavern-arrow tavern-arrow--right"
              onClick={goNext}
              disabled={animating || filtered.length === 0}
              aria-label={t("auth.tavernNext")}
            >
              <ChevronRight size={22} />
            </button>
          </div>
          {selectedTavern && (
            <p class="tavern-selected" aria-live="polite">
              {t("auth.tavernSelected", { name: selectedTavern.name })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
