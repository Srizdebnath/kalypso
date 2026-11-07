# Reach

**Who is it for?** Builders on Arkiv who handle personal or regulated data: health records, KYC/eligibility, HR, private messages, anything covered by GDPR's right to erasure. Today they can't use a public DB-chain for it. Kalypso is a library (`@arkivzk/sdk`), not just an app, so any Arkiv project can adopt it.

**Can they try it today?** Yes: the web app (vault → prove → verify → shred) runs against Arkiv Rabdi, and every proof and receipt has a public verify link anyone can open without a wallet.

**Would they use it?** The two things it unlocks — "prove a fact without revealing data" and "provable erasure" — are exactly what blocks personal data from public chains. We expect early users in eligibility checks (age/country gating) and data-retention-sensitive apps.

**After Mumbai:** relayer-based ephemeral signers (hide the wallet link), TEE-attested guardians, blind-index search and more circuits (set membership, nullifiers). The library API stays stable.
