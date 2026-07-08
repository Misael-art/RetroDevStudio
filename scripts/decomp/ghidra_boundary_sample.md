# Ghidra boundary benchmark
- provenance: ghidra=ghidra 12.1.2-1 jdk=jdk21-openjdk 21.0.11.u10-1 analyzeHeadless_sha=302880328a0024ee
- samples: 10 (ok=10 failed=0, allow_failures=0)
- release: n=5 precision[min=0.587 max=0.738 mean=0.691] recall[min=0.512 max=0.841 mean=0.748]
- debug:   n=5 precision[min=0.850 max=0.873 mean=0.859] recall[min=0.940 max=0.957 mean=0.951]

| label | status | truth | ghidra | exact_tp | fp | fn | precision | recall |
|---|---|---|---|---|---|---|---|---|
| release/flip | OK | 93 | 105 | 73 | 32 | 20 | 0.695 | 0.785 |
| release/Mega Pong Classic | OK | 107 | 122 | 90 | 32 | 17 | 0.738 | 0.841 |
| release/Lifebar | OK | 94 | 106 | 75 | 31 | 19 | 0.708 | 0.798 |
| release/Mega Runner | OK | 107 | 118 | 86 | 32 | 21 | 0.729 | 0.804 |
| release/Custom Font | OK | 86 | 75 | 44 | 31 | 42 | 0.587 | 0.512 |
| debug/flip | OK | 208 | 234 | 199 | 35 | 9 | 0.850 | 0.957 |
| debug/Mega Pong Classic | OK | 239 | 260 | 226 | 34 | 13 | 0.869 | 0.946 |
| debug/Lifebar | OK | 203 | 228 | 194 | 34 | 9 | 0.851 | 0.956 |
| debug/Mega Runner | OK | 249 | 268 | 234 | 34 | 15 | 0.873 | 0.940 |
| debug/Custom Font | OK | 206 | 231 | 197 | 34 | 9 | 0.853 | 0.956 |
