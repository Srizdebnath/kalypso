# 02 · Architecture

## 2.1 Library layout (monorepo)

```mermaid
flowchart TB
    subgraph APP["Your dApp / backend"]
        A1[App code]
    end

    subgraph ARKIVZK["arkivzk (npm workspace)"]
        SDK["@arkivzk/sdk<br/>high level API: put / get / prove / verify / shred"]
        CORE["@arkivzk/core<br/>schemas, envelope format, padding, ephemeral signers"]
        CRYPTO["@arkivzk/crypto<br/>AES-256-GCM, HKDF, X25519 + ML-KEM-768, Poseidon"]
        ZK["@arkivzk/zk<br/>Noir circuits + prover/verifier wrappers"]
        VAULT["@arkivzk/vault<br/>key hierarchy, threshold shares, key rotation"]
        SHRED["@arkivzk/shred<br/>shred protocol, receipts, tombstones, audit"]
        IDX["@arkivzk/index<br/>blind indexes (HMAC tags), private query helpers"]
    end

    subgraph EXT["External"]
        ARK["@arkiv-network/sdk<br/>Arkiv DB-Chain (Rabdi)"]
        KC["Key custodians<br/>t-of-n: user device, passkey, guardian nodes"]
        NOIR["Noir + Barretenberg (WASM)"]
    end

    A1 --> SDK
    SDK --> CORE
    SDK --> ZK
    SDK --> SHRED
    SDK --> IDX
    CORE --> CRYPTO
    ZK --> CRYPTO
    ZK --> NOIR
    SHRED --> VAULT
    VAULT --> CRYPTO
    IDX --> VAULT
    CORE --> ARK
    SHRED --> ARK
    VAULT --> KC
```

## 2.2 What lives where

```mermaid
flowchart LR
    subgraph DEVICE["User device (trusted)"]
        PT[Plaintext]
        DEK[Data key DEK]
        SALT[Commitment salt]
    end

    subgraph CUST["Key custodians (threshold)"]
        S1[Share 1: device]
        S2[Share 2: passkey / HW]
        S3[Share 3..n: guardian nodes]
    end

    subgraph ARKIV["Arkiv (PUBLIC, forever in history)"]
        E1["zk.record entity<br/>bytes: ciphertext (padded)<br/>bytes: commitment C = Poseidon(fields, salt)<br/>bytes: key envelope id<br/>attr: schemaId, epoch, blindTag"]
        E2["zk.proof entity<br/>bytes: proof<br/>attr: recordKey, circuitId, vkHash"]
        E3["zk.receipt entity<br/>shred receipt: signatures of custodians"]
    end

    PT -- encrypt with DEK --> E1
    PT -- commit --> E1
    DEK -- wrapped by KEK --> CUST
    PT -. witness .-> E2
```

Rule: **nothing on Arkiv is ever decryptable without a key that lives off-chain and can be destroyed.**

## 2.3 Key hierarchy (the heart of shredding)

```mermaid
flowchart TB
    ROOT["User Root Key URK<br/>never stored whole: Shamir / threshold t-of-n"]
    ROOT --> EPOCH1["Epoch Key EK_2026_11<br/>HKDF(URK, epoch)"]
    ROOT --> EPOCH2["Epoch Key EK_2026_12"]
    EPOCH1 --> COLL1["Collection Key<br/>per schema e.g. medical"]
    EPOCH1 --> COLL2["Collection Key<br/>chat"]
    COLL1 --> DEK1["DEK record #1<br/>random 256-bit"]
    COLL1 --> DEK2["DEK record #2"]
    COLL2 --> DEK3["DEK record #3"]
    ROOT --> BIX["Blind-index key<br/>HMAC tags for search"]

    classDef shred fill:#ffdddd,stroke:#c00;
    class DEK1,COLL1,ROOT shred;
```

Shred granularity = pick the node to destroy:

| Destroy | Effect |
|---|---|
| one DEK | one record gone |
| collection key | whole collection gone (e.g. all chats) |
| epoch key | everything from one month gone |
| root key shares | **account nuked**: everything ever written, plus blind indexes |

## 2.4 Write flow (`zk.put`)

```mermaid
sequenceDiagram
    autonumber
    participant U as User app
    participant S as arkivzk sdk
    participant V as vault
    participant C as custodians t-of-n
    participant A as Arkiv

    U->>S: put(schema, record, prove=[age>=18])
    S->>S: validate + pad to size bucket
    S->>V: newDEK(collection, epoch)
    V->>C: wrap DEK with hybrid KEM (ML-KEM-768 + X25519)
    C-->>V: envelope ids
    S->>S: ct = AES-256-GCM(DEK, padded, aad=schemaId|epoch)
    S->>S: C = Poseidon(fields, salt)
    S->>S: blindTag = HMAC(BIX, field value) (optional)
    S->>S: ephemeral signer key (unlinkable owner)
    S->>A: createEntity zk.record {ct, C, envId, blindTag}
    A-->>S: entityKey + receipt
    opt prove requested
        S->>S: Noir prove: C opens to fields AND age>=18
        S->>A: createEntity zk.proof {proof, recordKey, vkHash}
    end
    S-->>U: entityKey
```

## 2.5 Verify flow (anyone, no keys)

```mermaid
sequenceDiagram
    participant VR as Verifier (dApp, DAO, employer)
    participant A as Arkiv
    participant Z as arkivzk verifier (WASM)

    VR->>A: query zk.proof where recordKey = X
    A-->>VR: proof, vkHash, circuitId
    VR->>A: get zk.record X (commitment C)
    VR->>Z: verify(proof, publicInputs=[C, threshold], vk)
    Z-->>VR: true / false
    Note over VR: learns only "age>=18" is true, nothing else
```

## 2.6 Shred flow (`zk.shred`) – see doc 04 for full detail

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant S as arkivzk shred
    participant C as custodians t-of-n
    participant A as Arkiv

    U->>S: shred(entityKey | collection | account)
    S->>S: compute target key ids from hierarchy
    S->>C: DESTROY(keyIds, nonce) signed by user
    C->>C: zeroize shares (memory, disk, backups queue)
    C-->>S: signed destruction attestation each
    S->>A: deleteEntity(record), deleteEntity(proofs)
    S->>A: overwrite blind index tags (if any) then delete
    S->>A: createEntity zk.receipt {attestations, keyIds, time}
    S->>S: local zeroize DEK cache, salts
    S-->>U: ShredReceipt (verifiable)
    Note over A: old nodes still have ciphertext,<br/>but no key exists anywhere -> noise
```

## 2.7 Entity lifecycle state machine

```mermaid
stateDiagram-v2
    [*] --> Encrypted: put()
    Encrypted --> Proven: prove()
    Proven --> Proven: more proofs
    Encrypted --> Rotated: rotate epoch / re-wrap DEK
    Proven --> Rotated
    Rotated --> Encrypted
    Encrypted --> Shredded: shred()
    Proven --> Shredded: shred()
    Rotated --> Shredded: shred()
    Encrypted --> Expired: Arkiv expiry
    Expired --> Shredded: auto-shred key on expiry
    Shredded --> [*]: receipt on Arkiv
```
