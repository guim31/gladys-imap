# IMAP Mail

Mach aus den E-Mails, die du empfängst, Szenenauslöser in Gladys: Überwache bis zu drei IMAP-Postfächer, reagiere auf eine E-Mail von einem bestimmten Absender, einer Domain oder aus einem Ordner, oder deren Betreff ein Stichwort enthält, und gib Absender, Betreff und einen kurzen Auszug an die Szene weiter. Jedes Postfach wird außerdem ein Gerät mit seinem Ungelesen-Zähler, und ein Dashboard-Widget listet die neuesten E-Mails auf.

Diese Integration **empfängt** E-Mails. Um E-Mails aus Gladys zu **senden**, nutze die offizielle [SMTP-Integration](https://github.com/GladysAssistant/gladys-smtp) (gladys-smtp).

Getestet mit einem GreenMail-Testserver, noch nicht mit allen Anbietern: Rückmeldungen sind willkommen in [den Issues](https://github.com/guim31/gladys-imap/issues).

## Was die Integration macht

- **Echtzeit**: Der erste überwachte Ordner jedes Postfachs wird per IMAP IDLE verfolgt, eine neue E-Mail löst ihren Auslöser innerhalb von ein, zwei Sekunden aus. Die anderen Ordner und Server ohne IDLE werden im gewählten Intervall geprüft.
- **Nur lesend**: Nichts wird gesendet, verschoben, gelöscht oder als gelesen markiert, außer durch die Szenenaktion „Als gelesen markieren“, wenn eine Szene es verlangt. Die E-Mails werden mit `BODY.PEEK` gelesen, das sie ungelesen lässt.
- **Nur neue E-Mails**: Beim ersten Start lösen die bereits vorhandenen E-Mails nichts aus. Nach einem Neustart lösen die in der Zwischenzeit empfangenen E-Mails aus (höchstens 20 pro Ordner, die neuesten).
- **Nichts wird gespeichert**: Die Integration speichert nur die Nummer der zuletzt gesehenen E-Mail jedes Ordners, unter `/data`. Kein Betreff, kein Absender, kein Inhalt.

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer.
- Ein von Gladys aus erreichbares IMAP-Konto: die Serveradresse, der Benutzer (meist die E-Mail-Adresse) und das Passwort.
- **Gmail, Outlook, iCloud, Yahoo**: ein **App-Passwort**, erstellt in den Sicherheitseinstellungen des Kontos (die Bestätigung in zwei Schritten muss aktiviert sein). Das normale Passwort wird von diesen Anbietern abgelehnt. Die Anmeldung per OAuth2 wird nicht unterstützt.

## Konfiguration

Fülle unter **Integrationen → IMAP Mail → Konfiguration** einen Block pro Postfach aus (bis zu drei):

| Feld                                    | Bedeutung                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| IMAP-Server                             | z. B. `imap.gmail.com`, `outlook.office365.com`, `imap.mail.me.com`. Leer lassen, um den Block zu deaktivieren.                    |
| Port                                    | 993 für TLS (Standard), 143 für STARTTLS.                                                                                          |
| Sicherheit                              | TLS oder STARTTLS. Ein Server, der keines von beiden anbietet, wird abgelehnt: Das Passwort geht nie im Klartext über die Leitung. |
| Benutzer                                | Meist die vollständige E-Mail-Adresse.                                                                                             |
| Passwort                                | Das (App-)Passwort. Von Gladys als Geheimnis gespeichert, nie in die Protokolle geschrieben.                                       |
| Zu überwachende Ordner                  | Durch Kommas getrennt, höchstens 5, standardmäßig `INBOX`. Der erste läuft in Echtzeit.                                            |
| Selbstsigniertes Zertifikat akzeptieren | Nur für einen eigenen Server, dessen Zertifikat du selbst erstellt hast.                                                           |

Dann die Optionen:

- **Betreff-Stichwörter**: durch Kommas getrennte Wörter (z. B. `Rechnung, Paket, Alarm`). Eine E-Mail, deren Betreff eines davon enthält, löst „Stichwort im Betreff einer E-Mail“ aus. Groß-/Kleinschreibung und Akzente werden ignoriert.
- **Einen kurzen Auszug an die Szenen geben**: die ersten 200 Zeichen des E-Mail-Texts (standardmäßig an). Wenn aus, verlassen nur Absender und Betreff den Mailserver.
- **Vollständige Prüfung alle**: 1, 2 (Standard), 5 oder 15 Minuten, für die anderen Ordner und die Ungelesen-Zähler.
- **Sprache der Namen und Meldungen**: standardmäßig Französisch.

Speichere, dann klicke auf **Verbindung testen**: eine Zeile pro Postfach, mit der Anzahl ungelesener E-Mails oder dem Grund des Fehlers.

### Anbieter

| Anbieter    | Server                  | Port, Sicherheit |
| ----------- | ----------------------- | ---------------- |
| Gmail       | `imap.gmail.com`        | 993, TLS         |
| Outlook.com | `outlook.office365.com` | 993, TLS         |
| iCloud      | `imap.mail.me.com`      | 993, TLS         |
| Yahoo       | `imap.mail.yahoo.com`   | 993, TLS         |
| Orange      | `imap.orange.fr`        | 993, TLS         |
| Free        | `imap.free.fr`          | 993, TLS         |

Gmail zeigt seine Labels als Ordner: `[Gmail]/Spam`, ein Label `Alarme` ist der Ordner `Alarme`.

## Geräte

Unter **Integrationen → IMAP Mail → Entdecken** erscheint jedes konfigurierte Postfach als Gerät, benannt nach seiner Adresse, mit einer Funktion: der Anzahl **ungelesener E-Mails** in seinen überwachten Ordnern. Füge es zu Gladys hinzu, um es auf dem Dashboard zu sehen, als Diagramm darzustellen oder in einer Szenenbedingung zu nutzen („mehr als 10 ungelesen“). Es folgt Änderungen von anderswo (eine auf dem Handy gelesene E-Mail) innerhalb des Prüfintervalls, beim ersten Ordner sofort.

## Szenenauslöser

Wähle in einer Szene **Integrationen**, dann einen dieser Auslöser. Ein leer gelassener Filter bedeutet „beliebig“.

### E-Mail empfangen

Eine neue E-Mail ist in einem überwachten Ordner angekommen. Filter: das Postfach, die **Adresse des Absenders** (exakt, in Kleinbuchstaben), die **Domain des Absenders** (was nach dem @ kommt, in Kleinbuchstaben) und der **Ordner** (wie in der Konfiguration geschrieben).

### Stichwort im Betreff einer E-Mail

Eine neue E-Mail, deren Betreff eines der Betreff-Stichwörter der Konfiguration enthält. Filter: das Postfach, das **Stichwort** (wie in der Konfiguration geschrieben; leer: beliebig) und die Adresse des Absenders. Ein Betreff mit zwei Stichwörtern löst den Auslöser zweimal aus, einmal pro Stichwort.

### An die Szene weitergegebene Informationen

Beide Auslöser geben weiter: Postfach, Ordner, Name des Absenders, Adresse des Absenders, Betreff, Auszug (leer, wenn ausgeschaltet), Empfangen am (Ortszeit, `2026-10-14 08:05`) und E-Mail-Referenz (für die Aktion „Als gelesen markieren“). „Stichwort im Betreff einer E-Mail“ fügt das gefundene Stichwort hinzu. Füge sie mit der Variablenauswahl in eine Nachricht ein.

## Szenenaktionen

### Anzahl ungelesener E-Mails lesen

Fragt den Server sofort nach der Anzahl ungelesener E-Mails eines Postfachs. Das Ergebnis, „Ungelesene E-Mails“, kann in einer Bedingung oder einer Nachricht der folgenden Aktionen verwendet werden.

### Als gelesen markieren

Markiert die E-Mail des Auslösers als gelesen. Wähle das Postfach und setze die Variable **E-Mail-Referenz** des Auslösers in das Feld „E-Mail-Referenz“. Nur diese E-Mail wird angefasst; hat der Server den Ordner inzwischen neu aufgebaut, schlägt die Aktion fehl, statt eine andere E-Mail anzufassen. Ergebnis: „Als gelesen markiert“.

## Widget

Füge das Widget **Neueste E-Mails** zu einem Dashboard hinzu: der Ungelesen-Zähler und die letzten 8 empfangenen E-Mails (Absender, Betreff, Uhrzeit; nie der Inhalt). Wähle in seinen Einstellungen ein Postfach oder lass das Feld leer, um alle zu sehen. Ein Postfach, das der Server ablehnt, zeigt eine rote Zeile.

## Szenenbeispiele

- **Paket zugestellt**: Stichwort `zugestellt` in der Konfiguration; Auslöser „Stichwort im Betreff einer E-Mail“ (Stichwort `zugestellt`); Aktion „Nachricht senden“: „📦 {{Betreff}} — {{Auszug}}“.
- **Alarm per E-Mail**: Auslöser „E-Mail empfangen“, Adresse des Absenders `alerts@my-nas.example`; Aktionen: das Flurlicht einschalten, eine Benachrichtigung mit dem Betreff senden; dann „Als gelesen markieren“ mit der E-Mail-Referenz.
- **Morgenübersicht**: Auslöser „Jeden Tag um 7:30“; Aktion „Anzahl ungelesener E-Mails lesen“; Bedingung „Ungelesene E-Mails“ größer als 0; Nachricht „Du hast {{Ungelesene E-Mails}} ungelesene E-Mails“.

## Fehlerbehebung

- **„Anmeldung abgelehnt“**: Prüfe Benutzer und Passwort. Gmail, Outlook und iCloud brauchen ein App-Passwort. Nach einem abgelehnten Passwort wartet die Integration 30 Minuten, bevor sie es erneut versucht (manche Anbieter sperren das Konto nach wiederholten Fehlversuchen): Speichere die Konfiguration, um es sofort erneut zu versuchen.
- **„sichere Verbindung fehlgeschlagen“**: Port und Sicherheit passen nicht zusammen (993 mit TLS, 143 mit STARTTLS), oder das Zertifikat ist selbstsigniert: Hake „Selbstsigniertes Zertifikat akzeptieren“ nur bei einem eigenen Server an.
- **„der Mailserver antwortet nicht“**: falsche Serveradresse, oder Gladys hat keinen Internetzugang. Die Integration verbindet sich von selbst neu, mit wachsender Wartezeit bis zu 5 Minuten.
- **„Ordner nicht gefunden“**: Der Ordnername muss der des Servers sein, mit seinem übergeordneten Ordner (`Arbeit/Alarme` oder `Arbeit.Alarme`, je nach Server).
- **Kein Auslöser für eine alte E-Mail**: Absicht, nur E-Mails, die nach dem ersten Start ankommen, lösen aus.
- **Eine in einen überwachten Ordner verschobene E-Mail** zählt dort als neue E-Mail.
- Ausführliche Protokolle: Setze die Umgebungsvariable `LOG_LEVEL=debug`; Absender und Betreffs erscheinen dann in den Protokollen, nie das Passwort.

## Grenzen

- Drei Postfächer, fünf Ordner pro Postfach.
- Echtzeit nur für den ersten Ordner; die anderen folgen dem Prüfintervall.
- Die Filter des Szeneneditors prüfen auf Gleichheit: „Betreff enthält“ läuft über die Stichwörter der Konfiguration.
- Keine Anmeldung per OAuth2 (Gmail- und Microsoft-Konten brauchen ein App-Passwort; manche Microsoft-365-Firmenkonten deaktivieren sie).
- Keine Anhänge, kein Inhalt über den Auszug von 200 Zeichen hinaus, kein Versand (siehe gladys-smtp).
- Der Mailserver ist ein entfernter Dienst: Die Integration hängt von ihm und von der Internetverbindung ab.
