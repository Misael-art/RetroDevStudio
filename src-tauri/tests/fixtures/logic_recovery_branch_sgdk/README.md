# Logic recovery branch fixture (Experimental)

This fixture is deliberately narrow: a Mega Drive M68K routine reads the low
word of D0, adds one, compares the word with threshold 5 using signed `BGE.S`,
and writes 0 or 1 to the controlled WRAM oracle before returning. The node
fixture implements the same bounded semantics in C. The routine has no
unrelated instructions; the bridge exists only to pass the common test input.

It is a fixture for the bounded profile `m68k.add_compare_branch_word_d0_wram.v1`,
not general 68000 decompilation support.
