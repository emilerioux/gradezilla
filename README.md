# 🦖 Gradezilla

PWA perso de suivi de notes pour l'université (Concordia, échelle GPA 4.30).

## Ce que ça fait

- **Calculateur « note nécessaire »** — tu fixes un objectif de lettre par cours, l'app dit la moyenne qu'il te faut sur tout ce qui reste, avec la fourchette finale possible (meilleur / pire cas).
- **Notes en %** → lettre + points GPA. Barème % → lettre **éditable par cours** (chaque prof à Concordia fixe ses seuils).
- **Multi-sessions + GPA cumulatif** (inclut cours antérieurs / externes).
- **Règles spéciales** : « garder les k meilleurs sur n », « retirer la pire note ».
- **Échéances à venir** triées par date, avec le poids de chaque travail.
- **Import de syllabus** — deux modes :
  - *Par défaut* : analyse **locale, gratuite, aucune donnée envoyée**. Détection par motifs (regex) du sigle, des composantes + pondérations, du barème % → lettre, des règles « best k of n » / « drop lowest » et des dates, sur du texte collé ou extrait d'un PDF (`pdf.js`) / `.docx` (`JSZip`). PDF scannés et photos non pris en charge.
  - *Optionnel* : coller une clé **Google Gemini** (gratuite, sans carte — `aistudio.google.com/apikey`) dans Réglages → l'import passe par `gemini-2.5-flash` : lecture plus fiable, gère **photos et PDF scannés**. Clé stockée en local uniquement. Sur l'offre gratuite, Google peut utiliser le contenu pour améliorer ses services.
  - Ce qui n'est pas détecté est signalé pour complétion à la main dans la fiche du cours.
- **Tutoriel** de premier lancement, re-jouable depuis Réglages → Aide.

## Données

100 % local, aucun compte, aucune clé, aucun coût : `localStorage` pour les cours/notes, `IndexedDB` pour les fichiers source. Exporte un `.json` de temps en temps (Réglages → Sauvegarde).

## Déploiement

Statique, aucune étape de build. Déployé via GitHub Pages depuis `main`.
**Après chaque déploiement, bumper `CACHE_NAME` dans `sw.js`** sinon le téléphone garde l'ancienne version en cache.
