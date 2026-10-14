# Journal des versions

Format : une entrée par version, la plus récente en haut. Les trois valeurs à tenir à jour à chaque
publication (`package.json`, `APP_VERSION` dans `web/app.js`, `CACHE` dans `web/sw.js`) sont
décrites dans le README.

## 2.2.0 — 2026-10-14

**Ajouté**
- **Reste à vivre par jour** sur l'accueil : « Tu peux dépenser 23 € par jour jusqu'à la fin du mois », après déduction des charges fixes pas encore prélevées.
- **Récurrences** : chaque semaine, tous les 3 mois, chaque année ; date de fin ; **montant variable** (noté « estimé », à confirmer en l'ouvrant).
- **Avis dans l'appli** : budget à 80 % ou dépassé, dépenses « à classer » (sans enveloppe), montants « à confirmer ». Les avis de seuil se rangent d'un geste.
- **Le mois en trois phrases** (Bilan), et une annonce discrète en début de mois.
- **Note** sur chaque mouvement (recherchable), **division** d'une dépense entre plusieurs enveloppes, **virement de budget** d'une enveloppe à une autre pour le mois.
- **Épargne reliée au budget** : une mise de côté mensuelle automatique est une vraie dépense de l'enveloppe « Épargne » et fait avancer l'objectif.
- **Raccourci iPhone refait** : boîte de réception par fichiers (automatisation Apple Pay « Transaction », iOS 17+), ouverture directe sur « Nouvelle dépense », lien web étendu (`enregistrer=1`, `date`, `type`, `note`, `evitable`) avec garde anti-doublon.
- Audit de mise en page dans la CI, mise à jour automatique des actions GitHub (Dependabot), ce journal.

**Corrigé**
- La recherche ignore désormais les accents et la casse (« cafe » trouve « Café »).
- Les liens de raccourci ouvraient Safari, dont le stockage est séparé de l'appli installée : la dépense était notée au mauvais endroit. Le README et Réglages l'expliquent et proposent le chemin fiable.
- Une sauvegarde qui ne se lit pas n'est plus remplacée en silence par une sauvegarde vide : la copie brute est mise de côté et récupérable dans Réglages.

## 2.1.0 — 2026-10-14

- Supprimer l'occurrence d'un mois récurrent ne la recrée plus à la réouverture (annulable).
- Import : comparaison et confirmation avant de remplacer, annulable.
- Export par le menu Partager sur iPhone, date de dernière sauvegarde, rappel après 30 jours, stockage persistant.
- CI : `npm test` avant tout déploiement.
- Contrastes ≥ 4,5:1 dans les deux thèmes ; vraie roue dentée pour Réglages.

## 2.0.0 — 2026-10-14

- « Évitable » devient une étiquette sur toute dépense.
- Budgets gardés mois par mois ; report du reste d'une enveloppe ; réaffecter ou archiver une enveloppe supprimée.
- Premier lancement guidé, suggestion d'enveloppe d'après le libellé.
- « À venir » (7 jours), objectifs d'épargne, échéances jusqu'au 31.
- Toute modification annulable ; pagination, balayage pour supprimer, sélecteur de mois, tiroirs au glissé.
- Texte en `rem` qui suit la taille iOS, retour tactile léger, écrans de lancement iPhone, focus et `inert`.

## 1.10.0 — 2026-10-14

- Sélection multiple (modifier l'enveloppe ou la date, supprimer), filtres par période et montant, « Annuler » après une suppression.
- Le bouton + passe dans la barre d'onglets ; Réglages devient un engrenage en haut.
- Bilan : total au-dessus de chaque barre ; accueil : tri « plus entamées », pastilles à initiale.

## 1.8.1 — 2026-09-04
- Le libellé suit le modèle quand on en change.

## 1.8.0 — 2026-09-04
- Répare la lecture des données (sauvegardes abîmées), rattrape les échéances manquées, ajoute le rythme du mois.

## 1.7.0 — 2026-09-02
- Répare la navigation mobile, coque en verre dépoli.

## 1.6.x — 2026-09-02
- Direction plate, calendrier, revenus récurrents, boutons du bas.

## 1.0.0 — 2026-09-02
- Première version : budget par enveloppes, 100 % local.
