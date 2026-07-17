"""Traitement des OpeningTags Lichess (SPEC §E, grill #6).

Deux étages :

1. À l'ingestion — `parse_opening_tags` extrait les tags bruts distincts d'un
   puzzle. Chaque tag est inséré provisoirement comme sa propre famille.
2. Post-pass GLOBAL — une fois toutes les ouvertures connues, `compute_family`
   remonte chaque tag à la famille = plus long tag connu (toutes ouvertures
   confondues) qui en est préfixe strict sur frontière `_`. Robuste même si un
   puzzle ne porte que le tag profond.

Déterministe, zéro réseau, stdlib seule.
"""

from __future__ import annotations


def humanize(tag: str) -> str:
    """Rend un tag lisible : French_Defense_Advance -> 'French Defense Advance'."""
    return tag.replace("_", " ").strip()


def parse_opening_tags(raw: str | None) -> list[str]:
    """Tags bruts distincts d'un champ OpeningTags, ordre préservé."""
    if not raw:
        return []
    seen: dict[str, None] = {}
    for tag in raw.split():
        if tag:
            seen.setdefault(tag, None)
    return list(seen)


def compute_family(tag: str, known_tags: set[str]) -> tuple[str, str | None]:
    """Famille et variation d'un tag, résolues sur l'ensemble GLOBAL des tags.

    family    = plus long `other` de `known_tags`, `other != tag`, tel que
                `tag` commence par `other + '_'` ; à défaut, `tag` lui-même.
    variation = portion propre au tag au-delà de la famille (humanisée), ou None.
    """
    family = tag
    best_len = -1
    for other in known_tags:
        if other != tag and tag.startswith(other + "_") and len(other) > best_len:
            family = other
            best_len = len(other)

    variation = None if family == tag else humanize(tag[len(family) + 1:])
    return family, variation
