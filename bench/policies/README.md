# Declared-intent policy for the `tell-policy` run

`tell.json` here is what the `tell-policy` configuration passes with `--policy`. It writes down, in Tell's policy format, intent that a file's own header states and that Tell cannot infer from the code. The plain `tell` run uses `--no-policy`.

| File | Entry | Why |
|---|---|---|
| `cases/S07-key-hashed.compact` | `circuits.enroll.once: true` | the header says "one device, one tag": each device key is enrolled once, so the stored tag does not line up repeated actions |

Only one file has an entry. It was written after the first benchmark run showed S07 as Tell's one medium false alarm, so treat the `tell-policy` row as "what a user who declares intent gets", not as an independent result. The other false alarm of that run (S05, info) was fixed in the analysis itself, without a policy: a value computed on one side of a branch no longer counts as a published yes/no fact, because the branch rule already judges which side ran (and drops branches that look the same both ways).

Nightshade's policy run is the analogue on its side; its policy is generic (every witness secret), not written per file.
