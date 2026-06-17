const fs = require('fs');

/**
 * Parse INI text into an ordered array of sections.
 * Each section: { section: string, keys: Map<string, string> }
 * Supports duplicate section names (e.g., multiple [Mania] sections).
 */
function parseIni(content) {
  const result = [];
  let currentEntry = null;

  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentEntry = { section: sectionMatch[1].trim(), keys: new Map() };
      result.push(currentEntry);
      continue;
    }

    const kvMatch = line.match(/^([^=:]+)[=:]\s*(.*)$/);
    if (kvMatch && currentEntry) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      currentEntry.keys.set(key, value);
    }
  }

  return result;
}

/**
 * Serialize an ordered array of sections back to INI text.
 */
function serializeIni(sections) {
  const lines = [];
  for (const entry of sections) {
    lines.push(`[${entry.section}]`);
    for (const [key, value] of entry.keys) {
      lines.push(`${key}: ${value}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Read skin.ini file into parsed sections array.
 */
function readSkinIni(skinPath) {
  const iniPath = require('path').join(skinPath, 'skin.ini');
  if (!fs.existsSync(iniPath)) {
    return [];
  }
  const content = fs.readFileSync(iniPath, 'utf-8');
  return parseIni(content);
}

/**
 * Build a lookup key for a section entry.
 * For non-Mania sections, this is just the section name.
 * For Mania sections, this includes the Keys value: "Mania◆Keys:4".
 */
function sectionKey(entry) {
  if (entry.section !== 'Mania') return entry.section;
  const keysVal = entry.keys.get('Keys');
  return keysVal ? `Mania◆Keys:${keysVal}` : 'Mania◆Keys:?';
}

/**
 * Find a section entry by its logical key.
 */
function findSection(sections, key) {
  for (const entry of sections) {
    if (sectionKey(entry) === key) return entry;
  }
  return null;
}

/**
 * Merge INI edits into the sections array (mutates sections).
 * Edits have shape: { section, key, value, maniaKeys? }
 * - For non-Mania sections: edits with the same section name go into the same section.
 * - For Mania sections: maniaKeys determines which [Mania] section gets the edit.
 *   Multiple [Mania] sections differentiated by Keys value are supported.
 */
function mergeIniEdits(sections, edits) {
  for (const edit of edits) {
    const targetKey = edit.section === 'Mania'
      ? `Mania◆Keys:${edit.maniaKeys || '?'}`
      : edit.section;

    let entry = findSection(sections, targetKey);

    if (!entry) {
      // Create new section entry
      entry = { section: edit.section, keys: new Map() };
      if (edit.section === 'Mania' && edit.maniaKeys != null) {
        entry.keys.set('Keys', String(edit.maniaKeys));
      }
      sections.push(entry);
    }

    if (edit._delete) {
      entry.keys.delete(edit.key);
      // Remove empty sections (only Mania may keep its Keys marker)
    } else {
      entry.keys.set(edit.key, edit.value);
    }
  }
}

/**
 * Write merged INI sections back to skin.ini, creating a timestamped backup first.
 */
function writeSkinIni(skinPath, sections) {
  const iniPath = require('path').join(skinPath, 'skin.ini');
  const content = serializeIni(sections);
  fs.writeFileSync(iniPath, content, 'utf-8');
}

module.exports = { parseIni, serializeIni, readSkinIni, mergeIniEdits, writeSkinIni, sectionKey, findSection };
