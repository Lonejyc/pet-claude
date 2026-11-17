//! Taille du diff non commité d'un projet (insertions + suppressions), pour que le pet s'inquiète d'un énorme travail en cours.
//! `git diff --shortstat HEAD` compte aussi l'index ; les fichiers non suivis ne sont pas comptés. Résultat gardé 30 s par dossier :
//! le front peut appeler à chaque outil sans lancer git à chaque fois. Hors dépôt, ou sans commit : `None`.
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CACHE: Duration = Duration::from_secs(30);
type Cache = HashMap<String, (Instant, Option<u32>)>;
static CACHED: Mutex<Option<Cache>> = Mutex::new(None);

/// « 3 files changed, 120 insertions(+), 45 deletions(-) » -> 165. Chaîne vide (aucun changement) -> 0.
fn parse_shortstat(out: &str) -> u32 {
    let number_before = |word: &str| out.split(',').find(|part| part.contains(word)).and_then(|part| part.split_whitespace().next()).and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
    number_before("insertion") + number_before("deletion")
}

fn run(cwd: &str) -> Option<u32> {
    let out = Command::new("git").args(["--no-optional-locks", "-C", cwd, "diff", "--shortstat", "HEAD"]).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| parse_shortstat(&String::from_utf8_lossy(&out.stdout)))
}

/// Async : tourne hors du thread principal, une commande git lente ne fige pas le pet.
#[tauri::command]
pub async fn git_diff_size(cwd: String) -> Option<u32> {
    if !Path::new(&cwd).is_dir() {
        return None;
    }
    if let Some((at, size)) = CACHED.lock().unwrap().as_ref().and_then(|m| m.get(&cwd)).copied()
        && at.elapsed() < CACHE
    {
        return size;
    }
    let size = run(&cwd);
    CACHED.lock().unwrap().get_or_insert_with(HashMap::new).insert(cwd, (Instant::now(), size));
    size
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_insertions_and_deletions() {
        assert_eq!(parse_shortstat(" 3 files changed, 120 insertions(+), 45 deletions(-)\n"), 165);
    }

    #[test]
    fn handles_one_sided_changes_and_singulars() {
        assert_eq!(parse_shortstat(" 1 file changed, 1 insertion(+)\n"), 1);
        assert_eq!(parse_shortstat(" 2 files changed, 7 deletions(-)\n"), 7);
    }

    #[test]
    fn an_empty_output_means_no_change() {
        assert_eq!(parse_shortstat(""), 0);
    }

    #[test]
    fn a_real_repository_is_measured_and_a_plain_folder_is_not() {
        let base = std::env::temp_dir().join(format!("pet-diff-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let git = |args: &[&str]| Command::new("git").args(["-C", base.to_str().unwrap()]).args(args).output().unwrap();
        git(&["init", "-q"]);
        std::fs::write(base.join("a.txt"), "un\ndeux\n").unwrap();
        git(&["add", "."]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]);
        std::fs::write(base.join("a.txt"), "un\ndeux\ntrois\nquatre\n").unwrap();
        assert_eq!(run(base.to_str().unwrap()), Some(2));
        let plain = std::env::temp_dir().join(format!("pet-plain-{}", std::process::id()));
        std::fs::create_dir_all(&plain).unwrap();
        assert_eq!(run(plain.to_str().unwrap()), None);
        let _ = std::fs::remove_dir_all(base);
        let _ = std::fs::remove_dir_all(plain);
    }
}
