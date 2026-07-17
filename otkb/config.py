"""Configuration de l'usine (SPEC §6, module Configuration).

Valeurs par défaut + surcharge optionnelle par fichier TOML local
(`config.local.toml`, gitignoré). Les réglages persistants qui décrivent une
base construite (seuil de filtre, N…) sont AUSSI écrits dans la table Settings
à l'initialisation, pour rester attachés à l'artefact.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

# Racine du projet = dossier parent de otkb/
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"


@dataclass(slots=True)
class Config:
    """Réglages de l'usine. Tout est overridable via config.local.toml."""

    # Chemins (données lourdes -> data/, gitignoré)
    data_dir: Path = DATA_DIR
    db_path: Path = DATA_DIR / "otkb.db"
    csv_path: Path = DATA_DIR / "lichess_db_puzzle.csv"

    # Filtre passe 1 (SPEC §4) : OpeningTags non vide ET fullmove < seuil.
    # 25 = borne naturelle de Lichess (100% des puzzles taggés ont fullmove < 25),
    # donc on garde TOUS les puzzles d'ouverture tels que Lichess les tague.
    opening_fullmove_max: int = 25   # comparaison EXCLUSIVE

    # Seuil de publication web (SPEC §4), utilisé en passe 2
    publish_threshold_n: int = 5

    # Passe 2 : token API Lichess (jamais versionné)
    lichess_token: str | None = None

    # Divers
    log_level: str = "INFO"

    # settings persistés en base à l'init (clé -> str)
    _persisted_keys: tuple[str, ...] = field(
        default=("opening_fullmove_max", "publish_threshold_n"),
        repr=False,
    )

    @classmethod
    def load(cls, path: Path | str | None = None) -> "Config":
        """Charge la config par défaut, surchargée par un TOML si présent."""
        cfg = cls()
        toml_path = Path(path) if path else PROJECT_ROOT / "config.local.toml"
        if toml_path.exists():
            with toml_path.open("rb") as fh:
                data = tomllib.load(fh)
            cfg._apply(data)
        # La variable d'environnement l'emporte (jamais versionnée, jamais loggée).
        env_token = os.environ.get("LICHESS_TOKEN")
        if env_token:
            cfg.lichess_token = env_token
        return cfg

    def has_token(self) -> bool:
        """Un token est-il configuré ? (sans jamais exposer sa valeur)."""
        return bool(self.lichess_token)

    def _apply(self, data: dict) -> None:
        paths = {"data_dir", "db_path", "csv_path"}
        for key, value in data.items():
            if not hasattr(self, key) or key.startswith("_"):
                continue
            setattr(self, key, Path(value) if key in paths else value)

    def persisted_settings(self) -> dict[str, str]:
        """Réglages à écrire dans la table Settings (attachés à l'artefact)."""
        return {k: str(getattr(self, k)) for k in self._persisted_keys}
