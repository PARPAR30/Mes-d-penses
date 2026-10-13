# Mon Budget

Suivi de budget et de dépenses par **enveloppes** : un poste, un budget mensuel, une jauge qui se remplit au fil du mois. Les revenus se notent de la même façon, ponctuels ou récurrents, et l'accueil affiche le solde réel du mois.

Un repère sur la jauge marque où la dépense en serait si elle suivait le calendrier, et une ligne dit où le mois finira au rythme actuel : « il te reste 300 € » ne dit pas si c'est confortable ou si tout va y passer avant le 20. La projection n'apparaît qu'à partir du 7 du mois, et n'extrapole que la part **variable** — étaler le loyer payé le 3 sur trente jours annoncerait quatorze mille euros pour un budget de mille sept cents.

Un seul code source pour trois usages :

- un **site mobile** (GitHub Pages) installable sur l'écran d'accueil de l'iPhone ;
- une **application Windows** (`.exe`) ;
- une **application macOS** (`.dmg`).

Les données restent **sur l'appareil** (`localStorage`), sans compte ni serveur. Chaque appareil a donc son propre budget ; l'export/import JSON sert à les transférer.

---

## Démarrer

```bash
npm run serve
```

Affiche deux adresses : une pour l'ordinateur, une pour l'iPhone sur le même Wi-Fi.

Le fichier `web/index.html` s'ouvre aussi directement par double-clic — sans le mode hors-ligne, qui exige `http://` ou `https://`.

## Installer sur l'iPhone

1. Ouvrir le site dans **Safari** (pas Chrome : lui seul sait installer une app).
2. Bouton **Partager** → **Sur l'écran d'accueil**.

L'appli s'ouvre alors en plein écran, sans barre d'adresse, et fonctionne sans connexion.

## Ajouter une dépense depuis un raccourci Apple

iOS n'offre à aucune appli tierce le moyen de détecter un paiement Apple Pay pour se déclencher automatiquement — ni Raccourcis, ni Mon Budget. La carte **Réglages → Ajout rapide** propose donc le plus proche que permette la plateforme : un raccourci lancé en un geste (bouton Action, tapotement arrière, écran d'accueil) qui ouvre directement le tiroir « Nouvelle dépense ».

Le contrat d'URL, géré par `consumeShortcutLink()` dans `web/app.js` :

| Paramètre | Effet |
|---|---|
| `ajouter=1` | requis — ouvre le tiroir de saisie |
| `montant=12,50` | préremplit le montant (accepte virgule ou point) ; ignoré silencieusement s'il est illisible |
| `env=Courses` | présélectionne l'enveloppe, par id ou par nom (insensible à la casse) |
| `libelle=Boulangerie` | préremplit le libellé |

La dépense n'est jamais enregistrée sans confirmation : le tiroir s'ouvre toujours pour laisser vérifier montant et catégorie avant validation.

## Ce que fait l'appli

| | |
|---|---|
| Accueil | le reste à dépenser, la jauge par enveloppe (pastille à initiale), le repère de rythme et la projection de fin de mois ; tri « mon ordre » ou « plus entamées » |
| Dépenses | les mouvements du mois, jour par jour ; la recherche ratisse **tout l'historique** et totalise ce qu'elle trouve ; **Filtres** par période (30 jours, 3 mois, année, tout, dates) et par montant ; **Sélectionner** pour modifier (enveloppe, date) ou supprimer plusieurs lignes d'un coup |
| Bilan | comparaison au mois précédent, six derniers mois (le total au-dessus de chaque barre, chaque barre y emmène), répartition en barre ou en camembert |
| Récurrent | calendrier des échéances du mois, revenus récurrents, dépenses récurrentes |
| Réglages | (engrenage de la barre du haut) thème, export / import, lien du raccourci Apple, tout effacer ; la carte d'installation disparaît une fois l'appli installée |

**Évitable** est une **étiquette** à cocher sur n'importe quelle dépense (un resto est à la fois « Sorties » et évitable), pas une enveloppe : le Bilan chiffre sa part du mois (« dont évitable … »), la liste la signale et un filtre ne garde que les évitables. Une enveloppe nommée « Évitable » (créée avec la 1.9) continue d'être comptée comme telle.

Le bouton **+**, au centre de la barre d'onglets, note une dépense ou un revenu ponctuel. Toute suppression (mouvement, sélection, enveloppe, règle récurrente, « Tout effacer ») propose **Annuler** pendant sept secondes : on ne remet que ce qui a été retiré, sans toucher à ce qui a été noté entre-temps. En modification, **Dupliquer** rouvre le même montant, la même enveloppe et le même libellé à la date du jour — pour la dépense qui revient sans être assez régulière pour mériter une règle. Le mode **Gérer** de l'accueil sert à créer, modifier et **réordonner** les enveloppes.

## Gestes et accessibilité

Balayer une ligne vers la gauche la supprime (annulable) ; balayer une vue change de mois ; toucher le titre du mois ouvre un sélecteur de mois et d'année ; glisser la poignée d'un tiroir vers le bas le ferme. Tiroir ouvert, le reste de l'appli est `inert` et le focus revient au bouton d'origine à la fermeture ; les groupes de choix se parcourent aux flèches. Les tailles de texte sont en `rem` et suivent la taille réglée dans iOS (`--text-scale`).

## Budgets, report, objectifs

- **Un budget par enveloppe et par mois.** Changer le budget de Courses ne vaut que pour le mois affiché et les suivants (`budgetHistory`) ; les mois passés gardent le leur, sauf si on coche « Appliquer aussi aux mois passés ».
- **Report du reste** (par enveloppe) : ce qui n'a pas été dépensé un mois s'ajoute au suivant ; un dépassement n'est jamais reporté comme une dette.
- **Supprimer une enveloppe qui contient des dépenses** propose de les réaffecter, d'archiver l'enveloppe (historique gardé, saisie fermée, règles récurrentes en pause) ou de tout supprimer. Les archivées se restaurent depuis *Gérer*.
- **Premier lancement guidé** : revenu mensuel et budgets saisis tout de suite, au lieu de montants inventés.
- **Suggestion d'enveloppe** : un libellé déjà rangé (« Monoprix ») présélectionne son enveloppe habituelle.
- **Objectifs d'épargne** (accueil) : montant, avance, échéance et somme à mettre de côté par mois ; versements annulables.
- **À venir** (onglet Récurrent) : les échéances des 7 prochains jours, et charges fixes contre revenus fixes.
- Une échéance au **29, 30 ou 31** tombe le dernier jour du mois quand celui-ci est plus court.

## Les échéances récurrentes

Une règle récurrente est un modèle : elle « tamponne » une vraie dépense (ou un vrai revenu) dès que le jour choisi est atteint. Elle ne pré-remplit jamais un mois futur.

Un iPhone laissé de côté six semaines sautait autrefois un loyer, et le bilan des mois traversés restait faux pour toujours. Les mois manqués sont donc **rattrapés** à l'ouverture, en remontant jusqu'au champ `debut` de la règle — posé à sa création, remis au mois courant à chaque sortie de pause, pour qu'une pause ne se rattrape pas rétroactivement. Le rattrapage s'arrête à douze mois en arrière : importer une sauvegarde de trois ans ne doit pas faire surgir trente-six loyers d'un coup. Un message dit ce qui a été rattrapé.

Supprimer à la main l'occurrence d'un mois ne la fait **pas** revenir : le mois est retenu dans `rule.skipped` et la règle ne le recrée plus (Annuler le rend). Déplacer une échéance dans un autre mois fait de même pour l'ancien.

## Mettre en ligne

Le workflow `.github/workflows/pages.yml` publie le dossier `web/` à chaque `push` sur `main`. Une seule chose à faire côté GitHub, une fois : **Settings → Pages → Source : GitHub Actions**.

## Construire les applications

En local, pour la plateforme courante :

```bash
npm install
npm run build
```

Résultats dans `src-tauri/target/release/bundle/` (`nsis/*.exe` et `msi/*.msi` sous Windows, `dmg/*.dmg` sous macOS).

Les paquets desktop se construisent sur le PC (ou le Mac), pas sur GitHub : `build-windows.yml` et `build-mac.yml` existent mais ne se déclenchent plus automatiquement à chaque push — uniquement à la demande, depuis l'onglet **Actions → sélectionner le workflow → Run workflow**, si besoin d'un `.dmg` sans avoir de Mac sous la main.

> Pour compiler en local il faut Rust (`rustup`) et, sous Windows, les *Build Tools* Visual Studio avec la charge de travail C++.

## Les données

| | |
|---|---|
| Où | `localStorage`, clé `mon-budget/v1` |
| Quoi | enveloppes (nom, couleur, budget mensuel, ordre), dépenses et revenus (montant, libellé, date), règles récurrentes (montant, libellé, jour, `debut` du rattrapage) |
| Montants | stockés en **centimes** (entiers), jamais en nombres à virgule |
| Transfert | Réglages → **Exporter** produit un `.json` ; **Importer** le relit sur un autre appareil |

Tout ce qui entre est **assaini à la lecture** : un budget écrit en toutes lettres retombe à zéro, un jour hors de 1–28 est ramené dedans, une dépense dont l'enveloppe a disparu est gardée sans enveloppe (elle a bien eu lieu) et apparaît sous « Sans enveloppe » dans la répartition, et ce qui n'est pas récupérable est écarté — l'import dit combien. Ce n'est pas du zèle : **une seule dépense sans date suffisait à interrompre tout le rendu**, et l'accueil restait vide pour toujours puisque la même sauvegarde était relue à chaque ouverture.

**Sauvegarde.** Sur iPhone installé, *Exporter* ouvre le menu Partager avec le fichier joint (Fichiers, AirDrop, Mail…) — le téléchargement direct y est peu fiable ; ailleurs, c'est un téléchargement. La date de la dernière sauvegarde s'affiche dans Réglages, et un rappel discret apparaît après 30 jours sans sauvegarde (au plus un par semaine). L'appli demande aussi au système un stockage persistant (`navigator.storage.persist()`). **Importer** compare le fichier aux données actuelles et demande confirmation avant de remplacer ; l'import reste annulable.

Rien n'est envoyé sur Internet — il n'y a aucun serveur. Effacer les données du site dans Safari efface le budget : d'où l'export.

## Structure

```
web/                  le site — c'est aussi le contenu des apps desktop
  index.html          squelette des cinq vues
  styles.css          direction « pièce » : plate, filets plutôt qu'ombres, thème clair + sombre
  app.js              état, stockage, rendu, interactions
  manifest.webmanifest / sw.js    installation et mode hors-ligne
  fonts/              Archivo embarquée (aucun appel réseau)
  icons/              icônes PWA et iPhone
  splash/             écrans de lancement iPhone, clairs et sombres (npm run splash)
src-tauri/            coque desktop (Tauri 2) → .exe et .dmg
tools/
  make-icons.mjs      régénère toutes les icônes (npm run icons)
  make-splash.mjs     régénère les écrans de lancement iPhone (npm run splash)
  serve.mjs           serveur de test local (npm run serve)
tests/navigateur/
  cdp.js              pilote Chrome minimal (protocole DevTools) + serveur statique
  regressions.test.js chaque bug corrigé + les parcours de base (npm test)
  audit.js            balayage de mise en page et de cibles tactiles (npm run audit)
design/chartes.html   les quatre directions proposées au départ (état d'origine, avant aplatissement)
.github/workflows/    déploiement du site, build Windows, build macOS
```

## Intégration continue

`pages.yml` lance d'abord `npm test` (Node 24 + le Chrome des runners Ubuntu) ; le site n'est déployé que si les tests passent. Une pull request est testée mais ne publie rien.

## Tests

```bash
npm test          # régressions : 220 vérifications, sortie non nulle si l'une casse
npm run audit     # audit de mise en page : débordements, texte coupé, cibles tactiles
```

Les deux pilotent un **vrai Chrome** par le protocole DevTools, à la taille d'un iPhone (390 × 844, puis 320 × 568). Aucune dépendance : Node 24 fournit `WebSocket`, Chrome est trouvé tout seul (`CHROME_PATH=…` pour l'imposer).

jsdom ne conviendrait pas : il ne reproduit ni la mise en page, ni le canevas qui dimensionne le champ montant, ni la règle `[hidden]{display:none}` de la feuille par défaut — c'est-à-dire précisément les endroits où les bugs sont tombés.

L'audit signale encore deux points, tenus pour acceptables : les segments de la barre de répartition font 28 px de haut (la légende juste dessous offre la même action sur 44 px), et les cases du calendrier tombent à 34 px sur un écran de 320 px (sept colonnes dans 256 px utiles, c'est de la géométrie).

## Régénérer les icônes

Les icônes sont dessinées par code, pas éditées à la main. Pour changer la couleur ou la forme, modifier `tools/make-icons.mjs` puis :

```bash
npm run icons
```

## Pièges déjà tombés dedans

**`hidden` ne masque rien si la CSS déclare un `display`.** Les navigateurs
posent `[hidden]{display:none}` depuis leur feuille par défaut, donc avec la
plus faible priorité de la cascade : une règle d'auteur comme
`.view{display:flex}` l'écrase et l'élément reste affiché. C'est ce qui
empilait les cinq vues sur une seule page interminable. D'où le garde-fou
`[hidden]{display:none !important}` en tête de `styles.css` — à ne pas retirer.
À noter : **jsdom ne reproduit pas ce bug** (il traite `hidden` à part), aucun
test DOM ne pouvait donc l'attraper.

**`getComputedStyle(el).font` peut renvoyer une chaîne vide.** Le raccourci
`font` n'est pas sérialisable dès qu'une propriété qu'il couvre n'y est pas
représentable — `font-variant-numeric:tabular-nums` par exemple. Le canevas qui
mesure le champ montant retombait alors sur `10px sans-serif` et rabotait le
champ à un chiffre. On compose la fonte à la main (`fontWeight`, `fontSize`,
`fontFamily`).

**Une donnée illisible fige toute l'appli, pas seulement sa ligne.** Une dépense
sans `date` faisait lever `t.date.slice(0,7)` dans `expensesOf()`, donc dans
`render()` : l'accueil restait à son HTML statique — « 0,00 € », aucune
enveloppe — et le rechargement n'y changeait rien, puisque la même sauvegarde
était relue. D'où `normalizeData()`, qui répare ou écarte à la lecture, et
réécrit une bonne fois le fichier fautif.

**`aspect-ratio` et `min-height` ensemble contraignent aussi la LARGEUR.**
Poser `min-height:40px` sur une case de calendrier carrée lui imposait 40 px de
large ; sept colonnes plus six gouttières font alors 298 px, contre 256 px
disponibles sur un écran de 320 px — et c'est toute la page qui débordait
horizontalement. Pour agrandir une cible tactile sans toucher à la mise en page,
on élargit la seule zone d'appui : un `::before` en `position:absolute` et
`inset` négatif, invisible.

**Un `<button>` ne se met pas dans un `<button>`.** C'est du HTML invalide, et le
navigateur ne le signale pas : il défait l'imbrication en déplaçant les nœuds, et
la mise en page part en morceaux. Les commandes « Monter » / « Descendre » sont
donc posées à côté de la rangée d'enveloppe, dans un `.env-row`, jamais dedans.

**Le montant est aligné à droite : trop long, il déborde par la gauche.** Ce sont
donc les chiffres de tête qui sortent du champ, et on lit 345,67 là où 12 345,67
est saisi. Le champ rétrécit sa fonte plutôt que de rogner.

## Après une modification de `web/`

Tiroirs et clavier : sur iPhone, quand le clavier monte, seule la fenêtre *visible* (`visualViewport`) rétrécit ; `fitSheetsToViewport()` remonte donc le tiroir d'autant (variables CSS `--kb` et `--vvh`). Sans cela, un tiroir en `bottom:0` reste derrière le clavier.

Trois valeurs à faire monter ensemble : `version` dans `package.json`, `APP_VERSION` en tête de `web/app.js`, et `CACHE` dans `web/sw.js`. C'est `CACHE` qui compte vraiment : sans changement, les appareils qui ont déjà installé l'appli continuent de servir l'ancienne version depuis leur cache.

Une appli posée sur l'écran d'accueil ne se recharge jamais d'elle-même. Quand le service worker installe une version plus récente, un bandeau **« Une version plus récente de Mon Budget est prête »** le propose, avec le bouton qui recharge — sans quoi une correction publiée pouvait rester invisible pendant des jours.

Puis `npm test` avant de pousser.
