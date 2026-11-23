# Revolve — Turn-Based Tactical MOBA

Prototype local 1v1 au tour par tour, jouable à deux sur le même ordinateur. Le champ de bataille reste affiché dans la même orientation ; les joueurs alternent le contrôle. Les règles décrites ici correspondent au comportement actuellement implémenté.

## Lancer le jeu

Servir le dossier en HTTP pour que les modules ES soient chargés :

```powershell
python -m http.server 4173
```

Ouvrir ensuite `http://localhost:4173`.

## Organisation du code

- `index.html`, `styles.css` — structure et présentation de l’interface
- `main.js` — interactions navigateur, sélection, commandes et rendu
- `engine/game.js` — règles de partie, ressources, déploiement, attaques, capacités et tours
- `engine/board.js` — dimensions, terrain, troupes, structures et projectiles
- `engine/turn_manager.js` — joueur actif et numéro du tour
- `units/troop.js`, `stats.js`, `effects.js`, `damage.js` — état des unités, statistiques, effets et calculs de dégâts
- `cards/` — paquets, mains et cartes
- `data/troops.js`, `data/abilities.js` — source unique des statistiques, types de dégâts, capacités et coûts utilisés par le jeu
- `data/unit-icons/` et `data/unit_icons.js` — images d’unité utilisées sur les cartes et sur le plateau
- `data/unit-descriptions/` — fiches Markdown de chaque troupe et de ses capacités
- `abilities/` — anciennes abstractions de capacités ; le jeu courant résout les capacités dans `engine/game.js`
- `ui/`, `rendering/` — interface et rendu du canvas

## Partie et ressources

- La partie oppose deux joueurs locaux : équipe 0 (bleue), puis équipe 1 (rouge).
- Chaque joueur commence avec 1200 Elixir et 0 AP. Au début de son tour, il gagne 100 de chaque ressource, jusqu’à un maximum de 2000.
- L’Elixir paie le déploiement des troupes. Les AP paient les capacités et les deux ressources peuvent payer le remplacement de cartes. Reby et ses bâtiments d’invocation sont des unités immobiles ; ils ne sont pas déplacés par l’IA.
- Une équipe peut déployer partout dans l’arène si le point choisi n’est pas bloqué par le terrain et n’est pas dans la zone d’interdiction d’une structure ennemie encore vivante. Les troupes peuvent se chevaucher au déploiement puis se repoussent selon leur masse. Il n’y a pas de limite de troupes appliquée par le moteur ; le compteur `/7` de l’interface est indicatif.
- Chaque tourelle détruite rapporte 1 point à l’équipe adverse, affiché au tableau des scores. La destruction d’une base termine immédiatement la partie et fait gagner l’équipe adverse.

## Paquets, main et remplacement

- Chaque paquet contient 28 cartes : 7 cartes de troupe et 21 capacités (3 par troupe, une copie de chaque capacité). Le paquet est mélangé au début.
- La main est initialisée à 10 cartes. Jouer une carte la retire de la main, pioche une remplaçante, puis remet la carte jouée dans le paquet. Le remplacement est immédiat.
- Les cartes de capacité peuvent être défaussées en échange d’une carte de remplacement : sélectionner jusqu’à 3 capacités coûte 100 AP ou 100 Elixir au total, quel que soit le nombre sélectionné.
- Le jeu tente de maintenir au moins une carte de troupe en main. S’il n’y en a pas, il remplace jusqu’à trois capacités par lots ; pendant la partie, chaque lot automatique coûte 100 Elixir si le joueur peut le payer. À la création de la main, cette recherche ne coûte pas de ressource.
- Les structures et les capacités ne sont pas limitées par une réserve ou un coût de carte distinct.

## Troupes et dégâts

Chaque troupe possède des PV, Force (F), attaque (ATK), puissance magique (APT), armure, résistance magique, portée d’attaque, portée de vue, déplacement, coût AC d’attaque, AC initial et coût en Elixir. Les valeurs sont dans `data/troops.js`.

Chaque troupe définit son attaque de base dans `basicAttack` : le type (`physical` ou `magic`) et les coefficients de statistiques (`force`, `atk`, `apt`) lui sont propres. Les dégâts bruts sont la somme de chaque statistique multipliée par son coefficient. Les capacités définissent aussi leur propre type et coefficient de dégâts, soin ou PV dans `data/abilities.js` (`scaling`, `healScaling`, `shieldScaling`, `domeHealthScaling`). Les calculs utilisent les stats du lanceur ; les nombres fixes de dégâts, soins et PV de bouclier/dôme ne sont pas utilisés dans les profils équilibrés. Les dégâts numériques sont ensuite mitigés selon le type :

Les profils de base sont équilibrés sur les équivalents Clash Royale indiqués ci-dessous. Les données utilisent les références de niveau 11 quand elles sont disponibles.

| Référence | Troupe | Coût Elixir du jeu | PV du jeu | Portée d’attaque | Déplacement par tour propre |
| --- | --- | ---: | ---: | ---: | ---: |
| Musketeer (4 Elixir) | Rookie | 800 | 553 | 163,2 | 40,8 |
| Baby Dragon (4) | Rayka | 800 | 1060 | 95,2 | 61,2 |
| Furnace pré-refonte (4) | Reby | 800 | 678 | bâtiment | 0 |
| Giant (5) | Hugo | 1000 | 3968 | 40 | 30,6 |
| Skeleton Army (3), 7 Ninjas valant chacun 2 squelettes | Ninja | 600 | 124 par Ninja | 20 | 61,2 |
| Phoenix (4) | Kaguya | 800 | 745 | 81,6 (3 tuiles) | 40,8 |
| Miner (3) | Burrower | 600 | 773 | 32,6 | 61,2 |

La conversion est la suivante : 200 Elixir du jeu = 1 Elixir Clash Royale ; 2 tours de jeu = 1,5 seconde ; la portée Princess Tower de 7,5 cases correspond à la portée actuelle de tourelle de 204 unités, soit 27,2 unités par case. La portée des tourelles reste donc 204. Les déplacements utilisent les classes demandées : lent 30,6 unités/tour, moyen 40,8, rapide 61,2 et très rapide 81,6. Les portées d’attaque reprennent la portée Clash Royale connue, convertie avec 27,2 unités par case ; les unités de mêlée ont une marge pratique de collision.

Les résistances sont spécialisées selon le rôle. La référence neutre est 50, qui réduit les dégâts à 2/3. Rayka privilégie un grand pool de PV (1060) avec 25 d’armure/RM ; son PV effectif contre chaque type de dégâts reste au niveau du profil précédent. Hugo est un tank à faible résistance (30) et 3968 PV, soit 130 % des PV effectifs de référence du Giant. Reby a reçu 20 % de PV de plus que sa conversion Furnace initiale (678 PV), sans changer l’usure par tour. Kaguya privilégie la résistance magique (90) au détriment de l’armure (35), avec 745 PV : son PV effectif moyen reste proche du Phoenix, mais elle encaisse mieux les dégâts magiques que physiques. Burrower privilégie l’armure (80) au détriment de la RM (30) ; ses PV effectifs physiques restent à environ 115 % du Miner niveau 11. Rookie et Ninja conservent leur bonus de PV de 15 % contre pénétration et plongeurs. Les 7 Ninjas ont chacun deux fois les PV et dégâts d’un Squelette niveau 11 (avant conversion), ce qui donne un total proche d’une Armée de squelettes de 15 membres.

ATK et APT représentent le DPS de référence de niveau 11 avant mitigation, pour le type de dégâts principal de l’unité. Pour les attaques directes, le coefficient de base est ajusté à son `attackCost` (coefficient usuel = `attackCost / 10`) afin que le rythme de dépenses AC garde ce DPS ; Rayka fait exception, son coefficient `0.31 APT` est appliqué à chaque tick d’orage. Les PV ajustés pour les résistances et bonus défensifs sont définis en regard de ces dégâts. Les dégâts de capacité, soins et valeurs de PV de bouclier/dôme sont calculés à partir des statistiques via `scaling`, `healScaling`, `shieldScaling` ou `domeHealthScaling`, et non à partir d’un nombre fixe. Les dégâts proportionnels aux PV (`damageFraction`, `targetMaxHpFraction`) sont ajoutés aux dégâts bruts puis mitigés selon le type de dégâts, l’armure ou la résistance magique et la pénétration. Les coûts de capacité n’ont pas été changés.

Les tourelles intérieures et extérieures ont chacune 2 289 PV, soit 75 % des 3 052 PV d’une Princess Tower niveau 11, 60 armure/RM et une portée inchangée de 204. Leurs dégâts sont de 153 bruts mixtes par tir, calibrés à environ 136 DPS au rythme actuel des tours. Chaque base reprend la King Tower niveau 11 : 4 824 PV effectifs, convertis en 2 838 PV avec 70 armure/RM ; ses dégâts visent 109 DPS (123 bruts mixtes par tir au rythme actuel). Sa portée reste 247,5, volontairement supérieure à l’équivalent Clash Royale. Reby reprend la conversion des 848 PV de Furnace pré-refonte, avec le bonus de PV de 20 % ci-dessus. Les PV des bâtiments et troupes produits par ses capacités utilisent également des coefficients de ses stats.

```text
résistance effective = max(0, résistance - pénétration fixe)
                      × (1 - pénétration en pourcentage / 100)
dégâts après résistance = dégâts bruts × 100 / (100 + résistance effective)
```

L’armure réduit les dégâts physiques ; la résistance magique réduit les dégâts magiques. La pénétration est actuellement à zéro pour les autres troupes définies dans les données. Ninja peut gagner 60 % de pénétration magique pendant quatre fins de tour avec Piercing Shuriken ; Burrower possède une pénétration d’armure fixe de 30 propre à ses attaques physiques. Tous les dégâts de Burrower contre les tourelles et les bases sont réduits de 50 %. Les dégâts d’attaque sont arrondis ; les dégâts des capacités et projectiles ne le sont pas toujours.

## AC, activation et déroulement d’un tour

- AC désigne les points d’action d’une troupe. Une attaque de base consomme son `attackCost` ; une capacité consomme son coût AC, affiché comme `apCost` dans les données de capacité.
- Une troupe peut agir plusieurs fois tant qu’elle a assez d’AC. L’AC est dépensé par les attaques et capacités ; il n’y a pas de bouton de fin d’activation.
- À la fin du tour, les troupes actives tentent automatiquement leurs attaques de base sur leur cible focalisée, tant que celle-ci est à portée et qu’il leur reste assez d’AC. Cette résolution précède le tir des structures.
- À la fin du tour d’une troupe, si elle n’a pas de cible focale valide, son AC revient à son AC initial. Sinon, son AC est plafonné au coût d’une attaque de base. Exception : les bâtiments conservent leur AC sans focus ; Reby gagne 15 AC au début de chacun de ses tours.
- Au début du prochain tour de son propriétaire, une troupe non étourdie reçoit `15 + AC conservés`, avec l’AC conservé plafonné au coût d’une attaque. Sans cible focale valide, elle reçoit plutôt son AC initial.
- Une troupe fraîchement déployée est étourdie jusqu’au prochain début de tour de son propriétaire. Elle ne peut ni attaquer, ni lancer de capacité, ni se déplacer manuellement/automatiquement pendant cet état. À sa récupération, elle perd l’étourdissement et reçoit son AC initial, sans bonus de 15.
- Les structures tirent à la fin du tour, avant le changement de joueur. Le joueur suivant reçoit ensuite ses ressources, ses troupes sont réinitialisées et leurs mouvements automatiques sont préparés.

## Déplacement et comportement automatique

- Le déplacement ne coûte pas d’AC. Chaque troupe dispose de sa statistique `movement` par tour ; plusieurs commandes manuelles peuvent répartir cette distance. Les bonus de vitesse Rayka multiplient temporairement la distance disponible et la vitesse d’animation.
- Les troupes aériennes ignorent le terrain, les structures et les troupes terrestres pour le déploiement et le déplacement. Elles peuvent donc être déployées au-dessus de ces obstacles, sauf dans les zones d’interdiction de déploiement des structures ennemies. Les troupes aériennes bloquent le passage et le déploiement des autres troupes aériennes ; les couches au sol et dans les airs ne se bloquent pas mutuellement.
- Une commande manuelle vers une destination trop éloignée s’arrête au plus loin possible sur le segment. Le déplacement est refusé si le segment traverse un obstacle ou une autre troupe.
- Une troupe qui a un focus ne peut pas se déplacer si sa destination ferait sortir la cible de sa portée d’attaque. Le mouvement entier est refusé et le focus est conservé.
- Pour les troupes au sol, la rivière bloque le passage sauf sur les deux ponts, et les troupes/structures vivantes bloquent le déplacement. Une structure détruite ne bloque plus. Le tableau de terrain décoratif est vide et n’est pas pris en compte dans les collisions.
- La portée de vue par défaut vaut environ 70 % de la portée d’une tourelle standard (143 unités) ; elle ne descend jamais sous la portée d’attaque de la troupe. Les valeurs actuelles vont de 143 à 204.
- Au début du tour de son propriétaire, chaque troupe non étourdie suit ces étapes dans l’ordre, sans qu’elles soient exclusives : (1) sans focus et sans ennemi en vue, avance vers la tourelle ennemie vivante la plus proche (ou la base s’il n’y a plus de tourelle) jusqu’à repérer un ennemi ; (2) si des ennemis sont en vue mais aucun à portée d’attaque, avance vers l’ennemi visible le plus proche jusqu’à entrer à portée d’attaque ; (3) si elle n’a toujours pas de focus, choisit l’ennemi valide le plus proche qui est dans sa portée d’attaque. Ainsi, une troupe rencontrée en chemin peut interrompre l’approche de la tourelle et devenir la cible d’approche.
- Les trajets automatiques utilisent une grille A* de 20 unités avec huit voisins, puis une simplification par visibilité directe : les segments libres sont parcourus en ligne droite, donc les angles de déplacement ne sont pas limités aux huit directions de la grille. Pour une structure, la recherche accepte toute position dégagée dans sa portée d’approche, autour de son obstacle, au lieu d’exiger un point précis qui pourrait être inaccessible. La portée d’attaque contre une structure est mesurée depuis son bord de collision. Les segments lissés sont revérifiés contre les obstacles avant le déplacement. Le déplacement est animé ; tant qu’une troupe bouge, les commandes de jeu sont temporairement ignorées.

## Ciblage et attaques

- La portée de vue sert à repérer les ennemis et à décider de l’approche automatique. Le focus est normalement une cible ennemie à portée d’attaque. Exception : Kaguya acquiert une troupe alliée (jamais elle-même) à portée pour la soigner avec son attaque de base.
- Si la cible meurt ou sort de portée d’attaque, le focus est réinitialisé. Une troupe ne prend pas de focus sur une cible qui est seulement dans sa portée de vue ; elle s’en approche d’abord.
- Une attaque de base frappe la cible focale si elle est à portée d’attaque et si l’AC suffit. Kaguya soigne sa cible focale et jusqu’à deux autres alliées blessées à portée. Un profil avec `aoeRadius` inflige aussi ses dégâts aux troupes ennemies admissibles proches de la cible principale. Les structures peuvent être attaquées par une attaque de base ; leurs valeurs d’armure et de résistance magique sont définies dans `engine/board.js` et réduisent les dégâts de leur type correspondant.
- Cliquer sur une structure ennemie à portée d’attaque permet de la définir comme cible focale. Le clic ne lance pas immédiatement l’attaque.
- Le jeu n’applique pas de règle d’aggro ou de priorité particulière aux troupes pour les tourelles : elles choisissent la troupe ennemie admissible la plus proche.
- Une attaque de base ne peut cibler une troupe aérienne que si son `movementType` (`air`) figure dans `attackTypes` de l’attaquant. Les tourelles et bases ciblent actuellement les unités aériennes comme les autres troupes.
- Reby n’acquiert pas de focus. Quand elle a 70 AC, sa résolution automatique dépense 70 AC et lance trois drones volants vers l’ennemi le plus proche. Les drones apparaissent espacés devant Reby, ont leurs propres PV, peuvent être détruits avant l’impact et explosent au contact avec un rayon de 40,8 unités. Chaque ennemi touché subit des dégâts magiques bruts égaux à 160 % de l’ATK de Reby. Ils avancent de 81,6 unités au début de chacun de leurs tours (classe « très rapide » / Fire Spirit), puis s’arrêtent jusqu’à leur prochain tour ; le déplacement est animé comme celui des troupes. Ils sont autonomes et non contrôlables.

## Capacités

- Chaque capacité appartient à une troupe précise. Il faut sélectionner cette troupe puis jouer l’une de ses capacités.
- `darkCost` est le coût en AP ; `apCost` est le coût en AC. La carte est remplacée immédiatement après le lancement réussi.
- Le type de ciblage est défini par `targeting` : `self` se lance avec un clic n’importe où dans l’arène ; `unit` exige une troupe valide ; `area` prévisualise son rayon sous le curseur et peut limiter la portée de lancement par `castRange` ; `direction` affiche une ligne depuis le lanceur et touche la première cible ou toutes selon `hitMode`.
- Un ciblage `unit` vérifie la faction (`targetTeam`) et la distance (`targetRange`) avant de dépenser les ressources. Une cible valide est cerclée au survol ; un clic sans cible valide affiche un avertissement et ne consomme pas la carte.
- Les capacités de zone utilisent le point cliqué comme centre du rayon `radius`. Les capacités de dégâts touchent les troupes ennemies, pas les structures.
- Les zones persistantes (`createsZone`) appliquent leurs dégâts à chaque fin de tour globale pendant leur durée. Une capacité peut aussi utiliser une durée en secondes réelles (`durationSeconds`) pour les effets temporisés.
- Chaque application de dégâts de zone affiche brièvement sa forme sur le plateau pendant 2 secondes : cercle pour les zones et splash, arc pour les attaques en cône. Les zones persistantes gardent leur cercle de durée et affichent aussi chaque impact de dégâts.
- Les dégâts d’une capacité utilisent les statistiques du lanceur et ses coefficients `scaling`. Le champ `damageType` choisit l’armure (`physical`) ou la résistance magique (`magic`). Les zones persistantes utilisent `damagePerTurnScaling` à chaque fin de tour. Une capacité sans profil de dégâts n’inflige pas de dégâts. Les dégâts proportionnels aux PV maximums sont ajoutés aux dégâts bruts et subissent eux aussi la mitigation correspondant au type de dégâts.
- Une capacité de soin utilise `healScaling`; les boucliers et dômes utilisent `shieldScaling` et `domeHealthScaling`. Les soins et PV effectifs sont plafonnés par les PV maximums concernés.
- Hugo gagne 10 énergie à chaque attaque de base et 1 énergie par pourcentage de PV maximum effectivement perdu. Chaque tranche de 50 énergie consommée crée ou renouvelle à sa position une pelouse de rayon 68 unités (2,5 tuiles) pendant 10 fins de tour globales. L’eau et les bâtiments ne sont pas remplacés ; les alliés sur la pelouse reçoivent des soins et bonus 40 % plus efficaces.
- Bodyguard sélectionne un allié à 120 unités maximum et dure 8 fins de tour globales : Hugo ralentit de 30 % et dessine une barrière de 163,2 unités perpendiculaire à l’allié sélectionné. Les attaques à distance traversant la barrière sont redirigées vers Hugo après réduction fixe égale à 40 % de sa Force (20 % pour les tourelles et bases). Les dégâts dirigés directement vers Hugo sont réduits de la même valeur. Une touche à distance après réduction inférieure à 2 % de ses PV maximum lui donne 5 énergie et donne 5 AC à l’allié choisi, ou à l’allié vivant le plus proche si celui-ci est mort ; une attaque de sbire invoqué ne donne qu’1 AC.
- Les capacités de Reby peuvent placer des bâtiments alliés jusqu’à 4 tuiles (108,8 unités) de Reby. Ils apparaissent à l’endroit choisi, perdent des PV à chaque fin de tour globale et génèrent automatiquement des troupes tous les deux tours ; les troupes apparaissent devant leur bâtiment. Aegis Dome protège les alliés dans son rayon contre les attaques à distance provenant de l’extérieur, jusqu’à épuisement de ses PV ou expiration de sa durée.
- Les durées d’effets persistants comptent les fins de tour globales : la fin de Blue vaut 1 tour, puis la fin de Red en vaut un autre.
- Le saignement de Shield Ricochet inflige ses dégâts bruts chaque fois que la cible dépense de l’AC. Les capacités différées décrites dans les données gardent leur position dans `board.strikes` jusqu’à l’impact, et leur marqueur de cible est rendu uniquement pour l’équipe propriétaire.
- Le silence bloque les capacités mais laisse l’attaque de base et le déplacement disponibles. Une troupe enfouie est invisible, non ciblable et ne bloque pas les autres unités ; elle réapparaît après son nombre prévu de fins de tour globales.

## Structures défensives

- Chaque équipe possède quatre tourelles (deux intérieures et deux extérieures) et une base.
- Les tourelles ont 2 289 PV, 60 armure/RM, 204 de portée et 153 dégâts mixtes bruts par tir. Les bases ont 2 838 PV, 70 armure/RM, 247,5 de portée et 123 dégâts mixtes bruts par tir. La base correspond à 4 824 PV effectifs et 109 DPS d’une King Tower niveau 11 ; sa portée supérieure à l’équivalent Clash Royale est intentionnelle.
- Les tirs sont lancés à la fin du tour, sous forme de projectiles. À l’impact, dégâts physiques et magiques représentent chacun la moitié des dégâts bruts et sont mitigés séparément par l’armure et la résistance magique de la cible. Les projectiles continuent vers leur cible même si elle quitte ensuite la portée ; si elle est déjà morte à l’impact, le projectile n’inflige aucun dégât.
- Une structure vivante choisit la troupe ennemie non située sur un pont qui est à portée et la plus proche. Elle conserve sa cible tant qu’elle est présente, vivante et à portée.
- Les structures vivantes bloquent le déplacement. Les bases et tourelles sont des obstacles et les zones d’interdiction de déploiement sont égales à 130 % de leur portée de tir. Une structure détruite ne tire plus, ne bloque plus et n’interdit plus le déploiement.

## Arène

- Dimensions : 1560 × 570 unités. Blue est à gauche, Red à droite. La rivière traverse le plateau verticalement entre `x = 740` et `x = 820`.
- Deux ponts mesurent 160 × 84 et sont centrés autour de `y = 143` et `y = 427`.
- Base bleue : `(135, 285)` ; tourelles intérieures bleues : `x = 245`, extérieures : `x = 500`.
- Base rouge : `(1425, 285)` ; tourelles intérieures rouges : `x = 1315`, extérieures : `x = 1060`.
- `engine/board.js` contient un tableau `terrains` vide ; aucun rocher ou mur ne participe actuellement aux collisions.

## Interface

- Cliquer une troupe affiche son panneau de statistiques et d’actions. Les capacités appartenant à cette troupe sont mises en évidence dans la main.
- Le tableau en haut de l’écran affiche les points de Blue et Red. Chaque tourelle détruite ajoute 1 point à l’équipe adverse ; une base détruite donne la victoire immédiate. Après la victoire, les commandes de tour et les actions de jeu sont bloquées.
- La sélection d’une troupe affiche ses cercles de portée de vue et d’attaque. Un petit triangle devant la troupe indique son orientation, mise à jour dans la direction de son dernier déplacement.
- Le bouton d’information `i` affiche les données de la capacité. Le bouton d’attaque utilise la cible focale ; clic droit est également un raccourci d’attaque.
- Le bouton MOVE entre en mode déplacement, puis un clic sur le plateau définit la destination. ATTACK entre en mode attaque ; cliquer une cible ennemie à portée effectue l’attaque. Le bouton sélectionné reste visuellement surligné jusqu’à l’action ou à sa désactivation. `END TURN` (ou Entrée) termine le tour.
- Les actions sont verrouillées pendant qu’une troupe suit une trajectoire animée.
- Le contrôle en pourcentage et le compteur `/7` du HUD sont des indicateurs d’interface, pas une limite d’unités ni une condition de victoire.

## Troupes disponibles

Rookie, Rayka, Reby, Hugo, Ninja, Kaguya et Burrower. Leurs statistiques et capacités sont définies dans `data/troops.js` et `data/abilities.js` ; les fiches sont dans `data/unit-descriptions/`.

### Hugo

Hugo reprend le Giant : tank à bâtiments avec 3 968 PV, 168 Force/ATK, 30 armure/RM, portée d’attaque 40, portée de vue 204, déplacement lent (30,6 par tour) et coût de 1 000 Elixir. Ses PV effectifs valent 130 % de la référence Giant niveau 11. Il ignore les troupes ennemies tant qu’un bâtiment est en vue. Chaque attaque de base lui donne 10 énergie ; il gagne aussi 1 énergie par pourcentage de PV maximum effectivement perdu.

- **Passif — Changement de pelouse** : chaque fois qu’il atteint 50 énergie, Hugo consomme une tranche de 50 et crée ou renouvelle une pelouse centrée sur lui, de rayon 68 unités (2,5 tuiles), pendant 10 fins de tour globales. L’eau et les bâtiments restent intacts. Les soins et bonus reçus par les alliés sur la pelouse sont 40 % plus efficaces ; l’énergie excédentaire est conservée.
- **Dab** — ciblage soi-même ; utilisable seulement si un bâtiment est dans la portée d’attaque d’Hugo. Le soin dépend de ses PV maximum et lui donne 10 énergie. Coût : 150 AP.
- **Smoke Grenade** — lance un projectile jusqu’à 7 tuiles (190,4 unités) ; l’impact inflige de faibles dégâts physiques calculés à 25 % de l’ATK de Hugo et crée un champ persistant visible pendant 8 fins de tour globales. Les ennemis dans la fumée voient leur portée d’attaque et de vue réduites de moitié et perdent leur focus si leur cible devient hors de portée. Coût : 200 AP.
- **Bodyguard** — sélectionne un allié dans un rayon de 120 unités. Pendant 8 fins de tour globales, Hugo ralentit de 30 % et crée devant lui une barrière de 163,2 unités, perpendiculaire à l’allié. Les attaques à distance traversant la barrière sont redirigées vers Hugo après une réduction fixe égale à 40 % de sa Force (20 % pour les tourelles et les bases) ; les dégâts dirigés directement vers Hugo sont réduits pareillement. Si une touche à distance réduite inflige moins de 2 % de ses PV maximum, Hugo gagne 5 énergie et l’allié sélectionné gagne 5 AC (1 AC si l’attaque provient d’un sbire invoqué). Coût : 400 AP.

Les rayons des capacités Smoke Grenade et Bodyguard et la portée de sélection d’allié restent des valeurs de prototype.

### Kaguya

Kaguya reprend le Phoenix : support volant de mêlée avec 745 PV, 35 armure, 90 RM, portée 43,5, vue 143, vitesse moyenne (40,8 par tour) et 800 Elixir. Sa résistance est spécialisée vers la magie, au prix d’une armure plus basse. Son attaque de base choisit une alliée blessée comme focus et la soigne, ainsi que jusqu’à deux autres alliées à portée ; elle ne se cible jamais elle-même. Chaque soin vaut 10 % de ses PV maximum.

- **Shield Ricochet** — direction jusqu’à 300 unités ; le bouclier inflige des dégâts physiques à la première troupe ennemie touchée puis ricoche jusqu’à deux fois vers les ennemis proches du dernier impact. Chaque touche applique un saignement de 6 fins de tour globales, dont l’intensité vaut 20 % des PV effectivement perdus sur cette touche. À chaque dépense d’AC, la cible subit en dégâts bruts une fois l’intensité du saignement. Coût : 150 AP.
- **Force Field** — ciblage soi-même ; pendant 4 fins de tour globales, renvoie à l’attaquant 30 % des dégâts de santé subis par les alliés dans un rayon de 140 unités autour de Kaguya. Coût : 400 AP.
- **Skyfall Bomb** — sélectionne une zone n’importe où sur la carte. Le marqueur n’est visible que par l’équipe de Kaguya. La bombe frappe après 2 fins de tour globales, inflige des dégâts magiques de zone dans un rayon de 68 unités, calculés depuis l’ATK de Kaguya, et repousse les ennemis. Les cibles dans un rayon central de 27,2 unités subissent 20 % de dégâts supplémentaires et 50 % de recul supplémentaire ; l’impact fait trembler l’arène. Coût : 700 AP.

Les paramètres de rebond/saignement du bouclier, le rayon du champ de force et le recul de la bombe restent des valeurs de prototype.

### Reby

Reby reprend la référence Furnace pré-refonte : bâtiment immobile de 678 PV (20 % au-dessus de la conversion), 50 armure/RM et 800 Elixir. Son usure reste à 15,1 PV par fin de tour globale. Toutes les 13 fins de tour globales (environ 10 secondes selon la conversion du jeu), elle lance deux drones kamikaze volants vers l’ennemi le plus proche. Les drones ont des PV dérivés de ceux de Reby et apparaissent espacés devant elle. À chacun de leurs tours, ils avancent de 81,6 unités (classe très rapide, comme un Fire Spirit), puis attendent le prochain tour pour avancer de nouveau. Leur déplacement est animé comme celui des autres troupes. Ils explosent au contact dans un rayon de 40,8 unités et infligent à chaque ennemi touché des dégâts magiques bruts égaux à 160 % de l’ATK de Reby. Les drones peuvent être ciblés et détruits avant l’impact.

- **Drone Foundry** — place un bâtiment à 4 tuiles (108,8 unités) maximum de Reby ; ses PV et son usure dépendent des PV de Reby. Il produit un Scout équivalent à un Gobelin à lance devant lui tous les 4 tours globaux. Coût : 400 AP.
- **Guard Foundry** — même portée de placement, avec un Guard de mêlée généré seul devant le bâtiment environ toutes les 10 secondes (13 tours globaux), sur le rythme de l’ancienne Cabane de Barbares. Ses PV et son ATK sont réduits par rapport à un Barbare. Coût : 500 AP.
- **Aegis Dome** — ciblage soi-même ; crée autour de Reby un dôme de rayon 160 pendant 14 fins de tour globales. Il absorbe jusqu’à 120 % des PV de Reby en dégâts à distance venant de l’extérieur. Coût : 400 AP.

Les valeurs non indiquées dans le concept pour la portée et les paramètres des bâtiments invoqués restent des valeurs de prototype.

### Ninja

Ninja est une carte qui déploie simultanément sept combattants de mêlée indépendants. Chacun est fragile et inflige des dégâts magiques ; ils sont donc efficaces contre les tanks résistants à la magie lorsqu’ils activent Piercing Shuriken, mais vulnérables aux attaques de zone qui peuvent toucher plusieurs membres. Chaque membre peut être ciblé et éliminé séparément.

- **Piercing Shuriken** — ciblage soi-même ; augmente de 60 % la pénétration magique de l’escouade pendant 4 fins de tour globales. Coût : 100 AP.
- **Paralyzing Strikes** — ciblage soi-même ; pendant 10 fins de tour globales, les attaques des Ninjas ajoutent une marque à la troupe ennemie touchée. À 10 marques, elle est étourdie pendant 2 fins de tour globales. Coût : 200 AP.
- **Shadow Replicas** — ciblage soi-même ; chaque Ninja original crée un clone après une attaque de base, avec un maximum de 2 clones vivants par individu. Les clones combattent automatiquement, ne sont pas contrôlables et ne peuvent pas créer de clones. Coût provisoire : 300 AP ; durée provisoire : reste de la partie, car ces valeurs n'étaient pas précisées.

Le coût et la durée de Shadow Replicas sont provisoires.

### Rookie

Rookie reprend la Musketeer : 553 PV après compensation des résistances, 50 armure/RM, portée d’attaque et vue de 163,2, déplacement moyen (40,8 par tour propre) et 800 Elixir. Il attaque magiquement les troupes au sol et dans les airs. Son APT/DPS de base est réduit de 15 %. Ses attaques de base ne font aucun dégât en pourcentage des PV ; elles appliquent une marque.

- **Overdrive** — augmente de 50 % sa génération d’AC pendant 8 fins de tour. Ciblage soi-même. Le coût de 0 AP et 0 AC est provisoire.
- **Momentum Shield** — protège le premier allié traversé par la ligne de tir avec un bouclier égal à 35 % des PV de Rookie pendant 6 fins de tour. Le déplacement cumule ses vecteurs : aller dans la même direction ajoute du momentum, changer de direction le réduit. Le momentum donne jusqu’à 50 % de vitesse de déplacement supplémentaire (maximum atteint à 272 unités cumulées). Quand le bouclier casse ou expire, il inflige des dégâts physiques de zone dans un rayon de 54,4 unités ; les dégâts bruts valent 0,5 par unité de momentum. Ciblage directionnel, 250 AP.
- **Rocket** — projectile ciblé sur une troupe ennemie ; inflige 150 % de l’ATK en dégâts physiques, applique une marque et repousse de 144 unités. Portée de sélection : 350 unités ; coût : 400 AP.

Chaque attaque de base de Rookie et son Rocket appliquent une marque. À la troisième marque, la cible devient fragile pendant 6 fins de tour globales ; les attaques suivantes de Rookie renouvellent la durée. Une troupe fragile subit, après chaque attaque à distance, des dégâts magiques égaux à 5 % de ses PV courants après résistance magique. Toute attaque d’un sbire ou d’une invocation inflige plutôt 1 %.

Le recul et la portée de sélection de Rocket, ainsi que la durée et le coût d’Overdrive, restent des valeurs provisoires de prototype.

### Rayka

Rayka reprend le Baby Dragon : 1060 PV, 25 armure/RM, portée d’attaque 95,2, vue 143, vitesse rapide (61,2 par tour propre) et 800 Elixir. Elle privilégie son pool de PV au lieu de résistances élevées. Elle vise les unités au sol et dans les airs. Les attaquants dont l’attaque de base ne vise que le sol l’ignorent ; les tourelles et bases peuvent la prendre pour cible. Son énergie augmente séparément son armure et sa résistance magique de 1,5 % par point ; ce bonus est multiplicatif sur ses résistances de base.

- **Attaque de base — Thunderstorm** : à chaque attaque, Rayka invoque sur sa cible un orage de rayon 40,8. À chaque fin de tour globale où il persiste, l’orage inflige des dégâts magiques de zone calculés à 31 % de l’APT de Rayka avant mitigation, pendant 2 fins de tour. Il touche les troupes et les bâtiments ennemis. Les orages sont indépendants : leurs dégâts se cumulent dans les zones qui se chevauchent. Leur cercle, les éclairs et leur durée restante restent visibles sur l’arène.
- **Relay Flight** — utilisable seulement si Rayka n’a pas de focus ; téléporte Rayka à une position libre près d’un allié choisi à 600 unités maximum. Rayka et l’allié gagnent 50 % de vitesse de déplacement pendant 4 secondes réelles. Coût : 200 AP.
- **Aegis Feedback** — ciblage soi-même ; pendant 10 fins de tour globales, Rayka récupère 30 % des dégâts de santé infligés par ses orages. Chaque impact de l’orage sur une unité lui donne 5 énergie. Les bâtiments ne génèrent pas d’énergie. Coût : 250 AP.
- **Lightning Storm** — ciblage soi-même ; consomme toute l’énergie de Rayka et la renforce pendant 10 fins de tour globales. Ses orages durent alors 4 fins de tour et gagnent chacun un bonus de rayon et de dégâts égal à 1 % par énergie consommée. Seuls ces orages renforcés infligent confusion : les ennemis présents ne peuvent pas recevoir d’ordre manuel de déplacement tant que Lightning Storm est actif et qu’ils restent dans l’orage. Quand un orage frappe un bâtiment, un orage supplémentaire apparaît à cet endroit ; cet orage secondaire ne crée pas d’autres orages. Coût : 400 AP.

Après la dernière génération d’énergie, celle-ci reste intacte pendant deux fins de tour globales sans génération, puis perd 10 % par fin de tour tant qu’aucune énergie n’est générée. Les zones d’orage peuvent se chevaucher et infligent séparément leurs dégâts, même à une cible dans plusieurs zones.

Les valeurs non indiquées dans le concept (bonus de vitesse, portée de téléportation et conversion en bouclier) restent des paramètres de prototype.

### Burrower

Burrower reprend le Miner : 773 PV, 80 armure, 30 RM, portée 32,6, vue 143, vitesse rapide (61,2 par tour propre) et 600 Elixir. Sa résistance favorise l’armure, au prix d’une RM plus basse. Son attaque physique a 30 de pénétration d’armure fixe ; tous ses dégâts aux tourelles et aux bases sont réduits de moitié.

- **Tunnel Pounce** — sélectionne une troupe ennemie à courte portée (140 unités provisoires), la définit comme focus et dash en chemin praticable jusque dans la portée d’attaque. Coût : 100 AP.
- **Dust Veil** — silence les troupes ennemies dans un cône de 45° jusqu’à 61,2 unités (30 % de la portée d’une tourelle standard) et inflige des dégâts magiques calculés depuis l’ATK de Burrower. Le silence dure 4 fins de tour globales. Coût : 200 AP.
- **Deep Tunnel** — sélectionne un point sur la carte ; Burrower s’enfouit pendant 2 fins de tour globales puis ressort à cet endroit ou à l’emplacement libre le plus proche. Sa prochaine attaque de base contre une troupe la projette en l’air si elle est lancée dans les 4 fins de tour suivant son émergence. Coût : 300 AP.

La projection interrompt la troupe touchée et l’empêche d’agir pendant son prochain tour.

La portée du dash et la durée du lancement en l’air restent des valeurs provisoires.
