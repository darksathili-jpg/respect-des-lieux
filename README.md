# 🏫 Respect des Lieux v3 — Lycée Antoine Watteau

> Outil de gestion des signalements de dégradations et des mesures de réparation éducative, à destination des équipes vie scolaire.

![Version](https://img.shields.io/badge/version-3.0-blue)
![Hébergement](https://img.shields.io/badge/hébergement-GitHub%20Pages-lightgrey)
![Base de données](https://img.shields.io/badge/base%20de%20données-Supabase-3ECF8E)
![Licence](https://img.shields.io/badge/licence-MIT-orange)
![RGPD](https://img.shields.io/badge/RGPD-conforme-green)

---

## 📌 Présentation

**Respect des Lieux v3** est une application web monopage (SPA) permettant à l'équipe vie scolaire du **Lycée Antoine Watteau** de :

- **Signaler et suivre** les dégradations constatées dans l'établissement
- **Gérer les mesures de réparation éducative** associées aux élèves concernés
- **Visualiser en temps réel** les statistiques via un tableau de bord
- **Générer des documents imprimables** (fiches éducatives, charte élève)

Les données sont stockées dans **Supabase** (base SQL cloud, hébergement EU), ce qui permet un accès simultané depuis plusieurs postes de l'établissement, avec synchronisation en temps réel.

---

## ✨ Fonctionnalités détaillées

### 📊 Tableau de bord
- KPIs en temps réel : total signalements, cas graves, dossiers clos, taux de résolution (objectif : 80 %)
- Répartition des signalements **par lieu** et **par type** (graphiques à barres)
- **Évolution mensuelle** sur 8 mois glissants
- Tableau des **derniers signalements** avec accès rapide

### 📋 Signalements
- Création de signalements avec numérotation automatique au format `AAAA-NNNN`
- Champs disponibles :
  - **Lieu** : Toilettes, Couloir, Salle de classe, CDI, Cantine, Gymnase, Extérieur/Cour, Loge, Vestiaires, Autre (champ libre)
  - **Type** : Tags/graffiti, Casse matériel, Salissures, Matériel informatique, Mobilier, Vitres/murs, Sanitaires, Autre (champ libre)
  - **Gravité** : Mineure / Moyenne / Grave
  - **Signalé par** : Agent, AED, CPE, Enseignant, Chef d'établissement, Élève
  - **Description des faits** (faits objectifs uniquement — RGPD)
  - **Élève identifié** : Nom, Prénom, Classe, Famille informée
  - **Photos** : jusqu'à 2 photos (JPG/PNG, max 3 Mo), envoyées sur Supabase Storage
- Filtres : gravité, statut, lieu — tri, pagination et export CSV

### 🔧 Réparations
- Gestion des **mesures de réparation éducative** liées aux dossiers élèves
- Types de mesures disponibles :
  - Participation au nettoyage des lieux
  - Remise en état / réparation matérielle
  - Affichage de sensibilisation
  - Aide aux agents sur plage horaire
  - Rédaction d'un engagement écrit
  - Entretien avec le chef d'établissement
  - Travail d'intérêt collectif
  - Autre mesure
- Saisie des entretiens (prise de conscience + clôture), filtres par référent et par date
- **Génération de fiches de réparation éducative** imprimables (6 rubriques réglementaires, photos intégrées, entretiens éditables)

### 📄 Documents
- **Fiche éducative** : générée depuis un dossier élève, imprimable directement
- **Charte élève** : 4 engagements avec zones de signature (élève + représentant légal), imprimable

### ⚙️ Administration
- Reconfiguration des identifiants Supabase
- Export des données en **CSV** et **JSON**
- **Purge des données** (gestion du cycle de vie RGPD)

---

## 🚀 Démo

👉 [Accéder à l'application](https://darksathili-jpg.github.io/respect-des-lieux/respect-lieux-application.html)

---

## ⚙️ Installation & Configuration

L'application ne nécessite **aucune installation locale**. Elle fonctionne directement dans le navigateur via GitHub Pages.

### Prérequis
- Un compte [Supabase](https://supabase.com) (gratuit)
- Un projet Supabase créé avec la région EU

### Étapes (~3 minutes)

1. **Ouvrir l'application** via le lien GitHub Pages ci-dessus
2. **Renseigner les identifiants Supabase** :
   - URL du projet (`https://xxxx.supabase.co`)
   - Clé anon publique (commence par `eyJ`)
   > Ces informations se trouvent dans *Supabase → Project Settings → API*
3. **Initialiser les tables** : copier le script SQL fourni dans l'application et l'exécuter via *SQL Editor → New query → RUN*
   > Si les tables sont déjà créées sur un autre poste, passer directement à l'étape suivante.
4. **Renseigner le nom de l'établissement** et le CPE référent, puis lancer l'application.

> 💡 **Multi-postes** : sur un second poste, renseigner les mêmes identifiants Supabase — les données seront immédiatement synchronisées.

---

## 🛠️ Technologies

| Technologie | Usage |
|---|---|
| HTML5 / CSS3 / JavaScript Vanilla | Application monopage (SPA) |
| [Supabase](https://supabase.com) | Base SQL cloud + Realtime + Storage photos |
| GitHub Pages | Hébergement statique |

---

## 🔒 Conformité RGPD

> Cet outil traite des **données personnelles de mineurs**.

- Les données sont stockées **exclusivement dans votre projet Supabase** (hébergement EU) — aucun tiers n'y a accès.
- Seuls des **faits objectifs** doivent être renseignés (pas d'appréciation comportementale).
- Avant utilisation : **déclarer le traitement au DPD académique** et **informer les familles**.
- Une fonction de **purge des données** est disponible dans l'onglet Admin.

---

## 📸 Aperçu

![Tableau de bord Respect des Lieux](screenshot.png)

---

## 🤝 Contribution

1. Forkez le dépôt
2. Créez une branche (`git checkout -b feature/ma-fonctionnalite`)
3. Commitez vos changements (`git commit -m 'Ajout : ma fonctionnalité'`)
4. Poussez la branche (`git push origin feature/ma-fonctionnalite`)
5. Ouvrez une Pull Request

---

## 📄 Licence

Ce projet est sous licence **MIT** — voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

<div align="center">
  <sub>Développé pour le <strong>Lycée Antoine Watteau</strong> · Respect des Lieux v3</sub>
</div>
