// Sync the version from package.json into Cargo.toml and tauri.conf.json.
// package.json is the single source of truth; this script mirrors it so a
// version bump only needs one edit. Cargo.lock follows Cargo.toml automatically
// on the next `cargo build`, so it is intentionally not touched here.
//
// Idempotent: if the targets already match, no files are written and nothing is
// staged — safe to run from a pre-commit hook on every commit.
//
// Usage:
//   node scripts/sync-version.js        # write changes in place
//   node scripts/sync-version.js --check # exit 1 if out of sync (no writes)
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content);
}

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[sync-version] invalid version in package.json: ${version}`);
  process.exit(1);
}

// (file, regex, replaceFn) → returns true if the file was (or would be) changed.
function patch(file, regex, build) {
  const before = read(file);
  let changed = false;
  const after = before.replace(regex, (match) => {
    const next = build();
    if (next !== match) { changed = true; return next; }
    return match;
  });
  if (changed && !checkOnly) write(file, after);
  return changed;
}

const targets = [
  // src-tauri/Cargo.toml:  version = "x.y.z"  (only the [package] line)
  {
    file: 'src-tauri/Cargo.toml',
    changed: patch(
      'src-tauri/Cargo.toml',
      /^version = "[^"]*"/m,
      () => `version = "${version}"`
    ),
  },
  // src-tauri/tauri.conf.json:  "version": "x.y.z"
  {
    file: 'src-tauri/tauri.conf.json',
    changed: patch(
      'src-tauri/tauri.conf.json',
      /"version":\s*"[^"]*"/,
      () => `"version": "${version}"`
    ),
  },
];

const changedFiles = targets.filter(t => t.changed).map(t => t.file);

if (checkOnly) {
  if (changedFiles.length) {
    console.error(`[sync-version] out of sync with package.json (${version}): ${changedFiles.join(', ')}`);
    process.exit(1);
  }
  console.log(`[sync-version] all targets at ${version} ✓`);
  process.exit(0);
}

if (changedFiles.length) {
  console.log(`[sync-version] synced ${version} → ${changedFiles.join(', ')}`);
} else {
  console.log(`[sync-version] all targets already at ${version} ✓`);
}
