// arkivzk range proof.
// Statement: "the record committed in `commitment` has fields[slot] in [min, max]".
// min == max gives an equality proof (e.g. country hash == X).
// `context` binds the proof to a verifier challenge / record key so it cannot be replayed elsewhere.
use poseidon::poseidon2::Poseidon2;

global SLOTS: u32 = 8;

fn main(
    fields: [Field; SLOTS],
    salt: Field,
    commitment: pub Field,
    slot: pub u32,
    min: pub Field,
    max: pub Field,
    context: pub Field,
) {
    let mut input = [0; SLOTS + 1];
    for i in 0..SLOTS {
        input[i] = fields[i];
    }
    input[SLOTS] = salt;
    assert(Poseidon2::hash(input, SLOTS + 1) == commitment, "commitment mismatch");

    assert(slot < SLOTS, "slot out of range");
    let value = fields[slot];
    // Range checks only make sense on values that fit in 64 bits (or exact equality).
    if min == max {
        assert(value == min, "value != expected");
    } else {
        let v = value as u64;
        assert(v as Field == value, "value is not a u64");
        assert(v >= min as u64, "below min");
        assert(v <= max as u64, "above max");
        assert((min as u64) as Field == min, "min not u64");
        assert((max as u64) as Field == max, "max not u64");
    }
    // Keep context as a bound public input.
    assert(context == context);
}

#[test]
fn proves_age_in_range() {
    let fields = [25, 7, 0, 0, 0, 0, 0, 0];
    let salt = 123456789;
    let mut input = [0; SLOTS + 1];
    for i in 0..SLOTS { input[i] = fields[i]; }
    input[SLOTS] = salt;
    let c = Poseidon2::hash(input, SLOTS + 1);
    main(fields, salt, c, 0, 18, 200, 42);
    main(fields, salt, c, 1, 7, 7, 42);
}

#[test(should_fail_with = "below min")]
fn rejects_underage() {
    let fields = [16, 0, 0, 0, 0, 0, 0, 0];
    let mut input = [0; SLOTS + 1];
    for i in 0..SLOTS { input[i] = fields[i]; }
    input[SLOTS] = 1;
    let c = Poseidon2::hash(input, SLOTS + 1);
    main(fields, 1, c, 0, 18, 200, 0);
}

#[test(should_fail_with = "commitment mismatch")]
fn rejects_wrong_salt() {
    let fields = [25, 0, 0, 0, 0, 0, 0, 0];
    let mut input = [0; SLOTS + 1];
    for i in 0..SLOTS { input[i] = fields[i]; }
    input[SLOTS] = 1;
    let c = Poseidon2::hash(input, SLOTS + 1);
    main(fields, 2, c, 0, 18, 200, 0);
}
