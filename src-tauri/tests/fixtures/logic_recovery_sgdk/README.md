# Bounded logic-recovery SGDK fixture

This fixture is durable source material for the bounded Mega Drive profile
`m68k.addq_word_d0_rts.v1`. It deliberately contains no commercial ROM, donor
asset, or generated binary. The recipe creates a temporary SGDK workspace and
prints the resulting ROM hashes.

From the repository root, with the certified host available:

```sh
npm run fixture:logic-recovery -- --output /tmp/rds-logic-fixture
```

The command produces two source-built ROMs:

- `node/out/rom.bin`: the node/code-generation path, using the C semantics emitted by `rom_addq_word`.
- `routine/out/rom.bin`: the linked-routine path, using `recovered_addq_word` assembled as `ADDQ.W #1,D0; RTS`.

Both programs start from `D0 = 0x12340058` and publish the calculated D0 word
and flags to Mega Drive work RAM offsets `0xFF00..0xFF03`. Each program holds
that initial state for a 90-frame fixture prelude; with SGDK startup, the E2E
runner reaches the same state after exactly 120 controlled warmup frames. It
then executes exactly one controlled assertion frame, so `#1` must produce
`0x12340059` and `#2` must produce `0x1234005A` from the same state and input.
It reads the oracle from Libretro region 2. Genesis Plus GX exposes each 68000
word in host order, so the runner decodes each 16-bit word explicitly before
applying the independent ADDQ expected-value model.

The routine path includes an explicit C-ABI bridge that loads the stack
argument into D0, then calls the linked `recovered_addq_word` body. The body
itself remains exactly `ADDQ.W #1,D0; RTS` (`52 40 4E 75`). The routine ROM is
the only one eligible for `rom_patch_recovered_logic`; immediate `#1` is a
byte-for-byte no-op control and immediate `#2` must satisfy the independently
computed word/flags oracle after the same warmup and one assertion frame.

The model is intentionally limited: it does not model callers, stack frames,
return-address provenance, interrupts, indirect/PC-relative callers, or
dynamic execution traces. The assembly routine has no memory effect; the
fixture's RAM writes are test instrumentation outside the recovered routine.
It does not claim Sonic recovery or full caller/context equivalence.

The durable summary of the latest proof is
`e2e-proof-report.json`; the detailed generated report is written under
`src-tauri/target-test/validation/` and is referenced from that summary.
