# Análise preparatória da rodada (2026-09-26)

Scripts de uma sessão anterior do integrador que viviam em `/tmp`, promovidos
para local durável por ordem do prompt de retomada
(`docs/handoffs/PROMPT_REX_INTEGRATOR_RESUME_2026-09-26.md`: "Leve scripts/provas
necessários que estejam em /tmp para local durável adequado"). **Nenhum byte da
ROM comercial está aqui**: os scripts leem a ROM BYOR por caminho em tempo de
execução e só gravam offsets/hashes.

| arquivo | sha256 | o que faz |
|---|---|---|
| `rex_68000_sim.py` | `89e85b4cda881adc782512d0e3dc95dbf9250e8f0bc3b7ed30674bca7ca78407` | transcrição em Python do desempacotador de `tools_a.s` (COPY_MATCH, `.lm_len` por salto relativo, `.lmr` com tabela de paridade, ROM-source no espaço do stream). Conferiu `asm ≡ Rust` nos streams decodificáveis e classificou 25/191 headers como falsos positivos estruturais (tamanho 0/inválido). **Superado pelo oráculo real**: a medição no 68000 de verdade está em `docs/rex_profiles/LZ4W_68K_ORACLE.md`; este script serve como segunda opinião barata, não como prova. |
| `rex_palette_free_match.py` | `97fb6f95bebf9f575deb17d062869c0451c5862351749625688118cebc16553f` | busca de correspondência de tiles em tela **sem** assumir identidade de paleta (o casamento por paleta anterior era a hipótese refutada). |
| `rex-scan-checkpoint.log` | `6e28d1c4c0aa0034abbce48d75617b416eb123c3d20ad19601f5d91622954810` | checkpoint da varredura orçada do produto: `fit=4 aplicados=4` apenas no alvo 0xc8cc8 (tile 0, linha 7, colunas 4-7), com o SHA-256 de cada patch exportado. |
