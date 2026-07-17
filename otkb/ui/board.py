"""État d'échiquier + rendu SVG pour l'explorateur (python-chess, offline).

Aucune dépendance réseau ni JS de plateau : le SVG est produit par
`chess.svg` et affiché tel quel. La navigation se fait par coups légaux
(l'UI expose les coups possibles ; ici on ne gère que l'état + le rendu).
"""

from __future__ import annotations

import base64
from functools import lru_cache

import chess
import chess.svg

from ..fen import normalize_fen


class PositionParseError(ValueError):
    """Saisie de position illisible (ni FEN ni coups valides)."""


# Notation figurine (FAN) : la lettre de pièce devient un glyphe. Glyphes pleins
# (plus lisibles sur fond clair) ; les pions n'ont pas de lettre.
_FIGURINE = {"K": "♚", "Q": "♛", "R": "♜", "B": "♝", "N": "♞"}


@lru_cache(maxsize=12)
def _piece_data_uri(piece: chess.Piece) -> str:
    """Data-URI SVG d'une pièce seule (cache : 12 pièces possibles)."""
    b64 = base64.b64encode(chess.svg.piece(piece).encode()).decode()
    return f"data:image/svg+xml;base64,{b64}"


def to_figurine(san: str) -> str:
    """Convertit un SAN en notation figurine (ex. 'Bg5' → '♝g5', 'e8=Q' → 'e8=♛')."""
    if not san:
        return san
    out = san
    if out[0] in _FIGURINE:                       # pièce en tête de coup
        out = _FIGURINE[out[0]] + out[1:]
    if "=" in out:                                # pièce de promotion
        i = out.index("=")
        if i + 1 < len(out) and out[i + 1] in _FIGURINE:
            out = out[: i + 1] + _FIGURINE[out[i + 1]] + out[i + 2:]
    return out


class BoardState:
    """Plateau navigable : pousser/annuler des coups, exposer FEN & SVG."""

    def __init__(self) -> None:
        self.board = chess.Board()
        self.orientation: bool = chess.WHITE  # couleur en bas de l'échiquier

    # -- navigation --------------------------------------------------------
    def push_uci(self, uci: str) -> None:
        self.board.push_uci(uci)

    def push_san(self, san: str) -> None:
        self.board.push_san(san)

    def pop(self) -> None:
        if self.board.move_stack:
            self.board.pop()

    def reset(self) -> None:
        self.board.reset()

    def set_moves(self, moves: str) -> None:
        """Remplace l'état par une séquence UCI espace-séparée (peut être vide)."""
        board = chess.Board()
        for tok in moves.split():
            board.push_uci(tok)
        self.board = board

    def set_position(self, text: str) -> None:
        """Charge une position depuis un FEN OU une séquence de coups UCI.

        Heuristique : un '/' → FEN (4 ou 6 champs) ; sinon coups UCI. Lève
        `PositionParseError` sur saisie invalide.
        """
        text = text.strip()
        if not text:
            self.reset()
            return
        try:
            if "/" in text:
                parts = text.split()
                if len(parts) == 4:            # FEN normalisé → compléter les compteurs
                    text = f"{text} 0 1"
                self.board = chess.Board(text)
            else:
                self.set_moves(text)
        except (ValueError, AssertionError) as exc:
            raise PositionParseError(str(exc)) from exc

    # -- accès -------------------------------------------------------------
    @property
    def normalized_fen(self) -> str:
        return normalize_fen(self.board.fen())

    @property
    def ply(self) -> int:
        return len(self.board.move_stack)

    @property
    def last_move(self) -> chess.Move | None:
        return self.board.peek() if self.board.move_stack else None

    def history_san(self) -> list[str]:
        """Historique en SAN, reconstruit depuis le début (pour l'affichage)."""
        replay = chess.Board()
        out: list[str] = []
        for mv in self.board.move_stack:
            out.append(replay.san(mv))
            replay.push(mv)
        return out

    def legal_moves_san(self) -> list[tuple[str, str]]:
        """Coups légaux comme (san, uci), triés par SAN pour un affichage stable."""
        pairs = [(self.board.san(m), m.uci()) for m in self.board.legal_moves]
        pairs.sort(key=lambda p: p[0])
        return pairs

    def legal_targets(self, square: int) -> set[int]:
        """Cases d'arrivée légales depuis `square` (pour la surbrillance)."""
        return {m.to_square for m in self.board.legal_moves if m.from_square == square}

    def find_move(self, src: int, dst: int) -> chess.Move | None:
        """Coup légal src→dst (promotion → Dame par défaut), ou None."""
        for m in self.board.legal_moves:
            if m.from_square == src and m.to_square == dst:
                if m.promotion in (None, chess.QUEEN):
                    return m
        return None

    def moves_between(self, src: int, dst: int) -> list[chess.Move]:
        """Tous les coups légaux src→dst : 1 en général, 4 si promotion (Q/R/B/N)."""
        return [
            m for m in self.board.legal_moves
            if m.from_square == src and m.to_square == dst
        ]

    # -- rendu -------------------------------------------------------------
    # Cases aux couleurs « brown » lichess : IDENTIQUES à celles de l'échiquier
    # Chessground de l'Explorateur. Sans ça, chess.svg rend ses défauts orangés
    # (#ffce9e/#d18b47) et chaque vignette semble venir d'un autre logiciel —
    # défaut signalé par l'utilisateur le 16/07. Les pièces sont déjà les mêmes
    # (cburnett) des deux côtés.
    _SVG_COLORS = {
        "square light": "#f0d9b5",
        "square dark": "#b58863",
        "square light lastmove": "#cdd26a",
        "square dark lastmove": "#aaa23a",
    }

    def svg(self, size: int = 400, selected: int | None = None) -> str:
        # sans coordonnées ni bordures : l'échiquier remplit exactement l'image
        # (8×8), ce qui permet d'aligner la grille de zones cliquables par-dessus.
        fill: dict[int, str] = {}
        if selected is not None:
            fill[selected] = "#20b2aa66"
            for tgt in self.legal_targets(selected):
                fill[tgt] = "#20b2aa40"
        return chess.svg.board(
            self.board,
            size=size,
            orientation=self.orientation,
            lastmove=self.last_move,
            fill=fill,
            coordinates=False,
            borders=False,
            colors=self._SVG_COLORS,
        )

    def img_tag(self, size: int = 400, selected: int | None = None) -> str:
        """Balise <img> avec le SVG complet en data-URI base64 (rendu statique).

        chess.svg référence les pièces via <use xlink:href>. Injecté en innerHTML
        par NiceGUI/Vue, ces références ne résolvent pas (pièces invisibles) ; en
        document autonome (data-URI dans un <img>), elles résolvent correctement.
        """
        b64 = base64.b64encode(self.svg(size, selected).encode()).decode()
        return (
            f'<img src="data:image/svg+xml;base64,{b64}" '
            f'width="{size}" height="{size}" style="display:block" alt="échiquier"/>'
        )

    # -- rendu en 2 couches (fond + pièces) pour le glisser-déposer ---------
    def background_img_tag(self, size: int = 400, highlight: int | None = None) -> str:
        """Couche de fond : cases + surbrillance du dernier coup (et d'un indice)."""
        fill = {highlight: "#f6b73c88"} if highlight is not None else {}
        svg = chess.svg.board(
            chess.BaseBoard.empty(),
            size=size,
            orientation=self.orientation,
            lastmove=self.last_move,
            fill=fill,
            coordinates=False,
            borders=False,
        )
        b64 = base64.b64encode(svg.encode()).decode()
        return (
            f'<img src="data:image/svg+xml;base64,{b64}" draggable="false" '
            f'style="position:absolute; inset:0; width:100%; height:100%; '
            f'user-select:none; pointer-events:none"/>'
        )

    def pieces_html(self) -> str:
        """Couche pièces : une <img> déplaçable par case occupée (positions en %).

        Positions dépendantes de l'orientation (le côté au trait est en bas).
        """
        white_bottom = self.orientation == chess.WHITE
        cells: list[str] = []
        for square, piece in self.board.piece_map().items():
            file = chess.square_file(square)
            rank = chess.square_rank(square)
            col = file if white_bottom else 7 - file
            row = (7 - rank) if white_bottom else rank
            left = col * 12.5
            top = row * 12.5
            name = chess.square_name(square)
            cells.append(
                f'<img class="otkb-piece" data-square="{name}" draggable="false" '
                f'src="{_piece_data_uri(piece)}" '
                f'style="position:absolute; width:12.5%; height:12.5%; '
                f'left:{left}%; top:{top}%; cursor:grab; touch-action:none; '
                f'user-select:none"/>'
            )
        return "".join(cells)

    def moves_line(self, figurine: bool = False) -> str:
        """Ligne de coups lisible : '1. e4 c5 2. Nf3 ...' (figurine optionnelle)."""
        sans = self.history_san()
        out: list[str] = []
        for i, san in enumerate(sans):
            if i % 2 == 0:
                out.append(f"{i // 2 + 1}.")
            out.append(to_figurine(san) if figurine else san)
        return " ".join(out)
