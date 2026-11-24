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
pub fn epoch(ts: &str) -> Option<i64> {
    let n = |r: std::ops::Range<usize>| ts.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    Some(days * 86400 + n(11..13)? * 3600 + n(14..16)? * 60 + n(17..19)?)
}

/// Coût en $ d'une requête, ou None si le modèle n'est pas dans la grille. Partagé par le calcul global et celui d'une session.
fn price_cost(model: &str, input: f64, output: f64, read: f64, write: f64, write_1h: f64) -> Option<f64> {
    PRICES.iter().find(|(p, ..)| model.starts_with(p)).map(|&(_, i, o, r)| (input * i + output * o + read * r + (write - write_1h) * i * 1.25 + write_1h * i * 2.0) / 1e6)
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
            let cost = price_cost(model, input, output, read, write, write_1h).unwrap_or_else(|| {
                partial |= tokens > 0.0;
                0.0
            });
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

/// Coût et remplissage du contexte d'une session, lus dans son transcript (`<id>.jsonl`).
/// Le contexte = tokens d'entrée de la dernière requête du fil principal (entrée + cache lu + cache écrit). Les sous-agents (`isSidechain`) ont leur propre contexte : ils comptent dans le coût, pas dans le contexte.
/// ponytail: la taille de la fenêtre n'est pas dans le transcript : 200 000 tokens, ou 1 000 000 dès que le contexte dépasse 200 000 (preuve d'une fenêtre étendue).
pub fn session_stats_from(text: &str) -> Value {
    let (mut cost, mut partial, mut context, mut model) = (0.0, false, 0.0, String::new());
    let mut seen = HashSet::new();
    for line in text.lines().filter(|l| l.contains("\"usage\"")) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let u = &v["message"]["usage"];
        if !u.is_object() {
            continue;
        }
        let id = format!("{}{}", v["message"]["id"].as_str().unwrap_or(""), v["requestId"].as_str().unwrap_or(""));
        if !id.is_empty() && !seen.insert(id) {
            continue;
        }
        let t = |k: &str| u[k].as_f64().unwrap_or(0.0);
        let (input, output, read, write) = (t("input_tokens"), t("output_tokens"), t("cache_read_input_tokens"), t("cache_creation_input_tokens"));
        let write_1h = u["cache_creation"]["ephemeral_1h_input_tokens"].as_f64().unwrap_or(0.0);
        let m = v["message"]["model"].as_str().unwrap_or("");
        match price_cost(m, input, output, read, write, write_1h) {
            Some(c) => cost += c,
            None => partial |= input + output + read + write > 0.0,
        }
        if v["isSidechain"] != true {
            context = input + read + write;
            model = m.to_string();
        }
    }
    let window = if context > 200_000.0 { 1_000_000.0 } else { 200_000.0 };
    json!({ "cost": cost, "partial": partial, "context": context, "window": window, "pct": (context / window * 100.0).round(), "model": model })
}

/// Dossier `~/.claude/projects/<projet>/<id>.jsonl`. L'identifiant ne contient que des caractères d'un UUID (pas de chemin).
fn find_transcript(home: &Path, id: &str) -> Option<PathBuf> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    std::fs::read_dir(home.join(".claude/projects")).ok()?.flatten().map(|d| d.path().join(format!("{id}.jsonl"))).find(|p| p.is_file())
}

/// Relit tout le transcript : au plus un calcul toutes les 15 s par session.
pub fn session_stats(id: &str) -> Option<Value> {
    type Cache = HashMap<String, (Instant, Option<Value>)>;
    static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
    if let Some((at, value)) = CACHE.lock().ok()?.as_ref().and_then(|m| m.get(id)).cloned()
        && at.elapsed() < Duration::from_secs(15)
    {
        return value;
    }
    let path = find_transcript(Path::new(&std::env::var_os("HOME")?), id)?;
    let value = std::fs::read_to_string(path).ok().map(|t| session_stats_from(&t));
    CACHE.lock().ok()?.get_or_insert_with(HashMap::new).insert(id.to_string(), (Instant::now(), value.clone()));
    value
}

/// Relire une semaine de transcripts coûte : au plus un calcul toutes les 2 min.
pub fn get() -> Option<Value> {
    static LAST: Mutex<Option<(Instant, Option<Value>)>> = Mutex::new(None);
    let mut last = LAST.lock().ok()?;
    if let Some((at, value)) = &*last
        && at.elapsed() < Duration::from_secs(120) {
            return value.clone();
        }
    let value = compute();
    *last = Some((Instant::now(), value.clone()));
    value
}

#[cfg(test)]
mod tests {
    use super::session_stats_from;

    fn line(id: &str, model: &str, input: u32, output: u32, read: u32, write: u32, sidechain: bool) -> String {
        format!(
            r#"{{"isSidechain":{sidechain},"requestId":"r{id}","message":{{"id":"m{id}","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_read_input_tokens":{read},"cache_creation_input_tokens":{write}}}}}}}"#
        )
    }

    #[test]
    fn session_stats_sum_the_cost_and_take_the_context_of_the_last_main_request() {
        let text = [
            line("1", "claude-sonnet-4-5", 1000, 500, 0, 9000, false),
            line("1", "claude-sonnet-4-5", 1000, 500, 0, 9000, false), // doublon du même message : compté une fois
            line("2", "claude-sonnet-4-5", 100, 400, 18000, 1900, false),
            line("3", "claude-haiku-4-5", 5000, 100, 90000, 0, true), // sous-agent : coût oui, contexte non
        ]
        .join("\n");
        let s = session_stats_from(&text);
        assert_eq!(s["context"], 20_000.0);
        assert_eq!(s["pct"], 10.0);
        assert_eq!(s["window"], 200_000.0);
        assert_eq!(s["model"], "claude-sonnet-4-5");
        let sonnet = |i: f64, o: f64, r: f64, w: f64| (i * 3.0 + o * 15.0 + r * 0.30 + w * 3.0 * 1.25) / 1e6;
        let haiku = (5000.0 * 1.0 + 100.0 * 5.0 + 90000.0 * 0.10) / 1e6;
        let expected = sonnet(1000.0, 500.0, 0.0, 9000.0) + sonnet(100.0, 400.0, 18000.0, 1900.0) + haiku;
        assert!((s["cost"].as_f64().unwrap() - expected).abs() < 1e-9, "{} vs {expected}", s["cost"]);
        assert_eq!(s["partial"], false);
    }

    #[test]
    fn a_context_above_200k_proves_an_extended_window() {
        let s = session_stats_from(&line("1", "claude-opus-4-7", 10, 10, 300_000, 0, false));
        assert_eq!(s["window"], 1_000_000.0);
        assert_eq!(s["pct"], 30.0);
    }

    #[test]
    fn an_unknown_model_is_flagged_as_partial_without_breaking_the_context() {
        let s = session_stats_from(&line("1", "claude-nouveau-9", 10, 10, 1000, 0, false));
        assert_eq!(s["partial"], true);
        assert_eq!(s["cost"], 0.0);
        assert_eq!(s["context"], 1010.0);
    }

    #[test]
    fn transcripts_are_found_by_session_id_and_ids_cannot_escape() {
        let home = std::env::temp_dir().join(format!("pet-sess-{}", std::process::id()));
        let proj = home.join(".claude/projects/-Users-a-boutique");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("abc-123.jsonl"), "").unwrap();
        assert!(super::find_transcript(&home, "abc-123").is_some());
        assert!(super::find_transcript(&home, "zzz").is_none());
        for bad in ["", "../abc-123", "a/b", "abc-123.jsonl"] {
            assert!(super::find_transcript(&home, bad).is_none(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn epoch_parses_utc_timestamps() {
        assert_eq!(super::epoch("1970-01-02T00:00:01.000Z"), Some(86401));
        assert_eq!(super::epoch("2026-10-19T08:24:51.592Z"), Some(1792398291));
    }
}
