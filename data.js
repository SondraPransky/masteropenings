// ════════════════════════════════════════════════════════════
//  FICHIER DE CONTENU — MODIFIEZ UNIQUEMENT CE FICHIER
//  Ouvrez-le avec le Bloc-notes ou VS Code.
//  Respectez les guillemets " et les virgules ,
//  N'effacez pas les accolades { } ni les crochets [ ]
// ════════════════════════════════════════════════════════════

const SITE = {

  // ── Identité ─────────────────────────────────────────────
  nom:       "EECoach",
  tagline:   "Révision d'ouvertures",
  lien_outil: "index.html",   // chemin vers l'outil de drill

  // ── Navigation ───────────────────────────────────────────
  nav_cta: "Lancer l'outil →",

  // ── Hero (grande bannière) ───────────────────────────────
  hero: {
    sur_titre:  "Outil pédagogique d'échecs",
    titre:      "Faites réviser vos<br>ouvertures, <em>en ligne</em>",
    sous_titre: "Importez vos PGN annotés, partagez un code à vos élèves et analysez leurs erreurs position par position — sans aucune inscription.",
    cta_principal:   "Lancer l'outil gratuitement",
    cta_secondaire:  "Voir comment ça marche ↓"
  },

  // ── Chiffres clés (3 stats sous le hero) ─────────────────
  stats: [
    { valeur: "100%",   label: "Gratuit & open-source" },
    { valeur: "< 1 min", label: "Pour créer un module" },
    { valeur: "∞",      label: "Élèves simultanés" }
  ],

  // ── Fonctionnalités (3 cartes) ────────────────────────────
  fonctionnalites: [
    {
      icone: "♟",
      titre: "Import PGN avec commentaires",
      description: "Collez n'importe quel PGN. Les commentaires {…} sont lus automatiquement et affichés à l'élève après chaque coup."
    },
    {
      icone: "↗",
      titre: "Mode Ligne complète",
      description: "L'adversaire joue automatiquement. L'élève rejoue toute l'ouverture de mémoire, coup après coup, sans aide."
    },
    {
      icone: "📤",
      titre: "Partage instantané par code",
      description: "Un clic génère un code unique. L'élève le colle dans l'outil pour importer le module. Aucun compte, aucune app."
    },
    {
      icone: "📋",
      titre: "Vue Professeur",
      description: "Tableau de bord par élève : taux de réussite, erreurs par position, historique. Identifiez les points faibles du groupe."
    }
  ],

  // ── Comment ça marche (3 étapes) ─────────────────────────
  etapes: [
    {
      num: "01",
      titre: "Le prof crée le module",
      description: "Collez un PGN avec vos annotations, choisissez le mode (Ligne complète ou Flash) et cliquez sur Créer."
    },
    {
      num: "02",
      titre: "Un code de partage",
      description: "Cliquez 📤 pour générer un code compact. Envoyez-le par message, email, ou affichez-le en classe."
    },
    {
      num: "03",
      titre: "L'élève révise",
      description: "Il colle le code, entre son prénom et joue immédiatement. Le prof voit les résultats en temps réel."
    }
  ],

  // ── Citation / Témoignage ─────────────────────────────────
  citation: {
    texte:  "Enfin un outil simple pour donner des devoirs d'ouvertures. Je crée le module, j'envoie le code au groupe, et le lendemain j'ai les statistiques.",
    auteur: "Formateur fédéral",
    afficher: true   // mettez false pour masquer cette section
  },

  // ── Section CTA finale ────────────────────────────────────
  cta_final: {
    titre:       "Prêt à réviser ?",
    description: "Gratuit, sans inscription, sans installation. Fonctionne dans n'importe quel navigateur.",
    bouton:      "Ouvrir EECoach"
  },

  // ── Footer ───────────────────────────────────────────────
  footer: {
    description: "Outil pédagogique libre pour les professeurs d'échecs.",
    liens: [
      // { label: "Contact", url: "mailto:votre@email.fr" },
      // { label: "GitHub",  url: "https://github.com/..." }
    ]
  }

};
