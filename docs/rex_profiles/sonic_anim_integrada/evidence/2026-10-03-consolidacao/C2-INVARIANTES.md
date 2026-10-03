# C2 — revisão independente dos invariantes da entrega (2026-10-03)

Método: dois passes. (1) Agente somente-leitura revisou os invariantes no
worktree de destino contra o código; (2) o agente principal re-verificou
cada achado citado, linha a linha, antes de aceitar. Descoberta de processo:
o primeiro passe produzindo claims de filesystem falsos (alegou symlinks
`S_IFLNK` quando `ls`/`git ls-files -s` mostaram arquivos regulares
mode `100644`, HEAD limpo) — esse rapport foi descartado e um segundo passe
ordenado. Nenhum achado do segundo passe foi aceito sem leitura direta.

## invariantes — veredito com evidência re-verificada

| # | Invariante | Veredito | Evidência (verificada) |
|---|-----------|----------|------------------------|
| 1 | Base BYOR nunca escrita | enforced + testado | escrita só via `write_file_immutable` (`create_new(true)`, inspection.rs:1490); base re-lida e comparada ao SHA pinado antes de toda edição (:1429-1435); testes de integridade da base em :1893/:2076/:2400 (tier `#[ignore]`, ROM real) + e2e `Base BYOR mudou` (harness) |
| 2 | Edições acumulam na cópia | enforced + testado | `changed_offsets` = diff completo base→cópia (cumulativo, :1438-1442); ledger por domínio com `previous_*` (:1446-1469); acúmulo em ambas as ordens no tier `#[ignore]` (:2099+) e jornada E2E passo 3/5 |
| 3 | BPS export→apply reproduz a cópia | enforced + testado | unit `test_create_and_apply_bps_match` (patch_studio.rs:722); base errada recusa (:737); E2E `passo6.bps_reproduz_copia` com bytes independentes |
| 4 | Restauração seletiva só devolve o byte do intervalo | enforced + testado | `edit_sonic_duration` só toca `set_interval` (sonic_cadence.rs); unit não-ignorado `reserved_values_refuse_and_edit_writes_exactly_one_byte` asserta `changed == vec![WAIT_ADDR]` (sonic_cadence.rs:317-322); E2E passo 10 reverifica byte + pixel intacto |
| 5 | Reabertura com hidratação real | enforced + testado | `load_stored_session_from_disk` revalida identidade contra ROM relida frescamente (inspection.rs:309-313); painel valida `normalized_sha256` + status na remontagem (InspectionPanel.tsx:281-305); E2E restart+reopen reverifica pixels contra referência independente |
| 6 | Respostas antigas descartadas | enforced + testado | contadores monotônicos por handler + id de sessão (InspectionPanel.tsx:182-220 etc.); testes jsdom resolvem promessas atrasadas após trocar sessão (test.tsx:238/344/457/704/731/752) |
| 7 | Identidade dos bytes carregados vs disco | enforced; aviso por design | `LoadedGame.rom_sha256` é o SHA dos bytes lidos no load (`emulator/libretro_ffi.rs:484-486`, exposto por `loaded_rom_identity` :1137); mismatch com disco é `disk_matches_loaded` de diagnóstico (lib.rs:871-872) — **não bloqueia por design documentado**; e2e compara tail.rom_sha256; unit `load_identity_reports_loaded_bytes_not_disk_file` (lib.rs:7508) |

## achados abertos (re-aceitos só após verificação direta)

1. **Sem teste negativo de cópia adulterada em disco.** Os portões de
   identidade/escopo de `read_sonic_session_rom`
   (`tools/reverse/decomp/sprite_composition.rs`: base bate pinned :554-562,
   cópia canônica sob `extract/<SHA>/edits/` :565-570, sha do arquivo ==
   `edit.modified_rom_sha256` :572-574, diff fora de escopo → recusa :576-592)
   nunca são exercitados negativamente por teste unit ou e2e — verificado
   por grep no harness (só checagens de oracle dourado). A prova exigida da
   Part 2 inclui o negativo "cópia adulterada" — esse teste fecha o gap aqui
   (vai para EXPECTATIONS-SEQUENCIA).
2. **Tier `#[ignore]`.** Os testes mais fortes de acúmulo/reabertura/restauração
   exigem ROM real e rodam fora do CI; o CI cobre com fixtures autorais +
   jsdom + e2e nativo. Limitação registrada, não defeito.
3. **No-op com sessão sem edições** (`inspection.rs:1538-1551`): o registro
   noop devolve `modified_rom_path = caminho da BASE` quando a cadeia de
   edições está vazia. Verificado no painel: `edit.noop` suprime
   `setUnsavedChanges` (linhas 704/731) — o estado "Aplicado/salvo" não é
   ativado; o campo do registro aponta à base como "cópia == base", que é
   semanticamente honesto, mas o shape do struct convida a leitura errada.
   Caveat cosmético/proveniência; nenhuma escrita ocorre; decisão de produto
   adiada com registro.

## leitura

Nenhum dos 7 invariantes está violado no código do destino. As duas lacunas
aceitas (teste negativo de adulteração; handlers de export/apply/run sem
guarda de sequência) entram como requisitos da frente P1/P3 em vez de
afirmações de "aprovado".
