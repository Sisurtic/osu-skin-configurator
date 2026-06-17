const fs = require('fs');
const path = require('path');
const { loadPreset } = require('./preset-manager');
const { readSkinIni, mergeIniEdits, writeSkinIni } = require('./ini-reader');

/**
 * Apply a preset to a skin:
 * 1. Load preset JSON by id
 * 2. Read, merge, and write skin.ini (with backup)
 * 3. Copy files from preset's files/ folder to skin root
 *
 * All paths validated to stay within skin directory.
 */
function applyPreset(skinPath, presetId) {
  // 1. Load preset
  const preset = loadPreset(skinPath, presetId);
  if (!preset) {
    throw new Error('预设不存在: ' + presetId);
  }

  const actions = preset.actions || {};
  const skinIniEdits = actions.skinIni || [];
  const fileCopies = actions.fileCopies || [];
  const fileDeletes = actions.fileDeletes || [];
  const warnings = [];
  const normalizedSkin = path.normalize(skinPath);

  // 2. Apply skin.ini changes
  let skinIniChanges = 0;
  if (skinIniEdits.length > 0) {
    const sections = readSkinIni(skinPath);
    mergeIniEdits(sections, skinIniEdits);
    writeSkinIni(skinPath, sections);
    skinIniChanges = skinIniEdits.length;
  }

  // 3. Copy files
  let filesCopied = 0;
  for (const copy of fileCopies) {
    const sourcePath = copy.source;
    const sourceName = path.basename(sourcePath);
    const destRelPath = copy.destination || '';

    if (destRelPath.includes('..') || path.isAbsolute(destRelPath)) {
      warnings.push(`跳过 "${sourceName}": 目标路径无效 (不允许 .. 或绝对路径)`);
      continue;
    }

    const isDirOnly = !destRelPath || destRelPath.endsWith('/') || destRelPath.endsWith('\\');
    const destPath = isDirOnly
      ? path.join(skinPath, destRelPath, sourceName)
      : path.join(skinPath, destRelPath);

    const normalizedDest = path.normalize(destPath);
    if (!normalizedDest.startsWith(normalizedSkin + path.sep) && normalizedDest !== normalizedSkin) {
      warnings.push(`跳过 "${sourceName}": 目标路径超出皮肤目录`);
      continue;
    }

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
      filesCopied++;
    } else {
      warnings.push(`跳过 "${sourceName}": 源文件不存在`);
    }
  }

  // 4. Delete files
  let filesDeleted = 0;
  for (const del of fileDeletes) {
    const delPath = del.path;
    if (delPath.includes('..') || path.isAbsolute(delPath)) {
      warnings.push(`跳过删除 "${delPath}": 路径无效`);
      continue;
    }
    const fullPath = path.join(skinPath, delPath);
    const normalizedDel = path.normalize(fullPath);
    if (!normalizedDel.startsWith(normalizedSkin + path.sep) && normalizedDel !== normalizedSkin) {
      warnings.push(`跳过删除 "${delPath}": 路径超出皮肤目录`);
      continue;
    }
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      filesDeleted++;
    } else {
      warnings.push(`跳过删除 "${delPath}": 文件不存在`);
    }
  }

  return { skinIniChanges, filesCopied, filesDeleted, warnings };
}

/**
 * Apply multiple presets at once, merging their actions.
 * Later presets override earlier ones on INI key conflicts (same section + maniaKeys + key).
 */
function applyMultiplePresets(skinPath, presetIds) {
  const allIniEdits = [];
  const allFileCopies = [];
  const allFileDeletes = [];
  const warnings = [];

  for (const id of presetIds) {
    const preset = loadPreset(skinPath, id);
    if (!preset) {
      warnings.push('预设不存在: ' + id);
      continue;
    }
    const actions = preset.actions || {};
    for (const copy of (actions.fileCopies || [])) {
      allFileCopies.push({ ...copy });
    }
    for (const del of (actions.fileDeletes || [])) {
      allFileDeletes.push(del);
    }
    for (const edit of (actions.skinIni || [])) {
      allIniEdits.push(edit);
    }
  }

  // Deduplicate INI edits: same section + maniaKeys + key → last one wins
  const editKey = (e) => `${e.section}◆${e.maniaKeys || ''}◆${e.key}`;
  const mergedMap = new Map();
  for (const edit of allIniEdits) {
    mergedMap.set(editKey(edit), edit);
  }
  const mergedIniEdits = [...mergedMap.values()];

  // Apply merged INI changes
  let skinIniChanges = 0;
  if (mergedIniEdits.length > 0) {
    const sections = readSkinIni(skinPath);
    mergeIniEdits(sections, mergedIniEdits);
    writeSkinIni(skinPath, sections);
    skinIniChanges = mergedIniEdits.length;
  }

  // Copy files
  let filesCopied = 0;
  const normalizedSkin = path.normalize(skinPath);
  for (const copy of allFileCopies) {
    const sourcePath = copy.source;
    const sourceName = path.basename(sourcePath);
    const destRelPath = copy.destination || '';

    if (destRelPath.includes('..') || path.isAbsolute(destRelPath)) {
      warnings.push(`跳过 "${sourceName}": 目标路径无效`);
      continue;
    }

    const isDirOnly = !destRelPath || destRelPath.endsWith('/') || destRelPath.endsWith('\\');
    const destPath = isDirOnly
      ? path.join(skinPath, destRelPath, sourceName)
      : path.join(skinPath, destRelPath);

    const normalizedDest = path.normalize(destPath);
    if (!normalizedDest.startsWith(normalizedSkin + path.sep) && normalizedDest !== normalizedSkin) {
      warnings.push(`跳过 "${sourceName}": 目标路径超出皮肤目录`);
      continue;
    }

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
      filesCopied++;
    } else {
      warnings.push(`跳过 "${sourceName}": 源文件不存在`);
    }
  }

  // Delete files
  let filesDeleted = 0;
  for (const del of allFileDeletes) {
    const delPath = del.path;
    if (delPath.includes('..') || path.isAbsolute(delPath)) {
      warnings.push(`跳过删除 "${delPath}": 路径无效`);
      continue;
    }
    const fullPath = path.join(skinPath, delPath);
    const normalizedDel = path.normalize(fullPath);
    if (!normalizedDel.startsWith(normalizedSkin + path.sep) && normalizedDel !== normalizedSkin) {
      warnings.push(`跳过删除 "${delPath}": 路径超出皮肤目录`);
      continue;
    }
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      filesDeleted++;
    } else {
      warnings.push(`跳过删除 "${delPath}": 文件不存在`);
    }
  }

  return { skinIniChanges, filesCopied, filesDeleted, warnings };
}

module.exports = { applyPreset, applyMultiplePresets };
