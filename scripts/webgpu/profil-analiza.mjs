// Analiza zapisanego profilu CPU (.cpuprofile z scripts/profil-bitwy.mjs albo DevTools) — zadanie 23:
// ms na klatkę po funkcjach (łącznie i własny czas), drzewo od wskazanej funkcji, wołający funkcji.
//
//   node scripts/webgpu/profil-analiza.mjs plik.cpuprofile --klatki N [--od nazwa] [--glebia 6] [--prog 0.02]
//        [--wolajacy nazwa] [--top 40]
//
// --klatki:   liczba klatek w profilu (profil-bitwy wypisuje ją w linii „profil”) — dzielnik „na klatkę”;
// --od:       drzewo od najwyższych wystąpień funkcji o tej nazwie (dzieci scalone po nazwie);
// --wolajacy: kto woła funkcję (ścieżki w górę, scalone, z czasem łącznym);
// bez --od: łączny (inkluzywny, bez rekursji) i własny czas funkcji — top --top.
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
if (!file) { console.log('użycie: node scripts/webgpu/profil-analiza.mjs plik.cpuprofile --klatki N [--od nazwa]'); process.exit(2); }
const frames = Math.max(1, Number(opt('klatki', 1)));
const depth = Number(opt('glebia', 6));
const minMs = Number(opt('prog', 0.02));
const top = Number(opt('top', 40));
const profile = JSON.parse(readFileSync(file, 'utf8'));

const nodes = new Map();
for (const n of profile.nodes) nodes.set(n.id, { ...n, self: 0, total: 0, parent: null });
for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
const { samples, timeDeltas } = profile;
for (let i = 0; i < samples.length; i++) nodes.get(samples[i]).self += (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000;
const totalOf = (n) => { let t = n.self; for (const c of (n.children || [])) t += totalOf(nodes.get(c)); n.total = t; return t; };
for (const n of nodes.values()) if (!n.parent) totalOf(n);
const pf = (ms) => (ms / frames).toFixed(3).padStart(7);
const fname = (n) => n.callFrame.functionName || '(anon)';
const nameOf = (n) => `${fname(n)} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;

const od = opt('od', null);
const wol = opt('wolajacy', null);
if (od) {
  const tops = [...nodes.values()].filter((n) => {
    if (fname(n) !== od) return false;
    for (let p = n.parent; p; p = p.parent) if (fname(p) === od) return false;
    return true;
  });
  console.log(`== ${od}: ${pf(tops.reduce((s, n) => s + n.total, 0))} ms/klatkę (${tops.length} wystąpień w drzewie)`);
  const merge = (list, d, indent) => {
    const by = new Map();
    for (const n of list) for (const cid of (n.children || [])) {
      const c = nodes.get(cid); const k = nameOf(c);
      const e = by.get(k) || { total: 0, self: 0, kids: [] };
      e.total += c.total; e.self += c.self; e.kids.push(c); by.set(k, e);
    }
    for (const [k, e] of [...by.entries()].sort((a, b) => b[1].total - a[1].total)) {
      if (e.total / frames < minMs) continue;
      console.log(`${indent}${pf(e.total)}  ${k}  [self ${pf(e.self).trim()}]`);
      if (d > 1) merge(e.kids, d - 1, indent + '  ');
    }
  };
  merge(tops, depth, '  ');
} else if (wol) {
  const by = new Map();
  for (const n of nodes.values()) {
    if (fname(n) !== wol) continue;
    let dup = false;
    for (let p = n.parent; p; p = p.parent) if (fname(p) === wol) { dup = true; break; }
    if (dup) continue;
    const path = [];
    for (let p = n.parent; p && path.length < depth; p = p.parent) path.push(nameOf(p));
    const k = path.join(' ← ');
    by.set(k, (by.get(k) || 0) + n.total);
  }
  console.log(`== wołający ${wol}:`);
  for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${pf(v)}  ${k}`);
} else {
  const incl = new Map();
  const self = new Map();
  for (const n of nodes.values()) {
    const k = nameOf(n);
    self.set(k, (self.get(k) || 0) + n.self);
    let dup = false;
    for (let p = n.parent; p; p = p.parent) if (nameOf(p) === k) { dup = true; break; }
    if (!dup) incl.set(k, (incl.get(k) || 0) + n.total);
  }
  console.log(`-- łącznie (ms/klatkę, ${frames} klatek):`);
  for (const [k, v] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${pf(v)}  ${k}`);
  console.log(`\n-- własny czas (ms/klatkę):`);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${pf(v)}  ${k}`);
}
