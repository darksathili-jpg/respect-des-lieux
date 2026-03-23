# 🏫 Respect des Lieux

> Application web de gestion des signalements de dégradations pour établissements scolaires

![Tableau de bord](https://img.shields.io/badge/statut-actif-brightgreen)
![Technologie](https://img.shields.io/badge/technologie-HTML%20%2F%20CSS%20%2F%20JS-blue)
![Licence](https://img.shields.io/badge/licence-MIT-orange)

---

## 📌 Présentation

**Respect des Lieux** est une application web destinée aux établissements scolaires pour **suivre, gérer et résoudre les signalements de dégradations** (tags, graffitis, mobilier abîmé, etc.) au sein de leurs locaux.

Elle permet au personnel et aux élèves de remonter des incidents, de les catégoriser par lieu et par type, et d'en assurer le suivi jusqu'à leur résolution.

---

## ✨ Fonctionnalités

- 📊 **Tableau de bord** — Vue synthétique des signalements (total, cas graves, dossiers clos, taux de résolution)
- 📍 **Signalements par lieu** — Visualisation des incidents par espace (salle de classe, couloir, cour…)
- 🏷️ **Signalements par type** — Catégorisation des dégradations (tags / graffitis, mobilier, vitrerie…)
- 📈 **Évolution mensuelle** — Graphique d'historique sur 8 mois glissants
- 🔧 **Suivi des réparations** — Gestion de l'état d'avancement (en réparation, clos, en cours)
- 📄 **Documents éducatifs** — Fiche éducative et Charte élève intégrées
- 📥 **Export CSV** — Extraction des données pour reporting
- 🔄 **Synchronisation** — Données synchronisées en temps réel

---

## 📸 Aperçu

![Aperçu du tableau de bord](screenshot.png)

---

## 🚀 Démo

👉 [Accéder à l'application en ligne](https://darksathili-jpg.github.io/respect-des-lieux/respect-lieux-application.html)

---

## 🛠️ Technologies utilisées

| Technologie | Usage |
|---|---|
| HTML5 | Structure des pages |
| CSS3 | Mise en forme et responsive |
| JavaScript (Vanilla) | Logique métier et interactions |
| GitHub Pages | Hébergement |

---

## 📂 Structure du projet

```
respect-des-lieux/
├── respect-lieux-application.html   # Application principale
├── assets/
│   ├── css/                         # Feuilles de style
│   ├── js/                          # Scripts JavaScript
│   └── img/                         # Ressources visuelles
├── docs/
│   ├── fiche-educative.pdf          # Fiche éducative élève
│   └── charte-eleve.pdf             # Charte de bonne conduite
└── README.md
```

---

## 📋 Utilisation

1. **Créer un signalement** — Cliquer sur `+ Signalement`, renseigner le lieu, le type de dégradation, la gravité et l'élève concerné.
2. **Suivre les dossiers** — Consulter l'onglet *Signalements* pour voir l'état de chaque dossier.
3. **Gérer les réparations** — Mettre à jour le statut dans l'onglet *Réparations*.
4. **Exporter les données** — Utiliser le bouton `↓ CSV` pour générer un rapport.

---

## 🎯 Public cible

- 👨‍🏫 Personnels d'établissement (CPE, direction, agents d'entretien)
- 🏫 Lycées et collèges souhaitant responsabiliser leurs élèves
- 📊 Gestionnaires cherchant un suivi structuré des dégradations

---

## 🤝 Contribution

Les contributions sont les bienvenues ! Pour proposer une amélioration :

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
  <sub>Développé avec ❤️ pour le <strong>Lycée Antoine Watteau</strong></sub>
</div>
