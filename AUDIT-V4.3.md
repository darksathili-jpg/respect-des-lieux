# Audit V4.3 — Reliability Gate

Date de l'audit : 22 septembre 2026  
Application : **Respect des Lieux**  
Frontend : GitHub Pages  
Backend : Supabase Free — projet `respect-des-lieux-v2` (`eu-west-3`)

## 1. Objectif

Cet audit a été lancé après l'incident de saturation I/O de l'ancien projet Supabase. Son objectif n'est pas de déclarer le système « sans risque », mais de supprimer les mécanismes ayant contribué à l'incident, de réduire la charge permanente, de limiter les scénarios de perte silencieuse de données et de vérifier le comportement de PostgreSQL sous une charge synthétique supérieure au volume actuel.

## 2. Cause principale de l'incident précédent

L'ancienne architecture exécutait un polling toutes les 30 secondes. Chaque onglet ouvert déclenchait deux lectures REST récurrentes, soit environ 240 requêtes SQL par heure et par onglet, même lorsqu'aucune donnée ne changeait.

D'autres facteurs de fragilité ont été identifiés :

- deux chemins de démarrage pouvaient initialiser l'application concurremment ;
- le code historique conservait un client Supabase non authentifié en secours ;
- certaines écritures étaient présentées dans l'interface avant confirmation serveur ;
- une file hors-ligne pouvait donner l'impression qu'une opération était durable alors qu'elle ne l'était pas ;
- un ancien fallback photo pouvait stocker du Base64 dans PostgreSQL ;
- une fonction de purge globale pouvait supprimer toutes les données depuis le navigateur ;
- le code historique contenait des instructions permettant de désactiver RLS ;
- les identifiants et numéros de dossier étaient calculés dans le navigateur, créant un risque de collision entre plusieurs postes ;
- les limites de taille des photos et des textes n'étaient pas toutes imposées côté serveur.

## 3. Corrections V4.3 mises en production

### Charge Supabase

- suppression physique du polling périodique ;
- aucun appel `setInterval()` dans le chemin de production ;
- deux lectures métier au démarrage authentifié ;
- aucune lecture périodique lorsque l'onglet reste ouvert et inactif ;
- actualisation au retour sur l'onglet au maximum une fois toutes les 2 minutes ;
- bouton **Actualiser** pour un rafraîchissement explicite ;
- déduplication des rafraîchissements concurrents ;
- timeout réseau de 12 secondes ;
- requêtes avec colonnes explicitement sélectionnées ;
- suppression des index inutiles identifiés par le Performance Advisor.

### Démarrage

- un seul bootstrap initial : `secureBoot` ;
- garde `appLaunchPromise` empêchant deux initialisations concurrentes ;
- `config.js` contient uniquement l'URL Supabase et la clé publishable ;
- backend de production verrouillé ;
- le code principal est « fail closed » si le module de sécurité n'est pas chargé.

### Intégrité des écritures

- aucune écriture métier hors-ligne ;
- aucun cache persistant des signalements/réparations dans `localStorage` ;
- l'interface n'annonce plus un succès avant confirmation Supabase ;
- ID des signalements générés par une séquence PostgreSQL ;
- ID des réparations générés par une séquence PostgreSQL ;
- numéro de dossier annuel généré transactionnellement côté serveur ;
- index unique sur le numéro de dossier ;
- clé étrangère `reparations.signa_id -> signalements.id` ;
- contraintes `NOT NULL`, longueurs maximales et valeurs de statut imposées en base ;
- suppression métier interdite au rôle navigateur `authenticated`.

### Sécurité

- RLS actif sur les tables métier ;
- le rôle `anon` ne possède aucun accès métier ;
- le rôle `authenticated` ne possède que `SELECT`, `INSERT` et `UPDATE` ;
- liste blanche d'adresses dans `public.authorized_users` ;
- trigger sur `auth.users` empêchant la création d'un compte dont l'e-mail n'est pas autorisé ;
- fonction d'autorisation placée dans le schéma privé ;
- aucune clé `service_role` ou `sb_secret_...` dans le frontend ;
- purge globale supprimée de l'interface ;
- suppression via le client JavaScript désactivée.

### Photos

- bucket `rl-photos` privé ;
- JPEG uniquement côté Storage ;
- limite serveur de 3 Mo par objet ;
- maximum 2 photos par signalement côté base ;
- aucun fallback Base64 dans PostgreSQL ;
- marqueur privé stocké en base, URL signée générée uniquement à l'affichage.

### Rendu et exports

- données utilisateur échappées avant insertion HTML ;
- sélecteur de fiche construit avec `textContent` ;
- protection contre l'injection de formules CSV ;
- confirmation explicite avant export de données personnelles ;
- limites des champs reflétées dans les formulaires et dans PostgreSQL.

## 4. Garde-fou automatique de non-régression

Le dépôt contient désormais :

- `tests/v43-guard.mjs` ;
- `.github/workflows/v43-reliability-guard.yml`.

Le workflow s'exécute automatiquement à chaque push sur `main` et sur les pull requests. Il bloque notamment le retour des régressions suivantes :

- `setInterval()` de polling ;
- `fetch()` direct dans le code principal ;
- cache métier persistant dans `localStorage` ;
- purge REST globale ;
- génération des ID ou numéros de dossier dans le navigateur ;
- clé `service_role` / `sb_secret_...` dans le frontend ;
- ancien hotfix V4.2 ;
- désactivation de RLS dans le schéma ;
- droits `DELETE` ou `TRUNCATE` accordés au rôle navigateur ;
- bucket photo public ;
- disparition des limites Storage, de la liste blanche Auth, des séquences serveur ou de `RL_DIAG`.

Ce contrôle ne remplace pas les tests fonctionnels, mais il transforme les règles qui ont empêché l'incident en **invariants vérifiés par CI**.

## 5. Épreuve de charge réalisée

Le test a temporairement injecté **5 000 signalements** et **10 000 réparations**, puis a exécuté les deux requêtes correspondant au chargement de l'application. Les données synthétiques ont ensuite été supprimées et le retour à zéro a été vérifié.

### Plans PostgreSQL

| Requête | Plan | Temps d'exécution |
|---|---|---:|
| 500 signalements, triés par date | `Index Scan signalements_date_idx` | 0,347 ms |
| 1 000 réparations, triées par création | `Index Scan reparations_created_at_idx` | 0,362 ms |

### Simulation de lectures de démarrage

Test effectué sur cache chaud, côté PostgreSQL uniquement. Il ne représente pas la latence HTTP réelle du navigateur.

| Onglets simulés | Temps SQL total | Temps moyen / onglet |
|---:|---:|---:|
| 1 | 1,588 ms | 1,588 ms |
| 5 | 2,200 ms | 0,440 ms |
| 10 | 3,928 ms | 0,393 ms |
| 20 | 8,308 ms | 0,415 ms |

Ces résultats montrent que les requêtes métier sont correctement indexées à ce volume. Ils ne garantissent pas la tenue à une charge arbitraire : le plan Free reste une instance Nano à ressources partagées.

## 6. Contrôles PostgreSQL après le test

- cache hit : **99,846 %** ;
- fichiers temporaires : **0** ;
- octets temporaires : **0** ;
- deadlocks : **0** ;
- conflits : **0** ;
- autovacuum exécuté après le test ;
- tuples morts signalés après autovacuum : **0** ;
- données synthétiques restantes : **0 signalement / 0 réparation**.

## 7. Test d'autorisation réel au niveau PostgreSQL

Une transaction de validation a été exécutée en assumant le rôle `authenticated` avec l'adresse autorisée.

Résultat :

- insertion sans `id` acceptée ;
- ID généré côté serveur ;
- numéro généré côté serveur au format `2026-0001` ;
- création d'une réparation avec ID serveur acceptée ;
- avec une adresse non autorisée, les deux tables métier renvoient **0 ligne visible**.

Les lignes de test ont ensuite été supprimées et, puisque la base métier était encore vide, les séquences et le compteur annuel ont été remis à leur état initial. Contrôle final : **0 signalement / 0 réparation / 0 compteur consommé**.

## 8. Fenêtre de données et garde-fou

Pour protéger le projet Free, l'application charge actuellement au maximum :

- 500 signalements ;
- 1 000 réparations.

Une ligne sentinelle supplémentaire est demandée afin de détecter une troncature sans requête `COUNT` supplémentaire.

À partir de 450 signalements ou 900 réparations, le diagnostic interne passe en état de proximité de limite. Si la fenêtre est dépassée, l'utilisateur reçoit un avertissement et l'application indique qu'une pagination serveur ou un archivage devient nécessaire.

Cette limite est volontaire : elle empêche qu'une croissance de la base augmente indéfiniment le coût de chaque ouverture.

## 9. Diagnostic navigateur

Après connexion, ouvrir la console du navigateur et exécuter :

```js
RL_DIAG.snapshot()
```

Points importants :

- `version` doit être `4.3` ;
- `backend` doit être `odrussbhwyvyudmybjxy` ;
- `refreshInFlight` doit généralement être `false` au repos ;
- `requests` ne doit **pas augmenter périodiquement** lorsque l'onglet reste inactif ;
- `dataWindowExceeded` doit rester `false`.

## 10. Seuils opérationnels recommandés

| Indicateur | Surveillance | Action |
|---|---|---|
| Disk IO % consumed | idéalement 0 % | si > 1 %, rechercher immédiatement la cause |
| Disk IO % consumed | 100 % | incident critique : charge à stopper |
| Base PostgreSQL | < 250 Mo souhaité | au-delà, préparer archivage avant la limite Free |
| Storage | < 500 Mo souhaité | au-delà, revoir durée de conservation des photos |
| Signalements chargés | < 450 | au-delà, préparer pagination/archivage |
| Réparations chargées | < 900 | au-delà, préparer pagination/archivage |
| Erreurs réseau répétées | 0 attendu | vérifier Supabase Observability et les quotas |

Supabase indique qu'un `Disk IO % consumed` supérieur à 1 % signifie que le workload a dépassé le débit I/O de base à un moment de la journée ; 100 % signifie que le budget de burst est épuisé.

## 11. Sauvegarde et reprise

La V4.3 protège mieux contre les erreurs applicatives, mais elle ne remplace pas une sauvegarde indépendante.

Pour le plan Free :

1. effectuer un export régulier chiffré des données ;
2. sauvegarder **séparément le bucket Storage `rl-photos`** : l'export JSON/CSV de l'application contient les références des photos, pas les fichiers binaires eux-mêmes ;
3. conserver base et photos sur un emplacement distinct du projet Supabase et du dépôt GitHub public ;
4. ne jamais stocker un export nominatif dans un dépôt GitHub public ;
5. tester périodiquement qu'un export JSON est lisible et qu'un échantillon de photos sauvegardées s'ouvre ;
6. avant toute migration destructive, effectuer ces deux sauvegardes et vérifier leur contenu.

Pour une sauvegarde technique complète, utiliser les outils Supabase CLI (`db dump` pour PostgreSQL et copie du bucket Storage) depuis un poste d'administration sécurisé.

## 12. Limite connue du plan Free

Le Security Advisor peut signaler **Leaked Password Protection Disabled**. La documentation Supabase précise que la protection automatique contre les mots de passe présents dans Have I Been Pwned est disponible à partir du plan Pro.

Sur le plan Free, utiliser un mot de passe long, unique et généré par un gestionnaire de mots de passe. Le parcours d'activation V4.3 impose désormais **12 caractères minimum** côté application.

Référence : https://supabase.com/docs/guides/auth/password-security

## 13. Références Supabase

- Compute et I/O : https://supabase.com/docs/guides/platform/compute-and-disk
- Sécurité des mots de passe : https://supabase.com/docs/guides/auth/password-security
- Row Level Security : https://supabase.com/docs/guides/database/postgres/row-level-security
- Sécurité Storage : https://supabase.com/docs/guides/storage/security/access-control

## 14. État de sortie du Reliability Gate

V4.3 élimine les mécanismes identifiés comme dangereux dans l'incident précédent :

- pas de polling périodique ;
- pas de double démarrage initial ;
- pas d'écriture « réussie » sans confirmation serveur ;
- pas de suppression massive depuis le navigateur ;
- pas de données métier persistées localement ;
- pas d'accès anonyme ;
- pas d'identifiants concurrents créés côté client ;
- charge SQL mesurée et bornée.

Le système reste dépendant des limites et de la disponibilité d'un service Free. Le bon objectif n'est donc pas « zéro risque », mais **défaillance visible, charge bornée et absence de perte silencieuse par le frontend**.
