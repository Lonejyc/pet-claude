//! Tokens et coût estimé lus dans les transcripts de Claude Code (~/.claude/projects), sur 24 h et 7 jours glissants.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// ($ par million de tokens) entrée, sortie, lecture du cache. Écriture du cache : 1,25× l'entrée (5 min) ou 2× (1 h).
/// ponytail: grille copiée à la main ; un modèle absent compte ses tokens sans coût (`partial`). À compléter aux nouveaux modèles.
const PRICES: &[(&str, f64, f64, f64)] = &[
    ("claude-fable-5", 10.0, 50.0, 0.25),
    ("claude-mythos-5", 10.0, 50.0, 0.25),
    ("claude-opus-5-5", 4.0, 20.0, 0.20),
    ("claude-opus-5", 5.0, 25.0, 0.50),
    ("claude-opus-4-6", 5.0, 25.0, 0.50),
    ("claude-opus-4-7", 5.0, 25.0, 0.50),
    ("claude-opus-4-8", 5.0, 25.0, 0.50),
    ("claude-sonnet-5", 2.0, 10.0, 0.20),
    ("claude-sonnet-4", 3.0, 15.0, 0.30),
    ("claude-haiku-5", 0.10, 0.50, 0.01),
    ("claude-haiku-4-5", 1.0, 5.0, 0.10),
];

/// "2026-10-19T08:24:51.592Z" -> secondes depuis 1970 (UTC), sans dépendance de date.
fn epoch(ts: &str) -> Option<i64> {
    let n = |r: std::ops::Range<usize>| ts.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    Some(days * 86400 + n(11..13)? * 3600 + n(14..16)? * 60 + n(17..19)?)
}

fn recent_jsonl(dir: &Path, since: SystemTime, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if path.is_dir() {
            recent_jsonl(&path, since, out);
        } else if path.extension().is_some_and(|x| x == "jsonl") && e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t >= since) {
            out.push(path);
        }
    }
}

fn rows(map: HashMap<String, [f64; 2]>, limit: usize) -> Vec<Value> {
    let mut list: Vec<_> = map.into_iter().collect();
    list.sort_by(|a, b| b.1[1].total_cmp(&a.1[1]).then(b.1[0].total_cmp(&a.1[0])));
    list.into_iter().take(limit).map(|(name, [tokens, cost])| json!({ "name": name, "tokens": tokens, "cost": cost })).collect()
}

fn compute() -> Option<Value> {
    let now = SystemTime::now();
    let now_s = now.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let mut files = Vec::new();
    recent_jsonl(&Path::new(&std::env::var_os("HOME")?).join(".claude/projects"), now - Duration::from_secs(7 * 86400), &mut files);

    let (mut day, mut week) = ([0.0; 2], [0.0; 2]); // [tokens, coût]
    let (mut models, mut projects) = (HashMap::<String, [f64; 2]>::new(), HashMap::<String, [f64; 2]>::new());
    let (mut seen, mut partial) = (HashSet::new(), false);
    for file in files {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        for line in text.lines().filter(|l| l.contains("\"usage\"")) {
            let Ok(v) = serde_json::from_str::<Value>(line) else { continue }; // ligne partielle en cours d'écriture
            let u = &v["message"]["usage"];
            let Some(ts) = v["timestamp"].as_str().and_then(epoch) else { continue };
            if !u.is_object() || ts < now_s - 7 * 86400 {
                continue;
            }
            // un même message est répété sur plusieurs lignes du transcript
            let id = format!("{}{}", v["message"]["id"].as_str().unwrap_or(""), v["requestId"].as_str().unwrap_or(""));
            if !id.is_empty() && !seen.insert(id) {
                continue;
            }
            let t = |k: &str| u[k].as_f64().unwrap_or(0.0);
            let (input, output, read, write) = (t("input_tokens"), t("output_tokens"), t("cache_read_input_tokens"), t("cache_creation_input_tokens"));
            let write_1h = u["cache_creation"]["ephemeral_1h_input_tokens"].as_f64().unwrap_or(0.0);
            let tokens = input + output + read + write;
            let model = v["message"]["model"].as_str().unwrap_or("");
            let cost = match PRICES.iter().find(|(p, ..)| model.starts_with(p)) {
                Some(&(_, i, o, r)) => (input * i + output * o + read * r + (write - write_1h) * i * 1.25 + write_1h * i * 2.0) / 1e6,
                None => {
                    partial |= tokens > 0.0;
                    0.0
                }
            };
            let project = v["cwd"].as_str().and_then(|c| c.rsplit('/').next()).unwrap_or("?").to_string();
            let add = |t: &mut [f64; 2]| {
                t[0] += tokens;
                t[1] += cost;
            };
            add(&mut week);
            if ts >= now_s - 86400 {
                add(&mut day);
            }
            add(models.entry(model.to_string()).or_default());
            add(projects.entry(project).or_default());
        }
    }
    Some(json!({
        "day": { "tokens": day[0], "cost": day[1] },
        "week": { "tokens": week[0], "cost": week[1] },
        "models": rows(models, 5),
        "projects": rows(projects, 3),
        "partial": partial,
    }))
}

/// Relire une semaine de transcripts coûte : au plus un calcul toutes les 2 min.
pub fn get() -> Option<Value> {
    static LAST: Mutex<Option<(Instant, Option<Value>)>> = Mutex::new(None);
    let mut last = LAST.lock().ok()?;
    if let Some((at, value)) = &*last {
        if at.elapsed() < Duration::from_secs(120) {
            return value.clone();
        }
    }
    let value = compute();
    *last = Some((Instant::now(), value.clone()));
    value
}

#[cfg(test)]
mod tests {
    #[test]
    fn epoch_parses_utc_timestamps() {
        assert_eq!(super::epoch("1970-01-02T00:00:01.000Z"), Some(86401));
        assert_eq!(super::epoch("2026-10-19T08:24:51.592Z"), Some(1792398291));
    }
}
