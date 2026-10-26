# Habit Tracker — عاداتي

Version numérique du tableau d'habitudes papier, avec un compte par utilisateur.
Front-end en HTML/CSS/JS, back-end Express, données dans PostgreSQL.

## Fonctionnalités

- Comptes : inscription, connexion, déconnexion. Chaque utilisateur ne voit que ses données.
- Cases cliquables : vide → ✓ → ✗ → vide, enregistrées tout de suite
- Les 12 mois en onglets (+ changement d'année). Un nouveau mois reprend les habitudes du mois voisin.
- Mois modifiable : titre, objectif ; réinitialiser un mois
- Habitudes : ajouter, renommer (clic sur le nom), monter/descendre, supprimer
- Graphique % par semaine, objectif / complété / restant, donut global
- Humeur par jour + courbe, poids par semaine, % de réussite par jour
- Statistiques par habitude : total, %, série actuelle et meilleure série, classement
- Notes du mois sauvegardées automatiquement
- Design feuille jaune + frise zellige ; mode nuit avec le bouton ☾ ; utilisable sur téléphone

## Structure

| Fichier | Rôle |
|---|---|
| `server.js` | Démarre Express : fichiers statiques, sessions, routes, erreurs |
| `db.js` | Connexion PostgreSQL (`DATABASE_URL`), création des tables, transactions |
| `schema.sql` | Les tables : `users`, `months`, `habits`, `checks`, `moods`, `weights` |
| `routes/auth.js` | `/api/auth/register`, `/login`, `/logout`, `/me` (bcrypt + session) |
| `routes/months.js` | `/api/months`, `/api/periods/...` : mois, habitudes, cases, humeur, poids |
| `public/` | La page (HTML, CSS, JavaScript) |
| `scripts/local-db.mjs` | PostgreSQL local pour le développement |
| `scripts/import-json.js` | Importe l'ancien `data/db.json` dans un compte |
| `render.yaml` | Configuration de l'hébergement Render |

## Lancer en local

Il faut **deux terminaux**.

Terminal 1, la base de données (laisser ouvert) :

```bash
npm install
npm run db
```

Terminal 2, le site :

```bash
npm start
```

Ouvrir http://localhost:3000 puis créer un compte.
Le fichier `.env` (non publié sur GitHub) contient `DATABASE_URL` et `SESSION_SECRET` ; modèle dans `.env.example`.

## Importer les anciennes données JSON

Créer d'abord son compte sur le site, puis :

```bash
npm run import-json -- <nom_utilisateur> data/db.backup.json
npm run import-json -- <nom_utilisateur> data/db.json
```

Les mois vides sont ignorés. Un mois déjà rempli dans le compte n'est jamais écrasé.
Pour importer dans la base en ligne, remplacer temporairement `DATABASE_URL` dans `.env` par l'adresse Neon.

## Mettre en ligne sur Vercel (gratuit)

Le projet est relié au dépôt GitHub : chaque `git push` sur `main` redéploie le site.
Sur Vercel, `server.js` exporte l'app Express, qui devient une fonction serverless ;
le dossier `public/` est servi par le CDN de Vercel.

Il faut deux variables d'environnement :

1. **`DATABASE_URL`** : dans le projet Vercel, onglet **Storage → Create Database → Neon**
   (Postgres serverless, offre gratuite), puis **Connect** au projet `habit-tracker`.
   Vercel ajoute `DATABASE_URL` tout seul.
2. **`SESSION_SECRET`** : **Settings → Environment Variables → Add**, nom `SESSION_SECRET`,
   valeur = une longue chaîne aléatoire générée avec :
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Redéployer (**Deployments → … → Redeploy**, ou un nouveau `git push`).
   Les tables sont créées automatiquement à la première requête.

Si une variable manque, le site ne plante plus : l'écran de connexion affiche laquelle.

`render.yaml` permet aussi d'héberger sur Render (*New → Blueprint*) avec une base Neon.

## Sécurité

- Mots de passe hachés avec bcrypt (jamais stockés en clair)
- Session dans un cookie `httpOnly`, `sameSite=lax`, `secure` en ligne ; sessions gardées dans PostgreSQL
- Max 20 tentatives de connexion / 15 min par adresse IP
- Toutes les requêtes SQL sont paramétrées (`$1`, `$2`…) : pas d'injection SQL
- Chaque route vérifie que le mois appartient à l'utilisateur connecté
