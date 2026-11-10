# Translation review notes (A14)

The six catalogs were drafted by a model, then reviewed on 2026-11-10 by an independent model pass per language
(each review.ts text translated back to English and compared). Those passes fixed 56–79 messages per language.
What they could not settle, for the next pass (Gemini, or a native speaker):

## All languages
- Generic masculine left where no `{name}` is involved (e.g. milestones "sits", "your child"); `{name}` texts were made neutral.
- "Passphrase" is translated as the common word for password (Passwort, contraseña, mot de passe, wachtwoord, password, senha).
- `sync.newPhone.body`: `{phones}` can be a list of names; check the verb reads right with one and with two phones.

## German (de)
- `feed.formula`: "Säuglingsmilch" vs "Pulvermilch"; `diaper.dirty`: "Voll" vs "groß"/"Stuhl".
- `schedule.disclaimer`: "eurer Kinderärztin oder eurem Kinderarzt" (du/euer mix).
- `editor.parent` "Eltern" next to "Selbst gegessen"; "Oma und Opa" replaced "die Großeltern" (tone).
- `percentile.*`: "<0,1. Perzentile" for the lowest band.

## Spanish (es)
- "Toca" for a due dose (`home.dueAt`, `home.dueTomorrow`) is colloquial; "Próxima: a las {time}" may read better in Latin America.
- `home.overdue` "Con {span} de retraso"; `home.ago` "atrás · …" (natural in Latin America, less in Spain).
- "Orinal" (Spain) vs bacinica/pelela; "marrón" vs "café"; "media" vs "promedio"; "recuadro" vs "tarjeta" for a tile.
- Present perfect ("se ha dormido") leans Spain; Latin America prefers "se durmió".

## French (fr)
- `home.ago` "écoulé · {detail}" under the big "2 h 15 min" on the tile: needs a wording that fits, checked on a device.
- `schedule.disclaimer`: "pédiatre" alone, or "votre pédiatre ou médecin" (many babies are followed by a GP or PMI).
- Diaper "Pipi / Selles" vs potty "pipi / caca"; "Abandonner" vs "Supprimer" for discarding a sleep.
- "stores", "build de dev", "Galerie": fine in France, less so in Quebec.

## Italian (it)
- "Veglia" / "in veglia" replaced "sveglio" (gender); a bit formal, generic masculine is the alternative.
- `home.dueAt` / `home.dueTomorrow` "Alle {time}" next to the drug name: does it read as the next dose's time?
- Terms: "Fortificato", "Circonferenza cranica", "Estrazione" vs "Tiralatte", "Pappa/Pappe" for solids; Subby treated as feminine.

## Dutch (nl)
- "gezin" vs "familie" (grandparents' phones join too); "Aansluiten bij een gezin".
- "Flesvoeding" vs Flemish "kunstvoeding"; `schedule.disclaimer` "een arts of het consultatiebureau" (Flanders: Kind en Gezin).
- Anglicisms "loggen", "item", "Up-to-date"; "wakkere periode", "Langste stuk".

## Portuguese, Brazil (pt-BR)
- `feedSheet.fortified` "Enriquecido" vs "aditivado"; "Extração" vs "ordenha"; "Tempo de bruços" vs "tummy time".
- Masculine defaults on short labels ("Acordado", "Ativo"); night wakings as "despertares".
- "bloco" for a tile; `reminders.openSettings` "Ajustes" (Android calls it Configurações).
- Milestones: compare with an official Portuguese "Learn the Signs" version if one exists.
