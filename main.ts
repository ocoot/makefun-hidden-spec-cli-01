// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

// ---- Section 5: line matching, and the formats of sections 6 to 8 ----

/** Successful move edits of this run, as [oldPath, newPath], for the R lines of section 2. */
const MOVES: Array<[string, string]> = [];

interface Split {
  lines: string[];
  br: string;
  final: boolean;
}

function splitFile(text: string): Split {
  if (text === '') return { lines: [], br: '\n', final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}

function joinFile(lines: string[], br: string, final: boolean): string {
  return lines.length === 0 ? '' : lines.join(br) + (final ? br : '');
}

const stripTrail = (s: string): string => s.replace(/[ \t]+$/, '');
const stripBoth = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadWs = (s: string): string => /^[ \t]*/.exec(s)![0];

/** Lines of O and of N built from body entries; ctx flags mark context lines (present in both). */
interface Body {
  o: string[];
  n: string[];
  /** For each line of N: the index into O of its context line, or -1 when it is a `+` line. */
  nCtx: number[];
  /** For each line of O: whether a `\` line follows it in the body. */
  oSlash: boolean[];
  /** For each line of N: whether a `\` line follows it in the body. */
  nSlash: boolean[];
}

function tierOf(tier: number, s: string): string {
  return tier === 0 ? s : tier === 1 ? stripTrail(s) : stripBoth(s);
}

/** All positions at or after `from` where O occurs at `tier`; when endAtLast, only ones ending at the last line. */
function occurrences(lines: string[], o: string[], tier: number, from: number, endAtLast = false): number[] {
  const out: number[] = [];
  if (o.length === 0) return out;
  for (let i = Math.max(0, from); i + o.length <= lines.length; i += 1) {
    if (endAtLast && i + o.length !== lines.length) continue;
    let ok = true;
    for (let j = 0; j < o.length; j += 1) {
      if (tierOf(tier, lines[i + j]!) !== tierOf(tier, o[j]!)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The first tier (0, then 1, then 2; tier 0 only when strict) at which O occurs, and its positions. */
function findTier(lines: string[], o: string[], strict: boolean, from: number, endAtLast = false): { tier: number; at: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const at = occurrences(lines, o, tier, from, endAtLast);
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/** N as written over the matched lines at `pos`: context lines keep the file's own text; tier 2 re-indents. */
function written(body: Body, lines: string[], pos: number, tier: number): string[] {
  const out: string[] = [];
  const f = pos < lines.length ? leadWs(lines[pos]!) : '';
  const p = body.o.length > 0 ? leadWs(body.o[0]!) : '';
  for (let j = 0; j < body.n.length; j += 1) {
    const ctx = body.nCtx[j]!;
    if (ctx >= 0) {
      out.push(lines[pos + ctx]!);
      continue;
    }
    let line = body.n[j]!;
    if (tier === 2 && line.trim() !== '' && line.startsWith(p)) line = f + line.slice(p.length);
    out.push(line);
  }
  return out;
}

function bodyOf(entries: Array<{ kind: string; text: string; slash: boolean }>): Body {
  const b: Body = { o: [], n: [], nCtx: [], oSlash: [], nSlash: [] };
  for (const e of entries) {
    if (e.kind === ' ') {
      b.nCtx.push(b.o.length);
      b.o.push(e.text);
      b.oSlash.push(e.slash);
      b.n.push(e.text);
      b.nSlash.push(e.slash);
    } else if (e.kind === '-') {
      b.o.push(e.text);
      b.oSlash.push(e.slash);
    } else if (e.kind === '+') {
      b.nCtx.push(-1);
      b.n.push(e.text);
      b.nSlash.push(e.slash);
    }
  }
  return b;
}

/** Replace O by N in `sp` at the occurrence chosen by `pick`; returns the new Split. Throws Fail('no-match'). */
function replaceOnce(sp: Split, body: Body, strict: boolean, path: string, pick: (found: { tier: number; at: number[] }) => number): { sp: Split; pos: number; tier: number } {
  const found = findTier(sp.lines, body.o, strict, 0);
  if (found === null) throw new Fail('no-match', path);
  const pos = pick(found);
  const lines = [...sp.lines.slice(0, pos), ...written(body, sp.lines, pos, found.tier), ...sp.lines.slice(pos + body.o.length)];
  return { sp: { lines, br: sp.br, final: sp.final }, pos, tier: found.tier };
}

function checkSafe(p: string): void {
  if (!safe(p)) throw new Fail('unsafe', p);
}

function mustExist(tree: Tree, p: string): string {
  const t = tree.get(p);
  if (t === null) throw new Fail('missing', p);
  return t;
}

function mustNotExist(tree: Tree, p: string): void {
  if (tree.get(p) !== null) throw new Fail('exists', p);
}

// ---- Section 7: SEARCH/REPLACE ----

function searchReplaceEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevPath: string | null = null;
  let searchFrom = 0; // first patch index after the previous block's REPLACE line
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    const searchLine = i + 1;
    // Path: nearest eligible line before SEARCH, at or after searchFrom.
    let path: string | null = null;
    for (let j = i - 1; j >= searchFrom; j -= 1) {
      const l = lines[j]!;
      if (blank(l)) continue;
      if (l.trim().startsWith('```')) continue;
      path = l.trim();
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw new Exit2(`error: parse ${searchLine}`);
    let eq = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j]!.trimEnd() === '=======') {
        eq = j;
        break;
      }
    }
    let rep = -1;
    if (eq >= 0) {
      for (let j = eq + 1; j < lines.length; j += 1) {
        if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
          rep = j;
          break;
        }
      }
    }
    if (eq < 0 || rep < 0) throw new Exit2(`error: parse ${searchLine}`);
    const oldLines = lines.slice(i + 1, eq);
    const newLines = lines.slice(eq + 1, rep);
    const p = path;
    edits.push((tree) => {
      checkSafe(p);
      if (oldLines.length === 0) {
        mustNotExist(tree, p);
        tree.now.set(p, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
        return;
      }
      const sp = splitFile(mustExist(tree, p));
      const body = bodyOf([...oldLines.map((t) => ({ kind: '-', text: t, slash: false })), ...newLines.map((t) => ({ kind: '+', text: t, slash: false }))]);
      // bodyOf puts all of O before all of N, which is exactly the block's meaning.
      const found = findTier(sp.lines, body.o, strict, 0);
      if (found === null) throw new Fail('no-match', p);
      if (found.at.length > 1) throw new Fail('ambiguous', p);
      const pos = found.at[0]!;
      const out = [...sp.lines.slice(0, pos), ...written(body, sp.lines, pos, found.tier), ...sp.lines.slice(pos + body.o.length)];
      tree.now.set(p, joinFile(out, sp.br, sp.final));
    });
    prevPath = p;
    searchFrom = rep + 1;
    i = rep + 1;
  }
  return edits;
}

// ---- Section 6: unified diffs ----

interface Hunk {
  a: number;
  body: Body;
}

interface Section {
  diffOld: string | null;
  diffNew: string | null;
  pairOld: string | null; // null sentinel handling: see pairSet and the /dev/null flags
  pairNew: string | null;
  pairSet: boolean;
  oldIsNull: boolean;
  newIsNull: boolean;
  renameFrom: string | null;
  renameTo: string | null;
  isCreate: boolean;
  isDelete: boolean;
  hunks: Hunk[];
  hasHunk: boolean;
}

function newSection(): Section {
  return { diffOld: null, diffNew: null, pairOld: null, pairNew: null, pairSet: false, oldIsNull: false, newIsNull: false, renameFrom: null, renameTo: null, isCreate: false, isDelete: false, hunks: [], hasHunk: false };
}

/** The path named by a ---/+++ line: after the 4 characters, up to the first tab, spaces removed, a/ or b/ removed. */
function headerPath(line: string): string {
  let p = line.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = p.trim();
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const sections: Section[] = [];
  let sec: Section | null = null;
  let i = 0;
  const isPairAt = (j: number): boolean => (lines[j] ?? '').startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ');
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      sec = newSection();
      sec.diffOld = m[1]!;
      sec.diffNew = m[2]!;
      sections.push(sec);
      i += 1;
      continue;
    }
    if (line.startsWith('@@')) {
      if (sec === null) throw new Exit2(`error: parse ${i + 1}`);
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      const a = parseInt(m[1]!, 10);
      i += 1;
      const entries: Array<{ kind: string; text: string; slash: boolean }> = [];
      while (i < lines.length) {
        const bl = lines[i]!;
        if (bl.startsWith('diff --git ')) break;
        if (isPairAt(i)) break;
        if (bl.startsWith('\\')) {
          if (entries.length > 0) entries[entries.length - 1]!.slash = true;
          i += 1;
          continue;
        }
        if (bl === '') {
          entries.push({ kind: ' ', text: '', slash: false });
          i += 1;
          continue;
        }
        const c = bl[0]!;
        if (c === ' ' || c === '-' || c === '+') {
          entries.push({ kind: c, text: bl.slice(1), slash: false });
          i += 1;
          continue;
        }
        break;
      }
      while (entries.length > 0 && entries[entries.length - 1]!.kind === ' ' && entries[entries.length - 1]!.text === '') entries.pop();
      sec.hunks.push({ a, body: bodyOf(entries) });
      sec.hasHunk = true;
      continue;
    }
    if (line.startsWith('--- ') && (sec === null || !sec.hasHunk)) {
      // A section header pair, or a header pair starting a new section.
      if (!isPairAt(i)) throw new Exit2(`error: parse ${i + 2}`);
      if (sec === null || sec.pairSet) {
        sec = newSection();
        sections.push(sec);
      }
      const oldP = headerPath(line);
      const newP = headerPath(lines[i + 1]!);
      sec.pairSet = true;
      sec.oldIsNull = oldP === '/dev/null';
      sec.newIsNull = newP === '/dev/null';
      sec.pairOld = sec.oldIsNull ? null : oldP;
      sec.pairNew = sec.newIsNull ? null : newP;
      i += 2;
      continue;
    }
    if (line.startsWith('--- ') && sec !== null && sec.hasHunk) {
      // After hunks, a --- line followed by +++ starts the next section; otherwise it is an old body-less line: ignore.
      if (isPairAt(i)) {
        sec = newSection();
        sections.push(sec);
        const oldP = headerPath(line);
        const newP = headerPath(lines[i + 1]!);
        sec.pairSet = true;
        sec.oldIsNull = oldP === '/dev/null';
        sec.newIsNull = newP === '/dev/null';
        sec.pairOld = sec.oldIsNull ? null : oldP;
        sec.pairNew = sec.newIsNull ? null : newP;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (sec !== null && !sec.hasHunk) {
      if (line.startsWith('rename from ')) sec.renameFrom = line.slice('rename from '.length).trim();
      else if (line.startsWith('rename to ')) sec.renameTo = line.slice('rename to '.length).trim();
      else if (line.startsWith('new file mode')) sec.isCreate = true;
      else if (line.startsWith('deleted file mode')) sec.isDelete = true;
      i += 1;
      continue;
    }
    i += 1;
  }
  return sections.map((s) => unifiedEdit(s, strict));
}

function applyHunks(sp: Split, hunks: Hunk[], strict: boolean, path: string): Split {
  let lines = [...sp.lines];
  let final = sp.final;
  let d = 0;
  for (const h of hunks) {
    const b = h.body;
    if (b.o.length === 0) {
      const pos = Math.min(Math.max(h.a + d, 0), lines.length);
      const atEnd = pos === lines.length;
      lines = [...lines.slice(0, pos), ...b.n, ...lines.slice(pos)];
      if (atEnd && b.n.length > 0) final = !b.nSlash[b.nSlash.length - 1];
      d += b.n.length;
      continue;
    }
    const found = findTier(lines, b.o, strict, 0);
    if (found === null) throw new Fail('no-match', path);
    const target = h.a - 1 + d;
    let pos = found.at[0]!;
    for (const cand of found.at) {
      if (Math.abs(cand - target) < Math.abs(pos - target)) pos = cand;
    }
    const atEnd = pos + b.o.length === lines.length;
    const w = written(b, lines, pos, found.tier);
    lines = [...lines.slice(0, pos), ...w, ...lines.slice(pos + b.o.length)];
    if (atEnd && b.n.length > 0) final = !b.nSlash[b.nSlash.length - 1];
    d += b.n.length - b.o.length;
  }
  return { lines, br: sp.br, final };
}

function unifiedEdit(s: Section, strictFlag: boolean): Edit {
  return (tree) => {
    let oldPath: string | null;
    let newPath: string | null;
    if (s.pairSet) {
      oldPath = s.pairOld;
      newPath = s.pairNew;
    } else if (s.renameFrom !== null || s.renameTo !== null) {
      oldPath = s.renameFrom;
      newPath = s.renameTo;
    } else {
      oldPath = s.diffOld;
      newPath = s.diffNew;
    }
    const create = s.oldIsNull || s.isCreate;
    const del = s.newIsNull || s.isDelete;
    // Safety first, for every path the edit names (after the prefixes section 6 removes).
    if (create) {
      if (newPath !== null) checkSafe(newPath);
    } else if (del) {
      if (oldPath !== null) checkSafe(oldPath);
    } else {
      if (oldPath !== null) checkSafe(oldPath);
      if (newPath !== null && newPath !== oldPath) checkSafe(newPath);
    }
    if (create) {
      const p = newPath!;
      mustNotExist(tree, p);
      const plus: string[] = [];
      let lastSlash = false;
      for (const h of s.hunks) {
        for (let j = 0; j < h.body.n.length; j += 1) {
          if (h.body.nCtx[j] === -1) {
            plus.push(h.body.n[j]!);
            lastSlash = h.body.nSlash[j]!;
          }
        }
      }
      tree.now.set(p, plus.length === 0 ? '' : plus.join('\n') + (lastSlash ? '' : '\n'));
      return;
    }
    if (del) {
      const p = oldPath!;
      mustExist(tree, p);
      tree.now.set(p, null);
      return;
    }
    if (oldPath !== newPath) {
      const o = oldPath!;
      const n = newPath!;
      const before = mustExist(tree, o);
      mustNotExist(tree, n);
      const out = applyHunks(splitFile(before), s.hunks, strictFlag, o);
      tree.now.set(n, joinFile(out.lines, out.br, out.final));
      tree.now.set(o, null);
      MOVES.push([o, n]);
      return;
    }
    const p = oldPath!;
    const before = mustExist(tree, p);
    const out = applyHunks(splitFile(before), s.hunks, strictFlag, p);
    tree.now.set(p, joinFile(out.lines, out.br, out.final));
  };
}

// ---- Section 8: V4A ----

interface VChunk {
  anchor: string | null;
  eof: boolean;
  body: Body;
}

interface VSection {
  kind: 'add' | 'delete' | 'update';
  path: string;
  line: number; // 1-based line of the section header
  addLines: string[];
  moveTo: string | null;
  chunks: VChunk[];
}

function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const firstNB = lines.findIndex((l) => !blank(l));
  if (firstNB < 0) throw new Exit2('error: parse 1');
  if (lines[firstNB]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${firstNB + 1}`);
  let lastNB = -1;
  for (let j = lines.length - 1; j >= 0; j -= 1) {
    if (!blank(lines[j]!)) {
      lastNB = j;
      break;
    }
  }
  if (lines[lastNB]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: VSection[] = [];
  let sec: VSection | null = null;
  let chunk: { anchor: string | null; eof: boolean; entries: Array<{ kind: string; text: string; slash: boolean }> } | null = null;
  const flushChunk = (): void => {
    if (sec !== null && chunk !== null) sec.chunks.push({ anchor: chunk.anchor, eof: chunk.eof, body: bodyOf(chunk.entries) });
    chunk = null;
  };
  const flushSection = (): void => {
    flushChunk();
    if (sec !== null) {
      // Blank lines at the end of a section are not part of it.
      while (sec.addLines.length > 0 && sec.addLines[sec.addLines.length - 1] === '') sec.addLines.pop();
      if (sec.chunks.length > 0) {
        const last = sec.chunks[sec.chunks.length - 1]!;
        if (!last.eof) {
          const b = last.body;
          while (b.n.length > 0 && b.nCtx[b.n.length - 1]! >= 0 && b.n[b.n.length - 1] === '') {
            b.n.pop();
            b.nCtx.pop();
            b.nSlash.pop();
            b.o.pop();
            b.oSlash.pop();
          }
          // A chunk that was only section-end blank lines is no chunk at all.
          if (b.o.length === 0 && b.n.length === 0 && last.anchor === null) sec.chunks.pop();
        }
      }
      sections.push(sec);
    }
    sec = null;
  };
  for (let i = firstNB + 1; i < lastNB; i += 1) {
    const line = lines[i]!;
    const isAdd = line.startsWith('*** Add File: ');
    const isDel = line.startsWith('*** Delete File: ');
    const isUpd = line.startsWith('*** Update File: ');
    if (isAdd || isDel || isUpd) {
      flushSection();
      const prefix = isAdd ? '*** Add File: ' : isDel ? '*** Delete File: ' : '*** Update File: ';
      sec = { kind: isAdd ? 'add' : isDel ? 'delete' : 'update', path: line.slice(prefix.length).trim(), line: i + 1, addLines: [], moveTo: null, chunks: [] };
      continue;
    }
    if (sec === null) {
      if (blank(line)) continue;
      throw new Exit2(`error: parse ${i + 1}`);
    }
    if (sec.kind === 'add') {
      if (line.startsWith('+')) sec.addLines.push(line.slice(1));
      else if (line === '') sec.addLines.push('');
      else throw new Exit2(`error: parse ${i + 1}`);
      continue;
    }
    if (sec.kind === 'delete') {
      if (blank(line)) continue;
      throw new Exit2(`error: parse ${i + 1}`);
    }
    // Update section.
    if (line.startsWith('*** Move to: ')) {
      if (sec.moveTo !== null || sec.chunks.length > 0 || chunk !== null) throw new Exit2(`error: parse ${i + 1}`);
      sec.moveTo = line.slice('*** Move to: '.length).trim();
      continue;
    }
    if (line === '*** End of File') {
      // It ends a chunk: with no chunk in progress there is nothing to end, a parse error.
      if (chunk === null) throw new Exit2(`error: parse ${i + 1}`);
      chunk.eof = true;
      flushChunk();
      continue;
    }
    if (line.startsWith('@@')) {
      flushChunk();
      const anchorText = line.slice(2).trim();
      chunk = { anchor: anchorText === '' ? null : anchorText, eof: false, entries: [] };
      continue;
    }
    if (line === '' || line.startsWith(' ') || line.startsWith('-') || line.startsWith('+')) {
      if (chunk === null) chunk = { anchor: null, eof: false, entries: [] };
      if (line === '') chunk.entries.push({ kind: ' ', text: '', slash: false });
      else chunk.entries.push({ kind: line[0]!, text: line.slice(1), slash: false });
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  flushSection();
  for (const s of sections) {
    if (s.kind === 'update' && s.chunks.length === 0 && s.moveTo === null) throw new Exit2(`error: parse ${s.line}`);
  }
  return sections.map((s) => v4aEdit(s, strict));
}

function v4aEdit(s: VSection, strict: boolean): Edit {
  return (tree) => {
    checkSafe(s.path);
    if (s.moveTo !== null) checkSafe(s.moveTo);
    if (s.kind === 'add') {
      mustNotExist(tree, s.path);
      tree.now.set(s.path, s.addLines.length === 0 ? '' : s.addLines.join('\n') + '\n');
      return;
    }
    if (s.kind === 'delete') {
      mustExist(tree, s.path);
      tree.now.set(s.path, null);
      return;
    }
    const before = mustExist(tree, s.path);
    if (s.moveTo !== null) mustNotExist(tree, s.moveTo);
    const sp = splitFile(before);
    let lines = [...sp.lines];
    let cursor = 0;
    for (const ch of s.chunks) {
      if (ch.anchor !== null) {
        // First line at or after the cursor equal to the anchor, at the first tier with one.
        const tiers = strict ? [0] : [0, 1, 2];
        let at = -1;
        for (const tier of tiers) {
          at = -1;
          for (let j = cursor; j < lines.length; j += 1) {
            if (tierOf(tier, lines[j]!) === tierOf(tier, ch.anchor)) {
              at = j;
              break;
            }
          }
          if (at >= 0) break;
        }
        if (at < 0) throw new Fail('no-match', s.path);
        cursor = at + 1;
      }
      const b = ch.body;
      if (b.o.length === 0) {
        const pos = ch.eof ? lines.length : Math.min(cursor, lines.length);
        lines = [...lines.slice(0, pos), ...b.n, ...lines.slice(pos)];
        cursor = pos + b.n.length;
        continue;
      }
      const found = findTier(lines, b.o, strict, cursor, ch.eof);
      if (found === null) throw new Fail('no-match', s.path);
      const pos = found.at[0]!;
      const w = written(b, lines, pos, found.tier);
      lines = [...lines.slice(0, pos), ...w, ...lines.slice(pos + b.o.length)];
      cursor = pos + w.length;
    }
    const text = joinFile(lines, sp.br, sp.final);
    if (s.moveTo !== null) {
      tree.now.set(s.moveTo, text);
      tree.now.set(s.path, null);
      MOVES.push([s.path, s.moveTo]);
    } else {
      tree.now.set(s.path, text);
    }
  };
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    MOVES.length = 0;
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'search-replace' ? searchReplaceEdits(lines, strict) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'v4a' ? v4aEdits(lines, strict) : [];
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  // Section 2 R lines: a successful move whose old path is gone and whose new path is new
  // replaces that pair's D and A lines, and sorts by the new path.
  const rByNew = new Map<string, string>();
  const rOlds = new Set<string>();
  for (const [o, n] of MOVES) {
    if (tree.original(o) !== null && tree.now.get(o) === null && tree.original(n) === null && tree.now.get(n) !== null && tree.now.get(n) !== undefined) {
      rByNew.set(n, o);
      rOlds.add(o);
    }
  }
  const keyed: Array<{ key: string; text: string }> = [];
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was !== now) {
      if (rByNew.has(p)) keyed.push({ key: p, text: `R ${rByNew.get(p)!} -> ${p}` });
      else if (!(was !== null && now === null && rOlds.has(p))) keyed.push({ key: p, text: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
    }
    if (check) continue;
    if (was === now) continue;
    if (now === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  keyed.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const rows = keyed.map((k) => k.text);
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
