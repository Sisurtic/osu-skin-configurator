// Generated from osu-settings.json — field definitions for skin.ini editor
// Each entry: { section, key, type, default?, perColumn?, options? }
// Display labels live in the locale dictionaries under `iniFields.<key>` and
// `iniOptions.<fieldKey>.<optValue>`; fieldLabel() / optionLabel() below read
// them from window.__LOCALES__ for the active locale.

const INI_FIELD_DEFS = (() => {
  // This is a static copy of osu-settings.json data.
  // In a full build, this would be generated automatically.
  return [
    // ── string ──
    { section: 'General', key: 'Name', type: 'string' },
    { section: 'General', key: 'Author', type: 'string' },
    { section: 'General', key: 'Version', type: 'string' },

    // ── number (can contain decimals) ──
    { section: 'Mania', key: 'ColumnStart', type: 'number', default: '136' },
    { section: 'Mania', key: 'ColumnRight', type: 'number', default: '19' },
    { section: 'Mania', key: 'BarlineHeight', type: 'number', default: '1.2' },
    { section: 'Mania', key: 'WidthForNoteHeightScale', type: 'number' },
    { section: 'Mania', key: 'StageSeparation', type: 'number', default: '40' },

    // ── integer (whole numbers only) ──
    { section: 'General', key: 'AnimationFramerate', type: 'integer', default: '-1', min: -1, forbidden: [0] },
    { section: 'Mania', key: 'LightFramePerSecond', type: 'integer', min: 1 },
    { section: 'Fonts', key: 'HitCircleOverlap', type: 'integer', default: '-2' },
    { section: 'Fonts', key: 'ScoreOverlap', type: 'integer', default: '0' },
    { section: 'Fonts', key: 'ComboOverlap', type: 'integer', default: '0' },
    { section: 'Mania', key: 'Keys', type: 'integer' },
    { section: 'Mania', key: 'HitPosition', type: 'integer', default: '402' },
    { section: 'Mania', key: 'LightPosition', type: 'integer', default: '413' },
    { section: 'Mania', key: 'ScorePosition', type: 'integer' },
    { section: 'Mania', key: 'ComboPosition', type: 'integer' },

    // ── list ──
    { section: 'General', key: 'CustomComboBurstSounds', type: 'list' },
    { section: 'Mania', key: 'ColumnSpacing', type: 'list', default: '0', fillCount: 'keys-1' },
    { section: 'Mania', key: 'ColumnWidth', type: 'list', default: '30' },
    { section: 'Mania', key: 'ColumnLineWidth', type: 'list', default: '2', fillCount: 'keys+1' },
    { section: 'Mania', key: 'LightingNWidth', type: 'list' },
    { section: 'Mania', key: 'LightingLWidth', type: 'list' },

    // ── bool ──
    { section: 'General', key: 'AllowSliderBallTint', type: 'bool', default: '0' },
    { section: 'General', key: 'ComboBurstRandom', type: 'bool', default: '0' },
    { section: 'General', key: 'CursorCentre', type: 'bool', default: '1' },
    { section: 'General', key: 'CursorExpand', type: 'bool', default: '1' },
    { section: 'General', key: 'CursorRotate', type: 'bool', default: '1' },
    { section: 'General', key: 'CursorTrailRotate', type: 'bool', default: '1' },
    { section: 'General', key: 'HitCircleOverlayAboveNumber', type: 'bool', default: '1' },
    { section: 'General', key: 'LayeredHitSounds', type: 'bool', default: '1' },
    { section: 'General', key: 'SliderBallFlip', type: 'bool', default: '1' },
    { section: 'General', key: 'SpinnerFadePlayfield', type: 'bool', default: '0' },
    { section: 'General', key: 'SpinnerFrequencyModulate', type: 'bool', default: '1' },
    { section: 'General', key: 'SpinnerNoBlink', type: 'bool', default: '0' },
    { section: 'Mania', key: 'JudgementLine', type: 'bool', default: '1' },
    { section: 'Mania', key: 'SeparateScore', type: 'bool', default: '1' },
    { section: 'Mania', key: 'KeysUnderNotes', type: 'bool', default: '0' },
    { section: 'Mania', key: 'UpsideDown', type: 'bool', default: '0' },
    { section: 'Mania', key: 'KeyFlipWhenUpsideDown', type: 'bool', default: '1' },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown', type: 'bool', default: '1' },
    { section: 'Mania', key: 'KeyFlipWhenUpsideDown#', type: 'bool', default: '1', perColumn: true },
    { section: 'Mania', key: 'KeyFlipWhenUpsideDown#D', type: 'bool', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#', type: 'bool', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#H', type: 'bool', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#L', type: 'bool', default: '1', perColumn: true },
    { section: 'Mania', key: 'NoteFlipWhenUpsideDown#T', type: 'bool', default: '1', perColumn: true },

    // ── section (enum dropdown) ──
    { section: 'Mania', key: 'SpecialStyle', type: 'section', default: '0',
      options: [
        { value: '0' },
        { value: '1' },
        { value: '2' },
      ] },
    { section: 'Mania', key: 'ComboBurstStyle', type: 'section', default: '1',
      options: [
        { value: '0' },
        { value: '1' },
        { value: '2' },
      ] },
    { section: 'Mania', key: 'SplitStages', type: 'section', default: ' ',
      options: [
        { value: ' ' },
        { value: '0' },
        { value: '1' },
      ] },
    { section: 'Mania', key: 'NoteBodyStyle', type: 'section', default: '1',
      options: [
        { value: '0' },
        { value: '1' },
        { value: '2' },
      ] },
    { section: 'Mania', key: 'NoteBodyStyle#', type: 'section', default: '1', perColumn: true,
      options: [
        { value: '0' },
        { value: '1' },
        { value: '2' },
      ] },

    // ── rgb ──
    { section: 'Colours', key: 'Combo1', type: 'rgb', default: '255,192,0' },
    { section: 'Colours', key: 'Combo2', type: 'rgb', default: '0,202,0' },
    { section: 'Colours', key: 'Combo3', type: 'rgb', default: '18,124,255' },
    { section: 'Colours', key: 'Combo4', type: 'rgb', default: '242,24,57' },
    { section: 'Colours', key: 'Combo5', type: 'rgb' },
    { section: 'Colours', key: 'Combo6', type: 'rgb' },
    { section: 'Colours', key: 'Combo7', type: 'rgb' },
    { section: 'Colours', key: 'Combo8', type: 'rgb' },
    { section: 'Colours', key: 'InputOverlayText', type: 'rgb', default: '0,0,0' },
    { section: 'Colours', key: 'MenuGlow', type: 'rgb', default: '0,78,155' },
    { section: 'Colours', key: 'SliderBall', type: 'rgb', default: '2,170,255' },
    { section: 'Colours', key: 'SliderBorder', type: 'rgb', default: '255,255,255' },
    { section: 'Colours', key: 'SliderTrackOverride', type: 'rgb' },
    { section: 'Colours', key: 'SongSelectActiveText', type: 'rgb', default: '0,0,0' },
    { section: 'Colours', key: 'SongSelectInactiveText', type: 'rgb', default: '255,255,255' },
    { section: 'Colours', key: 'SpinnerBackground', type: 'rgb', default: '100,100,100' },
    { section: 'Colours', key: 'StarBreakAdditive', type: 'rgb', default: '255,182,193' },
    { section: 'CatchTheBeat', key: 'HyperDash', type: 'rgb', default: '255,0,0' },
    { section: 'CatchTheBeat', key: 'HyperDashFruit', type: 'rgb' },
    { section: 'CatchTheBeat', key: 'HyperDashAfterImage', type: 'rgb' },
    { section: 'Mania', key: 'ColourLight#', type: 'rgb', default: '55,255,255', perColumn: true },
    { section: 'Mania', key: 'ColourJudgementLine', type: 'rgb', default: '255,255,255' },
    { section: 'Mania', key: 'ColourKeyWarning', type: 'rgb', default: '0,0,0' },
    { section: 'Mania', key: 'ColourBreak', type: 'rgb', default: '255,0,0' },

    // ── rgba ──
    { section: 'Mania', key: 'Colour#', type: 'rgba', default: '0,0,0,255', perColumn: true },
    { section: 'Mania', key: 'ColourColumnLine', type: 'rgba', default: '255,255,255,255' },
    { section: 'Mania', key: 'ColourBarline', type: 'rgba', default: '255,255,255,255' },
    { section: 'Mania', key: 'ColourHold', type: 'rgba', default: '255,191,51,255' },

    // ── path ──
    { section: 'Fonts', key: 'HitCirclePrefix', type: 'path' },
    { section: 'Fonts', key: 'ScorePrefix', type: 'path' },
    { section: 'Fonts', key: 'ComboPrefix', type: 'path' },
    { section: 'Mania', key: 'KeyImage#', type: 'path', perColumn: true },
    { section: 'Mania', key: 'KeyImage#D', type: 'path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#', type: 'path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#H', type: 'path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#L', type: 'path', perColumn: true },
    { section: 'Mania', key: 'NoteImage#T', type: 'path', perColumn: true },
    { section: 'Mania', key: 'StageLeft', type: 'path' },
    { section: 'Mania', key: 'StageRight', type: 'path' },
    { section: 'Mania', key: 'StageBottom', type: 'path' },
    { section: 'Mania', key: 'StageHint', type: 'path' },
    { section: 'Mania', key: 'LightingN', type: 'path' },
    { section: 'Mania', key: 'LightingL', type: 'path' },
    { section: 'Mania', key: 'WarningArrow', type: 'path' },
    { section: 'Mania', key: 'Hit0', type: 'path' },
    { section: 'Mania', key: 'Hit50', type: 'path' },
    { section: 'Mania', key: 'Hit100', type: 'path' },
    { section: 'Mania', key: 'Hit200', type: 'path' },
    { section: 'Mania', key: 'Hit300', type: 'path' },
    { section: 'Mania', key: 'Hit300g', type: 'path' },
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

// ── Locale-aware label accessors ──
// Labels are read from the active locale's `iniFields` / `iniOptions` blocks
// (loaded into window.__LOCALES__ by i18n.js). Falls back to the raw key /
// option value if the dict isn't available yet or a translation is missing.
function fieldLabel(field) {
  if (!field || !window.i18n) return field ? field.key : '';
  const loc = window.i18n.locale();
  const dicts = window.__LOCALES__ || {};
  const d = dicts[loc] || {};
  const iniFields = d.iniFields || {};
  return iniFields[field.key] || field.key;
}
function optionLabel(field, opt) {
  if (!opt || !window.i18n) return opt ? opt.value : '';
  const loc = window.i18n.locale();
  const dicts = window.__LOCALES__ || {};
  const d = dicts[loc] || {};
  const iniOptions = d.iniOptions || {};
  const k = field.key + '.' + opt.value;
  return iniOptions[k] || opt.value;
}

window.INI_FIELD_LABELS = { fieldLabel, optionLabel };
