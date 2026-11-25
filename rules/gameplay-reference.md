# Référence de gameplay

Ce document décrit les règles communes de Revolve Infinity. Les statistiques et capacités propres à chaque héros sont documentées dans les fiches de [hero descriptions](../data/unit-descriptions/README.md). Les valeurs de balance de référence sont centralisées dans data/stats/<hero>.js.

## Démarrage et draft

Le jeu se lance depuis un serveur HTTP local. Avec Node.js, exécuter npm start ; sans Node.js, exécuter py -m http.server 8000 puis ouvrir http://localhost:8000. Ne pas ouvrir index.html directement : le navigateur doit charger les modules ES depuis HTTP.

La draft retire des héros de la pool par bans puis attribue les picks. Red bannit 1 héros, Blue en bannit 2, puis Red en bannit 1. Les picks suivent ensuite la séquence Blue 1, Red 2, Blue 2, Red 2, Blue 2, Red 2, Blue 2, Red 1. Chaque action est chronométrée à 15 secondes ; à expiration, le premier héros disponible est choisi automatiquement. Les bans s’appliquent aux deux joueurs et un héros choisi ne peut pas être repris par l’adversaire.

Chaque pick ajoute une carte de héros au deck des héros et ses cartes de compétence au deck de compétences. Chaque équipe joue sept héros. Il n’y a pas de phase de construction de deck. La main des héros contient trois cartes sur un cycle de sept ; la main de compétences en contient neuf sur un cycle de vingt et une. Jouer une carte la remplace par la prochaine carte de son deck, visible en aperçu à côté de sa main.

## Arène et objectifs

Les équipes bleue (0) et rouge (1) jouent à tour de rôle dans la même orientation de carte. Chaque base détruite termine la partie et donne la victoire à l’adversaire. Chaque tourelle détruite rapporte un point.

Les structures ennemies créent une zone d’interdiction qui empêche le déploiement. Le curseur prévisualise l’emplacement demandé ; le déploiement est refusé si la troupe chevauche le bord de l’arène, un obstacle ou une structure fixe. Un chevauchement avec une troupe mobile est accepté : les unités déjà présentes sont repoussées pour éviter tout chevauchement après un déploiement ou une invocation.

## Ressources, cartes et activation

Chaque joueur commence avec 1200 Elixir et 0 AP. Au début de son tour, il gagne 100 Elixir et 50 AP, chacun plafonné à 2000. L’Elixir sert au déploiement des héros ; les AP paient leurs capacités. Les compétences jouées reviennent au fond de leur deck après le tirage de remplacement. Le joueur peut défausser jusqu’à trois compétences de sa main pour 100 AP ou 100 Elixir ; chaque carte défaussée est remplacée par la prochaine de son deck.

L’AC est la ressource d’action propre à chaque unité. Une attaque de base ou une capacité peut en coûter. Une unité peut effectuer plusieurs actions si elle dispose d’assez d’AC. L’AC est réinitialisé ou conservé selon sa cible focale et les règles de l’unité ; les bâtiments suivent leurs propres valeurs de génération.

Une unité fraîchement déployée est étourdie jusqu’au prochain début de tour de son équipe. Pendant cet état, elle ne peut ni attaquer, ni lancer de capacité, ni se déplacer.

## Attaques, dégâts et soins

Les attaques de base et capacités utilisent le type de dégâts et les coefficients définis dans les données. Les dégâts physiques sont réduits par l’armure ; les dégâts magiques par la résistance magique. La pénétration réduit la résistance effective. La formule de réduction est :

    dégâts après résistance = dégâts bruts × 100 / (100 + résistance effective)

Les dégâts dirigés contre les tourelles et bases peuvent avoir un multiplicateur de structure défini par l’attaque. Les soins ne dépassent pas les PV maximums. Les boucliers absorbent les dégâts avant les PV.

Le focus est une cible que l’unité peut attaquer à portée. Si elle meurt, devient invalide ou sort de portée, le focus est réévalué. Lorsqu’une unité sans focus choisit une cible visible pour avancer ou attaquer, elle compare la distance physique divisée par l’aggro de la cible. Une aggro plus élevée rend donc une cible plus prioritaire sans modifier sa visibilité ni la portée de détection. Toutes les unités ont une aggro de 1 par défaut. Les structures défensives sélectionnent automatiquement la troupe ennemie admissible la plus proche à portée, selon la même priorité d’aggro.

Les capacités peuvent viser soi-même, une unité, une zone ou une direction. Les règles de faction, de portée et de validité s’appliquent avant le coût et la consommation de la carte. Les attaques de zone affectent les cibles qui se trouvent dans leur rayon ; la sélection d’une zone ne requiert pas nécessairement une cible valide.

## Déroulement d’un tour

À la fin du tour, les attaques automatiques des unités actives se résolvent, puis les structures tirent et les zones, effets et frappes différées évoluent. Le joueur suivant reçoit ses ressources ; ses unités récupèrent leur mouvement et leur AC selon leurs règles, puis préparent leurs déplacements automatiques.

Les déplacements automatiques cherchent une route autour du terrain et des structures. Les unités ne sont pas des obstacles de navigation : elles sont déplacées par les collisions. Le déplacement de contact est involontaire et ne remplace pas le trajet en cours. Les effets de contrôle dur, tels que l’étourdissement, la projection ou le knockback, peuvent interrompre l’action ou le déplacement selon leur effet.

La taille (`size`, 1 par défaut) multiplie le rayon de collision et l’échelle visuelle de l’unité ; 1 point de taille correspond à un rayon d’une demi-case, soit 14 unités (une case vaut 28 unités). Les tourelles ont une taille de 2,5 et les bases une taille de 3. Toutes les portées (détection, attaque et compétences) partent du bord de l’unité source ; les portées entre deux unités tiennent compte des bords des deux unités. La taille est indépendante de la masse. La force et la masse influencent différemment les déplacements : une unité avec plus de force repousse mieux lors d’un mouvement volontaire ; la masse résiste au déplacement. Le knockback explicite est mesuré comme une force de recul divisée par la masse de la cible ; la force de la cible ne le réduit pas.

## Historique et fin de partie

Le jeu conserve l’historique global des dégâts, soins, réductions, éliminations, déploiements et applications d’effets. Le résumé de fin de partie présente les statistiques principales par héros. Les invocations contribuent aux événements de combat mais ne prennent pas de place parmi les sept héros choisis.
