"""Tests de `force_safe_stdio` : la sortie cp1252 redirigée ne tue plus le CLI."""

import io
import sys

from otkb.logging_setup import force_safe_stdio


def test_force_safe_stdio_survives_cp1252_redirect(monkeypatch):
    """Reproduit le crash du 17/07 : « ≥ » imprimé vers un flux cp1252.

    Sans le correctif, `print("≥")` lève UnicodeEncodeError (cp1252 ne connaît
    pas U+2265) ; avec, le caractère est remplacé et la commande survit.
    """
    raw = io.BytesIO()
    cp1252 = io.TextIOWrapper(raw, encoding="cp1252")   # errors="strict" par défaut
    monkeypatch.setattr(sys, "stdout", cp1252)

    force_safe_stdio()
    print("25 183 positions fréquentes (≥ 50) — suites →")   # ne doit pas lever
    cp1252.flush()

    out = raw.getvalue().decode("cp1252")
    assert "positions" in out            # le message passe…
    assert "?" in out                    # …l'inencodable est remplacé, pas fatal


def test_force_safe_stdio_ignores_streams_without_reconfigure(monkeypatch):
    """pytest/capsys remplacent stdout par des objets sans `reconfigure` : no-op."""
    monkeypatch.setattr(sys, "stdout", io.StringIO())
    force_safe_stdio()                   # ne doit pas lever
    print("toujours vivant")
    assert "toujours vivant" in sys.stdout.getvalue()
