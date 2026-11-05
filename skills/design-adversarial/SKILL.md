---
name: design-adversarial
description: Adversarial review of a design before implementation, and of the implementation against that design afterwards. A reviewer in a context separate from the one that wrote the design (agent lanekeeper:design-adversary, a strong model, read-only) checks the design text against the code it cites, line by line, and returns findings as high, medium or low, each with file:line evidence and a direction for the fix, ending with the line "high N". The design is revised in numbered revisions (rev 2, rev 3 …), each revision marks the paragraphs it changed and carries a reconciliation table (finding → accepted or not accepted → where it was applied, with the reason when not accepted), and every revision is reviewed again. Implementation starts only at "high 0". Owner decisions found in the design are collected and confirmed separately. A UX design or mockup is reviewed on the nine axes of /lanekeeper:quality-ux-adversarial. After the implementation, one more adversarial review reads the code and checks that the design's invariants hold. Use when the user runs /lanekeeper:design-adversarial, when a design document is ready and implementation is about to start, when a design was revised, or when an implementation built from a reviewed design is finished.
---

# Lanekeeper design-adversarial

A design that reads well can still be wrong about the code it changes. This review catches that before any implementation lane starts, and checks the result once more when the implementation is done.

| Stage | When | Question | Pass |
|---|---|---|---|
| Design review | a design document (or a revision of it) is ready, before implementation | Does the design hold against the real code, and is anything missing, ambiguous or risky? | `high 0` on the newest revision |
| Implementation review | the implementation of that design is finished, before integration and before ship verification | Does the code do what the design says, and do the design's invariants hold? | `high 0` |

## Rules

1. Separate context. The reviewer did not write the design: agent `lanekeeper:design-adversary` (routing task `adversarial`; pass the model that `lanekeeper-route resolve adversarial --implementer <model>` prints. That is `"opus"` by default. When your routing adds a higher model such as `"fable"`, it comes first unless it wrote the design). The session that wrote the design does not review it.
2. Read-only. The reviewer writes its review into its result folder and nothing else. It does not edit the design, the code or the tests, and does not commit.
3. Check the code, not only the sentences. Every place the design cites (file, function, table, route, setting) is opened and compared with what the design says about it. A claim the reviewer could not check against the code is written as such.
4. Every finding has: severity (high, medium, low) → what is wrong, in one sentence → evidence as `path:line` (the design paragraph and the code it contradicts) → the direction of the fix. The last line of the review is `high N` (N = open high findings).

   | Severity | When |
   |---|---|
   | high | building it as written breaks behaviour, loses or corrupts data, opens a security or permission gap, contradicts the code it cites, or leaves a decision that implementation cannot make on its own |
   | medium | a gap or ambiguity an implementer would have to guess about; a missing test, migration or rollback step |
   | low | wording, structure, a missing reference that does not change the result |

5. Revisions. The author revises the design as rev 2, rev 3 … and does not overwrite the previous one silently. Each revision:
   - marks every changed paragraph with its revision (for example `[rev 2]`);
   - carries a reconciliation table: finding → accepted or not accepted → where it was applied; a finding that is not accepted states the reason with evidence;
   - is reviewed again by a fresh reviewer.
6. Short re-review. A revision that only fixes high findings may be re-reviewed on those findings alone, but the reviewer always checks whether the revision added a new risk (changed paragraphs, the code they now cite, and what depends on them).
7. Implementation starts only when the newest revision has `high 0`. Medium and low findings are either applied or written into the reconciliation table with a reason.
8. Owner decisions. Points in the design that need the owner (scope, wording on screen, a trade-off, a design change) are collected into one list and put to the owner with `/lanekeeper:decide`. Implementation does not decide them by default.
9. UX design and mockups. When the design covers screens, the reviewer also checks the screen flows and mockups on the nine axes of `/lanekeeper:quality-ux-adversarial` (logic errors, information consistency, user context, flow context, a first-time user getting lost, the next action, a way out of errors and exceptions, accessibility with narrow width and dark theme, design system visual comparison), with the same personas and task scenarios walked through on paper or on the mockup.
10. Implementation review. When the implementation is done, a fresh reviewer reads the changed code against the final revision: every invariant the design states (what must always hold: permissions, data integrity, ordering, limits, compatibility) is checked in the code, with `path:line`. Its findings and its `high N` line are an input to integration and to `/lanekeeper:ship-verify`.

## Steps

1. Settle the inputs: the design document and its revision, the base commit, the code areas it cites, recorded decisions, the result folder (scratch, not committed) and the report language (`personal.language`).
2. Write the brief from [references/brief.ko.md](references/brief.ko.md) or [references/brief.en.md](references/brief.en.md) and fill every `{{…}}`; set the stage to `design` or `implementation`. The dispatch guard checks the cover, the sections and the model.
3. Dispatch `lanekeeper:design-adversary`. It writes `review-rev<N>.md` in the format of [references/review.md](references/review.md).
4. Read the review and spot-check two findings against the code. A finding without `path:line` evidence goes back to the reviewer.
5. Revise the design (rev N+1) with the revision marks and the reconciliation table. Put the owner decision list to the owner.
6. Review again (step 3), in full or, when the revision only fixed high findings, on those findings plus the new risks of the revision. Repeat until `high 0`.
7. Start the implementation lanes with the final revision named in the brief.
8. When the implementation is finished, dispatch a fresh reviewer at stage `implementation`. Fix its high findings in the lane (return brief) and review again until `high 0`. Hand the result to `/lanekeeper:review-lane` and `/lanekeeper:ship-verify`.
9. Report to the owner as an artifact: the revision history, `high N` per revision, the reconciliation table of the final revision, the owner decisions and their answers.

## Do not

- Do not let the session that wrote the design review it, and do not let the reviewer edit the design or the code.
- Do not start implementation while the newest revision has an open high finding.
- Do not drop a finding or lower its severity to reach `high 0`. A finding leaves the count only by being applied, or by "not accepted" with a reason the next reviewer can check.
- Do not decide an owner decision inside the design or the implementation.
