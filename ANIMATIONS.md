# La Re-Naissance — notes techniques (site-oak-v2)

Base : template Webflow "Oak" (export statique), copié tel quel puis adapté section par
section. Ce document résume ce qui a été changé et pourquoi, pour ne pas avoir à
redécouvrir les mêmes pièges si le site est repris plus tard.

## Pourquoi des animations "maison"

Les interactions de scroll d'Oak (IX2, moteur propriétaire Webflow) sont compilées dans
`assets/js/webflow.schunk.a9b0014f8d70e418.js`. Une fois le site exporté et auto-hébergé
(hors Webflow), ce moteur ne se déclenche plus de façon fiable au scroll réel. Plutôt que
de laisser les sections concernées statiques ou cassées, les 4 interactions de scroll ont
été **reproduites à la main**, en extrayant les vraies valeurs de keyframes du JS compilé
(recherche de l'`actionListId` correspondant à chaque `data-w-id`, puis extraction du JSON
complet de l'action list). Les valeurs viennent donc directement d'Oak ; seul le moteur qui
les joue est différent.

Chaque script suit le même schéma (visible en bas de `index.html`, 4 IIFE) :
- `targetProgress()` : progression 0–100 calculée depuis `getBoundingClientRect()` du
  `.X-scroll-block` (le wrapper haut qui donne sa longueur de scroll à la section pinned).
- `interp(keyframes, progress)` : interpolation linéaire entre paires `[keyframe%, valeur]`.
- Un lissage exponentiel (`shown += (target - shown) * 0.12`) reproduit le `smoothing:90`
  qu'Oak appliquait nativement à ces tracks — sans lui, le mouvement est mécanique/saccadé.
- `prefers-reduced-motion` : rendu directement à l'état final, pas de boucle d'animation.

## Les 4 sections animées

1. **About** ("a-8") — les bandeaux masquant le texte ("walking blocks") glissent pour
   révéler le texte, les 3 photos apparaissent en scale/rotate. Bug corrigé : la section a
   DEUX blocs de titre (donc 6 walking-blocks, pas 3) — `querySelectorAll`, pas `querySelector`.
2. **Nos créations / Dish** ("a-9") — le carrousel de plats glisse horizontalement au
   scroll. Oak avait une valeur fixe (`-28%`, calibrée pour 4 cartes) ; recalculée
   dynamiquement (`list.scrollWidth - wrapper.clientWidth`) pour que les 6 cartes actuelles
   soient toutes atteignables.
3. **Réservation** ("a-12") — 3 bandeaux glissent alternativement de la gauche/droite, puis
   le badge rond ("NOUS CONTACTER") apparaît en fondu/scale.
4. **En cuisine / Gallery** ("a-19") — le bloc photo monte depuis le bas, un léger
   pivotement des 4 photos latérales suggère qu'il y en a plusieurs empilées, puis elles se
   déploient en éventail. La photo centrale (`._3`) ne bouge jamais (c'est l'ancre du
   design). **Important** : cette interaction n'existe, côté Oak, que sur les breakpoints
   "main/medium/small" (>479px) — en dessous, Oak bascule sur une grille 2 colonnes statique
   complètement différente (`position:static`, `flex-wrap`). Le script et les CSS custom de
   cette section sont donc bloqués sous 480px (`@media (min-width:480px)` + un check
   `matchMedia` dans le JS) pour ne pas se battre avec cette mise en page mobile native.

## Pièges rencontrés (à ne pas refaire)

- **Hauteur/largeur circulaires** : `.gallery-image-block` et ses 5 images utilisaient des
  tailles en `%` qui se référençaient mutuellement (aucune n'a de taille fixe) → tout
  s'effondrait à 0×0 tant qu'aucune image n'était décodée. Oak s'en sortait normalement car
  IX2 fige une taille en px au chargement. Fixé en ajoutant les attributs HTML
  `width`/`height` réels sur chaque `<img>` (ça fixe le ratio dès le premier paint, avant
  même le décodage) + une hauteur fixe sur le bloc parent.
- **`justify-content: space-between` sur une hauteur devenue élastique** : plusieurs
  sections (`.reservation-section`, `.footer-section`) étaient à l'origine `height:100vh;
  overflow:hidden`. En les rendant `height:auto` (pour éviter le clipping vertical), les
  enfants espacés en `space-between` se sont retrouvés étalés sur une hauteur bien plus
  grande que prévu (gros espace vide). Fixé en passant ces conteneurs en
  `justify-content:flex-start` + un `gap`/`margin` explicite.
- **`overflow:visible` casse le clip horizontal** : en autorisant le débordement vertical
  d'une section pinned (pour ne pas couper le badge du bas), on perd aussi le clip
  horizontal qui contenait les éléments hors-écran des animations de glissement (ex : les
  bandeaux "Réservation" positionnés à ±130% avant leur entrée). Fixé avec
  `overflow-x:hidden; overflow-y:visible` plutôt que `overflow:visible` tout court.

## Pages légales

`mentions-legales.html` et `confidentialite.html` ont été créées et liées depuis le pied de
page. Le contenu des mentions légales contient des champs `[à compléter]` (forme juridique,
SIRET, TVA, nom du directeur de publication) — obligatoires légalement (LCEN) mais que je
n'ai pas inventés faute d'information réelle sur la structure juridique du restaurant. À
compléter avant mise en ligne publique définitive.
