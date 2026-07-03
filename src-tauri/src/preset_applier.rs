// Apply presets to a skin: merge skin.ini edits, copy/delete files inside the
// skin dir. Faithful port of preset-applier.js. SECURITY: double-gated path
// containment (reject '..' / absolute, then normalize + starts_with skin dir).
// Uses lexical normalization (not canonicalize) to match JS path.normalize and
// to work on not-yet-created destination dirs.

use indexmap::IndexMap;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use rayon::prelude::*;

fn normalize_lexical(p: &str) -> String {
    // emulate Node path.normalize for our containment check: collapse separators,
    // resolve ".." and "." segments. Good enough for starts_with comparison.
    let mut segs: Vec<String> = Vec::new();
    let mut root = String::new();
    let p_norm_sep = p.replace('\\', "/");
    if p_norm_sep.starts_with('/') {
        root.push('/');
    } else if p_norm_sep.len() >= 2 {
        let b = p_norm_sep.as_bytes();
        if b[1] == b':' {
            root.push_str(&p_norm_sep[..2]);
            if p_norm_sep.len() > 2 && p_norm_sep.as_bytes()[2] == b'/' {
                root.push('/');
            }
        }
    }
    for part in p_norm_sep.split('/') {
        match part {
            "" | "." => {}
            ".." => { segs.pop(); }
            s => segs.push(s.to_string()),
        }
    }
    let joined = segs.join("/");
    if root.is_empty() {
        joined
    } else if root.ends_with('/') {
        format!("{}{}", root, joined)
    } else {
        if joined.is_empty() { root } else { format!("{}/{}", root, joined) }
    }
}

/// True if `dest` is within `skin_root` (lexical). Mirrors the JS check
/// `normalizedDest.startsWith(normalizedSkin + sep) || === normalizedSkin`.
fn is_within(dest: &str, skin_root: &str) -> bool {
    let n_dest = normalize_lexical(dest);
    let n_root = normalize_lexical(skin_root);
    if n_dest == n_root { return true; }
    let with_sep = if n_root.ends_with('/') || n_root.is_empty() {
        format!("{}{}", n_root, "")
    } else {
        format!("{}/", n_root)
    };
    // accept both '/' separator (our normalized form) — n_dest starts with n_root + "/"
    n_dest.starts_with(&with_sep)
}

fn is_absolute_js(p: &str) -> bool {
    let p2 = p.replace('\\', "/");
    p2.starts_with('/') || (p2.len() >= 2 && p2.as_bytes()[1] == b':')
}

// If the filename has an "@2x" HD suffix right before the extension
// (e.g. "cursor@2x.png"), return the path with "@2x" dropped ("cursor.png").
// Used to fall back to the non-HD variant when the @2x file is missing and
// the operation is not in "exact" mode.
fn without_2x(p: &Path) -> Option<PathBuf> {
    let fname = p.file_name()?.to_str()?;
    let i = fname.rfind("@2x.")?; // index of the '@' in "@2x."
    let new_fname = format!("{}{}", &fname[..i], &fname[i + 3..]); // drop "@2x", keep the '.'
    Some(p.with_file_name(new_fname))
}

// Parse a "r,g,b[,a]" color string into (r,g,b,a) u8. Defaults to opaque white.
fn parse_color(s: &str) -> (u8, u8, u8, u8) {
    let parts: Vec<f64> = s.split(',').filter_map(|t| t.trim().parse::<f64>().ok()).collect();
    let r = parts.get(0).map(|v| *v as u8).unwrap_or(255);
    let g = parts.get(1).map(|v| *v as u8).unwrap_or(255);
    let b = parts.get(2).map(|v| *v as u8).unwrap_or(255);
    let a = parts.get(3).map(|v| *v as u8).unwrap_or(255);
    (r, g, b, a)
}

// sRGB <-> HSL helper (0..1 floats) for the lightness-preserving mode.
fn rgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-9 { return (0.0, 0.0, l); }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r { (g - b) / d + (if g < b { 6.0 } else { 0.0 }) }
        else if max == g { (b - r) / d + 2.0 }
        else { (r - g) / d + 4.0 };
    (h / 6.0, s, l)
}
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s.abs() < 1e-9 { return (l, l, l); }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let hue_to = |t: f64| {
        let t = if t < 0.0 { t + 1.0 } else if t > 1.0 { t - 1.0 } else { t };
        if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
        if t < 0.5 { return q; }
        if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
        p
    };
    t_to_rgb_helper(hue_to(h + 1.0 / 3.0), hue_to(h), hue_to(h - 1.0 / 3.0))
}
fn t_to_rgb_helper(r: f64, g: f64, b: f64) -> (f64, f64, f64) { (r, g, b) }

// Decode PNG at src, apply the tint blend, write PNG to dest.
// All parameters for one image-edit operation (tint → crop → darken stages).
struct TintOp {
    tint_enabled: bool,
    color: String,
    mode: String,
    crop_enabled: bool,
    crop_a: f64,
    crop_b: f64,
    crop_c: f64,
    crop_tile: bool,
    crop_tile_dir: String,
    #[allow(dead_code)] // kept for deserializing older presets; darken is now derived
    darken_enabled: bool,
    darken_d: f64,
    darken_opacity: f64,
}

fn apply_tint(src: &str, dest: &str, op: &TintOp) -> Result<(), String> {
    let _t0 = std::time::Instant::now();
    let mut _t_decode = std::time::Duration::ZERO;
    let img = {
        let s = std::time::Instant::now();
        let i = image::open(src).map_err(|e| e.to_string())?;
        _t_decode = s.elapsed();
        i
    };
    let mut rgba = img.to_rgba8();
    let (w0, h0) = rgba.dimensions();

    // Stage 1: tint (parallelized across pixel rows via rayon).
    let mut _t_tint = std::time::Duration::ZERO;
    if op.tint_enabled {
        let _ts = std::time::Instant::now();
        let (cr, cg, cb, ca) = parse_color(&op.color);
        let cf = |c: u8| c as f64 / 255.0;
        let crf = cf(cr); let cgf = cf(cg); let cbf = cf(cb);
        // The picker's alpha is the BLEND STRENGTH (how much of the tint applies),
        // NOT the output image opacity. alpha is preserved from the source pixel.
        let t = cf(ca);
        let lerp = |orig: f64, blended: f64| orig + (blended - orig) * t;
        let mode = op.mode.clone();
        // Split the raw buffer into row-sized byte chunks so threads work on
        // contiguous spans (cache-friendly, no per-pixel indexing overhead).
        let (w, _h) = rgba.dimensions();
        let stride = (w as usize) * 4;
        let buf: &mut [u8] = rgba.as_mut();
        buf.par_chunks_mut(stride).for_each(|row| {
            for px in row.chunks_exact_mut(4) {
                let pa = px[3];
                if pa == 0 { continue; }
                let (prf, pgf, pbf) = (px[0] as f64, px[1] as f64, px[2] as f64);
                let (nr, ng, nb) = match mode.as_str() {
                    "multiply" => {
                        let m = |p: f64, c: f64| p * c;
                        (lerp(prf, m(prf, crf)), lerp(pgf, m(pgf, cgf)), lerp(pbf, m(pbf, cbf)))
                    }
                    "screen" => {
                        let s = |p: f64, c: f64| 255.0 - (255.0 - p) * (255.0 - c * 255.0) / 255.0;
                        (lerp(prf, s(prf, crf)), lerp(pgf, s(pgf, cgf)), lerp(pbf, s(pbf, cbf)))
                    }
                    "overlay" => {
                        let o = |p: f64, c: f64| {
                            if p < 128.0 { 2.0 * p * (c * 255.0) / 255.0 } else { 255.0 - 2.0 * (255.0 - p) * (255.0 - c * 255.0) / 255.0 }
                        };
                        (lerp(prf, o(prf, crf)), lerp(pgf, o(pgf, cgf)), lerp(pbf, o(pbf, cbf)))
                    }
                    "lightness" => {
                        let (ch, _, _) = rgb_to_hsl(crf, cgf, cbf);
                        let (_, ps, pl) = rgb_to_hsl(cf(px[0]), cf(px[1]), cf(px[2]));
                        let (rr, rg, rb) = hsl_to_rgb(ch, ps, pl);
                        (lerp(prf, rr * 255.0), lerp(pgf, rg * 255.0), lerp(pbf, rb * 255.0))
                    }
                    _ => (lerp(prf, cr as f64), lerp(pgf, cg as f64), lerp(pbf, cb as f64)),
                };
                px[0] = nr.round() as u8;
                px[1] = ng.round() as u8;
                px[2] = nb.round() as u8;
                // px[3] (alpha) preserved
            }
        });
        _t_tint = _ts.elapsed();
    }

    // Stage 2: crop — split at row tail_h; compose blank + tail + body-extended to out_h.
    let mut _t_crop = std::time::Duration::ZERO;
    if op.crop_enabled {
        let _ts = std::time::Instant::now();
        let (w, h) = rgba.dimensions();
        let tail_h = ((op.crop_a.round() as u64).min(h as u64)) as usize;
        let blank = (op.crop_b.round().max(0.0) as u64) as usize;
        let out_h = ((op.crop_c.round() as u64).max(1)) as usize;
        let body_src_h = (h as usize).saturating_sub(tail_h);
        let stride = w as usize * 4;
        // Output buffer (zero-initialized → blank region stays transparent).
        let mut out = vec![0u8; out_h * stride].into_boxed_slice();
        let out_buf = &mut out;
        let src_buf = rgba.as_raw();
        let y0 = blank + tail_h; // body starts at this output row
        let tile = op.crop_tile;
        let tile_up = op.crop_tile_dir == "up";

        // Fill each output row in parallel: tail (1:1) or body (stretch/tile).
        out_buf.par_chunks_mut(stride).enumerate().for_each(|(oy, orow)| {
            if oy < blank { return; } // blank → leave zeroed
            let src_row_bytes: &[u8] = if oy < y0 {
                // Tail: 1:1 from source top.
                let sy = oy - blank;
                &src_buf[sy * stride .. sy * stride + stride]
            } else if body_src_h == 0 {
                return;
            } else {
                // Body region.
                let into = oy - y0;
                let sy = if tile {
                    if tile_up {
                        // Tile upward from the bottom edge.
                        let from_bottom = out_h - 1 - oy;
                        body_src_h - (from_bottom % body_src_h) - 1
                    } else {
                        tail_h + (into % body_src_h)
                    }
                } else {
                    // Stretch (nearest): map output row into the body source range.
                    let remain = out_h - y0;
                    tail_h + into * body_src_h / remain
                };
                let sy = sy.min(h as usize - 1);
                &src_buf[sy * stride .. sy * stride + stride]
            };
            orow[..stride].copy_from_slice(src_row_bytes);
        });
        // Clear the bottom output row (transparent). osu! draws the LN body up
        // to but not including the very last row; leaving it set would extend
        // the body one row past the intended cropC height.
        if out_h > 0 {
            let last = (out_h - 1) * stride;
            for b in &mut out[last .. last + stride] { *b = 0; }
        }
        // Wrap into RgbaImage (dimensions = w × out_h).
        rgba = image::ImageBuffer::from_raw(w as u32, out_h as u32, out.into_vec()).unwrap_or(rgba);
        _t_crop = _ts.elapsed();
    }

    // Stage 3: darken — single parallel pass. For each output row y:
    //   ghost   = source[y] * alpha          (translucent, at original position)
    //   opaque  = source[y - shift]          (full-opacity, shifted down by `shift`)
    // Composite opaque OVER ghost. The top `shift` rows show ghost only. This
    // matches the old two-overlay pipeline but avoids 3 full-image allocations
    // (scale_alpha clone + 2 overlays into a fresh buffer).
    // Darkening is a derived sub-state: active when crop is on AND opacity > 0
    // (matches the frontend's isDarkening — darkenD just controls the shift).
    if op.crop_enabled && op.darken_opacity > 0.0 {
        let _ts = std::time::Instant::now();
        let shift = op.darken_d.round() as i64;
        let (w, h) = rgba.dimensions();
        let alpha = (255.0 * (op.darken_opacity / 100.0)).round().clamp(0.0, 255.0) as u8;
        let af = alpha as f64 / 255.0;
        let src = rgba.clone();
        let mut out = image::RgbaImage::new(w, h);
        let stride = (w as usize) * 4;
        let src_buf: &[u8] = src.as_raw();
        let out_buf: &mut [u8] = out.as_mut();
        // Pair each output row with its source row index for the parallel iter.
        out_buf.par_chunks_mut(stride).enumerate().for_each(|(y, orow)| {
            let sy_opaque = y as i64 - shift;
            for (ox, opx) in orow.chunks_exact_mut(4).enumerate() {
                let gi = y as usize * stride + ox * 4;
                let (gr, gg, gb, ga) = (src_buf[gi], src_buf[gi+1], src_buf[gi+2], src_buf[gi+3]);
                let ga_f = ga as f64 * af;
                if sy_opaque < 0 || sy_opaque >= h as i64 {
                    // Top strip: ghost only.
                    opx[0] = gr; opx[1] = gg; opx[2] = gb;
                    opx[3] = ga_f.round() as u8;
                    continue;
                }
                let oi = sy_opaque as usize * stride + ox * 4;
                let (orr, org, orb, oa) = (src_buf[oi], src_buf[oi+1], src_buf[oi+2], src_buf[oi+3]);
                // over-composite opaque (top) over ghost (bottom).
                let oa_f = oa as f64;
                let out_a = oa_f + ga_f * (1.0 - oa_f / 255.0);
                if out_a <= 0.0 { opx[3] = 0; continue; }
                let s = 1.0 / out_a;
                let ng = 1.0 - oa_f / 255.0;
                opx[0] = ((orr as f64 * oa_f + gr as f64 * ga_f * ng) * s).round() as u8;
                opx[1] = ((org as f64 * oa_f + gg as f64 * ga_f * ng) * s).round() as u8;
                opx[2] = ((orb as f64 * oa_f + gb as f64 * ga_f * ng) * s).round() as u8;
                opx[3] = out_a.round() as u8;
            }
        });
        rgba = out;
        eprintln!("[tint perf] darken: {:.2?}", _ts.elapsed());
    }

    // Encode PNG with zune-png (much faster than `image`'s deflate for large
    // outputs). Falls back to `image`'s encoder if zune-png fails.
    let _ts = std::time::Instant::now();
    let (w, h) = rgba.dimensions();
    let raw = rgba.as_raw();
    // Encode PNG with the `image` crate (flate2 deflate, Fast compression).
    // zune-png was faster but crashed (STATUS_STACK_BUFFER_OVERRUN) on very tall
    // outputs under debug builds, so we use the stable encoder here.
    let f = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let enc = image::codecs::png::PngEncoder::new_with_quality(
        f, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Adaptive);
    use image::ImageEncoder;
    let r = enc.write_image(raw, w, h, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string());
    eprintln!("[tint perf] src {}x{} -> out {}x{} | decode {:.2?} | tint {:.2?} | crop {:.2?} | png {:.2?} | total {:.2?}",
        w0, h0, rgba.width(), rgba.height(), _t_decode, _t_tint, _t_crop, _ts.elapsed(), _t0.elapsed());
    r
}


fn apply_one_set(
    skin_path: &str,
    skin_ini_edits: &[Value],
    file_copies: &[Value],
    file_deletes: &[Value],
    file_tints: &[Value],
) -> Value {
    let mut warnings: Vec<String> = Vec::new();
    let mut skin_ini_changes = 0i64;
    let mut files_copied = 0i64;
    let mut files_deleted = 0i64;
    let mut files_tinted = 0i64;

    // skin.ini merge
    if !skin_ini_edits.is_empty() {
        let mut sections = crate::ini_reader::read_skin_ini(skin_path);
        let edits: Vec<crate::ini_reader::IniEdit> = skin_ini_edits.iter()
            .filter_map(|e| serde_json::from_value(e.clone()).ok())
            .collect();
        crate::ini_reader::merge_ini_edits(&mut sections, &edits);
        crate::ini_reader::write_skin_ini(skin_path, &sections);
        skin_ini_changes = skin_ini_edits.len() as i64;
    }

    // copies
    for copy in file_copies {
        let source = copy.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let source_name = Path::new(source).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dest_rel = copy.get("destination").and_then(|v| v.as_str()).unwrap_or("");

        if dest_rel.contains("..") || is_absolute_js(dest_rel) {
            warnings.push(crate::i18n::t("warn.copy_invalid_path", &[("name", &source_name)]));
            continue;
        }
        // Source is stored as a skin-relative path; resolve to absolute.
        let source_abs = if is_absolute_js(source) || Path::new(source).is_absolute() {
            source.to_string()
        } else {
            PathBuf::from(skin_path).join(source).to_string_lossy().to_string()
        };
        let is_dir_only = dest_rel.is_empty() || dest_rel.ends_with('/') || dest_rel.ends_with('\\');
        let dest_path = if is_dir_only {
            PathBuf::from(skin_path).join(dest_rel).join(&source_name)
        } else {
            PathBuf::from(skin_path).join(dest_rel)
        };
        let dest_str = dest_path.to_string_lossy().to_string();
        if !is_within(&dest_str, skin_path) {
            warnings.push(crate::i18n::t("warn.copy_outside_skin", &[("name", &source_name)]));
            continue;
        }
        if let Some(parent) = dest_path.parent() {
            if !parent.exists() { let _ = std::fs::create_dir_all(parent); }
        }
        let exact = copy.get("exact").and_then(|v| v.as_bool()).unwrap_or(false);
        // Fallback: if the @2x source is missing and not exact-match, try the non-@2x variant.
        let mut use_src = source_abs.clone();
        if !Path::new(&use_src).exists() && !exact {
            if let Some(alt) = without_2x(Path::new(&use_src)) {
                if alt.exists() { use_src = alt.to_string_lossy().to_string(); }
            }
        }
        if Path::new(&use_src).exists() {
            if std::fs::copy(&use_src, &dest_path).is_ok() { files_copied += 1; }
        } else {
            warnings.push(crate::i18n::t("warn.copy_source_missing", &[("name", &source_name)]));
        }
    }

    // deletes
    for del in file_deletes {
        let del_path = del.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if del_path.contains("..") || is_absolute_js(del_path) {
            warnings.push(crate::i18n::t("warn.del_invalid_path", &[("path", del_path)]));
            continue;
        }
        let full = PathBuf::from(skin_path).join(del_path);
        let full_str = full.to_string_lossy().to_string();
        if !is_within(&full_str, skin_path) {
            warnings.push(crate::i18n::t("warn.del_outside_skin", &[("path", del_path)]));
            continue;
        }
        let exact = del.get("exact").and_then(|v| v.as_bool()).unwrap_or(false);
        // Fallback: if the @2x target is missing and not exact-match, try the non-@2x variant.
        let mut target = full.clone();
        if !target.exists() && !exact {
            if let Some(alt) = without_2x(&target) {
                if alt.exists() { target = alt; }
            }
        }
        if target.exists() {
            if std::fs::remove_file(&target).is_ok() { files_deleted += 1; }
        } else {
            warnings.push(crate::i18n::t("warn.del_missing", &[("path", del_path)]));
        }
    }

    // tints (recolor)
    for tint in file_tints {
        let source = tint.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let source_name = Path::new(source).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dest_rel = tint.get("destination").and_then(|v| v.as_str()).unwrap_or("");
        let op = TintOp {
            tint_enabled: tint.get("tintEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
            color: tint.get("color").and_then(|v| v.as_str()).unwrap_or("255,255,255,255").to_string(),
            mode: tint.get("mode").and_then(|v| v.as_str()).unwrap_or("multiply").to_string(),
            crop_enabled: tint.get("cropEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
            crop_a: tint.get("cropA").and_then(|v| v.as_f64()).unwrap_or(0.0),
            crop_b: tint.get("cropB").and_then(|v| v.as_f64()).unwrap_or(0.0),
            crop_c: tint.get("cropC").and_then(|v| v.as_f64()).unwrap_or(32768.0),
            crop_tile: tint.get("cropTile").and_then(|v| v.as_bool()).unwrap_or(false),
            crop_tile_dir: tint.get("cropTileDir").and_then(|v| v.as_str()).unwrap_or("down").to_string(),
            darken_enabled: tint.get("darkenEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
            darken_d: tint.get("darkenD").and_then(|v| v.as_f64()).unwrap_or(0.0),
            darken_opacity: tint.get("darkenOpacity").and_then(|v| v.as_f64()).unwrap_or(0.0),
        };

        if dest_rel.contains("..") || is_absolute_js(dest_rel) {
            warnings.push(crate::i18n::t("warn.copy_invalid_path", &[("name", &source_name)]));
            continue;
        }
        let source_abs = if is_absolute_js(source) || Path::new(source).is_absolute() {
            source.to_string()
        } else {
            PathBuf::from(skin_path).join(source).to_string_lossy().to_string()
        };
        let is_dir_only = dest_rel.is_empty() || dest_rel.ends_with('/') || dest_rel.ends_with('\\');
        // Normalize the dest's extension to the SOURCE's extension: ignore any
        // extension the user typed and use the source's (tint re-encodes via
        // image::save, which infers the format from the extension). A bare
        // directory → use the full source name.
        let src_ext = Path::new(&source_name).extension().and_then(|e| e.to_str());
        let dest_name = if is_dir_only {
            source_name.clone()
        } else {
            // Strip any typed extension from the last path segment, then re-attach the source's.
            let p = PathBuf::from(dest_rel);
            let stem = p.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string()).unwrap_or_else(|| dest_rel.to_string());
            let parent = p.parent().filter(|pp| !pp.as_os_str().is_empty());
            let base = match src_ext {
                Some(e) => format!("{}.{}", stem, e),
                None => format!("{}.png", stem),
            };
            match parent {
                Some(pp) => pp.join(base).to_string_lossy().to_string(),
                None => base,
            }
        };
        let dest_path = if dest_rel.is_empty() {
            // Empty destination = overwrite the SOURCE file in place.
            PathBuf::from(&source_abs)
        } else if is_dir_only {
            // Directory destination (e.g. "mania/") → place the source-named file there.
            PathBuf::from(skin_path).join(dest_rel).join(&dest_name)
        } else {
            PathBuf::from(skin_path).join(&dest_name)
        };
        let dest_str = dest_path.to_string_lossy().to_string();
        if !is_within(&dest_str, skin_path) {
            warnings.push(crate::i18n::t("warn.copy_outside_skin", &[("name", &source_name)]));
            continue;
        }
        if let Some(parent) = dest_path.parent() {
            if !parent.exists() { let _ = std::fs::create_dir_all(parent); }
        }
        // Tints use the exact source path (no @2x fallback — that's a copy/delete concern).
        if !Path::new(&source_abs).exists() {
            warnings.push(crate::i18n::t("warn.copy_source_missing", &[("name", &source_name)]));
            continue;
        }
        match apply_tint(&source_abs, &dest_str, &op) {
            Ok(()) => files_tinted += 1,
            Err(msg) => warnings.push(crate::i18n::t("warn.tint_failed", &[("name", &source_name), ("msg", &msg)])),
        }
    }

    json!({
        "skinIniChanges": skin_ini_changes,
        "filesCopied": files_copied,
        "filesDeleted": files_deleted,
        "filesTinted": files_tinted,
        "warnings": warnings,
    })
}

pub fn apply_preset(skin_path: &str, preset_id: i64) -> Result<Value, String> {
    let preset = crate::preset_manager::load_preset(skin_path, preset_id)
        .ok_or_else(|| crate::i18n::t("err.preset_not_found", &[("id", &preset_id.to_string())]))?;
    let actions = preset.get("actions").cloned().unwrap_or_else(|| json!({}));
    let skin_ini = actions.get("skinIni").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let copies = actions.get("fileCopies").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let deletes = actions.get("fileDeletes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let tints = actions.get("fileTints").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(apply_one_set(skin_path, &skin_ini, &copies, &deletes, &tints))
}

pub fn apply_multiple_presets(skin_path: &str, preset_ids: &[i64]) -> Value {
    let mut all_ini: Vec<Value> = Vec::new();
    let mut all_copies: Vec<Value> = Vec::new();
    let mut all_deletes: Vec<Value> = Vec::new();
    let mut all_tints: Vec<Value> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for id in preset_ids {
        match crate::preset_manager::load_preset(skin_path, *id) {
            Some(preset) => {
                let actions = preset.get("actions").cloned().unwrap_or_else(|| json!({}));
                if let Some(arr) = actions.get("fileCopies").and_then(|v| v.as_array()) {
                    all_copies.extend(arr.iter().cloned());
                }
                if let Some(arr) = actions.get("fileDeletes").and_then(|v| v.as_array()) {
                    all_deletes.extend(arr.iter().cloned());
                }
                if let Some(arr) = actions.get("fileTints").and_then(|v| v.as_array()) {
                    all_tints.extend(arr.iter().cloned());
                }
                if let Some(arr) = actions.get("skinIni").and_then(|v| v.as_array()) {
                    all_ini.extend(arr.iter().cloned());
                }
            }
            None => warnings.push(crate::i18n::t("err.preset_not_found", &[("id", &id.to_string())])),
        }
    }

    // Dedup INI edits by section + maniaKeys + key, last-wins (preserve order of last occurrence)
    let mut merged_map: IndexMap<String, Value> = IndexMap::new();
    for edit in &all_ini {
        let section = edit.get("section").and_then(|v| v.as_str()).unwrap_or("");
        let mania_keys = edit.get("maniaKeys").map(|v| v.to_string()).unwrap_or_default();
        let key = edit.get("key").and_then(|v| v.as_str()).unwrap_or("");
        let k = format!("{}◆{}◆{}", section, mania_keys, key);
        merged_map.insert(k, edit.clone());
    }
    let merged_ini: Vec<Value> = merged_map.values().cloned().collect();

    let mut result = apply_one_set(skin_path, &merged_ini, &all_copies, &all_deletes, &all_tints);
    // prepend load warnings
    if let Some(obj) = result.as_object_mut() {
        if let Some(w) = obj.get_mut("warnings").and_then(|v| v.as_array_mut()) {
            let mut combined: Vec<Value> = warnings.into_iter().map(Value::from).collect();
            combined.append(w);
            obj.insert("warnings".to_string(), Value::Array(combined));
        }
    }
    result
}
