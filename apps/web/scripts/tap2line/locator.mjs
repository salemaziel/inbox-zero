// tap2line locator: turns a tapped element's signature into a source line.
// Dev-only, loopback-only, zero dependencies. See README.md next to this file.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const APP_DIR = "apps/web/app";
const NEXT_PROJECT = "apps/web";
const CORPUS_DIRS = [
  APP_DIR,
  "apps/web/components",
  "packages/mail-ui/src",
  "packages/mail-react/src",
  "packages/email-editor/src",
];
const OWN_FILES = new Set(["Tap2Line.tsx", "locator.mjs"]);
const SKIP_DIRS = new Set(["node_modules", "__tests__", "generated", ".next"]);
const PORT = Number(process.env.T2L_PORT) || 3939;
const ORIGIN = process.env.T2L_ORIGIN || "http://localhost:3000";
const LAST_FILE = path.join(ROOT, ".tap2line", "last.txt");
const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
  "via",
];
const CACHE_MS = 2000;
const MAX_HITS = 60;
const MAX_BODY = 64 * 1024;
const WEIGHTS = {
  own: { id: 10, name: 6, attrKey: 4, attrValue: 3, text: 4 },
  ancestor: { id: 3, name: 2, attrKey: 1.5, attrValue: 1 },
};
const COMMON_TYPES = new Set([
  "div",
  "span",
  "p",
  "a",
  "button",
  "input",
  "label",
  "li",
  "ul",
  "ol",
  "img",
  "svg",
  "path",
  "section",
  "main",
  "header",
  "footer",
  "nav",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "tr",
  "td",
  "th",
  "tbody",
  "thead",
  "textarea",
  "select",
  "option",
  "g",
  "i",
  "b",
]);
const WIRING =
  /\bon[A-Z]\w*=\{|addEventListener\(|\.on[a-z]+\s*=|querySelector|closest\(/;

let cache = { at: 0, files: [] };

createServer(handle).listen(PORT, "127.0.0.1", () => {
  console.log(
    `tap2line locator on http://127.0.0.1:${PORT} · ${loadCorpus().length} files · origin ${ORIGIN}`,
  );
});

async function handle(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host ?? "";
  const proxied = FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined);
  const loopbackHost = new RegExp(
    `^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`,
  ).test(host);
  if (proxied || !loopbackHost || (origin && origin !== ORIGIN))
    return send(res, 404, { error: "not found" });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", ORIGIN);
    res.setHeader("Vary", "Origin");
  }
  const { pathname } = new URL(req.url ?? "/", "http://x");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204).end();
    return;
  }
  if (req.method === "GET" && pathname === "/ping")
    return send(res, 200, { ok: true, files: loadCorpus().length });
  if (req.method !== "POST" || pathname !== "/locate")
    return send(res, 404, { error: "not found" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: "bad json" });
  }
  const result = locate(body);
  if (!result) return send(res, 400, { error: "signature has no path" });
  remember(result);
  return send(res, 200, result);
}

export function locate(raw) {
  const sig = normalise(raw);
  if (!sig) return null;
  const files = loadCorpus();
  const signature = describe(sig);
  const screenFiles = findScreenFiles(sig.screen, files);
  const exact = resolveExact(sig.exact, files);
  if (exact) {
    const best = {
      file: exact.file.rel,
      line: exact.line,
      score: 0,
      handler: findHandler(exact.file, exact.line - 1, []),
    };
    return answer({
      found: true,
      confidence: "exact",
      best,
      others: [],
      signature,
    });
  }

  const own = tokensOf(sig.path[0], WEIGHTS.own);
  const hitsByToken = new Map(
    own.map((t) => [t.value, findHits(t.value, files)]),
  );
  const candidates = new Map();
  const addCandidates = (tokens) => {
    for (const token of tokens) {
      const hits = hitsByToken.get(token.value);
      if (hits.length === 0 || hits.length > MAX_HITS) continue;
      const gain = token.weight * rarity(hits.length);
      for (const hit of hits) {
        const key = `${hit.file.rel}:${hit.index}`;
        const c = candidates.get(key) ?? {
          file: hit.file,
          index: hit.index,
          score: 0,
          tokens: new Set(),
          birth: false,
        };
        c.score += gain;
        c.tokens.add(token.value);
        if (isBirth(hit.file.lines[hit.index], token)) c.birth = true;
        candidates.set(key, c);
      }
    }
  };
  // The owner component's name points at the function that renders the element, not at the
  // element's line, so it scopes the file and only creates candidates when nothing else does.
  const components = own.filter(
    (t) => t.kind === "name" && /^[A-Z][A-Za-z0-9]*$/.test(t.value),
  );
  const plain = own.filter((t) => !components.includes(t));
  addCandidates(plain);
  const onlyComponents = candidates.size === 0;
  if (onlyComponents) addCandidates(components);
  if (candidates.size === 0) return answer({ found: false, signature });

  const ownerDefinitions = components.flatMap((t) =>
    hitsByToken
      .get(t.value)
      .filter(
        (h) =>
          h.file.lines[h.index] !== undefined &&
          isBirth(h.file.lines[h.index], t),
      ),
  );
  const ancestorTokens = sig.path
    .slice(1)
    .flatMap((node) => tokensOf(node, WEIGHTS.ancestor));
  const ancestorHits = ancestorTokens
    .map((t) => findHits(t.value, files))
    .filter((hits) => hits.length > 0 && hits.length <= MAX_HITS);
  const rare = new Set(
    [...candidates.values()]
      .flatMap((c) => [...c.tokens])
      .filter((t) => hitsByToken.get(t).length <= 2),
  );
  const ownId = sig.path[0].id;
  const type = sig.path[0].type;
  const text = sig.path[0].text;

  for (const c of candidates.values()) {
    const line = c.file.lines[c.index];
    if (screenFiles.has(c.file.rel)) c.score += 5;
    if (ownerDefinitions.some((d) => d.file === c.file && d.index < c.index))
      c.score += 5;
    // A `<Owner` usage only wins when other tokens already placed the element in the caller;
    // otherwise the owner's own definition is where the element is born.
    const ownTypes = [
      type,
      ...(onlyComponents ? [] : components.map((t) => t.value)),
    ].filter(Boolean);
    if (
      ownTypes.some((t) =>
        new RegExp(`<${escapeRegExp(t)}(?![\\w-])`).test(line),
      )
    )
      c.score += 3;
    if (c.birth) c.score += 4;
    if (isLiteralText(text) && line.includes(text)) c.score += 4;
    c.score += ancestorBonus(c, ancestorHits);
  }

  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score);
  const merged = [];
  for (const c of sorted) {
    if (
      merged.some((m) => m.file === c.file && Math.abs(m.index - c.index) <= 3)
    )
      continue;
    merged.push(c);
  }
  const top = merged[0];
  const topRare = [...top.tokens].filter((t) => rare.has(t));
  const isRival = (c) => {
    if (top.birth) return c.birth;
    if (ownId && top.tokens.has(ownId)) return c.tokens.has(ownId);
    if (topRare.length > 0) return topRare.every((t) => c.tokens.has(t));
    return c.file !== top.file || Math.abs(c.index - top.index) > 60;
  };
  const rival = merged.slice(1).find(isRival);
  const confident =
    (!rival || top.score >= rival.score * 1.6) && top.score >= 8;
  const others = merged
    .slice(1)
    .filter(
      (c) =>
        isRival(c) || c.file !== top.file || Math.abs(c.index - top.index) > 60,
    )
    .filter(
      (c) =>
        (!confident && isRival(c)) ||
        (ownId && c.tokens.has(ownId)) ||
        [...c.tokens].some((t) => rare.has(t)),
    )
    .slice(0, 3)
    .map((c) => ({
      file: c.file.rel,
      line: c.index + 1,
      score: round(c.score),
    }));

  const best = {
    file: top.file.rel,
    line: top.index + 1,
    score: round(top.score),
    handler: findHandler(top.file, top.index, [...top.tokens]),
  };
  return answer({
    found: true,
    confidence: confident ? "high" : "low",
    best,
    others,
    signature,
  });
}

function answer(result) {
  const { found, confidence, best, others = [], signature } = result;
  if (!found) {
    return {
      found,
      confidence: "none",
      best: null,
      others: [],
      signature,
      line: `not found in ${CORPUS_DIRS.join(", ")} · sig: ${signature}`,
    };
  }
  const handler = best.handler ? ` · handler :${best.handler}` : "";
  const also = others
    .map((o) => `${short(o.file, best.file)}:${o.line}`)
    .join(" · ");
  const line =
    confidence === "low"
      ? `${best.file}:${best.line} (?)${handler}${also ? ` · also: ${also}` : ""} · sig: ${signature}`
      : `${best.file}:${best.line}${handler}${also ? ` · also: ${also}` : ""}`;
  return { found, confidence, best, others, signature, line };
}

function normalise(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.path)) return null;
  const path = raw.path
    .slice(0, 6)
    .filter((n) => n && typeof n === "object")
    .map(normaliseNode);
  if (path.length === 0) return null;
  const screen = typeof raw.screen === "string" ? raw.screen.slice(0, 200) : "";
  let exact = null;
  if (
    raw.exact &&
    typeof raw.exact.file === "string" &&
    Number.isInteger(raw.exact.line) &&
    raw.exact.line > 0
  ) {
    exact = { file: raw.exact.file.slice(0, 400), line: raw.exact.line };
  }
  return { screen, exact, path };
}

function normaliseNode(node) {
  const str = (v, max) =>
    typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const type = str(node.type, 40);
  const names = Array.isArray(node.names)
    ? node.names
        .filter((n) => typeof n === "string")
        .map((n) => str(n, 64))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const attrs = {};
  if (node.attrs && typeof node.attrs === "object") {
    for (const [key, value] of Object.entries(node.attrs)) {
      if (Object.keys(attrs).length >= 8) break;
      if (/^[\w-]{1,40}$/.test(key) && typeof value === "string")
        attrs[key] = str(value, 64);
    }
  }
  return {
    type: /^[\w.-]+$/.test(type) ? type : "",
    id: str(node.id, 64),
    names,
    attrs,
    text: str(node.text, 120),
  };
}

function tokensOf(node, weights) {
  const tokens = [];
  if (node.id) tokens.push({ value: node.id, weight: weights.id, kind: "id" });
  for (const name of node.names)
    if (name.length > 1)
      tokens.push({ value: name, weight: weights.name, kind: "name" });
  for (const [key, value] of Object.entries(node.attrs)) {
    tokens.push({ value: key, weight: weights.attrKey, kind: "attrKey" });
    if (value.length >= 3 && value.length <= 39 && !/^\d+$/.test(value)) {
      tokens.push({ value, weight: weights.attrValue, kind: "attrValue" });
    }
  }
  // Tailwind leaves most elements with only shared utility classes; literal JSX text is often
  // the one rare thing an element has of its own.
  if (weights.text && isLiteralText(node.text))
    tokens.push({ value: node.text, weight: weights.text, kind: "text" });
  const seen = new Set();
  return tokens.filter(
    (t) =>
      !COMMON_TYPES.has(t.value) && !seen.has(t.value) && seen.add(t.value),
  );
}

function findHits(token, files) {
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`);
  const hits = [];
  for (const file of files) {
    if (!file.text.includes(token)) continue;
    file.lines.forEach((line, index) => {
      if (line.includes(token) && pattern.test(line))
        hits.push({ file, index });
    });
    if (hits.length > MAX_HITS) break;
  }
  return hits;
}

function isBirth(line, token) {
  const t = escapeRegExp(token.value);
  if (token.kind === "name" && /^[A-Z]/.test(token.value)) {
    return new RegExp(
      `(?:function|class)\\s+${t}\\b|(?:const|let)\\s+${t}\\s*[=:]`,
    ).test(line);
  }
  if (
    new RegExp(
      `\\b(?:id|data-testid|aria-label|name)\\s*=\\s*\\{?\\s*["'\`]${t}["'\`]`,
    ).test(line)
  )
    return true;
  const inString = new RegExp(
    `["'\`][^"'\`]*(?<![\\w-])${t}(?![\\w-])[^"'\`]*["'\`]`,
  ).test(line);
  const classContext =
    /className\s*=|\b(?:cn|clsx|twMerge|cva)\(|classList\.add\(/.test(line) ||
    /^\s*(?:[\w.?!]+\s*(?:&&|\?|:)\s*)?["'`]/.test(line);
  return token.kind === "name" && inString && classContext;
}

function ancestorBonus(candidate, ancestorHits) {
  let flat = 0;
  let scale = 0;
  for (const hits of ancestorHits) {
    const inFile = hits.filter((h) => h.file === candidate.file);
    if (inFile.length === 0) continue;
    flat += 2;
    let nearest = null;
    for (const h of inFile) {
      if (h.index === candidate.index) continue;
      if (
        !nearest ||
        Math.abs(h.index - candidate.index) <
          Math.abs(nearest.index - candidate.index)
      )
        nearest = h;
    }
    if (!nearest) continue;
    const d = Math.abs(nearest.index - candidate.index);
    if (d <= 40) flat += 3;
    const step = 6 / (1 + d);
    scale += candidate.index > nearest.index ? step * 2 : step;
  }
  return Math.min(flat, 16) + scale;
}

function findHandler(file, index, tokens) {
  for (let i = index; i <= Math.min(index + 12, file.lines.length - 1); i++) {
    const line = file.lines[i];
    const match = line.match(/\bon[A-Z]\w*=\{\s*(\w+)\s*\}/);
    if (match) {
      const def = file.lines.findIndex((l) =>
        new RegExp(`(?:const|function)\\s+${escapeRegExp(match[1])}\\b`).test(
          l,
        ),
      );
      return def >= 0 && Math.abs(def - index) <= 300 ? def + 1 : i + 1;
    }
    if (/\bon[A-Z]\w*=\{/.test(line)) return i + 1;
    if (i > index && /(?:^|[^=])\/?>\s*$/.test(line)) break;
  }
  let nearest = null;
  for (
    let i = Math.max(0, index - 150);
    i <= Math.min(file.lines.length - 1, index + 150);
    i++
  ) {
    if (i === index) continue;
    const line = file.lines[i];
    if (!WIRING.test(line) || !tokens.some((t) => line.includes(t))) continue;
    if (nearest === null || Math.abs(i - index) < Math.abs(nearest - index))
      nearest = i;
  }
  return nearest === null ? null : nearest + 1;
}

function resolveExact(exact, files) {
  if (!exact) return null;
  let file = exact.file
    .replace(/^file:\/\//, "")
    .replace(/^\[project\]\//, "")
    .replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, "");
  file = file.split("?")[0];
  const candidates = path.isAbsolute(file)
    ? [path.relative(ROOT, file)]
    : [path.normalize(path.join(NEXT_PROJECT, file)), path.normalize(file)];
  const byRel = new Map(files.map((f) => [f.rel, f]));
  for (const rel of candidates) {
    const hit = byRel.get(rel.split(path.sep).join("/"));
    if (hit && exact.line <= hit.lines.length)
      return { file: hit, line: exact.line };
  }
  return null;
}

function findScreenFiles(screen, files) {
  const result = new Set();
  if (!screen.startsWith("/")) return result;
  const segments = screen
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
  const page = matchRoute(path.join(ROOT, APP_DIR), segments);
  if (!page) return result;
  const dir = path.posix.dirname(page);
  // Pages here are thin; the screen is drawn by components colocated next to page.tsx.
  for (const f of files)
    if (path.posix.dirname(f.rel) === dir) result.add(f.rel);
  return result;
}

function matchRoute(dir, segments) {
  const entries = safeReaddir(dir);
  if (segments.length === 0) {
    if (
      entries.some((e) => e.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(e.name))
    ) {
      const name = entries.find((e) =>
        /^page\.(tsx|ts|jsx|js)$/.test(e.name),
      ).name;
      return path
        .relative(ROOT, path.join(dir, name))
        .split(path.sep)
        .join("/");
    }
  }
  const dirs = entries.filter(
    (e) =>
      e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("@"),
  );
  const [head, ...rest] = segments;
  const tries = [
    ...dirs
      .filter((d) => head !== undefined && d.name === head)
      .map((d) => [d, rest]),
    ...dirs.filter((d) => /^\(.+\)$/.test(d.name)).map((d) => [d, segments]),
    ...dirs
      .filter((d) => head !== undefined && /^\[[^.[\]]+\]$/.test(d.name))
      .map((d) => [d, rest]),
    ...dirs
      .filter((d) => head !== undefined && /^\[\.\.\..+\]$/.test(d.name))
      .map((d) => [d, []]),
    ...dirs
      .filter((d) => /^\[\[\.\.\..+\]\]$/.test(d.name))
      .map((d) => [d, []]),
  ];
  for (const [d, next] of tries) {
    const found = matchRoute(path.join(dir, d.name), next);
    if (found) return found;
  }
  return null;
}

function loadCorpus() {
  if (Date.now() - cache.at < CACHE_MS) return cache.files;
  const files = [];
  for (const dir of CORPUS_DIRS) walk(path.join(ROOT, dir), files);
  cache = { at: Date.now(), files };
  return files;
}

function walk(dir, out) {
  for (const entry of safeReaddir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
      continue;
    }
    if (
      !/\.(tsx|ts|jsx)$/.test(entry.name) ||
      /\.(test|spec)\./.test(entry.name) ||
      OWN_FILES.has(entry.name)
    )
      continue;
    if (statSync(full).size > 1024 * 1024) continue;
    const text = readFileSync(full, "utf8");
    out.push({
      rel: path.relative(ROOT, full).split(path.sep).join("/"),
      text,
      lines: text.split("\n"),
    });
  }
}

function remember(result) {
  mkdirSync(path.dirname(LAST_FILE), { recursive: true });
  let previous = [];
  try {
    previous = readFileSync(LAST_FILE, "utf8").split("\n").filter(Boolean);
  } catch {}
  const entry = `${new Date().toISOString()}  ${result.line}${result.confidence === "low" || !result.found ? "" : `  · sig: ${result.signature}`}`;
  writeFileSync(LAST_FILE, `${[...previous, entry].slice(-20).join("\n")}\n`);
}

function describe(sig) {
  const node = sig.path[0];
  const component = node.names.find((n) => /^[A-Z]/.test(n));
  let label = node.type || "element";
  if (node.id) label += `#${node.id}`;
  if (component) label += ` in ${component}`;
  const parts = [label];
  if (sig.screen) parts.push(`on ${sig.screen}`);
  if (node.text) parts.push(`text «${node.text.slice(0, 60)}»`);
  return parts.join(" · ");
}

function isLiteralText(text) {
  return text.length >= 3 && text.length <= 40 && /\p{L}/u.test(text);
}

function rarity(n) {
  if (n <= 2) return 1.5;
  if (n <= 6) return 1;
  if (n <= 20) return 0.5;
  return 0.2;
}

function short(file, bestFile) {
  return path.posix.dirname(file) === path.posix.dirname(bestFile)
    ? path.posix.basename(file)
    : file;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
