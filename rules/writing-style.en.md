# Writing style rules

The style for each kind of file comes from `style.map` in `.wb/config.json`. The rules per style follow.

## haeyo
For: screen text, in-app manual, help, notices. (The name is the Korean polite-friendly register; in English use plain second-person sentences.)

- Write short, polite, direct sentences. Say "Save the file", not "You may wish to save".
- Keep one topic per screen. Put the action or value the user cares about first.
- Titles are statements or noun phrases. Do not write question titles.
- Do not decorate with extra explanation. Button labels and hints name the action as it is.
- Do not chain sentences with dashes. Split them.
- No abbreviations or developer terms. Follow the project glossary when one exists.
- The text must not sound machine-written. Avoid "easy and fast", "powerful" and the like.

## report
For: developer documents, reports, certification papers, release documents.

- Plain declarative business tone.
- Current state or problem first, then the approach, the main content, then the impact.
- One fact per sentence.
- Do not narrate the work. No "Let us analyze" or "We have fixed".
- Replace unsupported judgments (efficient, stable, fast) with figures or facts, or drop them.
- Replace developer slang with business terms. No hype or metaphors (brain, engine, powerful).
- Mark what was not confirmed as "unconfirmed". Do not fill gaps with guesses.

## plain
For: files that match neither of the above.

- Short sentences. Follow the wording and terms already in the file.
- No emoji or decoration.
