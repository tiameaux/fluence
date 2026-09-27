# Mots

Une petite application web (PWA) pour entraîner le **rappel lexical** en français : retrouver activement des mots précis qu'on comprend mais qu'on n'emploie pas spontanément.

Un quart d'heure par jour, sur téléphone, hors ligne.

## Principe

Chaque carte est une phrase à trou. On cherche le mot, puis on appuie sur **J'ai** ou **Je sèche** : rien à taper.

- **Aides** : toucher le trou affiche la définition ; le bouton *Indice* révèle le mot lettre par lettre.
- **Réponse** : mot cible, autres réponses acceptées, phrase d'exemple et définition. On touche le mot qu'on avait trouvé, ou *Autre mot ou rien*.
- **Répétition espacée** : découverte, puis rappels à J+3-6, J+10-15, J+25-40 et J+80-100. Un mot raté revient le lendemain et redescend d'un intervalle. Une réussite obtenue avec des lettres révélées raccourcit l'intervalle suivant.
- **Séance bornée par le temps** (15 min par défaut) : les révisions du jour, mêlées à des nouveaux mots, puis d'autres nouveaux mots s'il reste du temps.
- Chaque mot a deux phrases à trou, utilisées en alternance d'un rappel à l'autre.
- Un mot sans intérêt s'écarte d'un bouton ou d'un glissement vers la gauche. On peut le récupérer dans les Réglages.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Page et styles |
| `app.js` | Logique : séances, planification, écrans, sauvegarde |
| `words.js` | Banque de mots |
| `sw.js` | Service worker (fonctionnement hors ligne) |
| `manifest.webmanifest`, `icons/` | Installation comme application |

Aucune dépendance ni étape de build : ce sont des fichiers statiques.

## Banque de mots

Une entrée de `words.js` :

```js
{
  "w": "aplanir", "cat": "V", "reg": "S",
  "c": ["Le médiateur a réussi à ___ les dernières difficultés.",
        "Il faut ___ les désaccords avant la réunion."],
  "d": "(Figuré) Faire disparaître les difficultés, les obstacles.",
  "alts": ["lisser", "régler"],
  "ex": "Il faut aplanir les désaccords avant la réunion."
}
```

| Champ | Contenu |
|---|---|
| `w` | Mot cible (clé de la progression : ne pas le renommer) |
| `c` | Phrases à trou (`___`). Pour les anglicismes, le mot anglais est entre astérisques : `*smug*` |
| `d` | Définition, facultative pour les anglicismes |
| `alts` | Autres réponses acceptées |
| `ex` | Phrase d'exemple de l'écran réponse ; `exw` donne la forme exacte à surligner si le repérage automatique échoue |
| `cat` | `N` nom, `V` verbe, `A` adjectif, `R` adverbe |
| `reg` | `S` soutenu usuel, `F` familier, `E` anglicisme |
| `note` | Remarque facultative (faux ami, confusion fréquente…) |
| `calib` | Mot déjà vu pendant le calibrage : introduit trois semaines après la première séance |

Pour ajouter des mots, on complète le tableau et on pousse le fichier. La progression existante est conservée.

## Déploiement

Le site est servi par Netlify à partir de ce dépôt : chaque commit sur `main` est publié automatiquement.

Après une mise à jour, l'application installée prend la nouvelle version au lancement suivant (parfois le deuxième, à cause du cache hors ligne). Si `app.js` ou `index.html` changent, incrémenter `CACHE` dans `sw.js` force le rafraîchissement.

Pour tester en local : `python3 -m http.server` dans le dossier, puis ouvrir `http://localhost:8000`.

## Données

Toute la progression reste dans le navigateur du téléphone (`localStorage`, clé `mots.v1`). Rien n'est envoyé nulle part.

*Réglages → Sauvegarde* exporte un JSON contenant la progression et le journal de chaque réponse : date, mot, palier, résultat, latence, phrase utilisée, indices et définition consultée. Le même écran permet de restaurer une sauvegarde. Vider les données de Chrome efface la progression.
