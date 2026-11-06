// Commitment helper. Executed (not proven) by the SDK to compute
// C = Poseidon2(fields[0..8], salt) with the exact same hash the range circuit uses.
use poseidon::poseidon2::Poseidon2;

global SLOTS: u32 = 8;

fn main(fields: [Field; SLOTS], salt: Field) -> pub Field {
    let mut input = [0; SLOTS + 1];
    for i in 0..SLOTS {
        input[i] = fields[i];
    }
    input[SLOTS] = salt;
    Poseidon2::hash(input, SLOTS + 1)
}
