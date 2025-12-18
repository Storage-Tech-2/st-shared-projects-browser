import React, { useEffect, useMemo, useRef, useState } from "react";
import logoimg from "./assets/logo.png";
import { clsx, formatDate, timeAgo } from "./Utils";

type RawLitematicEntry = {
  file: string;
  fileSizeBytes: number;
  dimensions: { x: number; y: number; z: number };
  size: string;
  dataVersion: number;
  version: string;
  timeCreated: string | number;
  author: string;
  has_image: boolean;
};

type LitematicEntry = RawLitematicEntry & {
  id: string;
  createdAt: number;
  renderPath: string | null;
  filePath: string;
};

type SortKey = "newest" | "oldest" | "az";
type Option = { value: string; count?: number };

const WINDOW_SIZE = 200;
const BUFFER_ROWS = 3;
const ROW_GAP = 16;
const SCROLL_PARAM_KEY = "idx";
const DISCLAIMER_KEY = "stanalysis_disclaimer_ack";

function parseListParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function listToParam(values: string[]): string | null {
  if (!values.length) return null;
  return values.join(",");
}

function matchesSearch(entry: LitematicEntry, terms: string[]) {
  if (!terms.length) return true;
  const hay = `${entry.file} ${entry.author} ${entry.version} ${entry.size}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
}

function compareVersionsDesc(a: string, b: string) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

function displayName(file: string) {
  const base = file.replace(/\.litematic$/i, "");
  const withoutSnowflake = base.replace(/[-_]*\d{8,}$/i, "").replace(/[-_]+$/, "");
  const cleaned = withoutSnowflake || base;
  return cleaned.replace(/_/g, " ");
}

function getHeaderOffset() {
  const header = document.querySelector("header");
  return (header?.getBoundingClientRect().height || 0) + 8;
}

function getCols() {
  if (typeof window === "undefined") return 1;
  const w = window.innerWidth;
  if (w >= 1536) return 4; // 2xl
  if (w >= 1280) return 3; // xl
  if (w >= 640) return 2; // sm and up
  return 1;
}

function SelectedChip({ value, onRemove, tone }: { value: string; onRemove: () => void; tone: "include" | "exclude" }) {
  const tones = tone === "include"
    ? "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-100 dark:border-blue-800"
    : "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-100 dark:border-rose-800";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold", tones)}>
      <span>{value}</span>
      <button type="button" onClick={onRemove} className="rounded-full bg-black/10 px-1 text-[10px] dark:bg-white/10">
        ✕
      </button>
    </span>
  );
}

function AutocompleteBox({
  label,
  placeholder,
  options,
  selected,
  onAdd,
  onRemove,
  tone,
}: {
  label: string;
  placeholder: string;
  options: Option[];
  selected: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  tone: "include" | "exclude";
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const lower = query.toLowerCase();
    return options
      .filter((opt) => !selected.includes(opt.value) && (!lower || opt.value.toLowerCase().includes(lower)))
      .slice(0, 20);
  }, [options, query, selected]);

  const handleSelect = (value: string) => {
    onAdd(value);
    setQuery("");
    setOpen(true);
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">{label}</div>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          placeholder={placeholder}
          className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:border-gray-800 dark:bg-gray-900"
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
            {filtered.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(opt.value);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <span>{opt.value}</span>
                {typeof opt.count === "number" && <span className="text-[11px] text-gray-500">({opt.count})</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((value) => (
            <SelectedChip key={value} value={value} tone={tone} onRemove={() => onRemove(value)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LitematicCard({ entry, onPreview }: { entry: LitematicEntry; onPreview: (entry: LitematicEntry) => void }) {
  const baseName = displayName(entry.file);
  return (
    <article
      className="litematic-card group flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
      data-entry-id={entry.id}
    >
      <div className="relative aspect-video w-full bg-black/5 dark:bg-white/5">
        {entry.renderPath ? (
          <button type="button" onClick={() => onPreview(entry)} className="absolute inset-0 h-full w-full overflow-hidden">
            <img src={entry.renderPath} alt={`Render of ${baseName}`} className="h-full w-full object-contain transition duration-300 group-hover:scale-105" />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">No render</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3
              className="break-words text-base font-semibold leading-tight"
              style={{ overflowWrap: "anywhere" }}
            >
              {baseName}
            </h3>
            <div className="break-all text-xs text-gray-500">{entry.file}</div>
          </div>
          <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-800 dark:bg-gray-800 dark:text-gray-100">v{entry.version}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-100">By {entry.author}</span>
          <span className="text-xs text-gray-500" title={entry.createdAt ? formatDate(entry.createdAt) : undefined}>
            {entry.createdAt ? timeAgo(entry.createdAt) : "Unknown date"}
          </span>
        </div>
        <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
          <div>
            Dimensions: {entry.size} ({entry.dimensions.x}×{entry.dimensions.y}×{entry.dimensions.z})
          </div>
          <div>File size: {formatBytes(entry.fileSizeBytes)}</div>
          <div>Data version: {entry.dataVersion}</div>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          {entry.renderPath && (
            <button type="button" onClick={() => onPreview(entry)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              View render
            </button>
          )}
          <a href={entry.filePath} download className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            Download
          </a>
        </div>
      </div>
    </article>
  );
}

function Lightbox({ entry, onClose }: { entry: LitematicEntry | null; onClose: () => void }) {
  if (!entry || !entry.renderPath) return null;
  const baseName = displayName(entry.file);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <img src={entry.renderPath} alt={`Render of ${entry.file}`} className="max-h-[80vh] w-full rounded-2xl object-contain" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-white">
          <div className="space-y-0.5 min-w-0 flex-1">
            <div className="break-words text-base font-semibold" style={{ overflowWrap: "anywhere" }}>
              {baseName}
            </div>
            <div className="opacity-80">
              v{entry.version} · {entry.author}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={entry.renderPath} target="_blank" rel="noreferrer" className="rounded-full border border-white/40 px-3 py-1">
              Open image
            </a>
            <button type="button" onClick={onClose} className="rounded-full border border-white/40 px-3 py-1">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DisclaimerModal({ open, onAccept }: { open: boolean; onAccept: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-900 dark:bg-gray-900">
        <div className="mb-3 flex items-center gap-2 text-red-700 dark:text-red-200">
          <span className="text-2xl" aria-hidden="true">⚠️</span>
          <div className="text-lg font-bold">Use at your own risk</div>
        </div>
        <div className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
          <p>There is no guarantee that the devices listed by this tool are functional.</p>
          <p>This is for learning purposes only!</p>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onAccept}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [entries, setEntries] = useState<LitematicEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [versionIncludes, setVersionIncludes] = useState<string[]>([]);
  const [versionExcludes, setVersionExcludes] = useState<string[]>([]);
  const [authorIncludes, setAuthorIncludes] = useState<string[]>([]);
  const [authorExcludes, setAuthorExcludes] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [preview, setPreview] = useState<LitematicEntry | null>(null);
  const searchTerms = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const [windowStart, setWindowStart] = useState(0);
  const [measuredCardHeight, setMeasuredCardHeight] = useState<number | null>(null);
  const [cols, setCols] = useState<number>(getCols());
  const [anchorIndex, setAnchorIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pendingPreviewId = useRef<string | null>(null);
  const pendingIndex = useRef<number | null>(null);
  const pendingScrollId = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const lastPushedParamsRef = useRef<string>("");
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("litematics-processed.json");
        if (!res.ok) throw new Error(`Failed to load litematics (${res.status})`);
        const json: { entries: RawLitematicEntry[] } = await res.json();
        if (cancelled) return;
        const normalized = (json.entries || []).map((entry, idx) => {
          const createdAt = typeof entry.timeCreated === "string" ? Number.parseInt(entry.timeCreated, 10) : entry.timeCreated;
          const pngName = entry.file.replace(/\.litematic$/i, ".png");
          const renderPath = entry.has_image ? `litematic-renders-cropped/${encodeURIComponent(pngName)}` : null;
          const filePath = `litematic-files/${encodeURIComponent(entry.file)}`;
          return {
            ...entry,
            id: `${entry.file}-${idx}`,
            createdAt: Number.isFinite(createdAt) ? createdAt : 0,
            renderPath,
            filePath,
          };
        });
        setEntries(normalized);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unable to load litematics";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const seen = localStorage.getItem(DISCLAIMER_KEY) === "ack";
    setShowDisclaimer(!seen);
  }, []);

  const availableVersions = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.version));
    return Array.from(set).sort(compareVersionsDesc);
  }, [entries]);

  const availableAuthors = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.author));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const versionIncludeSet = useMemo(() => (versionIncludes.length ? new Set(versionIncludes) : null), [versionIncludes]);
  const versionExcludeSet = useMemo(() => (versionExcludes.length ? new Set(versionExcludes) : null), [versionExcludes]);
  const authorIncludeSet = useMemo(() => (authorIncludes.length ? new Set(authorIncludes) : null), [authorIncludes]);
  const authorExcludeSet = useMemo(() => (authorExcludes.length ? new Set(authorExcludes) : null), [authorExcludes]);

  const filtered = useMemo(() => {
    const list = entries.filter((entry) => {
      if (versionExcludeSet && versionExcludeSet.has(entry.version)) return false;
      if (authorExcludeSet && authorExcludeSet.has(entry.author)) return false;
      if (versionIncludeSet && !versionIncludeSet.has(entry.version)) return false;
      if (authorIncludeSet && !authorIncludeSet.has(entry.author)) return false;
      return matchesSearch(entry, searchTerms);
    });
    const sorted = [...list].sort((a, b) => {
      if (sortKey === "oldest") return a.createdAt - b.createdAt;
      if (sortKey === "az") return a.file.localeCompare(b.file, undefined, { sensitivity: "base" });
      return b.createdAt - a.createdAt;
    });
    return sorted;
  }, [entries, searchTerms, versionIncludeSet, versionExcludeSet, authorIncludeSet, authorExcludeSet, sortKey]);

  const approxRowHeight = useMemo(() => (measuredCardHeight || 360) + ROW_GAP, [measuredCardHeight]);

  useEffect(() => {
    const applyParams = (sp: URLSearchParams) => {
      restoringRef.current = true;
      setQ(sp.get("q") || "");
      const sortParam = sp.get("sort");
      if (sortParam === "newest" || sortParam === "oldest" || sortParam === "az") setSortKey(sortParam);
      setVersionIncludes(parseListParam(sp.get("vInc")));
      setVersionExcludes(parseListParam(sp.get("vExc")));
      setAuthorIncludes(parseListParam(sp.get("aInc")));
      setAuthorExcludes(parseListParam(sp.get("aExc")));
      pendingPreviewId.current = sp.get("preview");
      const scrollVal = sp.get(SCROLL_PARAM_KEY);
      pendingIndex.current = scrollVal ? Number.parseInt(scrollVal, 10) || 0 : null;
      setTimeout(() => {
        if (pendingIndex.current == null) restoringRef.current = false;
      }, 0);
    };

    applyParams(new URLSearchParams(window.location.search));
    const onPop = () => {
      applyParams(new URLSearchParams(window.location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (pendingPreviewId.current && entries.length) {
      const match = entries.find((e) => e.id === pendingPreviewId.current || e.file === pendingPreviewId.current);
      if (match) setPreview(match);
      pendingPreviewId.current = null;
    }
  }, [entries]);

  const buildParams = (indexOverride?: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q);
    if (sortKey !== "newest") params.set("sort", sortKey);
    const vInc = listToParam(versionIncludes);
    const vExc = listToParam(versionExcludes);
    const aInc = listToParam(authorIncludes);
    const aExc = listToParam(authorExcludes);
    if (vInc) params.set("vInc", vInc);
    if (vExc) params.set("vExc", vExc);
    if (aInc) params.set("aInc", aInc);
    if (aExc) params.set("aExc", aExc);
    if (preview?.id) params.set("preview", preview.id);
    const idxVal = typeof indexOverride === "number" ? indexOverride : anchorIndex;
    params.set(SCROLL_PARAM_KEY, String(Math.max(0, idxVal)));
    return params;
  };

  useEffect(() => {
    if (restoringRef.current) return;
    const params = buildParams();
    const qs = params.toString();
    if (qs === lastPushedParamsRef.current) return;
    lastPushedParamsRef.current = qs;
    window.history.pushState({}, "", `${window.location.pathname}?${qs}`);
  }, [q, sortKey, versionIncludes, versionExcludes, authorIncludes, authorExcludes, preview?.id]);

  useEffect(() => {
    const handleResize = () => setCols(getCols());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (pendingIndex.current != null) return;
    setWindowStart(0);
    setAnchorIndex(0);
  }, [filtered.length]);

  useEffect(() => {
    setWindowStart((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    const handleScroll = () => {
      if (restoringRef.current) return;
      const offset = getHeaderOffset();
      const gridTop = gridRef.current ? gridRef.current.getBoundingClientRect().top + window.scrollY : 0;
      const rel = Math.max(0, window.scrollY + offset - gridTop);
      const row = Math.floor(rel / approxRowHeight);
      const withinRow = rel - row * approxRowHeight;
      const anchorRow = withinRow > approxRowHeight / 2 ? row + 1 : row;
      const anchor = Math.max(0, anchorRow * cols);
      const start = Math.max(0, anchor - BUFFER_ROWS * cols);
      setAnchorIndex((prev) => (prev === anchor ? prev : anchor));
      setWindowStart((prev) => (prev === start ? prev : start));
      if (!restoringRef.current) {
        const params = buildParams(anchor);
        const qs = params.toString();
        if (qs !== lastPushedParamsRef.current) {
          lastPushedParamsRef.current = qs;
          window.history.replaceState({}, "", `${window.location.pathname}?${qs}`);
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [approxRowHeight, cols, q, sortKey, versionIncludes, versionExcludes, authorIncludes, authorExcludes, preview?.id]);

  useEffect(() => {
    if (pendingIndex.current == null || !filtered.length) return;
    const idx = Math.max(0, Math.min(filtered.length - 1, pendingIndex.current));
    if (idx === 0) {
      pendingIndex.current = null;
      restoringRef.current = true;
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
        setTimeout(() => {
          restoringRef.current = false;
        }, 50);
      });
      return;
    }
    const start = Math.max(0, idx - BUFFER_ROWS * cols);
    setAnchorIndex(idx);
    setWindowStart(start);
    pendingScrollId.current = filtered[idx]?.id || null;
    pendingIndex.current = null;
    restoringRef.current = true;
  }, [filtered.length, cols, approxRowHeight]);


  useEffect(() => {
    const card = document.querySelector<HTMLElement>(".litematic-card");
    if (card) setMeasuredCardHeight(card.getBoundingClientRect().height);
  }, [filtered.length, cols]);

  const windowEnd = Math.min(filtered.length, windowStart + WINDOW_SIZE);
  const visible = useMemo(() => filtered.slice(windowStart, windowEnd), [filtered, windowStart, windowEnd]);
  const topRows = Math.floor(windowStart / cols);
  const bottomRows = Math.ceil((filtered.length - windowEnd) / cols);
  const topSpacer = Math.max(0, topRows * approxRowHeight);
  const bottomSpacer = Math.max(0, bottomRows * approxRowHeight);

  useEffect(() => {
    if (!pendingScrollId.current) return;
    const targetId = pendingScrollId.current;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.querySelector<HTMLElement>(`[data-entry-id="${targetId.replace(/"/g, '\\"')}"]`);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - getHeaderOffset();
        window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
        setTimeout(() => {
          restoringRef.current = false;
        }, 50);
        pendingScrollId.current = null;
        return;
      }
      attempts += 1;
      if (attempts < 10) requestAnimationFrame(tryScroll);
      else restoringRef.current = false;
    };
    requestAnimationFrame(tryScroll);
  }, [visible]);

  const versionPreviewList = useMemo(() => {
    return entries.filter((entry) => {
      if (versionExcludeSet && versionExcludeSet.has(entry.version)) return false;
      if (authorExcludeSet && authorExcludeSet.has(entry.author)) return false;
      if (authorIncludeSet && !authorIncludeSet.has(entry.author)) return false;
      return matchesSearch(entry, searchTerms);
    });
  }, [entries, versionExcludeSet, authorExcludeSet, authorIncludeSet, searchTerms]);

  const authorPreviewList = useMemo(() => {
    return entries.filter((entry) => {
      if (versionExcludeSet && versionExcludeSet.has(entry.version)) return false;
      if (authorExcludeSet && authorExcludeSet.has(entry.author)) return false;
      if (versionIncludeSet && !versionIncludeSet.has(entry.version)) return false;
      return matchesSearch(entry, searchTerms);
    });
  }, [entries, versionExcludeSet, authorExcludeSet, versionIncludeSet, searchTerms]);

  const filteredVersionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    versionPreviewList.forEach((e) => {
      map[e.version] = (map[e.version] || 0) + 1;
    });
    return map;
  }, [versionPreviewList]);

  const filteredAuthorCounts = useMemo(() => {
    const map: Record<string, number> = {};
    authorPreviewList.forEach((e) => {
      map[e.author] = (map[e.author] || 0) + 1;
    });
    return map;
  }, [authorPreviewList]);

  const hasFilters =
    q.trim().length > 0 ||
    versionIncludes.length > 0 ||
    versionExcludes.length > 0 ||
    authorIncludes.length > 0 ||
    authorExcludes.length > 0;

  function clearFilters() {
    setQ("");
    setVersionIncludes([]);
    setVersionExcludes([]);
    setAuthorIncludes([]);
    setAuthorExcludes([]);
  }

  const versionOptions = useMemo<Option[]>(() => {
    const opts = availableVersions.map((v) => ({ value: v, count: filteredVersionCounts[v] || 0 }));
    return opts.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.value.localeCompare(b.value));
  }, [availableVersions, filteredVersionCounts]);

  const authorOptions = useMemo<Option[]>(() => {
    const opts = availableAuthors.map((a) => ({ value: a, count: filteredAuthorCounts[a] || 0 }));
    return opts.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.value.localeCompare(b.value));
  }, [availableAuthors, filteredAuthorCounts]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="sticky top-0 z-20 border-b bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center">
              <img src={logoimg} alt="Logo" className="h-9 w-9" />
            </div>
            <div>
              <div className="text-xl font-bold">ST Share Projects Litematic Browser</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Browse litematics posted in the #share-projects channel</div>
            </div>
          </div>
          <div className="relative w-full md:w-96">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by file name, author, version, size"
              className="w-full rounded-xl border px-3 py-2 pl-9 outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:border-gray-800 dark:bg-gray-900"
            />
            <span className="pointer-events-none absolute left-3 top-2.5 text-gray-400">🔎</span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[280px,1fr] xl:grid-cols-[320px,1fr]">
        <aside className="space-y-4 self-start lg:sticky lg:top-24">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Filters</div>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="text-xs text-blue-600 underline underline-offset-4 dark:text-blue-400">
                Reset
              </button>
            )}
          </div>
          <div className="space-y-4 rounded-2xl border bg-white/80 p-4 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
            <div className="space-y-2">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Sort</div>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="w-full rounded-xl border px-3 py-2 bg-white dark:border-gray-800 dark:bg-gray-900"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="az">A → Z (filename)</option>
              </select>
            </div>
            <AutocompleteBox
              label="Include versions"
              placeholder="Type to find versions"
              options={versionOptions}
              selected={versionIncludes}
              onAdd={(v) => setVersionIncludes((prev) => [...prev, v])}
              onRemove={(v) => setVersionIncludes((prev) => prev.filter((x) => x !== v))}
              tone="include"
            />
            <AutocompleteBox
              label="Exclude versions"
              placeholder="Type to filter versions out"
              options={versionOptions}
              selected={versionExcludes}
              onAdd={(v) => setVersionExcludes((prev) => [...prev, v])}
              onRemove={(v) => setVersionExcludes((prev) => prev.filter((x) => x !== v))}
              tone="exclude"
            />
            <AutocompleteBox
              label="Include authors"
              placeholder="Type to find authors"
              options={authorOptions}
              selected={authorIncludes}
              onAdd={(v) => setAuthorIncludes((prev) => [...prev, v])}
              onRemove={(v) => setAuthorIncludes((prev) => prev.filter((x) => x !== v))}
              tone="include"
            />
            <AutocompleteBox
              label="Exclude authors"
              placeholder="Type to filter authors out"
              options={authorOptions}
              selected={authorExcludes}
              onAdd={(v) => setAuthorExcludes((prev) => [...prev, v])}
              onRemove={(v) => setAuthorExcludes((prev) => prev.filter((x) => x !== v))}
              tone="exclude"
            />
          </div>
          <div className="rounded-2xl border bg-white/80 p-4 text-sm shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
            <div className="space-y-2">
              <div className="font-semibold text-gray-800 dark:text-gray-100">Data from</div>
              <a
                href="https://discord.gg/JufJ6uf"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
              >
                Storage Tech Discord ↗
              </a>
            </div>

            <div className="mt-4 space-y-2">
              <div className="font-semibold text-gray-800 dark:text-gray-100">Website based on</div>
              <a
                href="https://storagetech2.org"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
              >
                Storage Tech 2 ↗
              </a>
            </div>
          </div>
        </aside>

        <main className="space-y-4 pb-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {loading
                ? "Loading litematics..."
                : `Showing ${visible.length} of ${filtered.length} (total ${entries.length})`}
            </div>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="hidden text-sm text-blue-600 underline underline-offset-4 dark:text-blue-400 sm:inline">
                Reset filters
              </button>
            )}
          </div>

          {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-100">{error}</div>}

          {loading ? (
            <div className="rounded-xl border bg-white p-4 text-sm text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              Loading renders and metadata...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border bg-white p-6 text-center text-sm text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              No litematics match the current search or filters.
            </div>
          ) : (
            <div ref={gridRef}>
              <div style={{ height: topSpacer > 0 ? `${topSpacer}px` : undefined }} aria-hidden={true} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map((entry) => (
                  <LitematicCard key={entry.id} entry={entry} onPreview={setPreview} />
                ))}
              </div>
              <div style={{ height: bottomSpacer > 0 ? `${bottomSpacer}px` : undefined }} aria-hidden={true} />
            </div>
          )}
        </main>
      </div>

      <Lightbox entry={preview} onClose={() => setPreview(null)} />

      <footer className="border-t py-6 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        Built for the Storage Tech 2 litematic archive. Copyright © 2025 All rights reserved.
      </footer>

      <DisclaimerModal
        open={showDisclaimer}
        onAccept={() => {
          localStorage.setItem(DISCLAIMER_KEY, "ack");
          setShowDisclaimer(false);
        }}
      />
    </div>
  );
}
