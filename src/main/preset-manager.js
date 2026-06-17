const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'config.osp';

// ── Config file operations ──

function loadConfig(skinPath) {
  const configPath = path.join(skinPath, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return createEmptyConfig();
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Detect old format: has presets with `filename` or has `groupOrder` but no `rootGroupIds`
    if (!config.rootGroupIds && !config.groups) {
      // Old format — treat as empty (no migration)
      return createEmptyConfig();
    }

    // Validate new format
    return {
      nextPresetId: config.nextPresetId || 1,
      nextGroupId: config.nextGroupId || 1,
      rootGroupIds: config.rootGroupIds || [],
      groups: config.groups || [],
      presets: (config.presets || []).map(p => ({
        id: p.id,
        meta: p.meta || { name: '预设 ' + p.id, description: '', previewPath: '' },
        actions: p.actions || { skinIni: [], fileCopies: [], fileDeletes: [] },
      })),
    };
  } catch (_) {
    return createEmptyConfig();
  }
}

function createEmptyConfig() {
  return {
    nextPresetId: 1,
    nextGroupId: 1,
    rootGroupIds: [],
    groups: [],
    presets: [],
  };
}

function saveConfig(skinPath, config) {
  const configPath = path.join(skinPath, CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ── Tree helpers ──

function findGroup(config, groupId) {
  return config.groups.find(g => g.id === groupId) || null;
}

function findParentGroup(config, childId, type) {
  for (const g of config.groups) {
    if (g.children && g.children.some(c => c.type === type && c.id === childId)) {
      return g;
    }
  }
  return null; // at root level
}

function removeFromParent(config, childId, type) {
  // Check root level — only groups can be at root (presets live inside groups' children)
  if (type === 'group') {
    const rootIdx = config.rootGroupIds.indexOf(childId);
    if (rootIdx >= 0) {
      config.rootGroupIds.splice(rootIdx, 1);
      return true;
    }
  }
  // Check inside groups
  for (const g of config.groups) {
    if (g.children) {
      const idx = g.children.findIndex(c => c.type === type && c.id === childId);
      if (idx >= 0) {
        g.children.splice(idx, 1);
        return true;
      }
    }
  }
  return false;
}

function insertIntoParent(config, childId, type, parentGroupId, index) {
  if (type === 'preset' && (parentGroupId === null || parentGroupId === undefined)) {
    throw new Error('预设不能放置在根层级 (rootGroupIds 只能包含分组 ID)');
  }
  if (parentGroupId === null || parentGroupId === undefined) {
    // Insert group at root level
    const effectiveIndex = (index !== undefined && index >= 0) ? index : config.rootGroupIds.length;
    config.rootGroupIds.splice(effectiveIndex, 0, childId);
  } else {
    const group = findGroup(config, parentGroupId);
    if (!group) throw new Error('目标分组不存在: ' + parentGroupId);
    if (!group.children) group.children = [];
    const effectiveIndex = (index !== undefined && index >= 0) ? index : group.children.length;
    group.children.splice(effectiveIndex, 0, { type, id: childId });
  }
}

// ── ID compaction ──

function compactIds(config) {
  // --- Presets: sort by current ID, reassign 1,2,3,... ---
  const presetIdMap = {};
  const sortedPresets = [...config.presets].sort((a, b) => a.id - b.id);
  for (let i = 0; i < sortedPresets.length; i++) {
    presetIdMap[sortedPresets[i].id] = i + 1;
    sortedPresets[i].id = i + 1;
  }
  config.presets = sortedPresets;

  // --- Groups: sort by current ID, reassign 1,2,3,... ---
  const groupIdMap = {};
  const sortedGroups = [...config.groups].sort((a, b) => a.id - b.id);
  for (let i = 0; i < sortedGroups.length; i++) {
    groupIdMap[sortedGroups[i].id] = i + 1;
    sortedGroups[i].id = i + 1;
  }
  config.groups = sortedGroups;

  // --- Update all cross-references ---
  for (const g of config.groups) {
    if (g.children) {
      for (const c of g.children) {
        if (c.type === 'preset') {
          c.id = presetIdMap[c.id];
        } else if (c.type === 'group') {
          c.id = groupIdMap[c.id];
        }
      }
    }
  }
  config.rootGroupIds = config.rootGroupIds.map(id => groupIdMap[id]);

  // --- Reset counters ---
  config.nextPresetId = config.presets.length + 1;
  config.nextGroupId = config.groups.length + 1;
}

// ── Scan (returns full tree for renderer) ──

function scanSkin(skinPath) {
  const config = loadConfig(skinPath);

  // Build preset summaries
  const presetSummaries = config.presets.map(p => {
    const previewPath = p.meta?.previewPath;
    return {
      id: p.id,
      meta: p.meta || { name: '预设 ' + p.id },
      hasPreview: !!(previewPath && fs.existsSync(previewPath)),
      skinIniCount: (p.actions?.skinIni || []).length,
      fileCopyCount: (p.actions?.fileCopies || []).length,
    };
  });

  return {
    presets: presetSummaries,
    groups: config.groups,
    rootGroupIds: config.rootGroupIds,
    nextPresetId: config.nextPresetId,
    nextGroupId: config.nextGroupId,
  };
}

// ── Preset CRUD ──

function loadPreset(skinPath, presetId) {
  const config = loadConfig(skinPath);
  const preset = config.presets.find(p => p.id === presetId);
  return preset || null;
}

function savePreset(skinPath, presetId, data) {
  const config = loadConfig(skinPath);
  const isNew = (presetId === null || presetId === undefined);

  let id;
  if (isNew) {
    id = config.nextPresetId;
    config.nextPresetId++;
  } else {
    id = presetId;
  }

  const entry = {
    id,
    meta: data.meta || { name: '预设 ' + id, description: '', previewPath: '' },
    actions: data.actions || { skinIni: [], fileCopies: [], fileDeletes: [] },
  };

  const existingIdx = config.presets.findIndex(p => p.id === id);
  if (existingIdx >= 0) {
    config.presets[existingIdx] = entry;
  } else {
    config.presets.push(entry);
    // New presets are orphaned (not assigned to any group).
    // The frontend renders orphan presets at the top of the tree.
  }

  saveConfig(skinPath, config);
  return id; // return assigned/updated id
}

function deletePreset(skinPath, presetId) {
  const config = loadConfig(skinPath);
  // Remove from presets array
  config.presets = config.presets.filter(p => p.id !== presetId);
  // Remove from parent group's children
  removeFromParent(config, presetId, 'preset');
  compactIds(config);
  saveConfig(skinPath, config);
}

// ── Group CRUD ──

function addGroup(skinPath, name, parentGroupId) {
  const config = loadConfig(skinPath);
  const id = config.nextGroupId;
  config.nextGroupId++;

  const group = {
    id,
    name: name || '新分组',
    collapsed: false,
    children: [],
  };
  config.groups.push(group);
  insertIntoParent(config, id, 'group', parentGroupId);

  saveConfig(skinPath, config);
  return id;
}

function removeGroup(skinPath, groupId) {
  const config = loadConfig(skinPath);
  const group = findGroup(config, groupId);
  if (!group) throw new Error('分组不存在: ' + groupId);
  if (group.children && group.children.length > 0) {
    throw new Error('分组非空，无法删除');
  }
  // Remove from parent
  removeFromParent(config, groupId, 'group');
  // Remove from groups array
  config.groups = config.groups.filter(g => g.id !== groupId);
  compactIds(config);
  saveConfig(skinPath, config);
}

function renameGroup(skinPath, groupId, newName) {
  const config = loadConfig(skinPath);
  const group = findGroup(config, groupId);
  if (!group) throw new Error('分组不存在: ' + groupId);
  group.name = newName || '未命名';
  saveConfig(skinPath, config);
}

// ── Tree movement ──

function movePreset(skinPath, presetId, targetGroupId, index) {
  const config = loadConfig(skinPath);
  // Verify preset exists
  if (!config.presets.some(p => p.id === presetId)) {
    throw new Error('预设不存在: ' + presetId);
  }
  // Verify target group exists (null = make orphaned, no group)
  if (targetGroupId !== null && targetGroupId !== undefined) {
    const targetGroup = findGroup(config, targetGroupId);
    if (!targetGroup) throw new Error('目标分组不存在: ' + targetGroupId);
  }
  // Remove from current parent
  removeFromParent(config, presetId, 'preset');
  // Insert into target group, or leave orphaned
  if (targetGroupId !== null && targetGroupId !== undefined) {
    insertIntoParent(config, presetId, 'preset', targetGroupId, index);
  }
  saveConfig(skinPath, config);
}

function moveGroup(skinPath, groupId, targetGroupId, index) {
  const config = loadConfig(skinPath);
  // Verify group exists
  if (!findGroup(config, groupId)) {
    throw new Error('分组不存在: ' + groupId);
  }
  // Prevent moving into itself or its descendant
  if (targetGroupId !== null && targetGroupId !== undefined) {
    if (groupId === targetGroupId) throw new Error('不能将分组移动到自身内部');
    if (isDescendant(config, groupId, targetGroupId)) {
      throw new Error('不能将分组移动到其子分组内部');
    }
  }
  // Remove from current parent
  removeFromParent(config, groupId, 'group');
  // Insert into target
  insertIntoParent(config, groupId, 'group', targetGroupId, index);
  saveConfig(skinPath, config);
}

function isDescendant(config, ancestorId, groupId) {
  const ancestor = findGroup(config, ancestorId);
  if (!ancestor || !ancestor.children) return false;
  for (const child of ancestor.children) {
    if (child.type === 'group') {
      if (child.id === groupId) return true;
      if (isDescendant(config, child.id, groupId)) return true;
    }
  }
  return false;
}

function reorderChildren(skinPath, parentGroupId, childOrder) {
  const config = loadConfig(skinPath);
  if (parentGroupId === null || parentGroupId === undefined) {
    // Reorder root level
    config.rootGroupIds = childOrder;
  } else {
    const group = findGroup(config, parentGroupId);
    if (!group) throw new Error('分组不存在: ' + parentGroupId);
    // childOrder is array of child IDs (numbers)
    // Reorder group.children to match childOrder
    const orderMap = new Map(childOrder.map((id, i) => [id, i]));
    group.children.sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
      const bi = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
      return ai - bi;
    });
  }
  saveConfig(skinPath, config);
}

// ── Collapse ──

function setGroupCollapsed(skinPath, groupId, collapsed) {
  const config = loadConfig(skinPath);
  const group = findGroup(config, groupId);
  if (!group) throw new Error('分组不存在: ' + groupId);
  group.collapsed = !!collapsed;
  saveConfig(skinPath, config);
}

// ── Recursive delete ──

function deleteGroupRecursive(skinPath, groupId) {
  const config = loadConfig(skinPath);
  const group = findGroup(config, groupId);
  if (!group) throw new Error('分组不存在: ' + groupId);

  // Collect all preset ids and sub-group ids to delete
  const presetIdsToDelete = new Set();
  const groupIdsToDelete = new Set();

  function collect(group) {
    groupIdsToDelete.add(group.id);
    if (group.children) {
      for (const child of group.children) {
        if (child.type === 'preset') {
          presetIdsToDelete.add(child.id);
        } else if (child.type === 'group') {
          const subGroup = findGroup(config, child.id);
          if (subGroup) collect(subGroup);
        }
      }
    }
  }

  collect(group);

  // Capture deleted IDs BEFORE filtering (they are needed by frontend to clear stale state)
  const deletedPresetIds = [...presetIdsToDelete];
  const deletedGroupIds = [...groupIdsToDelete];

  // Remove all collected presets
  config.presets = config.presets.filter(p => !presetIdsToDelete.has(p.id));
  // Remove all collected groups
  config.groups = config.groups.filter(g => !groupIdsToDelete.has(g.id));
  // Remove from parent
  removeFromParent(config, groupId, 'group');
  // Clean rootGroupIds of deleted groups
  config.rootGroupIds = config.rootGroupIds.filter(id => !groupIdsToDelete.has(id));

  compactIds(config);
  saveConfig(skinPath, config);
  return { deletedPresets: deletedPresetIds.length, deletedGroups: deletedGroupIds.length, deletedPresetIds, deletedGroupIds };
}

// ── Preview ──

function getPreviewDataUrl(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mime = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
    : ext === '.gif' ? 'image/gif'
    : 'image/png';
  return `data:${mime};base64,${base64}`;
}

module.exports = {
  scanSkin,
  loadPreset,
  savePreset,
  deletePreset,
  addGroup,
  removeGroup,
  renameGroup,
  movePreset,
  moveGroup,
  reorderChildren,
  setGroupCollapsed,
  deleteGroupRecursive,
  compactIds,
  getPreviewDataUrl,
};
