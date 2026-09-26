# Mots

Entraînement quotidien au rappel lexical : un prompt (définition, phrase à trou, contraste ou anglicisme), « J'ai » ou « Je sèche », puis la réponse. Répétition espacée en 5 rappels (découverte, j+3-6, j+10-15, j+25-40, j+80-100).

## Mise en ligne sur GitHub Pages

1. Sur github.com, crée un dépôt **public** nommé `mots` (Pages gratuit exige un dépôt public).
2. Dans le dépôt : **Add file → Upload files**, glisse tout le contenu de ce dossier (y compris le dossier `icons`), puis **Commit changes**.
3. **Settings → Pages** : Source = *Deploy from a branch*, Branch = `main`, dossier `/ (root)`, **Save**.
4. Une minute plus tard, l'appli est à `https://<ton-identifiant>.github.io/mots/`.
5. Sur Android, ouvre cette adresse dans Chrome, menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).

Après la première ouverture, l'appli fonctionne hors ligne : toute la banque de mots est dans le téléphone.

## Ajouter des mots

Les mots sont dans `words.js`. Pour un nouveau lot, remplace ce fichier sur GitHub (Upload files, même nom). La progression est indexée sur le mot lui-même, donc elle survit aux mises à jour. La nouvelle version est prise au lancement suivant de l'appli (parfois le deuxième, à cause du cache hors ligne).

Format d'une entrée :

```js
{"w":"pugnace","cat":"A","reg":"S","type":"P","prompt":"… une avocate particulièrement ___.","alts":["combative"],"ex":"Sans une négociatrice aussi pugnace, …","note":"(facultatif)"}
```

- `cat` : N nom, V verbe, A adjectif, R adverbe
- `reg` : S soutenu usuel, F familier, E anglicisme
- `type` : D définition, P phrase à trou (`___`), C contraste (`«mot vague»`), E anglicisme (`*mot anglais*`)
- `exw` (facultatif) : forme exacte à surligner dans l'exemple quand le repérage automatique échoue

## Données

La progression reste dans le stockage du navigateur du téléphone. **Réglages → Sauvegarde** permet d'exporter un fichier JSON (progression + journal de chaque réponse avec sa latence) et de le restaurer. Désinstaller l'appli ou vider les données de Chrome efface la progression : exporte régulièrement.
