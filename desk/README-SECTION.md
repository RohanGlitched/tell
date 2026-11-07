<!-- Proposed section for the main README, after "Evidence". Not yet merged into README.md. -->

## Tell Desk: disclosure and grades on Midnight

Finding a leak is half the job; telling the team without telling everyone else is the other half. [**Tell Desk**](desk) is a Compact contract for private, provable responsible disclosure, and the on-chain registry of Tell's grades.

- **Seal.** A researcher seals a finding: the public ledger keeps a commitment to the report's SHA-256 and the project it is about, a researcher tag that is different on every report, and the time. Not the content, not the project, not the researcher.
- **Acknowledge and fix.** The maintainer proves in zero knowledge that they hold a credential registered for the project the sealed finding is about (a Merkle membership proof) and that they received this exact report. The chain shows that a registered maintainer answered; not which one, not which project.
- **Reveal.** After the fix, or after a 90-day embargo, either side opens the seal. Anyone with the published text can check it against the on-chain digest: proof the finding existed, unchanged, when it was sealed.
- **Grades.** Tell's attester key records `code hash → grade, rules version, scan` so wallets and dApps can read a contract's grade from the chain; maintainers can publish their own, flagged as self-reported.

Tell scans Desk too: grade **A**, nothing above info. The attacker tests in [`desk/test`](desk/test) read only public data (ledger state and every transaction's public transcript) and show that two reports by one researcher share no public value, that the report digest and the project id appear nowhere before the reveal, and that two acknowledgements by one maintainer share only the tree root every maintainer uses. What is public and why, every `disclose()` justified, and the threat model: [`desk/README.md`](desk/README.md).
