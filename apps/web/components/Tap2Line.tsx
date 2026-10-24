"use client";

// Dev-only tap-to-source inspector. Talks to apps/web/scripts/tap2line/locator.mjs;
// see the README there.
import { useEffect } from "react";

const LOCATOR = "http://127.0.0.1:3939";
const IDLE_MS = 3 * 60 * 1000;
const PLAQUE_MS = 9000;
const TOP_LAYER = "2147483647";
const OWN_ATTR = "data-t2l";
const POINTER_EVENTS = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "touchstart",
  "touchend",
] as const;
const EXTRA_ATTRS = ["aria-label", "placeholder", "title", "name"];
const COLORS = {
  exact: "#16a34a",
  high: "#16a34a",
  low: "#d97706",
  none: "#dc2626",
  info: "#4b5563",
};

type Fiber = {
  type?: unknown;
  return?: Fiber | null;
  _debugOwner?: Fiber | null;
  _debugStack?: Error | null;
  // Server Component owners arrive as ReactComponentInfo rather than fibers.
  name?: string;
  owner?: Fiber | null;
  debugStack?: Error | null;
};

type SignatureNode = {
  type: string;
  id: string;
  names: string[];
  attrs: Record<string, string>;
  text: string;
};

type LocateResult = {
  found: boolean;
  confidence: "exact" | "high" | "low" | "none";
  others: unknown[];
  line: string;
};

type StackFrame = {
  file: string;
  methodName: string;
  arguments: string[];
  line1: number;
  column1: number;
};

export function Tap2Line() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    fetch(`${LOCATOR}/ping`)
      .then((res) => {
        if (res.ok && !cancelled) stop = startTapper();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return null;
}

function startTapper() {
  let on = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let plaqueTimer: ReturnType<typeof setTimeout> | undefined;

  const toggle = ownElement("button", {
    position: "fixed",
    top: "50%",
    right: "0",
    transform: "translateY(-50%)",
    width: "20px",
    height: "44px",
    padding: "0",
    border: "1px solid #dc2626",
    borderRight: "none",
    borderRadius: "6px 0 0 6px",
    background: "#fff",
    color: "#dc2626",
    font: "600 9px/1 ui-monospace, monospace",
    writingMode: "vertical-rl",
    cursor: "pointer",
  });
  toggle.textContent = "t2l";
  toggle.title = "tap2line (Alt+I)";
  const frame = ownElement("div", {
    position: "fixed",
    border: "2px solid #dc2626",
    background: "rgba(220, 38, 38, 0.08)",
    pointerEvents: "none",
    display: "none",
  });
  const label = ownElement("div", {
    position: "absolute",
    left: "-2px",
    bottom: "100%",
    padding: "1px 4px",
    background: "#dc2626",
    color: "#fff",
    font: "11px/1.4 ui-monospace, monospace",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  });
  frame.append(label);
  const border = ownElement("div", {
    position: "fixed",
    inset: "0",
    border: "3px solid #dc2626",
    pointerEvents: "none",
  });
  const plaque = ownElement("div", {
    position: "fixed",
    left: "50%",
    bottom: "16px",
    transform: "translateX(-50%)",
    maxWidth: "90vw",
    padding: "8px 12px",
    borderRadius: "6px",
    background: "#111827",
    color: "#f9fafb",
    font: "12px/1.5 ui-monospace, monospace",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
    cursor: "pointer",
  });
  document.body.append(toggle);

  const hidePlaque = () => {
    clearTimeout(plaqueTimer);
    plaque.remove();
  };

  const showPlaque = (
    text: string,
    color: string,
    note?: string,
    manualCopy?: string,
  ) => {
    plaque.replaceChildren();
    plaque.style.borderLeft = `4px solid ${color}`;
    const main = document.createElement("div");
    main.textContent = text;
    plaque.append(main);
    if (note) {
      const sub = document.createElement("div");
      sub.textContent = note;
      sub.style.opacity = "0.7";
      plaque.append(sub);
    }
    if (manualCopy) {
      const field = document.createElement("textarea");
      field.readOnly = true;
      field.value = manualCopy;
      field.rows = 2;
      Object.assign(field.style, {
        width: "60vw",
        marginTop: "6px",
        color: "#111827",
        font: "inherit",
      });
      plaque.append(field);
      field.select();
    }
    document.body.append(plaque);
    clearTimeout(plaqueTimer);
    plaqueTimer = setTimeout(hidePlaque, PLAQUE_MS);
  };

  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      setMode(false);
      showPlaque(
        "tap2line switched off after 3 idle minutes",
        COLORS.info,
        "Alt+I or the t2l tab turns it back on",
      );
    }, IDLE_MS);
  };

  const onHover = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || isOwn(target)) {
      frame.style.display = "none";
      return;
    }
    const rect = target.getBoundingClientRect();
    Object.assign(frame.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const owner = ownerNames(target, 1)[0];
    label.textContent = `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""}${owner ? ` · ${owner}` : ""}`;
  };

  const pick = async (target: Element) => {
    resetIdle();
    showPlaque("locating…", COLORS.info);
    const exact = await findExactSource(target).catch(() => null);
    let result: LocateResult;
    try {
      const res = await fetch(`${LOCATOR}/locate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screen: window.location.pathname,
          exact,
          path: signaturePath(target),
        }),
      });
      if (!res.ok) throw new Error(`locator answered ${res.status}`);
      result = await res.json();
    } catch {
      showPlaque("tap2line: the locator did not answer", COLORS.none);
      return;
    }
    const copied = await copyText(result.line);
    const note =
      result.confidence === "low"
        ? "low confidence — check the alternatives"
        : result.others.length > 0
          ? `also used in ${result.others.length} other place${result.others.length === 1 ? "" : "s"}`
          : undefined;
    showPlaque(
      result.line,
      COLORS[result.confidence],
      copied ? note : "copy failed — copy it by hand",
      copied ? undefined : result.line,
    );
  };

  const onPointer = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && isOwn(target)) {
      // Keep the app's modals from treating a press on the tool as an outside click.
      event.stopImmediatePropagation();
      if (
        event.type === "mousedown" &&
        !(target instanceof HTMLTextAreaElement)
      )
        event.preventDefault();
      if (event.type !== "click") return;
      if (target === toggle) setMode(!on);
      else if (
        plaque.contains(target) &&
        !(target instanceof HTMLTextAreaElement)
      )
        hidePlaque();
      return;
    }
    if (!on) return;
    event.stopImmediatePropagation();
    // Cancelling touchstart would also cancel the click that carries the pick.
    if (event.type !== "touchstart" && event.type !== "touchend")
      event.preventDefault();
    if (event.type === "click" && target instanceof Element) pick(target);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.altKey && event.code === "KeyI") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMode(!on);
      return;
    }
    if (!on) return;
    if (event.key === "Escape") setMode(false);
    if (event.target instanceof HTMLTextAreaElement && isOwn(event.target))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  function setMode(next: boolean) {
    on = next;
    toggle.style.background = on ? "#dc2626" : "#fff";
    toggle.style.color = on ? "#fff" : "#dc2626";
    if (on) {
      document.body.append(border, frame);
      window.addEventListener("pointermove", onHover, true);
      resetIdle();
    } else {
      window.removeEventListener("pointermove", onHover, true);
      clearTimeout(idleTimer);
      border.remove();
      frame.remove();
      frame.style.display = "none";
      hidePlaque();
    }
  }

  for (const type of POINTER_EVENTS)
    window.addEventListener(type, onPointer, { capture: true, passive: false });
  window.addEventListener("keydown", onKey, true);

  return () => {
    setMode(false);
    for (const type of POINTER_EVENTS)
      window.removeEventListener(type, onPointer, true);
    window.removeEventListener("keydown", onKey, true);
    toggle.remove();
  };
}

function signaturePath(target: Element): SignatureNode[] {
  const path: SignatureNode[] = [];
  let el: Element | null = target;
  while (el && el !== document.body && path.length < 6) {
    const classes = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((name) => name && !name.startsWith("t2l"));
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      if (Object.keys(attrs).length >= 8) break;
      if (attr.name.startsWith("data-") || EXTRA_ATTRS.includes(attr.name))
        attrs[attr.name] = attr.value;
    }
    path.push({
      type: el.tagName.toLowerCase(),
      id: el.id,
      names: [...ownerNames(el, path.length === 0 ? 3 : 1), ...classes].slice(
        0,
        12,
      ),
      attrs,
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    });
    el = el.parentElement;
  }
  return path;
}

function ownerNames(el: Element, max: number) {
  const names: string[] = [];
  let owner = fiberOf(el)?._debugOwner ?? null;
  while (owner && names.length < max) {
    const name = componentName(owner);
    if (name && !names.includes(name)) names.push(name);
    owner = owner._debugOwner ?? owner.owner ?? null;
  }
  return names;
}

// React 19 dropped _debugSource; each fiber's _debugStack still records where its JSX was
// written, and the Next dev server maps those bundle positions back to source.
async function findExactSource(target: Element) {
  const chain: Fiber[] = [];
  let node = fiberOf(target);
  while (node && chain.length < 6) {
    chain.push(node);
    node = node._debugOwner ?? node.owner ?? null;
  }
  const entries = chain.map((fiber) =>
    parseStack((fiber._debugStack ?? fiber.debugStack)?.stack ?? ""),
  );
  const locations: { file: string; line: number }[] = [];
  const resolved = await Promise.all(
    [false, true].map(async (isServer) => {
      const frames = entries
        .flat()
        .filter((f) => isServerFrame(f) === isServer);
      if (frames.length === 0) return new Map<StackFrame, unknown>();
      const res = await fetch("/__nextjs_original-stack-frames", {
        method: "POST",
        body: JSON.stringify({
          frames: frames.map(toDistDirFrame),
          isServer,
          isEdgeServer: false,
          isAppDirectory: true,
        }),
      });
      if (!res.ok) return new Map<StackFrame, unknown>();
      const results: unknown[] = await res.json();
      return new Map(frames.map((f, i) => [f, results[i]]));
    }),
  );
  for (const frames of entries) {
    for (const frame of frames) {
      const source = originalSource(
        resolved[isServerFrame(frame) ? 1 : 0].get(frame),
      );
      if (source) {
        locations.push(source);
        break;
      }
    }
  }
  // A shadcn primitive's own line is rarely the question; where it was used is.
  return (
    locations.find((l) => !l.file.includes("components/ui/")) ??
    locations[0] ??
    null
  );
}

function originalSource(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const { status, value } = result as {
    status?: string;
    value?: { originalStackFrame?: Record<string, unknown> | null };
  };
  const frame = value?.originalStackFrame;
  if (status !== "fulfilled" || !frame || frame.ignored) return null;
  const { file, line1 } = frame;
  if (typeof file !== "string" || typeof line1 !== "number") return null;
  if (file.includes("node_modules") || file.includes("next/dist")) return null;
  return { file, line: line1 };
}

function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  // Line 0 is the "react-stack-top-frame" message; the next few frames hold jsxDEV and the caller.
  for (const raw of stack.split("\n").slice(1, 5)) {
    const match =
      raw.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/) ??
      raw.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    if (!match) continue;
    frames.push({
      file: match[2],
      methodName: match[1] || "<unknown>",
      arguments: [],
      line1: Number(match[3]),
      column1: Number(match[4]),
    });
  }
  return frames;
}

// Turbopack's tracer rejects http URLs; Next's own overlay rewrites /_next/static/… to the
// dist dir on disk the same way (next/dist/server/lib/parse-stack.js).
function toDistDirFrame(frame: StackFrame): StackFrame {
  const distDir = process.env.__NEXT_DIST_DIR
    ?.replace(/\\/g, "/")
    .replace(/\/$/, "");
  if (!distDir || !/^https?:/.test(frame.file)) return frame;
  const url = new URL(frame.file);
  const match = /\/_next(\/static\/.+)/.exec(url.pathname);
  if (!match) return frame;
  return { ...frame, file: `file://${distDir}${match[1]}${url.search}` };
}

function isServerFrame(frame: StackFrame) {
  return !/^https?:/.test(frame.file);
}

function fiberOf(el: Element): Fiber | null {
  let node: Element | null = el;
  while (node) {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    if (key) return (node as unknown as Record<string, Fiber>)[key];
    node = node.parentElement;
  }
  return null;
}

function componentName(owner: Fiber) {
  if (typeof owner.name === "string") return owner.name;
  const type = owner.type as
    | {
        displayName?: string;
        name?: string;
        render?: { displayName?: string; name?: string };
        type?: { displayName?: string; name?: string };
      }
    | undefined;
  if (!type || (typeof type !== "function" && typeof type !== "object"))
    return null;
  return (
    type.displayName ||
    type.render?.displayName ||
    type.render?.name ||
    type.type?.displayName ||
    type.type?.name ||
    type.name ||
    null
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    Object.assign(field.style, { position: "fixed", left: "-9999px" });
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

function ownElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
) {
  const el = document.createElement(tag);
  el.setAttribute(OWN_ATTR, "");
  Object.assign(el.style, { zIndex: TOP_LAYER, pointerEvents: "auto" }, style);
  return el;
}

function isOwn(el: Element) {
  return el.closest(`[${OWN_ATTR}]`) !== null;
}
