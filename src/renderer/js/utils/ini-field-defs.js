// Generated from osu-settings.json — field definitions for skin.ini editor
// Each entry: { section, key, type, cn, en, default?, options? }

const INI_FIELD_DEFS = (() => {
  // This is a static copy of osu-settings.json data.
  // In a full build, this would be generated automatically.
  return [
    // ── string ──
    { section: 'General', key: 'Name', type: 'string', cn: '皮肤名称', en: 'Skin Name' },
    { section: 'General', key: 'Author', type: 'string', cn: '皮肤作者', en: 'Skin Author' },
    { section: 'General', key: 'Version', type: 'string', cn: '皮肤版本 (或 latest)', en: 'Skin Version (or latest)' },

    // ── number ──
    { section: 'General', key: 'AnimationFramerate', type: 'number', cn: '动画帧率', en: 'Animation Framerate', default: '-1' },
    { section: 'Fonts', key: 'HitCircleOverlap', type: 'number', cn: '打击圈数字重叠像素', en: 'Hit Circle Number Overlap', default: '-2' },
    { section: 'Fonts', key: 'ScoreOverlap', type: 'number', cn: '分数数字重叠像素', en: 'Score Number Overlap', default: '0' },
    { section: 'Fonts', key: 'ComboOverlap', type: 'number', cn: '连击数字重叠像素', en: 'Combo Number Overlap', default: '0' },
    { section: 'Mania', key: 'Keys', type: 'number', cn: '键数', en: 'Number of Keys' },
    { section: 'Mania', key: 'ColumnStart', type: 'number', cn: '左侧轨道位置', en: 'Left Column Start Position', default: '136' },
    { section: 'Mania', key: 'ColumnRight', type: 'number', cn: '列最多绘制位置', en: 'Column Draw Limit', default: '19' },
    { section: 'Mania', key: 'BarlineHeight', type: 'number', cn: '小节线宽度', en: 'Barline Width', default: '1.2' },
    { section: 'Mania', key: 'WidthForNoteHeightScale', type: 'number', cn: '列宽不同时 Note 高度', en: 'Note Height When Different Column Width' },
    { section: 'Mania', key: 'LightFramePerSecond', type: 'number', cn: '灯光帧率 (已弃用)', en: 'Light Frame Per Second (deprecated)' },
    { section: 'Mania', key: 'StageSeparation', type: 'number', cn: '轨道分割间距', en: 'Split Distance', default: '40' },

    // ── integer ──
    { section: 'Mania', key: 'HitPosition', type: 'integer', cn: '判定线高度', en: 'Judgement Line Height', default: '402' },
    { section: 'Mania', key: 'LightPosition', type: 'integer', cn: 'StageLight 高度', en: 'StageLight Height', default: '413' },
    { section: 'Mania', key: 'ScorePosition', type: 'integer', cn: '击打结果高度', en: 'Hitbursts Height' },
    { section: 'Mania', key: 'ComboPosition', type: 'integer', cn: '连击数高度', en: 'Combo Height' },

    // ── list ──
    { section: 'General', key: 'CustomComboBurstSounds', type: 'list', cn: '连击提示音触发连击数列表', en: 'Comboburst Sound Trigger Combo List' },
    { section: 'Mania', key: 'ColumnSpacing', type: 'list', cn: '列间距列表', en: 'Column Distance List', default: '0' },
    { section: 'Mania', key: 'ColumnWidth', type: 'list', cn: '列宽列表', en: 'Column Width List', default: '30' },
    { section: 'Mania', key: 'ColumnLineWidth', type: 'list', cn: '列分隔线宽度列表', en: 'Column Separators Thickness List', default: '2' },
    { section: 'Mania', key: 'LightingNWidth', type: 'list', cn: 'LightingN 宽度列表', en: 'LightingN Width List' },
    { section: 'Mania', key: 'LightingLWidth', type: 'list', cn: 'LightingL 宽度列表', en: 'LightingL Width List' },

    // ── bool ──
    { section: 'General', key: 'AllowSliderBallTint', type: 'bool', cn: '允许滑条圈使用连击颜色', en: 'Allow Combo Color for Slider Ball', default: '0' },
    { section: 'General', key: 'ComboBurstRandom', type: 'bool', cn: '随机顺序显示连击提示图', en: 'Show Combobursts in Random Order', default: '0' },
    { section: 'General', key: 'CursorCentre', type: 'bool', cn: '光标原点居中', en: 'Center Cursor Origin', default: '1' },
    { section: 'General', key: 'CursorExpand', type: 'bool', cn: '点击时光标放大', en: 'Expand Cursor on Click', default: '1' },
    { section: 'General', key: 'CursorRotate', type: 'bool', cn: '光标持续旋转', en: 'Rotate Cursor Continuously', default: '1' },
    { section: 'General', key: 'CursorTrailRotate', type: 'bool', cn: '光标轨迹持续旋转', en: 'Rotate Cursor Trail Continuously', default: '1' },
    { section: 'General', key: 'HitCircleOverlayAboveNumber', type: 'bool', cn: '数字上方绘制 Hitcircleoverlay', en: 'Draw Hitcircleoverlay Above Number', default: '1' },
    { section: 'General', key: 'LayeredHitSounds', type: 'bool', cn: '总是播放 Hitnormal 音效', en: 'Always Play Hitnormal Sound', default: '1' },
    { section: 'General', key: 'SliderBallFlip', type: 'bool', cn: '翻转滑条圈', en: 'Flip Slider Ball', default: '1' },
    { section: 'General', key: 'SpinnerFadePlayfield', type: 'bool', cn: '转盘期间暗化游玩区域', en: 'Dim Playfield During Spinner', default: '0' },
    { section: 'General', key: 'SpinnerFrequencyModulate', type: 'bool', cn: '升高转盘音调', en: 'Pitch Up Spinnerspin Sound', default: '1' },
    { section: 'General', key: 'SpinnerNoBlink', type: 'bool', cn: '关闭转盘顶部闪烁', en: 'Always Display Spinner Top', default: '0' },
    { section: 'Mania', key: 'JudgementLine', type: 'bool', cn: '绘制额外判定线', en: 'Draw Additional Judgement Line', default: '1' },
    { section: 'Mania', key: 'SeparateScore', type: 'bool', cn: '只在得分轨道显示打击结果', en: 'Only Show Hitbursts on Scored Stage', default: '1' },
    { section: 'Mania', key: 'KeysUnderNotes', type: 'bool', cn: '按键被 Note 覆盖', en: 'Cover Keys with Notes', default: '0' },
    { section: 'Mania', key: 'UpsideDown', type: 'bool', cn: '颠倒轨道', en: 'Upside Down Stage', default: '0' },
    { section: 'Mania', key: 'KeyFlipWhenUpsideDown', type: 'bool', cn: '翻转所有按键', en: 'Flip All Keys', default: '1' },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown', type: 'bool', cn: '翻转所有 Note', en: 'Flip All Notes', default: '1' },
    { section: 'Mania', key: 'KeyFlipWhenUpsideDown#', type: 'bool', cn: '翻转指定列按键', en: 'Flip Key of This Column', default: '1', perColumn: true },
    { section: 'Mania', key: 'KeyFlipWhenUpsideDown#D', type: 'bool', cn: '翻转指定列按下的按键', en: 'Flip Pressed Key of This Column', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#', type: 'bool', cn: '翻转指定列 Note', en: 'Flip Note of This Column', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#H', type: 'bool', cn: '翻转指定列 NoteH', en: 'Flip NoteH of This Column', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#L', type: 'bool', cn: '翻转指定列 NoteL', en: 'Flip NoteL of This Column', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#T', type: 'bool', cn: '翻转指定列 NoteT', en: 'Flip NoteT of This Column', default: '1', perColumn: true },

    // ── section (enum dropdown) ──
    { section: 'Mania', key: 'SpecialStyle', type: 'section', cn: '特殊键样式', en: 'Special Key Style', default: '0',
      options: [{ value: '0', label: '无' }, { value: '1', label: '外侧' }, { value: '2', label: '内侧' }] },
    { section: 'Mania', key: 'ComboBurstStyle', type: 'section', cn: '连击提示图位置', en: 'Comboburst Position', default: '1',
      options: [{ value: '0', label: '左侧' }, { value: '1', label: '右侧' }, { value: '2', label: '两侧' }] },
    { section: 'Mania', key: 'SplitStages', type: 'section', cn: '轨道合并/分割', en: 'Split Stages', default: ' ',
      options: [{ value: ' ', label: '默认' }, { value: '0', label: '合并' }, { value: '1', label: '分割' }] },
    { section: 'Mania', key: 'NoteBodyStyle', type: 'section', cn: 'NoteL 样式', en: 'NoteL Style', default: '1',
      options: [{ value: '0', label: '拉伸' }, { value: '1', label: '顶部平铺' }, { value: '2', label: '底部平铺' }] },
    { section: 'Mania', key: 'NoteBodyStyle#', type: 'section', cn: '指定列 NoteL 样式', en: 'Column NoteL Style', default: '1', perColumn: true,
      options: [{ value: '0', label: '拉伸' }, { value: '1', label: '顶部平铺' }, { value: '2', label: '底部平铺' }] },

    // ── rgb ──
    { section: 'Colours', key: 'Combo1', type: 'rgb', cn: '连击颜色1', en: 'Combo Color 1', default: '255,192,0' },
    { section: 'Colours', key: 'Combo2', type: 'rgb', cn: '连击颜色2', en: 'Combo Color 2', default: '0,202,0' },
    { section: 'Colours', key: 'Combo3', type: 'rgb', cn: '连击颜色3', en: 'Combo Color 3', default: '18,124,255' },
    { section: 'Colours', key: 'Combo4', type: 'rgb', cn: '连击颜色4', en: 'Combo Color 4', default: '242,24,57' },
    { section: 'Colours', key: 'Combo5', type: 'rgb', cn: '连击颜色5', en: 'Combo Color 5' },
    { section: 'Colours', key: 'Combo6', type: 'rgb', cn: '连击颜色6', en: 'Combo Color 6' },
    { section: 'Colours', key: 'Combo7', type: 'rgb', cn: '连击颜色7', en: 'Combo Color 7' },
    { section: 'Colours', key: 'Combo8', type: 'rgb', cn: '连击颜色8', en: 'Combo Color 8' },
    { section: 'Colours', key: 'InputOverlayText', type: 'rgb', cn: '输入按键数字颜色', en: 'Input Key Number Color', default: '0,0,0' },
    { section: 'Colours', key: 'MenuGlow', type: 'rgb', cn: '主菜单外发光颜色', en: 'Menu Glow Color', default: '0,78,155' },
    { section: 'Colours', key: 'SliderBall', type: 'rgb', cn: '默认滑条圈颜色', en: 'Default SliderBall Color', default: '2,170,255' },
    { section: 'Colours', key: 'SliderBorder', type: 'rgb', cn: '滑条边框颜色', en: 'Slider Border Color', default: '255,255,255' },
    { section: 'Colours', key: 'SliderTrackOverride', type: 'rgb', cn: '滑条轨道颜色', en: 'Slider Track Color' },
    { section: 'Colours', key: 'SongSelectActiveText', type: 'rgb', cn: '已选择面板文字颜色', en: 'Active Panel Text Color', default: '0,0,0' },
    { section: 'Colours', key: 'SongSelectInactiveText', type: 'rgb', cn: '未选择面板文字颜色', en: 'Inactive Panel Text Color', default: '255,255,255' },
    { section: 'Colours', key: 'SpinnerBackground', type: 'rgb', cn: '转盘背景颜色', en: 'Spinner Background Color', default: '100,100,100' },
    { section: 'Colours', key: 'StarBreakAdditive', type: 'rgb', cn: '休息段 star2 颜色', en: 'Star2 Color During Breaks', default: '255,182,193' },
    { section: 'CatchTheBeat', key: 'HyperDash', type: 'rgb', cn: '红果跳 catcher 颜色', en: 'HyperDash Catcher Color', default: '255,0,0' },
    { section: 'CatchTheBeat', key: 'HyperDashFruit', type: 'rgb', cn: '红果跳 fruit 颜色', en: 'HyperDash Fruit Color' },
    { section: 'CatchTheBeat', key: 'HyperDashAfterImage', type: 'rgb', cn: '红果跳残影颜色', en: 'HyperDash Ghost Color' },
    { section: 'Mania', key: 'ColourLight#', type: 'rgb', cn: '指定列闪光颜色', en: 'Column Lighting Color', default: '55,255,255', perColumn: true },
    { section: 'Mania', key: 'ColourJudgementLine', type: 'rgb', cn: '判定线颜色', en: 'Judgement Line Color', default: '255,255,255' },
    { section: 'Mania', key: 'ColourKeyWarning', type: 'rgb', cn: '按键提示颜色', en: 'Key Bind Color', default: '0,0,0' },
    { section: 'Mania', key: 'ColourBreak', type: 'rgb', cn: '断连颜色', en: 'Combo Break Color', default: '255,0,0' },

    // ── rgba ──
    { section: 'Mania', key: 'Colour#', type: 'rgba', cn: '指定列背景颜色', en: 'Hold Note Color', default: '0,0,0,255', perColumn: true },
    { section: 'Mania', key: 'ColourColumnLine', type: 'rgba', cn: '分隔线颜色', en: 'Column Separator Color', default: '255,255,255,255' },
    { section: 'Mania', key: 'ColourBarline', type: 'rgba', cn: '小节线颜色', en: 'Bar Line Color', default: '255,255,255,255' },
    { section: 'Mania', key: 'ColourHold', type: 'rgba', cn: '长按颜色', en: 'Hold Note Color', default: '255,191,51,255' },

    // ── path ──
    { section: 'Fonts', key: 'HitCirclePrefix', type: 'path', cn: '打击圈数字路径', en: 'Hit Circle Number Path' },
    { section: 'Fonts', key: 'ScorePrefix', type: 'path', cn: '分数数字路径', en: 'Score Number Path' },
    { section: 'Fonts', key: 'ComboPrefix', type: 'path', cn: '连击数字路径', en: 'Combo Number Path' },
    { section: 'Mania', key: 'KeyImage#', type: 'path', cn: '指定列按键路径', en: 'Key Image Path', perColumn: true },
    { section: 'Mania', key: 'KeyImage#D', type: 'path', cn: '指定列按下按键路径', en: 'Key Pressed Image Path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#', type: 'path', cn: '指定列 Note 路径', en: 'Note Image Path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#H', type: 'path', cn: '指定列 NoteH 路径', en: 'NoteH Image Path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#L', type: 'path', cn: '指定列 NoteL 路径', en: 'NoteL Image Path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#T', type: 'path', cn: '指定列 NoteT 路径', en: 'NoteT Image Path', perColumn: true },
    { section: 'Mania', key: 'StageLeft', type: 'path', cn: '轨道左边缘图片路径', en: 'Left Stage Image Path' },
    { section: 'Mania', key: 'StageRight', type: 'path', cn: '轨道右边缘图片路径', en: 'Right Stage Image Path' },
    { section: 'Mania', key: 'StageBottom', type: 'path', cn: '轨道覆盖图片路径', en: 'Stage Covered Image Path' },
    { section: 'Mania', key: 'StageHint', type: 'path', cn: '判定线图片路径', en: 'Stage Hint Image Path' },
    { section: 'Mania', key: 'LightingN', type: 'path', cn: '短按闪光图片路径', en: 'Note Lighting Image Path' },
    { section: 'Mania', key: 'LightingL', type: 'path', cn: '长按闪光图片路径', en: 'Hold Lighting Image Path' },
    { section: 'Mania', key: 'WarningArrow', type: 'path', cn: '警告箭头图片路径', en: 'Warning Arrow Image Path' },
    { section: 'Mania', key: 'Hit0', type: 'path', cn: 'hit0 图片路径', en: 'Hit0 Image Path' },
    { section: 'Mania', key: 'Hit50', type: 'path', cn: 'hit50 图片路径', en: 'Hit50 Image Path' },
    { section: 'Mania', key: 'Hit100', type: 'path', cn: 'hit100 图片路径', en: 'Hit100 Image Path' },
    { section: 'Mania', key: 'Hit200', type: 'path', cn: 'hit200 图片路径', en: 'Hit200 Image Path' },
    { section: 'Mania', key: 'Hit300', type: 'path', cn: 'hit300 图片路径', en: 'Hit300 Image Path' },
    { section: 'Mania', key: 'Hit300g', type: 'path', cn: 'hit300g 图片路径', en: 'Hit300g Image Path' },
  ];
})();

// Group fields by section for easy lookup
const FIELDS_BY_SECTION = {};
INI_FIELD_DEFS.forEach(f => {
  if (!FIELDS_BY_SECTION[f.section]) FIELDS_BY_SECTION[f.section] = [];
  FIELDS_BY_SECTION[f.section].push(f);
});

// Get all unique sections
const INI_SECTIONS = Object.keys(FIELDS_BY_SECTION);

