# IMAP Mail

Transformez les mails que vous recevez en déclencheurs de scène Gladys : surveillez jusqu'à trois boîtes mail IMAP, réagissez à un mail d'un expéditeur, d'un domaine ou d'un dossier donné, ou dont l'objet contient un mot-clé, et transmettez à la scène son expéditeur, son objet et un court extrait. Chaque boîte mail devient aussi un appareil avec son compteur de non-lus, et un widget de tableau de bord liste les derniers mails.

Cette intégration **reçoit** des mails. Pour **envoyer** des mails depuis Gladys, utilisez l'[intégration SMTP](https://github.com/GladysAssistant/gladys-smtp) officielle (gladys-smtp).

Testé avec un serveur de test GreenMail, pas encore avec tous les fournisseurs : vos retours sont bienvenus dans [les issues](https://github.com/guim31/gladys-imap/issues).

## Ce que fait l'intégration

- **Temps réel** : le premier dossier surveillé de chaque boîte mail est suivi en IMAP IDLE, un nouveau mail déclenche sa scène en une ou deux secondes. Les autres dossiers, et les serveurs sans IDLE, sont vérifiés à l'intervalle choisi.
- **Lecture seule** : rien n'est envoyé, déplacé, supprimé ni marqué comme lu, sauf par l'action de scène « Marquer comme lu » quand une scène le demande. Les mails sont lus avec `BODY.PEEK`, qui les laisse non lus.
- **Seulement les nouveaux mails** : au premier démarrage, les mails déjà présents dans la boîte ne déclenchent rien. Après un redémarrage, les mails reçus entre-temps déclenchent (20 par dossier au plus, les plus récents).
- **Rien n'est conservé** : l'intégration ne stocke que le numéro du dernier mail vu dans chaque dossier, sous `/data`. Ni objet, ni expéditeur, ni contenu.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un compte IMAP joignable depuis Gladys : l'adresse du serveur, l'utilisateur (en général l'adresse mail) et le mot de passe.
- **Gmail, Outlook, iCloud, Yahoo** : un **mot de passe d'application**, créé dans les paramètres de sécurité du compte (la validation en deux étapes doit être activée). Ces fournisseurs refusent le mot de passe habituel. La connexion OAuth2 n'est pas prise en charge.

## Configuration

Dans **Intégrations → IMAP Mail → Configuration**, remplissez un bloc par boîte mail (trois au maximum) :

| Champ                             | Signification                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Serveur IMAP                      | par ex. `imap.gmail.com`, `outlook.office365.com`, `imap.mail.me.com`. Laissez vide pour désactiver le bloc.           |
| Port                              | 993 pour TLS (par défaut), 143 pour STARTTLS.                                                                          |
| Sécurité                          | TLS ou STARTTLS. Un serveur qui ne propose ni l'un ni l'autre est refusé : le mot de passe ne circule jamais en clair. |
| Utilisateur                       | En général l'adresse mail complète.                                                                                    |
| Mot de passe                      | Le mot de passe (d'application). Stocké par Gladys comme secret, jamais écrit dans les journaux.                       |
| Dossiers à surveiller             | Séparés par des virgules, 5 au maximum, `INBOX` par défaut. Le premier est suivi en temps réel.                        |
| Accepter un certificat auto-signé | Uniquement pour un serveur à vous dont vous avez créé le certificat vous-même.                                         |

Puis les options :

- **Mots-clés d'objet** : des mots séparés par des virgules (par ex. `facture, colis, alarme`). Un mail dont l'objet en contient un déclenche « Mot-clé dans l'objet d'un mail ». La casse et les accents sont ignorés.
- **Transmettre un court extrait aux scènes** : les 200 premiers caractères du texte du mail (activé par défaut). Désactivé, seuls l'expéditeur et l'objet quittent le serveur mail.
- **Vérification complète toutes les** : 1, 2 (par défaut), 5 ou 15 minutes, pour les autres dossiers et les compteurs de non-lus.
- **Langue des noms et des messages** : français par défaut.

Enregistrez, puis cliquez sur **Tester la connexion** : une ligne par boîte mail, avec son nombre de non-lus ou la raison de l'échec.

### Fournisseurs

| Fournisseur | Serveur                 | Port, sécurité |
| ----------- | ----------------------- | -------------- |
| Gmail       | `imap.gmail.com`        | 993, TLS       |
| Outlook.com | `outlook.office365.com` | 993, TLS       |
| iCloud      | `imap.mail.me.com`      | 993, TLS       |
| Yahoo       | `imap.mail.yahoo.com`   | 993, TLS       |
| Orange      | `imap.orange.fr`        | 993, TLS       |
| Free        | `imap.free.fr`          | 993, TLS       |

Gmail présente ses libellés comme des dossiers : `[Gmail]/Spam`, un libellé `Alertes` est le dossier `Alertes`.

## Appareils

Dans **Intégrations → IMAP Mail → Découverte**, chaque boîte mail configurée apparaît comme un appareil nommé d'après son adresse, avec une fonctionnalité : le nombre de **mails non lus** dans ses dossiers surveillés. Ajoutez-le à Gladys pour le voir sur le tableau de bord, en faire un graphique ou l'utiliser dans une condition de scène (« plus de 10 non lus »). Il suit les changements faits ailleurs (un mail lu sur votre téléphone) dans l'intervalle de vérification, immédiatement pour le premier dossier.

## Déclencheurs de scène

Dans une scène, choisissez **Intégrations**, puis l'un de ces déclencheurs. Un filtre laissé vide signifie « n'importe lequel ».

### Mail reçu

Un nouveau mail est arrivé dans un dossier surveillé. Filtres : la boîte mail, l'**adresse de l'expéditeur** (exacte, en minuscules), le **domaine de l'expéditeur** (ce qui suit le @, en minuscules) et le **dossier** (tel qu'écrit dans la configuration).

### Mot-clé dans l'objet d'un mail

Un nouveau mail dont l'objet contient l'un des mots-clés d'objet de la configuration. Filtres : la boîte mail, le **mot-clé** (écrit comme dans la configuration ; vide : n'importe lequel) et l'adresse de l'expéditeur. Un objet contenant deux mots-clés déclenche deux fois, une fois par mot-clé.

### Informations transmises à la scène

Les deux déclencheurs transmettent : Boîte mail, Dossier, Nom de l'expéditeur, Adresse de l'expéditeur, Objet, Extrait (vide si désactivé), Reçu le (heure locale, `2026-10-14 08:05`) et Référence du mail (pour l'action « Marquer comme lu »). « Mot-clé dans l'objet d'un mail » ajoute le Mot-clé trouvé. Insérez-les dans un message avec le sélecteur de variables.

## Actions de scène

### Lire le nombre de non-lus

Demande immédiatement au serveur le nombre de mails non lus d'une boîte mail. Son résultat, « Mails non lus », peut servir dans une condition ou un message des actions suivantes.

### Marquer comme lu

Marque comme lu le mail du déclencheur. Choisissez la boîte mail et mettez la variable **Référence du mail** du déclencheur dans le champ « Référence du mail ». Seul ce mail est touché ; si le serveur a reconstruit le dossier entre-temps, l'action échoue plutôt que de toucher un autre mail. Résultat : « Marqué comme lu ».

## Widget

Ajoutez le widget **Derniers mails** à un tableau de bord : le compteur de non-lus et les 8 derniers mails reçus (expéditeur, objet, heure ; jamais le contenu). Choisissez une boîte mail dans ses paramètres, ou laissez vide pour les voir toutes. Une boîte mail refusée par le serveur affiche une ligne rouge.

## Exemples de scènes

- **Colis livré** : mot-clé `livré` dans la configuration ; déclencheur « Mot-clé dans l'objet d'un mail » (mot-clé `livré`) ; action « Envoyer un message » : « 📦 {{Objet}} — {{Extrait}} ».
- **Alarme par mail** : déclencheur « Mail reçu », adresse de l'expéditeur `alerts@my-nas.example` ; actions : allumer la lumière de l'entrée, envoyer une notification avec l'objet ; puis « Marquer comme lu » avec la Référence du mail.
- **Résumé du matin** : déclencheur « Tous les jours à 7:30 » ; action « Lire le nombre de non-lus » ; condition « Mails non lus » supérieur à 0 ; message « Vous avez {{Mails non lus}} mails non lus ».

## Dépannage

- **« connexion refusée »** : vérifiez l'utilisateur et le mot de passe. Gmail, Outlook et iCloud demandent un mot de passe d'application. Après un mot de passe refusé, l'intégration attend 30 minutes avant de réessayer (certains fournisseurs bloquent le compte après des échecs répétés) : enregistrez la configuration pour réessayer tout de suite.
- **« connexion sécurisée impossible »** : le port et la sécurité ne correspondent pas (993 avec TLS, 143 avec STARTTLS), ou le certificat est auto-signé : cochez « Accepter un certificat auto-signé » uniquement pour un serveur à vous.
- **« le serveur de messagerie ne répond pas »** : mauvaise adresse de serveur, ou Gladys n'a pas accès à Internet. L'intégration se reconnecte d'elle-même, avec un délai croissant jusqu'à 5 minutes.
- **« Dossiers introuvables »** : le nom du dossier doit être celui du serveur, avec son parent (`Travail/Alertes` ou `Travail.Alertes` selon le serveur).
- **Pas de déclenchement pour un ancien mail** : c'est voulu, seuls les mails arrivés après le premier démarrage déclenchent.
- **Un mail déplacé dans un dossier surveillé** y compte comme un nouveau mail.
- Journaux détaillés : définissez la variable d'environnement `LOG_LEVEL=debug` ; les expéditeurs et les objets apparaissent alors dans les journaux, jamais le mot de passe.

## Limites

- Trois boîtes mail, cinq dossiers par boîte mail.
- Temps réel sur le premier dossier seulement ; les autres suivent l'intervalle de vérification.
- Les filtres de l'éditeur de scènes comparent l'égalité : « l'objet contient » passe par les mots-clés de la configuration.
- Pas de connexion OAuth2 (les comptes Gmail et Microsoft demandent un mot de passe d'application ; certains comptes professionnels Microsoft 365 les désactivent).
- Pas de pièce jointe, pas de contenu au-delà de l'extrait de 200 caractères, pas d'envoi (voir gladys-smtp).
- Le serveur mail est un service distant : l'intégration dépend de lui et de la connexion Internet.
