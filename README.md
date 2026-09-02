# 🦖 Gradezilla

PWA perso de suivi de notes pour l'université (Concordia, échelle GPA 4.30).

## Ce que ça fait

- **Calculateur « note nécessaire »** — tu fixes un objectif de lettre par cours, l'app dit la moyenne qu'il te faut sur tout ce qui reste, avec la fourchette finale possible (meilleur / pire cas).
- **Notes en %** → lettre + points GPA. Barème % → lettre **éditable par cours** (chaque prof à Concordia fixe ses seuils).
- **Multi-sessions + GPA cumulatif** (inclut cours antérieurs / externes).
- **Règles spéciales** : « garder les k meilleurs sur n », « retirer la pire note ».
- **Échéances à venir** triées par date, avec le poids de chaque travail.
- **Import de documents** (PDF, photo, .docx, copier-coller) : Gradezilla envoie le doc à l'API Claude (ta propre clé, stockée sur l'appareil) et pré-remplit le cours — composantes, pondérations, dates, notes déjà obtenues, infos du prof. Ce qui manque est signalé pour complétion à la main.

## Données

Tout est local : `localStorage` pour les cours/notes, `IndexedDB` pour les fichiers source. Exporte un `.json` de temps en temps (Réglages → Sauvegarde).

## Clé API

Réglages → Clé API Claude. Utilisée uniquement pour l'analyse de documents, envoyée seulement à `api.anthropic.com`. Coût : quelques cents par syllabus.

## Déploiement

Statique, aucune étape de build. Déployé via GitHub Pages depuis `main`.
**Après chaque déploiement, bumper `CACHE_NAME` dans `sw.js`** sinon le téléphone garde l'ancienne version en cache.
