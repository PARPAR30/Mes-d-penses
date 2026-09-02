# Mon Budget

Suivi de budget et de dépenses par **enveloppes** : un poste, un budget mensuel, une jauge qui se remplit au fil du mois. Les revenus se notent de la même façon, ponctuels ou récurrents, et l'accueil affiche le solde réel du mois.

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
| Quoi | enveloppes (nom, couleur, budget mensuel), dépenses et revenus (montant, libellé, date), règles récurrentes |
| Montants | stockés en **centimes** (entiers), jamais en nombres à virgule |
| Transfert | Réglages → **Exporter** produit un `.json` ; **Importer** le relit sur un autre appareil |

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
src-tauri/            coque desktop (Tauri 2) → .exe et .dmg
tools/
  make-icons.mjs      régénère toutes les icônes (npm run icons)
  serve.mjs           serveur de test local (npm run serve)
design/chartes.html   les quatre directions proposées au départ (état d'origine, avant aplatissement)
.github/workflows/    déploiement du site, build Windows, build macOS
```

## Régénérer les icônes

Les icônes sont dessinées par code, pas éditées à la main. Pour changer la couleur ou la forme, modifier `tools/make-icons.mjs` puis :

```bash
npm run icons
```

## Deux pièges déjà tombés dedans

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

## Après une modification de `web/`

Penser à incrémenter `CACHE` dans `web/sw.js` : sans ça, les appareils qui ont déjà installé l'appli continuent de servir l'ancienne version depuis leur cache.
