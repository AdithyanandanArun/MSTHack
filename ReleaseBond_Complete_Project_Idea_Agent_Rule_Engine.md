# ReleaseBond --- Complete Project Idea

> **A security bounty and adversarial peer-review layer for individual
> software releases.**

**Hackathon:** MST Blockchain Buildathon\
**MVP ecosystems:** npm + pacman\
**Core loop:** **Fund → Hunt → Commit → Reveal → Reproduce/Refute →
Adjudicate → Pay → Patch → Repeat**

------------------------------------------------------------------------

## 1. Executive Summary

ReleaseBond turns an **individual software release** into a temporary,
funded security competition.

When a developer publishes a release such as `package-x@2.4.1`, they can
register the **exact artifact hash** on ReleaseBond and lock an MST
bounty pool behind that release. Verified human security researchers
then have a defined period to attack that exact version.

During the hunt, researchers work independently and submit findings
privately. A cryptographic commitment to each finding is recorded on
MST, giving the researcher timestamped evidence of discovery without
publicly exposing the vulnerability.

After the hunt closes, findings enter a structured adversarial
peer-review process. Other verified researchers can reproduce, refute,
partially reproduce, add evidence, identify duplicates, challenge
severity, and discuss edge cases. A hybrid **Agent + Rule-Based Evidence
Engine** analyzes the exact release and reruns reproductions from two
complementary directions. The AI security agent reasons across code,
release diffs, dependencies, researcher claims, and execution traces to
identify suspicious behavior, propose targeted follow-up tests, detect
missing evidence, and challenge weak conclusions. The deterministic rule
layer independently records objective facts such as network connections,
filesystem access, process creation, environment-variable access,
package integrity, and artifact hashes.

The agent can investigate and reason, but it cannot declare a finding
valid or move money. Deterministic evidence, adversarial human peer
review, and moderator adjudication remain the final authority.

A qualified human security moderator reviews the complete evidence and
discussion, adjudicates each finding, assigns severity where
appropriate, identifies duplicates and material review contributions,
and finalizes the award state.

The MST smart contract already holds the bounty. Once adjudication is
finalized, predefined settlement rules distribute rewards to valid
discoverers and, where appropriate, meaningful peer-review contributors.

The central idea is:

> **Developers fund the attack of a specific release. Human researchers
> try to break it. Other researchers try to prove or disprove the
> findings. AI agents investigate and challenge hypotheses,
> deterministic rules collect reproducible facts, and humans make the
> security judgment. MST handles escrow, commitments, settlement, and
> auditable reputation.**

------------------------------------------------------------------------

# 2. The Problem

Software is updated constantly. A new release can introduce:

-   malicious or compromised install behavior,
-   credential access,
-   unexpected network communication,
-   dangerous filesystem behavior,
-   vulnerable dependencies,
-   supply-chain attacks,
-   security regressions,
-   or ordinary vulnerabilities.

Security scanners, provenance systems, static analyzers, fuzzers,
audits, and bug-bounty platforms already exist. ReleaseBond does not
pretend otherwise.

The problem ReleaseBond targets is the **incentive gap around individual
releases**.

A package can ship a new version that thousands of users may quickly
install while relatively few skilled researchers have an immediate
financial reason to deeply attack that exact version.

ReleaseBond changes that:

> **"Version 2.4.1 has 500 MST locked against it. Here is the exact
> artifact. You have seven days. Break it."**

------------------------------------------------------------------------

# 3. The Core Concept: Security at Release Level

ReleaseBond reviews exact artifacts, not vague project names.

``` text
package-x@2.4.0
    ↓
review completed

package-x@2.4.1
    ↓
NEW ARTIFACT
NEW HASH
NEW SECURITY ROOM
NEW BOUNTY
NEW REVIEW

package-x@2.4.2
    ↓
NEW ARTIFACT AGAIN
NEW REVIEW
```

A successful review of `2.4.1` does **not** mean `2.4.2` inherits that
result.

New code means a new security surface.

------------------------------------------------------------------------

# 4. What ReleaseBond Is Not

ReleaseBond is not:

-   an AI malware judge,
-   an AI-vs-human bounty competition,
-   a popularity-based vulnerability voting system,
-   a decentralized network of anonymous verifier nodes,
-   a claim that a reviewed package is universally safe,
-   a replacement for security professionals,
-   a package manager,
-   or simply a normal bug-bounty website with a wallet button.

It is an **artifact-specific bounty + adversarial peer-review
protocol**.

------------------------------------------------------------------------

# 5. The Actors

## 5.1 Developer / Publisher

The developer:

1.  publishes a software release,
2.  registers the exact artifact,
3.  chooses a review period,
4.  locks an MST security bounty,
5.  receives valid disclosures,
6.  patches accepted issues,
7.  and can fund the next release again.

Example:

``` text
Package: fast-json
Version: 3.7.0
Ecosystem: npm
SHA256: 71ac98...
Review duration: 7 days
Security pool: 500 MST
```

------------------------------------------------------------------------

## 5.2 Verified Human Security Researcher

Researchers are the bounty hunters.

They can use:

-   manual review,
-   static analysis,
-   dynamic analysis,
-   fuzzers,
-   debuggers,
-   reverse engineering,
-   dependency analysis,
-   version diffs,
-   custom scripts,
-   AI coding/security assistants,
-   and ReleaseBond's evidence tooling.

AI is a **tool used by the researcher**, not an independent bounty
participant.

The human researcher submits the finding and receives the bounty.

------------------------------------------------------------------------

## 5.3 Agent + Rule-Based Evidence Engine

ReleaseBond uses a **hybrid evidence engine** rather than trusting
either AI or fixed rules alone.

### Agent Layer

The AI security agent can:

-   inspect source/package contents,
-   compare the new release against the previous release,
-   reason across dependency changes,
-   inspect install scripts and unusual code paths,
-   analyze runtime traces,
-   correlate network, filesystem, process, and environment events,
-   inspect a researcher's PoC and reproduction instructions,
-   identify missing evidence or alternative explanations,
-   propose additional reproduction steps,
-   generate targeted test cases,
-   and flag suspicious behavior that fixed rules may not anticipate.

The agent is **not trusted as the final judge**. An LLM conclusion such
as "This looks malicious" is never enough to trigger a bounty.

### Deterministic Rule Layer

The rule layer independently:

-   fetches the exact artifact,
-   verifies its cryptographic hash,
-   creates an isolated environment,
-   executes reproduction steps,
-   records network activity,
-   records filesystem behavior,
-   records process creation,
-   records environment-variable access,
-   records package integrity and metadata,
-   and produces deterministic execution logs.

Example:

``` text
Artifact: SHA256 71ac98...
Command: npm install

FILESYSTEM
READ /home/test/.ssh/id_rsa

PROCESS
node postinstall.js

NETWORK
POST 185.x.x.x:443

ENVIRONMENT
READ AWS_SECRET_ACCESS_KEY
```

### How They Work Together

``` text
Researcher finding / package release
                ↓
        AI SECURITY AGENT
                ↓
   reasons, searches, correlates,
   proposes tests and challenges
                ↓
       DETERMINISTIC RULE ENGINE
                ↓
   executes tests and records facts
                ↓
        AGENT CROSS-ANALYSIS
                ↓
 explains traces, identifies gaps,
 proposes targeted follow-up tests
                ↓
       RULE ENGINE RERUNS TESTS
                ↓
      structured evidence package
                ↓
       HUMAN PEER REPRODUCTION
                ↓
         SECURITY MODERATOR
```

The separation is:

> **The agent investigates. The rules ground claims in observable facts.
> Humans adjudicate.**

This gives ReleaseBond broader investigation than a rules-only system
without making AI opinion equivalent to proof.

------------------------------------------------------------------------

## 5.4 Security Moderator / Judge

A qualified security moderator reviews:

-   the original finding,
-   proof of concept,
-   reproduction instructions,
-   independent reproductions,
-   refutations,
-   automated evidence,
-   severity arguments,
-   duplicate reports,
-   developer response,
-   and the discussion.

They issue a transparent adjudication such as:

``` text
Finding #18

VALID: YES
SEVERITY: CRITICAL

Original finder:
Researcher #821

Independent duplicate:
Researcher #192

Material review contributor:
Researcher #553

Reasoning:
[moderator explanation]
```

The moderator decides the security question.

The moderator does **not** personally hold the bounty funds.

------------------------------------------------------------------------

## 5.5 MST Smart Contracts

MST handles:

-   bounty escrow,
-   release registration,
-   artifact hashes,
-   finding commitments,
-   timestamps,
-   settlement,
-   reward records,
-   and reputation events.

MST does **not** determine whether code is malicious.

------------------------------------------------------------------------

# 6. Full Lifecycle

## Phase A --- Register and Fund

Developer publishes:

``` text
fast-json@3.7.0
```

ReleaseBond retrieves the exact artifact and calculates its hash.

``` text
Ecosystem: npm
Package: fast-json
Version: 3.7.0
Artifact: SHA256 71ac98...
Previous: fast-json@3.6.9
Bounty: 500 MST
Hunt: 7 days
```

The developer deposits 500 MST into the ReleaseBond contract.

Researchers can verify that the money exists **before doing the work**.

------------------------------------------------------------------------

# 7. Security Room

Every funded release gets a Security Room.

``` text
╔══════════════════════════════════════════╗
║ fast-json@3.7.0                         ║
║                                          ║
║ 500 MST SECURITY POOL                    ║
║ npm                                      ║
║ SHA256: 71ac98...                        ║
║ Hunt closes in 6d 14h                    ║
║                                          ║
║ Changes from 3.6.9                       ║
║ +17 files                                ║
║ +1 dependency                            ║
║ +438 / -129 lines                        ║
║                                          ║
║ Verified researchers hunting: 47         ║
╚══════════════════════════════════════════╝
```

This is the central workspace for that release.

------------------------------------------------------------------------

# 8. Researcher Identity

ReleaseBond is designed around verified human researchers.

Conceptually:

``` text
Real person
    ↓
strong identity verification
    ↓
one active researcher identity
    ↓
Researcher #821
    ↓
linked payout wallet
    ↓
security reputation
```

The goal is to make mass fake-account creation difficult.

Sensitive identity information should **not** be publicly written to the
blockchain.

The exact identity-verification provider and privacy model remain an
implementation decision.

------------------------------------------------------------------------

# 9. Hunt Phase

Researchers work independently.

They should not initially see each other's findings.

This prevents:

-   copying,
-   bounty sniping,
-   premature disclosure,
-   groupthink,
-   and researchers simply waiting to reproduce someone else's work.

Suppose Alice finds:

> `fast-json@3.7.0` unexpectedly accesses an SSH private key during
> installation.

She submits:

``` text
FINDING #18

Researcher: #821
Target: fast-json@3.7.0
Artifact: 71ac98...
Claimed severity: HIGH

Description:
Package accesses ~/.ssh/id_rsa
during postinstall.

PoC:
[...]

Reproduction:
[...]

Evidence:
[...]
```

The report remains private during the hunt.

------------------------------------------------------------------------

# 10. Finding Commitments on MST

A finding commitment can be calculated:

``` text
commitment =
HASH(
    artifactHash
    + findingHash
    + researcherWallet
    + secretNonce
)
```

Only the commitment goes on-chain initially.

``` text
Block 829182

Researcher:
0xAlice...

Commitment:
0x891ABC...
```

The vulnerability remains secret.

Later, Alice reveals the report and nonce. The commitment can be
recomputed, providing evidence that she possessed that exact finding at
the earlier timestamp.

This helps establish discovery priority without exposing a zero-day.

------------------------------------------------------------------------

# 11. Independent Duplicates

Bob may independently discover the same vulnerability without seeing
Alice's report.

Meanwhile:

``` text
Alice   → Finding A
Bob     → Finding A independently
Charlie → Finding B
David   → Finding C
Emma    → Finding D
```

Each can have a separate commitment.

The later reward system can distinguish independent duplicates from
copied reports.

------------------------------------------------------------------------

# 12. Hunt Closure and Responsible Disclosure

At the deadline:

``` text
HUNT CLOSED
```

The review moves to the next stage.

Dangerous findings should not instantly become public.

A responsible-disclosure flow can be:

``` text
private finding
      ↓
MST commitment
      ↓
hunt closes
      ↓
developer receives vulnerability details
      ↓
patch / mitigation window
      ↓
peer-review discussion opens safely
      ↓
eventual public disclosure
```

The exact disclosure timeline is still to be designed.

------------------------------------------------------------------------

# 13. Reddit-Style Adversarial Peer Review

After the appropriate reveal point, each finding becomes a structured
discussion thread.

Responses have technical types:

``` text
REPRODUCED
REFUTED
PARTIALLY REPRODUCED
ADDITIONAL EVIDENCE
DUPLICATE
SEVERITY CHALLENGE
CONDITION / EDGE CASE
```

Example:

``` text
┌──────────────────────────────────────────┐
│ FINDING #18                              │
│ Researcher #821                          │
│                                          │
│ SSH private-key access during install    │
│ Claimed severity: HIGH                   │
│                                          │
│ Upvotes: 74                              │
│ Reproduced: 9                            │
│ Refutations: 2                           │
└──────────────────────────────────────────┘

Researcher #821
│
│ Original PoC
│
├── #192 [REPRODUCED]
│   Reproduced on Ubuntu.
│
│   └── #402 [REPRODUCED]
│       Also reproduced in clean VM.
│
├── #514 [REFUTATION]
│   Only happens if configuration X exists.
│
│   └── #821
│       Here is a clean install without X.
│
│       └── #514
│           Confirmed. Refutation withdrawn.
│
└── #553 [ADDITIONAL EVIDENCE]
    The key is subsequently included
    in an outbound HTTP request.
```

This is **adversarial peer review**.

Researchers are not merely trying to support findings. They are
encouraged to attack the reasoning and expose incorrect conclusions.

------------------------------------------------------------------------

# 14. Likes / Upvotes

Reddit-style voting can exist for:

-   visibility,
-   sorting,
-   interesting discussions,
-   and community recognition.

But:

> **Likes never determine validity, severity, or payout.**

Otherwise popularity and collusion become financial attack vectors.

------------------------------------------------------------------------

# 15. Reproduction

A researcher can attempt to reproduce another finding.

Example:

``` text
REPRODUCTION #1282

Artifact:
71ac98... ✓

Finding:
#18

Environment:
ReleaseBond npm sandbox v1.2

Result:
Behavior reproduced

Observed:
READ ~/.ssh/id_rsa

Researcher:
#192
```

The finding can summarize:

``` text
Human reproductions:         9
Sandbox reproductions:       8/9
Refutations:                 2
Unresolved objections:       0
```

These are **evidence**, not an automatic vote.

------------------------------------------------------------------------

# 16. Agent + Rule-Based Evidence Engine for npm

The npm pipeline combines semantic investigation with deterministic
execution.

``` text
exact .tgz artifact
       ↓
verify SHA256
       ↓
AI agent inspects package + previous-version diff
       ↓
agent identifies suspicious code / hypotheses
       ↓
isolated npm environment
       ↓
rule engine runs npm install / reproduction trigger
       ↓
deterministic telemetry
       ↓
agent correlates traces and proposes follow-up tests
       ↓
rule engine executes follow-up tests
       ↓
structured evidence
```

The deterministic layer can record:

-   network destinations and ports,
-   processes responsible for connections,
-   files read/written/deleted,
-   shells and child processes spawned,
-   protected environment variables accessed,
-   package metadata,
-   lifecycle-script execution,
-   and artifact hash.

The agent can then reason over those facts, the package source,
dependency changes, and researcher PoC. Every important agent conclusion
should point back to concrete code, traces, or a reproducible test
wherever possible.

------------------------------------------------------------------------

# 17. Agent + Rule-Based Evidence Engine for pacman

The same architecture applies to pacman artifacts.

``` text
exact package artifact
       ↓
verify SHA256
       ↓
AI agent inspects metadata + package/version diff
       ↓
agent identifies suspicious behavior / hypotheses
       ↓
isolated pacman environment
       ↓
rule engine runs install / reproduction trigger
       ↓
deterministic telemetry
       ↓
agent analyzes traces and proposes follow-up tests
       ↓
rule engine executes those tests
       ↓
structured evidence
```

The normalized evidence model should remain as consistent as possible
between npm and pacman so the ReleaseBond core does not depend on one
ecosystem.

------------------------------------------------------------------------

# 18. Accuracy Architecture: Agent + Rules + Humans

Accuracy matters enormously because ReleaseBond affects both money and
reputation.

ReleaseBond therefore does **not** depend on one model, one rule, one
execution, or one person's opinion.

``` text
EXACT ARTIFACT HASH
        ↓
ISOLATED EXECUTION
        ↓
DETERMINISTIC TELEMETRY
        ↓
RULE-BASED CHECKS
        ↓
AI AGENT ANALYSIS
        ↓
AGENT PROPOSES TARGETED FOLLOW-UP TESTS
        ↓
RULE ENGINE EXECUTES THOSE TESTS
        ↓
FRESH-ENVIRONMENT REPRODUCTION
        ↓
OTHER HUMAN RESEARCHERS REPRODUCE / REFUTE
        ↓
MODERATOR REVIEWS COMPLETE EVIDENCE
        ↓
FINAL ADJUDICATION
```

## Why Both Agent and Rules?

A rules-only engine can be highly precise for known observable
behaviors, but it can miss unusual attack patterns that were never
encoded as rules.

An AI agent can reason across unfamiliar code and complex relationships,
but it can hallucinate or misinterpret behavior.

The responsibilities are therefore different:

``` text
AGENT
"What should we investigate?"
"How might these events be connected?"
"What evidence is missing?"
"What test would distinguish these hypotheses?"

RULE ENGINE
"What actually happened?"
"Which file was accessed?"
"Which process opened this connection?"
"Did the artifact hash match?"
"Did the behavior reproduce?"
```

The agent cannot override contradictory deterministic evidence.

## Repeated Execution

Important findings can be rerun in fresh environments.

``` text
Run 1 → reproduced
Run 2 → reproduced
Run 3 → reproduced
```

If the results are inconsistent:

``` text
Run 1 → reproduced
Run 2 → not reproduced
Run 3 → reproduced

STATUS → INCONCLUSIVE
```

ReleaseBond should surface uncertainty rather than pretending an
unstable result is definitive.

## Agent as an Adversarial Analyst

The agent should not merely try to confirm a researcher's claim.

Example:

``` text
Researcher:
"This package steals SSH keys."

Agent:
"The trace confirms an SSH-key read, but the current
evidence does not prove exfiltration. Run correlation
test T42."

Rule Engine:
Runs T42 and records the actual behavior.

Agent:
Updates analysis using the new deterministic evidence.
```

This allows the agent to strengthen **or weaken** a submitted claim.

## Confidence States

The UI should distinguish:

``` text
SUSPICIOUS
Agent found something worth investigating.
No bounty implication.

REPRODUCED EVIDENCE
Deterministic execution confirmed observable behavior.
Still requires interpretation.

ADJUDICATED FINDING
Human review accepted the security finding.
Eligible for settlement.
```

## No Claim of Perfect Accuracy

ReleaseBond should not claim mathematically perfect malware detection.

The defensible claim is:

> **Agent reasoning broadens the investigation, deterministic rules
> ground the analysis in observable facts, repeated execution tests
> reproducibility, peer researchers attack the conclusion, and
> accountable security moderators make the final judgment.**

That is stronger than either AI-only or rules-only verification.

------------------------------------------------------------------------

# 19. Why We Removed the "Verifier Nodes"

An earlier architecture was:

``` text
Researcher
    ↓
Verifier
    ↓
Smart contract
```

That caused an endless set of incentive problems:

-   Who are the verifiers?
-   Why do they spend time verifying?
-   Who pays them?
-   What prevents lazy verification?
-   What prevents lying?
-   What prevents collusion?
-   Who verifies the verifier?

The current system does not pretend arbitrary software-security judgment
can be made trustlessly by anonymous nodes.

**Human security judgment is explicitly human governance.**

Blockchain handles economic coordination instead.

------------------------------------------------------------------------

# 20. Moderator Adjudication

The moderator reviews the full record and finalizes findings.

Example:

``` text
Finding #18

Status: VALID
Severity: CRITICAL
Original finder: #821
Independent duplicate: #192
Material reviewer: #553

Reasoning:
[transparent explanation]
```

Or:

``` text
Finding #27

Status: INVALID

Reason:
The reproduction does not demonstrate
the claimed impact under the stated
conditions.
```

Moderator decisions and reasoning should be auditable.

For high-value production rooms, future versions may use multiple
moderators, appeals, and conflict-of-interest controls.

------------------------------------------------------------------------

# 21. Bounty Settlement

The moderator does not manually send money.

``` text
Moderator finalizes award state
            ↓
MST smart contract
            ↓
predefined settlement logic
            ↓
researcher wallets
```

The **exact payout percentages are not finalized yet**.

That should be designed only after testing the incentives.

------------------------------------------------------------------------

# 22. Reward Categories

## Discovery Reward

For discovering a valid vulnerability.

> "I found the problem."

## Review Contribution Reward

For materially improving the final security conclusion.

Examples:

-   independently reproducing an important finding,
-   successfully refuting an invalid claim,
-   identifying an important triggering condition,
-   strengthening a proof,
-   demonstrating additional impact.

> "I improved the reliability of the conclusion."

Discovery rewards should dominate so researchers are not incentivized to
stop hunting and merely wait for someone else's thread.

Not every reproduction should earn money.

------------------------------------------------------------------------

# 23. Duplicate Handling

If Alice and Bob independently discover the same issue during the hidden
hunt, both commitments provide useful evidence.

Possible factors for duplicate rewards include:

-   commitment time,
-   independent discovery,
-   report quality,
-   PoC quality,
-   material differences,
-   and contribution to the final understanding.

The exact formula remains open.

------------------------------------------------------------------------

# 24. Patch and New Release

Suppose:

``` text
fast-json@3.7.0
```

receives three accepted findings.

The developer fixes them and publishes:

``` text
fast-json@3.7.1
```

ReleaseBond shows:

``` text
3.7.0
Review complete
3 valid findings
500 MST distributed

        ↓

3.7.1
NEW ARTIFACT
NEW SHA256
review not inherited
```

The new version can open another Security Room.

------------------------------------------------------------------------

# 25. Release Security History

Over time:

``` text
fast-json

3.6.8   Reviewed
3.6.9   Reviewed
3.7.0   3 accepted findings
3.7.1   Reviewed after patch
3.7.2   Hunt active
```

This is a security-review history, **not a universal safety score**.

------------------------------------------------------------------------

# 26. Researcher Reputation

A verified researcher can accumulate:

``` text
Researcher #821

Verified Human

Valid discoveries:          27
Critical:                    4
High:                        9

Successful reproductions:   41
Successful refutations:      8
Findings later overturned:   2

Total earned:
4,821 MST
```

Possible reputation events include:

-   valid discovery,
-   severity,
-   successful reproduction,
-   successful refutation,
-   duplicate discovery,
-   rejected report,
-   overturned decision,
-   review contribution,
-   bounty payout.

Avoid reducing all of this to one simplistic "trust score."

------------------------------------------------------------------------

# 27. Developer / Project History

Example:

``` text
FastJSON Team

Releases reviewed:           31
Security pools funded:    8,420 MST
Critical findings:            2
High findings:                7
Accepted findings patched:  9/9
```

Again, this is historical evidence---not a guarantee.

------------------------------------------------------------------------

# 28. Cross-Ecosystem Architecture

ReleaseBond should use adapters.

``` text
npm adapter ──────┐
                  │
pacman adapter ───┼──► ReleaseArtifact
                  │
future PyPI ──────┤
future Cargo ─────┤
future APT ───────┤
future Docker ────┘
                         │
                         ▼
                  ReleaseBond Core
```

Normalized object:

``` json
{
  "ecosystem": "npm",
  "name": "package-x",
  "version": "2.4.1",
  "artifactHash": "sha256:...",
  "dependencies": [],
  "metadata": {},
  "previousArtifact": "sha256:..."
}
```

After normalization:

``` text
ReleaseArtifact
      ↓
Security Room
      ↓
Bounty
      ↓
Hunt
      ↓
Findings
      ↓
Peer Review
      ↓
Evidence
      ↓
Adjudication
      ↓
Settlement
      ↓
Reputation
```

The core protocol is shared between npm and pacman.

------------------------------------------------------------------------

# 29. What MST Does

## Bounty Escrow

``` text
Developer
    ↓
500 MST
    ↓
ReleaseBond Contract
```

Researchers can see that the reward is funded before working.

## Release Registration

On-chain state can reference:

``` text
release ID
artifact hash
ecosystem
package/version
bounty
review state
timestamps
```

## Finding Commitments

Private findings can receive public timestamps without exposing their
contents.

## Settlement

Finalized awards are distributed transparently from the escrow.

## Reputation Events

Important finalized security events can be anchored to
researcher/developer identities or wallets.

------------------------------------------------------------------------

# 30. What MST Does Not Do

MST does not:

-   execute npm/pacman packages,
-   understand arbitrary vulnerabilities,
-   determine maliciousness,
-   judge severity,
-   decide whether a refutation is convincing,
-   or replace security moderators.

The separation is:

``` text
OFF-CHAIN HUMAN SECURITY WORK
              +
ON-CHAIN ECONOMIC COORDINATION
```

------------------------------------------------------------------------

# 31. Blockchain-Removal Test

A centralized service could build much of the UI.

The structural blockchain roles are:

### Pre-funded escrow

Researchers independently verify that funds exist before doing work.

### Finding commitments

Researchers obtain timestamped discovery evidence without immediate
disclosure.

### Transparent settlement

Awards are paid through visible smart-contract state rather than opaque
internal accounting.

### Portable economic/reputation history

Security work and payouts can be anchored across ecosystems.

The project should never claim that blockchain itself verifies
vulnerabilities.

------------------------------------------------------------------------

# 32. Security Room State Machine

``` text
DRAFT
  ↓
FUNDED
  ↓
HUNTING
  ↓
HUNT CLOSED
  ↓
PRIVATE DISCLOSURE / PATCH WINDOW
  ↓
PEER REVIEW
  ↓
ADJUDICATION
  ↓
SETTLEMENT
  ↓
COMPLETE
```

Where appropriate, state transitions can be enforced by the contract.

------------------------------------------------------------------------

# 33. Anti-Gaming

## Fake Accounts

Mitigation:

-   strong identity verification,
-   one active researcher identity per person,
-   wallet linkage,
-   abuse monitoring.

## Vote Manipulation

Mitigation:

-   votes do not decide validity,
-   votes do not decide severity,
-   votes do not directly decide payout.

## Copying Findings

Mitigation:

-   hidden hunt phase,
-   commitments,
-   controlled reveal.

## Bounty Sniping

Mitigation:

-   timestamped commitments,
-   duplicate rules.

## Reproduction Farming

Mitigation:

-   discovery rewards dominate,
-   reproductions are not automatically paid,
-   only material contributions qualify.

## Collusion

Mitigation:

-   verified identities,
-   technical evidence,
-   transparent discussion,
-   moderator review,
-   auditable histories.

## Moderator Abuse

This remains a real governance risk.

Future controls:

-   public reasoning,
-   conflict-of-interest rules,
-   multiple judges for high-value rooms,
-   appeals,
-   moderator histories.

------------------------------------------------------------------------

# 34. Why Human Moderation Is Intentional

Questions such as:

-   Is this actually exploitable?
-   Is the behavior intended?
-   What conditions are necessary?
-   Does the claimed impact follow?
-   Is it Critical, High, Medium, or invalid?
-   Are two reports duplicates?
-   Did a reviewer materially improve the result?

often require expert interpretation.

Replacing these with token voting or anonymous verifier consensus does
not magically create correctness.

ReleaseBond therefore makes the trust model explicit:

> **Accountable humans adjudicate security. Smart contracts
> transparently coordinate the money.**

------------------------------------------------------------------------

# 35. AI's Role

AI has **two human-controlled roles** in ReleaseBond.

## 35.1 Researcher Assistant

Researchers can use AI alongside fuzzers, debuggers, static analyzers,
and other tools.

``` text
             HUMAN RESEARCHER
                    │
      ┌─────────────┼──────────────┐
      ▼             ▼              ▼
 AI assistant     Fuzzer      Static analyzer
      │             │              │
      └─────────────┼──────────────┘
                    ↓
             human investigates
                    ↓
             human submits
                    ↓
             human earns bounty
```

## 35.2 Evidence Analysis Agent

ReleaseBond itself runs a security-analysis agent over the exact
release, researcher report, and deterministic sandbox traces.

It can:

-   reason over code and package metadata,
-   analyze release diffs,
-   correlate events across traces,
-   detect suspicious combinations of otherwise-normal events,
-   propose targeted tests,
-   challenge unsupported researcher conclusions,
-   identify missing evidence,
-   and produce a structured explanation for reviewers and moderators.

But:

``` text
AI SAYS "VALID"
        ≠
VALID FINDING
```

The agent has no autonomous bounty identity, no payout wallet, and no
authority to finalize findings.

Its conclusions must be grounded through deterministic evidence and
human review.

> **AI expands the investigation. Rules ground the evidence. Humans own
> the judgment and bounty.**

------------------------------------------------------------------------

# 36. Possible Smart Contracts

For the MVP these may be separate or combined.

## ReleaseRegistry

-   register release,
-   store artifact hash,
-   track review state,
-   link bounty.

## BountyVault

-   receive MST,
-   lock bounty,
-   prevent unauthorized withdrawal,
-   execute settlement.

## FindingCommitmentRegistry

-   store commitment,
-   researcher address,
-   release ID,
-   timestamp/block information.

## ReputationRegistry

-   record finalized reputation events.

------------------------------------------------------------------------

# 37. Backend Architecture

``` text
                    FRONTEND
                       │
                       ▼
                ReleaseBond API
                       │
      ┌────────────────┼────────────────┐
      ▼                ▼                ▼
Package Service   Review Service   Identity Service
      │                │                │
      ▼                ▼                ▼
npm / pacman       findings /        verified
adapters             threads         researchers
      │
      ▼
Agent + Rule Evidence Engine
      │
      ├── AI Security Analysis Agent
      │
      └── Deterministic Rule / Telemetry Layer
      │
      ▼
Sandbox Workers

                       +
                       │
                       ▼
                MST Smart Contracts
```

------------------------------------------------------------------------

# 38. Main Frontend Surfaces

## Landing Page

> **Put a bounty on your release. Let verified researchers try to break
> it.**

## Active Security Rooms

``` text
npm     package-x@2.0     500 MST     HUNTING
pacman  package-y@1.4     250 MST     REVIEW
npm     package-z@5.1     800 MST     COMPLETE
```

## Release Room

-   artifact,
-   bounty,
-   timer,
-   previous version,
-   diff summary,
-   researcher count,
-   state.

## Researcher Dashboard

-   active hunts,
-   private findings,
-   commitments,
-   reviews,
-   reputation,
-   rewards.

## Finding Thread

-   report,
-   threaded reproductions/refutations,
-   evidence,
-   voting,
-   moderator result.

## Moderator Dashboard

-   pending findings,
-   evidence,
-   duplicate groups,
-   disputes,
-   adjudication,
-   settlement finalization.

## Developer Dashboard

-   releases,
-   bounty pools,
-   private disclosures,
-   remediation,
-   history.

------------------------------------------------------------------------

# 39. Hero Demo

## 1. Developer registers npm release

``` text
demo-package@2.0
SHA256: ABC123...
Bounty: 500 MST
```

Show MST transaction locking the bounty.

## 2. Researcher A submits private finding

Use a harmless test package with unexpected filesystem or network
behavior.

Hash/commit the finding on MST.

Show the transaction.

## 3. Reveal and peer review

After transitioning the demo room to review, display the finding thread.

## 4. Researcher B reproduces

Click:

``` text
REPRODUCE
```

Run the hybrid engine:

``` text
Artifact hash verified
Command: npm install

RULE ENGINE
READ /home/test/.ssh/demo_key
NETWORK POST → demo-endpoint

AGENT ANALYSIS
SSH-key access is reproduced.
Current evidence suggests a relationship between
the key read and outbound request.
Recommended follow-up: correlation test T42.

FOLLOW-UP RULE TEST
T42 reproduced in fresh environment.
```

Attach the deterministic trace and the agent's grounded analysis.

## 5. Researcher C challenges it

Submit a refutation or severity challenge.

Researcher A responds.

Show the Reddit-style adversarial thread.

## 6. Moderator adjudicates

Review the evidence.

Finalize:

``` text
VALID
Severity: HIGH
```

## 7. MST settles

Show the contract distributing the bounty.

``` text
500 MST
   ↓
smart-contract settlement
   ↓
discoverer reward
review contribution reward
...
```

Show transaction hash / explorer result.

## 8. Show pacman

Run the same core workflow with a pacman artifact or show the pacman
adapter feeding the same ReleaseArtifact model.

This demonstrates generalization.

------------------------------------------------------------------------

# 40. 30-Second Pitch

> **Every time a software package ships a new version, thousands of
> users may trust code that almost nobody was financially motivated to
> attack. ReleaseBond turns each release into a temporary security
> competition. A developer locks an MST bounty against the exact package
> artifact. Verified human security researchers privately hunt for
> vulnerabilities, then findings open into an adversarial peer-review
> room where other researchers reproduce and refute them using
> standardized evidence. A security moderator adjudicates the results,
> and the smart contract transparently distributes the locked bounty.
> Every release gets attacked instead of simply being trusted.**

------------------------------------------------------------------------

# 41. One-Line Pitch

> **ReleaseBond turns every software release into a funded adversarial
> security review.**

Alternative:

> **Put a bounty on your release. Let verified researchers try to break
> it before users have to trust it.**

------------------------------------------------------------------------

# 42. Core System Diagram

``` text
                 DEVELOPER
                     │
               publishes release
                     │
                     ▼
             EXACT ARTIFACT HASH
                     │
                     ▼
              MST BOUNTY LOCKED
                     │
                     ▼
════════════════ HUNT PHASE ════════════════

           VERIFIED HUMAN RESEARCHERS
                     │
                attack release
                     │
                     ▼
              PRIVATE FINDINGS
                     │
                     ▼
          HASH COMMITMENTS ON MST

═══════════════ REVIEW PHASE ═══════════════

               FINDINGS REVEALED
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      REPRODUCE    REFUTE     IMPROVE
          │          │          │
          └──────────┼──────────┘
                     ▼
            RULE-BASED EVIDENCE
                     │
                     ▼
             SECURITY MODERATOR
                     │
                     ▼
                ADJUDICATION

══════════════ SETTLEMENT PHASE ════════════

               MST SMART CONTRACT
                     │
             distributes bounty
                     │
           ┌─────────┴─────────┐
           ▼                   ▼
      DISCOVERERS          REVIEWERS
           │                   │
           └─────────┬─────────┘
                     ▼
                REPUTATION
                     │
                     ▼
               PATCHED RELEASE
                     │
                     ▼
              NEW SECURITY ROOM
```

------------------------------------------------------------------------

# 43. Potential Network Effects

More developers:

``` text
→ more funded releases
```

More funded releases:

``` text
→ more opportunities for researchers
```

More researchers:

``` text
→ more adversarial review
```

More completed reviews:

``` text
→ richer release and researcher histories
```

Eventually companies could consume ReleaseBond data in CI/CD or
dependency-review workflows.

ReleaseBond should remain a **decision-support signal**, not a magical
"safe" badge.

------------------------------------------------------------------------

# 44. Future Expansion

Possible ecosystems:

-   PyPI,
-   Cargo,
-   APT,
-   Docker/OCI,
-   Maven,
-   NuGet,
-   Git release artifacts.

Possible future features:

-   organization-funded pools,
-   community-sponsored reviews for critical open-source dependencies,
-   enterprise dependency watchlists,
-   CI/CD integration,
-   automated diff assistance,
-   stronger sandboxing,
-   multi-moderator panels,
-   appeals,
-   disclosure coordination,
-   security-review APIs,
-   optional trusted/verifiable execution for evidence collection.

------------------------------------------------------------------------

# 45. Product Language

Never say:

> **"This package is safe."**

Prefer:

> **"This exact release completed a ReleaseBond security review with a
> 500 MST bounty."**

or:

> **"No valid findings were accepted during this review."**

or:

> **"Three valid findings were identified and a patched release was
> subsequently published."**

A review produces evidence. It does not prove the absence of all
vulnerabilities.

------------------------------------------------------------------------

# 46. Current Open Decisions

These are deliberately **not finalized**.

## Bounty Formula

Need to decide:

-   severity weighting,
-   duplicate rewards,
-   review rewards,
-   unused bounty,
-   whether unused funds return or roll forward,
-   anti-farming rules.

## Moderator Governance

Need to decide:

-   who qualifies,
-   conflicts of interest,
-   appeals,
-   high-value-room requirements,
-   whether multiple moderators are needed.

## Identity Verification

Need to decide:

-   provider/mechanism,
-   privacy,
-   account recovery,
-   duplicate-account prevention.

## Disclosure

Need to decide:

-   patch window,
-   emergency disclosure,
-   public reveal timing,
-   uncooperative developer handling.

## Agent + Rule-Based Evidence Engine

Need to determine which agent analyses and exactly which deterministic
observations can be reliably and safely collected for npm and pacman.

## Novelty

ReleaseBond overlaps with bug-bounty and competitive-audit platforms.

The intended differentiation to validate is:

> **Exact-artifact release rooms + hidden discovery commitments +
> adversarial reproducibility/refutation threads + cross-ecosystem
> release security history + on-chain escrow/settlement/reputation.**

Do not claim strong novelty until this has been researched against
existing systems.

------------------------------------------------------------------------

# 47. Design Principles

1.  **Human-first security research** --- AI assists; humans
    participate.
2.  **Exact artifacts** --- every review refers to an immutable release
    hash.
3.  **Economic incentive** --- researchers have a reason to attack new
    releases.
4.  **Adversarial review** --- findings should survive attempts to
    disprove them.
5.  **Evidence over popularity** --- likes never decide technical truth.
6.  **Agents investigate; rules ground; humans judge** --- AI expands
    the investigation, deterministic telemetry establishes observable
    facts, and humans adjudicate.
7.  **Blockchain only where useful** --- escrow, commitments,
    settlement, history.
8.  **Responsible disclosure** --- never turn review into zero-day
    publication.
9.  **Generalization** --- npm and pacman are adapters to one protocol.
10. **Transparent uncertainty** --- reviewed does not mean
    vulnerability-free.
11. **No fake decentralization** --- do not invent verifier networks
    just to appear Web3.
12. **Auditable governance** --- human moderation must be accountable.

------------------------------------------------------------------------

# 48. Final Project Definition

**ReleaseBond is a release-level security bounty and adversarial
peer-review protocol. Developers attach MST-funded bounty pools to exact
software artifacts. Verified human security researchers privately hunt
for vulnerabilities and timestamp discoveries through cryptographic
commitments. After the hunt, findings enter structured peer-review rooms
where researchers reproduce, refute, strengthen, and debate each other's
work using a hybrid Agent + Rule-Based Evidence Engine that combines AI
security reasoning with deterministic sandbox telemetry. Qualified
security moderators adjudicate the final findings, while MST smart
contracts transparently escrow and distribute rewards and record
security-reputation events. Each new software release creates a new
review opportunity, producing an auditable security history across
package ecosystems such as npm and pacman.**

The complete loop is:

``` text
FUND
  ↓
HUNT
  ↓
COMMIT
  ↓
REVEAL
  ↓
REPRODUCE / REFUTE
  ↓
ADJUDICATE
  ↓
PAY
  ↓
PATCH
  ↓
NEW RELEASE
  ↓
REPEAT
```

**That is ReleaseBond.**
