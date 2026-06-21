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
    sous_titre: "Créez vos modules d'ouvertures, assignez-les à vos élèves, et analysez leurs erreurs position par position — chacun sur son compte.",
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
      titre: "Créez sur échiquier ou par PGN",
      description: "Construisez vos lignes en jouant sur un échiquier — variantes et commentaires inclus — ou collez n'importe quel PGN annoté."
    },
    {
      icone: "↗",
      titre: "Mode Ligne complète",
      description: "L'adversaire joue automatiquement. L'élève rejoue toute l'ouverture de mémoire, coup après coup, sans aide."
    },
    {
      icone: "👥",
      titre: "Assignation par classe",
      description: "Créez une classe, ajoutez l'email de vos élèves, et le module apparaît directement dans leur espace — où qu'ils soient."
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
      titre: "Assignez à votre classe",
      description: "Ajoutez l'email de vos élèves à une classe et choisissez les modules à réviser. Ils sont notifiés dans leur espace."
    },
    {
      num: "03",
      titre: "L'élève révise",
      description: "Il se connecte, voit ses modules assignés et révise. Vous suivez ses résultats en temps réel."
    }
  ],

  // ── Citation / Témoignage ─────────────────────────────────
  citation: {
    texte:  "Enfin un outil simple pour donner des devoirs d'ouvertures. Je crée le module, je l'assigne à ma classe, et le lendemain j'ai les statistiques.",
    auteur: "Formateur fédéral",
    afficher: true   // mettez false pour masquer cette section
  },

  // ── Section CTA finale ────────────────────────────────────
  cta_final: {
    titre:       "Prêt à réviser ?",
    description: "Gratuit, sans installation. Crée ton compte et commence en moins d'une minute.",
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
