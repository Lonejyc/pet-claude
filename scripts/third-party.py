#!/usr/bin/env python3
"""Génère THIRD_PARTY_LICENSES.md : licences des dépendances Rust réellement compilées sur macOS Apple Silicon + dépendances npm d'exécution.
Prérequis : cargo dans le PATH. Usage : python3 scripts/third-party.py"""
import json, pathlib, subprocess, collections

root = pathlib.Path(__file__).resolve().parent.parent
meta = json.loads(subprocess.check_output(
    ["cargo", "metadata", "--format-version", "1", "--filter-platform", "aarch64-apple-darwin"],
    cwd=root / "app/src-tauri"))
used = {n["id"] for n in meta["resolve"]["nodes"]}
workspace = set(meta["workspace_members"])
crates = sorted(((p["name"], p["version"], p.get("license") or "inconnue") for p in meta["packages"] if p["id"] in used and p["id"] not in workspace))
by_license = collections.Counter(c[2] for c in crates)

pkg = json.loads((root / "app/package.json").read_text())
npm = sorted(pkg.get("dependencies", {}))

out = ["# Licences des dépendances\n",
       "pet-claude est publié sous licence MIT (voir `LICENSE`). Il embarque les bibliothèques suivantes, sous leurs propres licences.",
       "Fichier généré par `scripts/third-party.py` ; il liste les crates réellement compilées pour macOS Apple Silicon.\n",
       "## Résumé par licence\n", "| Licence | Crates |", "|---|---|"]
out += [f"| {lic} | {n} |" for lic, n in by_license.most_common()]
out += ["\n## Dépendances npm d'exécution\n"] + [f"- `{n}` (voir son dépôt : licence MIT ou Apache-2.0)" for n in npm]
out += ["\n## Crates Rust\n", "| Crate | Version | Licence |", "|---|---|---|"] + [f"| {n} | {v} | {l} |" for n, v, l in crates]
(root / "THIRD_PARTY_LICENSES.md").write_text("\n".join(out) + "\n")
print(f"{len(crates)} crates, {len(by_license)} licences différentes")
