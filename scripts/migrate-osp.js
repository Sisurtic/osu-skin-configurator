#!/usr/bin/env node
// Migrate old (pretty) config.osp files to the new compact format.
//
// The only change is JSON whitespace: pretty (indented) → compact (single
// line). All data fields are preserved as-is — no field is dropped. Readers
// already tolerate either form; this just shrinks the file.
//
// Usage:
//   migrate-osp.bat                       # auto-detect osu path, dry run
//   node scripts/migrate-osp.js "<osu_path>" [--write]
//   node scripts/migrate-osp.js --file "<config.osp>" [--write]
//   node scripts/migrate-osp.js --auto [--write]
//
// Dry run (no writes) unless --write is passed.

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const AUTO = args.includes('--auto');
const fileIdx = args.indexOf('--file');
const dirArg = args.find(a => !a.startsWith('--') && args.indexOf(a) !== fileIdx + 1);

function autoDetectOsuPath() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData', 'Roaming', 'com.citrusis.osu-skin-configurator', 'config.json'),
    path.join(home, 'AppData', 'Local', 'com.citrusis.osu-skin-configurator', 'config.json'),
  ];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (cfg.osu_path) return cfg.osu_path;
    } catch (_) { /* try next */ }
  }
  return null;
}

function convertFile(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { return { skipped: 'read error: ' + e.message }; }
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch (e) { return { skipped: 'invalid JSON: ' + e.message }; }
  // Re-serialize compact, preserving all fields. No data is dropped.
  const newStr = JSON.stringify(cfg);
  if (newStr === raw.trim()) return { oldSize: raw.length, newSize: newStr.length, written: WRITE, noop: true };
  const oldSize = Buffer.byteLength(raw, 'utf8');
  const newSize = Buffer.byteLength(newStr, 'utf8');
  if (WRITE) fs.writeFileSync(filePath, newStr, 'utf8');
  return { oldSize, newSize, written: WRITE };
}

function findOspFiles(osuPath) {
  const skinsDir = path.join(osuPath, 'Skins');
  const files = [];
  let entries;
  try { entries = fs.readdirSync(skinsDir, { withFileTypes: true }); }
  catch (e) { console.error('Cannot read Skins dir:', skinsDir, '-', e.message); return files; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const osp = path.join(skinsDir, ent.name, 'config.osp');
    if (fs.existsSync(osp)) files.push(osp);
  }
  return files;
}

function fmt(n) { return n.toLocaleString() + ' B'; }

function main() {
  let files = [];
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    files = [args[fileIdx + 1]];
  } else {
    let osuPath = dirArg;
    if (!osuPath && AUTO) {
      osuPath = autoDetectOsuPath();
      if (!osuPath) {
        console.error('Could not auto-detect osu! path from the app config. Pass it explicitly:');
        console.error('  migrate-osp.bat "<osu_path>"');
        return;
      }
      console.log('Auto-detected osu! path:', osuPath);
    }
    if (osuPath) {
      files = findOspFiles(osuPath);
      if (!files.length) { console.log('No config.osp found under', path.join(osuPath, 'Skins')); }
    } else {
      console.log('Usage:');
      console.log('  migrate-osp.bat "<osu_path>"      (or just migrate-osp.bat to auto-detect)');
      console.log('  node scripts/migrate-osp.js --file "<config.osp>" [--write]');
      console.log('(Without --write, runs as a dry run and only reports savings.)');
      return;
    }
  }

  let totalOld = 0, totalNew = 0, converted = 0, noop = 0, skipped = 0;
  for (const f of files) {
    const r = convertFile(f);
    if (r.skipped) { console.log(`SKIP  ${f}  (${r.skipped})`); skipped++; continue; }
    if (r.noop) { console.log(`OK    ${f}  (already compact)`); noop++; continue; }
    totalOld += r.oldSize; totalNew += r.newSize; converted++;
    const pct = ((1 - r.newSize / r.oldSize) * 100).toFixed(1);
    console.log(`${r.written ? 'WROTE' : 'DRY  '} ${f}  ${fmt(r.oldSize)} → ${fmt(r.newSize)}  (-${pct}%)`);
  }
  if (converted) {
    const pct = ((1 - totalNew / totalOld) * 100).toFixed(1);
    console.log(`----  total ${fmt(totalOld)} → ${fmt(totalNew)} (-${pct}%) across ${converted} file(s), ${noop} already compact, ${skipped} skipped`);
  } else if (noop || skipped) {
    console.log(`----  nothing to convert (${noop} already compact, ${skipped} skipped)`);
  }
  if (!WRITE && converted) console.log('\n(dry run — re-run with --write to apply)');
}

main();
