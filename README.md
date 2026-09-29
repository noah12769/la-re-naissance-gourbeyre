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

## Espace admin

`connexion.html` → `admin.html` (+ `assets/admin/`) : interface pour gérer les plats de « Nos
créations » (nom + photo) et les photos de « Souvenir » (ajout, recadrage/zoom, suppression,
réorganisation). Lien d'accès : « Connexion » dans le footer de `index.html`.

Branché sur **Supabase** (projet `jnjyekeakikguumdjccf`) : base de données (tables `dishes` et
`gallery_photos`), stockage de fichiers (bucket `site-media`) et authentification. Voir
`../supabase/schema.sql` (un niveau au-dessus, pas déployé) pour le schéma complet, commenté,
à coller dans l'éditeur SQL du projet si la base doit être recréée.

- **`assets/admin/supabase-config.js`** : URL du projet + clé publique ("anon"/"publishable").
  C'est volontairement une clé publique, sans danger à exposer côté client — ce qui protège
  réellement les écritures, ce sont les règles RLS du schéma (lecture publique, écriture
  réservée à un compte connecté). **Ne jamais** mettre la clé `service_role`/"Secret key" ici
  ni ailleurs dans ce dépôt : elle contourne ces règles et ne doit jamais quitter le tableau de
  bord Supabase.
- **`assets/js/supabase.min.js`** : client JS de Supabase, mis en local (pas chargé depuis un
  CDN) pour ne pas avoir à autoriser un hôte de plus dans la CSP (`script-src` n'accepte que
  `'self'` pour les scripts du site).
- Le compte de connexion de l'admin est un utilisateur Supabase Auth séparé du compte
  Supabase lui-même (Authentication → Users dans le tableau de bord) — l'email est en dur
  dans `connexion.html` (`ADMIN_EMAIL`, un seul compte partagé), seul le mot de passe est
  saisi dans le formulaire.
- **Mot de passe oublié** (`connexion.html`, bouton) et **`reinitialiser-mot-de-passe.html`** :
  envoient/traitent le lien de réinitialisation standard de Supabase Auth. ⚠️ Nécessite un
  réglage dans le tableau de bord, à faire une fois : **Authentication → URL Configuration** →
  ajouter `https://la-re-naissance.com/reinitialiser-mot-de-passe.html` aux "Redirect URLs"
  (sinon Supabase refuse la redirection après le clic sur le lien reçu par email).
- **`parametres.html`** : accessible une fois connecté (lien dans l'en-tête de `admin.html`),
  permet de changer le mot de passe admin. Redemande le mot de passe ACTUEL avant d'accepter le
  nouveau (un appel `signInWithPassword` de vérification) — sans ça, `updateUser()` seul
  accepterait un nouveau mot de passe depuis une session déjà ouverte sans jamais vérifier que
  la personne connaît l'ancien, ce qui est risqué sur un appareil partagé resté connecté.
- Chaque photo ajoutée/remplacée depuis l'admin est uploadée dans le bucket `site-media`
  (dossiers `dishes/` et `gallery/`) ; les photos jamais touchées depuis l'admin continuent de
  pointer vers leur fichier d'origine dans `assets/images/` (c'est ce que la base a été semée
  au départ) — les deux formes de chemin sont traitées pareil côté admin.
- **`index.html` lit maintenant Supabase** (dernier bloc `<script>` de la page, juste après les
  scripts vendor) : "Nos créations" (les 6 plats, nom + photo, toujours 6 -- jamais de rotation
  là) et "Souvenir" mettent à jour les `<img>`/textes déjà présents dans le HTML statique une
  fois les données arrivées ; si Supabase est indisponible, vide, ou que les deux scripts
  `assets/js/supabase.min.js`/`assets/admin/supabase-config.js` n'ont pas pu charger, tout est
  englobé dans des `try/catch`/vérifications qui ne font rien dans ce cas -- le HTML statique
  déjà dans la page (tel qu'il était à la dernière modification manuelle) continue de s'afficher
  normalement, jamais de page cassée.
  - **Galerie "Souvenir" : positions et tailles des photos ne changent jamais.** Tant qu'il y a
    assez de photos pour remplir chaque emplacement (11 sur tablette/desktop : 1 solo + 2 rangées
    de 5 ; 6 sur mobile, la 2ᵉ rangée étant masquée en CSS en dessous de 480px), chaque emplacement
    affiche une photo, statique, comme avant. Dès qu'il y a PLUS de photos que d'emplacements
    pour la taille d'écran en cours, la rotation se déclenche automatiquement (même mécanisme de
    fondu que l'ancien diaporama mobile, désormais actif aussi sur tablette/desktop) : les
    emplacements font défiler toutes les photos, environ 10 secondes chacune, sans jamais bouger
    ni changer de taille. Une barre de progression (déjà utilisée sur mobile) s'affiche sur
    n'importe quel format dès qu'une rotation est active, et reste invisible sinon.
  - **La case du haut (1 photo, forme "presque carrée") est différente des 10 cases de rangée
    (recadrées en 3:4)** : elle ne peut tourner qu'avec des photos de la MÊME forme qu'elle,
    jamais avec une photo recadrée en 3:4 pour les rangées. La table `gallery_photos` a deux
    colonnes `width`/`height` (dimensions réelles du fichier exporté, capturées par `admin.js`
    au moment du recadrage) ; `index.html` compare leur ratio à 3:4 (±0.03) pour classer chaque
    photo dans le bon groupe ("solo" ou "rangée") avant de décider quoi afficher où. Les deux
    groupes tournent chacun à leur rythme, indépendamment. Une photo sans dimensions enregistrées
    (ne devrait plus arriver une fois toutes les lignes passées par l'admin au moins une fois) est
    traitée par défaut comme une photo de rangée -- le cas le plus courant, et le moins visible
    si jamais faux.
  - Les photos jamais retouchées depuis l'admin gardent leur `srcset` réactif (`-p-500`/`-p-800`)
    reconstruit à partir du chemin ; celles ajoutées/remplacées depuis l'admin n'ont qu'un seul
    fichier (~900px), donc un simple `src`.

## Audit

Un audit complet (SEO, performance, accessibilité, sécurité, RGPD, structure) est
archivé à la racine du dépôt sous `AUDIT_<date>.md`.
