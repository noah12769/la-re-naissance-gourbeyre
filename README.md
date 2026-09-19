# La Re-Naissance — site du restaurant

Site vitrine one-page pour le restaurant **La Re-Naissance** (Gourbeyre, Guadeloupe).
Développé et maintenu par [Lumea](https://github.com/noah12769).

## Stack

- **Aucun build step.** C'est un export statique du template Webflow "Oak", modifié à la
  main directement dans `index.html` (HTML + CSS + JS inline). Il n'y a pas de framework,
  pas de bundler, pas de `package.json` : on édite le fichier, on recharge la page.
- CSS de base d'Oak dans `assets/css/`, JS compilé de Webflow (IX2, etc.) dans `assets/js/`
  — ces deux-là ne sont **pas** modifiés à la main ; toutes les personnalisations vivent en
  `<style>`/`<script>` inline dans `index.html`, avec des commentaires expliquant le
  contexte à chaque fois qu'un comportement n'est pas évident (pourquoi tel hack, quel bug
  il corrige, ce qui a été essayé avant et n'a pas marché).
- Deux pages annexes autonomes (mentions légales, confidentialité), chacune un fichier
  HTML complet et indépendant, sans dépendance à `index.html`.

## Développer en local

Aucune installation nécessaire. Depuis ce dossier :

```bash
python3 -m http.server 8745
# puis ouvrir http://localhost:8745/index.html
```

Aucune variable d'environnement n'est requise pour faire tourner le site (le seul fichier
`.env*` présent, `VERCEL_OIDC_TOKEN`, est généré par la CLI Vercel elle-même et n'est ni
committé ni nécessaire en local — voir `.gitignore`).

## Déploiement

- **Hébergement** : Vercel, intégration Git — chaque `git push` sur `main` redéploie
  automatiquement en production. Pas de build command à configurer (site statique).
- **Domaine actuel** : `la-re-naissance-gourbeyre.vercel.app` (domaine de test Vercel).
  Un domaine personnalisé est prévu ; une fois attaché, penser à mettre à jour toutes les
  URLs absolues codées en dur : `<link rel="canonical">`, `og:url`, `og:image`,
  `twitter:image`, le JSON-LD (`image`), `sitemap.xml` (`<loc>`) et `robots.txt`
  (`Sitemap:`) — chercher `la-re-naissance-gourbeyre.vercel.app` dans le repo.
- **Sécurité / headers** : configurés dans `vercel.json` (CSP, HSTS, X-Frame-Options,
  etc.). Toute modification de CSP doit être vérifiée sur un déploiement preview Vercel
  (la console du navigateur signale les violations) — un serveur local type
  `python3 -m http.server` n'applique pas ces headers, donc un CSP cassé ne se verra pas
  en local.

## Comportements maison à connaître avant de toucher au CSS/JS

Ce ne sont pas des bugs — ce sont des correctifs déjà en place pour des problèmes réels
rencontrés sur des appareils réels. Les retirer sans comprendre pourquoi ils existent
réintroduit le bug d'origine (chaque bloc de code correspondant a un commentaire qui
raconte l'historique complet) :

- **`--vh` et `.short-vh`** : `window.innerHeight` mesuré en JS (pas les unités CSS
  `dvh`/`vh` seules), exposé en variable CSS globale. `.short-vh` sur `<html>` signale un
  écran avec peu de hauteur (téléphone OU fenêtre desktop pas plein écran), indépendamment
  de la largeur — beaucoup de tailles custom (About, Hero) en dépendent.
- **`--hero-pad-top`** : synchronisé en JS sur la vraie hauteur rendue de `.hero-image`
  (après son propre cap de hauteur), pour garder un espacement constant entre l'image et
  le reste du hero quel que soit l'écran.
- **Menu mobile (`.navbar-menu-block`)** : son ouverture/fermeture est pilotée entièrement
  par Webflow (IX2) via `style.height` inline — jamais de classe, jamais de transition CSS.
  Fermé = exactement `'0px'` ; ouvert peut finir à une valeur vide `''` une fois l'animation
  de Webflow terminée (à traiter comme "ouvert", pas comme fermé). Un `MutationObserver`
  corrige la hauteur pour couvrir l'image + le titre après coup, sans jamais toucher au
  chemin de fermeture. Voir le commentaire au-dessus de ce bloc dans `index.html` pour
  l'historique complet (une première tentative en CSS `!important` avait cassé la fermeture).
- **Diaporama mobile de la galerie** (`<480px`) : un vrai fondu enchaîné via une image de
  recouvrement temporaire (`.gallery-fade-overlay`), jamais une disparition complète —
  l'image réelle n'est mise à jour qu'une fois le fondu terminé, overlay retiré ensuite.
- **Animations de scroll "maison"** : voir `ANIMATIONS.md`, qui documente en détail
  pourquoi les interactions IX2 d'Oak ont été ré-implémentées à la main.

## Assets

Les photos et maquettes sources (hors `assets/` — pas nécessaires en prod, pas suivies par
ce dépôt Git) vivent un niveau au-dessus, dans le dossier `la-re-naissance/` : voir
`../assets-source/` (photos brutes) et `../references/` (maquettes, inspiration). Une
copie de secours de l'ancienne version du site est dans `../archive/site-v1-secours/`.

Toutes les images utilisées par le site sont en `.webp`, généralement en 3 tailles
(`-p-500`, `-p-800`, taille pleine) référencées via `srcset`/`sizes` pour servir la bonne
résolution selon l'écran.

## Espace admin (aperçu)

`connexion.html` → `admin.html` (+ `assets/admin/`) : interface pour gérer les plats de « Nos
créations » (nom + photo) et les photos de « Souvenir » (ajout, recadrage/zoom, suppression).
**Aperçu uniquement pour l'instant** : les modifications restent dans le `localStorage` du
navigateur et ne changent pas le site public. Le mot de passe (`1234`) est vérifié côté client
dans `connexion.html` — il ne protège rien et doit être remplacé par Supabase Auth (avec la
base de données + le stockage des photos) avant que l'admin puisse publier quoi que ce soit.
Lien d'accès : « Connexion » dans le footer de `index.html`.

## Audit

Un audit complet (SEO, performance, accessibilité, sécurité, RGPD, structure) est
archivé à la racine du dépôt sous `AUDIT_<date>.md`.
