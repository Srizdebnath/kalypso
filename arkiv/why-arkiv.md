# Why Arkiv

**If Kalypso sat on Postgres instead of Arkiv, what would users lose?**

- **Public verifiability without asking us.** A pharmacy, DAO or employer verifies "age ≥ 18" by reading the proof, the verification key and the commitment straight from Arkiv. In Postgres they would have to trust our API to tell the truth about all three.
- **An erasure receipt nobody can quietly delete.** Shred receipts (controller + guardian signatures) are public Arkiv entities. A database operator could edit or drop a receipt row.
- **Ownership.** Each record is owned by the user's wallet. Only that wallet can delete or extend it, and recovery on a new device works by querying Arkiv for entities owned by that wallet.
- **Expiry built in.** Arkiv's per-entity expiry is the backbone of our retention model: data on Arkiv expires and our guardians destroy keys at the same moment. In Postgres, "expiry" is a cron job you have to trust.
- **Proofs that can't outlive their data.** Each proof entity expires at the same block as its record, enforced by Arkiv, not by our code staying online.

**Why does a privacy project use a public database at all?** Because the hard part of privacy is not hiding data from the public (that's encryption), it's **proving facts and proving deletion to people who don't trust you**. That needs a shared public log. Arkiv is that log, with queries and expiry. Kalypso adds the missing half: confidentiality and real erasure.

**What we kept off Arkiv, and why**

| Kept off | Why |
|---|---|
| Plaintext | Arkiv history is forever. Even a deleted entity's calldata stays in every archive. |
| Keys and key shares | If a key ever touched Arkiv, crypto-shredding would be impossible. |
| Commitment salts | Inside the ciphertext, so shredding the key kills them too. |
| Large files | Swarm, encrypted with a key derived from the record key. |
| The record ↔ guardian id mapping | Only stored sealed (`envId`), readable by the owner alone. |
