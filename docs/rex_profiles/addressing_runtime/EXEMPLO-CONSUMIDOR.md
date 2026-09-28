# Exemplo consumidor da capa de recursos (etapa 4)

Obxectivo desta entrega: que calquera poida comprobar, **sen abrir a app**, que a
capa de lectura de recursos responde á pregunta do integrador —«le este recurso
neste enderezo, con este tamaño e este estado de mapper»— devolvendo bytes,
procedencia física e límites de interpretación.

## Como executalo

```bash
cd scripts/rex_profiles/addressing_runtime/rex-addressing
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo run --offline --example resource_report
```

`examples/resource_report.rs` só usa a API pública
(`rex_addressing::resource::*`), non abre ficheiros nin redes, e constrúe as
imaxes en memoria. Non engade dependencias: o SHA-256 e o oráculo de contido
son os mesmos ficheiros que xa emprega a suite (`tests/support/sha256.rs`,
`tests/support/banked.rs`, incluídos con `#[path]`), así que o exemplo é un
consumidor máis, non unha segunda implementación.

## Propiedade de determinismo

O informe non contén reloxos, rutas do host, aleatoriedade nin orde de `HashMap`.
A derradeira liña é o SHA-256 do corpo completo do informe. Executado tres veces
nesta rolda:

```text
resumo sha256=27bebc7b4f83cbf66baaff0a9968bb5055729f015da2079e3c04ab7d13774c8f
resumo sha256=27bebc7b4f83cbf66baaff0a9968bb5055729f015da2079e3c04ab7d13774c8f
resumo sha256=27bebc7b4f83cbf66baaff0a9968bb5055729f015da2079e3c04ab7d13774c8f
```

`diff` entre as tres saída: idénticas. Calquera cambio de comportamento —un
perfil que de repente devolva outro banco, unha recusa que se converta en
éxito— móvese nesta liña cunha soa comparación.

## Autoverificación

O exemplo non imprime o que ve e xa está: cada caso declara `espera` (`Ok` ou o
código de recusa concreto) e antes de engadir unha liña ao informe compróbanse
as invariantes da capa:

- `bytes.len() == length` (nunca un parcial como éxito),
- os segmentos son contiguos en `cpu_address` e `index` vai 0,1,2…,
- nun éxito toda rexión é `rom`,
- cada segmento leva o estado co que se leu,
- a procedencia recomponse byte a byte desde `banked::expect(offset, len)`, que
  é función do **desprazamento físico**, non do produto.

Se algo falla, o executável aborta con código de erro: non produce un informe
que pareza bo. Tamén compróbase que os sete motivos de recusa estean
representados (`assert` sobre a lista `codigos_de_recusa`), para que o exemplo
non se vaia esvaecendo a medida que cambian os casos.

## Saída literal

Xerada o 2026-09-28 sobre a rama `codex/rex-rust-addressing`, HEAD `f9c1913` +
os cambios desta etapa, con `cargo 1.97` e perfil `dev`.

```text
REX · capa de lectura de recursos · informe do exemplo consumidor
contract_version=1 crate_version=0.1.0 profiles=5
fixture: contido autor = byte(i) = i*37 + (i>>8)*0x5B + (i>>16)*0x2F (u8), ver tests/support/banked.rs
IMAXE fixture:md-4mb bytes=4194304 sha256=81841b8bb979b5e147991b9eeeb584158bb704f3eea859c14eebd5ba2261773f
IMAXE fixture:md-2mb bytes=2097152 sha256=723967aef3ce92cede29e420a9cc44459d88fce02dd5348b197704c4755168fc
IMAXE fixture:snes-lorom-512kb bytes=524288 sha256=63151897936d3277d45a0d7801362e7e1a387cbb68e7d7144800d2de6571bbf2
IMAXE fixture:snes-hirom-2mb bytes=2097152 sha256=723967aef3ce92cede29e420a9cc44459d88fce02dd5348b197704c4755168fc
IMAXE fixture:snes-exhirom-6mb bytes=6291456 sha256=a3e91a8c08a4e184983d67e74ae7066fdcbbefc871f676aea6734b3896c94409

· MD linear
LECTURA md-linear-corredor :: unha xanela, un segmento, lineal [perfil=md-linear cpu=0x001000 lon=0x40]
  estado: rom_size=0x400000 imaxe=fixture:md-4mb sha256=81841b8bb979b5e147991b9eeeb584158bb704f3eea859c14eebd5ba2261773f
  segmento 0: cpu=0x001000 lon=0x40 offset=0x001000 rexion=rom
  bytes=64 sha256=11138346aec7ca81aaa38b96661e89d850d6f82289bf6b2e38b4233ec7fc0243
LECTURA md-linear-alias-espello :: $200000 é espello de $000000 co rom_size de 2 MB: mesmos bytes; o enderezo do bus non é o offset físico [perfil=md-linear cpu=0x200000 lon=0x20]
  estado: rom_size=0x200000 imaxe=fixture:md-2mb sha256=723967aef3ce92cede29e420a9cc44459d88fce02dd5348b197704c4755168fc
  segmento 0: cpu=0x200000 lon=0x20 offset=0x000000 rexion=rom
  bytes=32 sha256=d8d04ea66a4c5b31915f38c073229f5f5691773c7549891cbd7280e13f0ba43d
LECTURA md-linear-borde-espello :: corte no borde do espello de 2 MB: dous segmentos, o segundo plegado no offset 0 [perfil=md-linear cpu=0x1fff00 lon=0x200]
  estado: rom_size=0x200000 imaxe=fixture:md-2mb sha256=723967aef3ce92cede29e420a9cc44459d88fce02dd5348b197704c4755168fc
  segmento 0: cpu=0x1fff00 lon=0x100 offset=0x1fff00 rexion=rom
  segmento 1: cpu=0x200000 lon=0x100 offset=0x000000 rexion=rom
  bytes=512 sha256=474da891f9245e0a7ef90fd873adadf48efcc5b8dbbc553936d5a0fa8301735a
RECUSA md-linear-fora-da-xanela :: $400000 non ten dispositivo: recúsase tras os 16 bytes reais, que viaxan no erro [perfil=md-linear codigo=non-rom-region rexion=- detido_en=0x400000 percorridos=1]
  detalle=percorrido detido en 0x400000: xanela sen dispositivo mapeado no perfil md-linear (open bus / reservado / lockup)
  percorrido 0: cpu=0x3ffff0 lon=0x10 offset=0x3ffff0 rexion=rom
RECUSA md-linear-z80 :: $A08000 é RAM do Z80: rexión coñecida que nunca sai da imaxe ROM [perfil=md-linear codigo=non-rom-region rexion=z80-ram detido_en=0xa08000 percorridos=0]
  detalle=0xa08000 é z80-ram do perfil md-linear: rexión coñecida sen backing na imaxe (offset interno 0x0)
RECUSA md-linear-work-ram :: $E00000 é WorkRam do 68K, non cartucho [perfil=md-linear codigo=non-rom-region rexion=work-ram detido_en=0xe00000 percorridos=0]
  detalle=0xe00000 é work-ram do perfil md-linear: rexión coñecida sen backing na imaxe (offset interno 0x0)

· MD SSF2 (o mesmo enderezo, dous estados)
LECTURA ssf2-xanela1-banco0 :: banco 0 na xanela 1: $080000 é identidade [perfil=md-ssf2 cpu=0x080000 lon=0x20]
  estado: banks={1:0x0} rom_size=0x400000 imaxe=fixture:md-4mb sha256=81841b8bb979b5e147991b9eeeb584158bb704f3eea859c14eebd5ba2261773f
  segmento 0: cpu=0x080000 lon=0x20 offset=0x000000 rexion=rom
  bytes=32 sha256=d8d04ea66a4c5b31915f38c073229f5f5691773c7549891cbd7280e13f0ba43d
LECTURA ssf2-xanela1-banco5 :: o MESMO enderezo co banco 5: bytes distintos, offset $280000 [perfil=md-ssf2 cpu=0x080000 lon=0x20]
  estado: banks={1:0x5} rom_size=0x400000 imaxe=fixture:md-4mb sha256=81841b8bb979b5e147991b9eeeb584158bb704f3eea859c14eebd5ba2261773f
  segmento 0: cpu=0x080000 lon=0x20 offset=0x280000 rexion=rom
  bytes=32 sha256=96fced831f393ea03298f8964256804db0bd047244dcf35ed766ec8686eddfd7
LECTURA ssf2-porta-xanela-0-1 :: un segmento por xanela, aínda que as bases sexan contiguas [perfil=md-ssf2 cpu=0x07ff00 lon=0x200]
  estado: banks={1:0x5} rom_size=0x400000 imaxe=fixture:md-4mb sha256=81841b8bb979b5e147991b9eeeb584158bb704f3eea859c14eebd5ba2261773f
  segmento 0: cpu=0x07ff00 lon=0x100 offset=0x07ff00 rexion=rom
  segmento 1: cpu=0x080000 lon=0x100 offset=0x280000 rexion=rom
  bytes=512 sha256=0bd38fd2a5e3c739bbf03f6773676df732380fd02d77c57c68c40cd804c13b24
RECUSA ssf2-xanela7-esouto :: banco 3 na xanela 7: o percorrido que viaxa no erro xa está remapeado [perfil=md-ssf2 codigo=non-rom-region rexion=- detido_en=0x400000 percorridos=1]
  detalle=percorrido detido en 0x400000: xanela sen dispositivo mapeado no perfil md-ssf2 (open bus / reservado / lockup)
  percorrido 0: cpu=0x3ffff0 lon=0x10 offset=0x1ffff0 rexion=rom

SECUENCIA ssf2-secuencia-bancos :: escritura de banco entre lecturas [perfil=md-ssf2 writes_applied=2]
  paso 0: cpu=0x080000 lon=0x8 offset=0x080000 estado=banks={} rom_size=0x400000 sha256=ac08b8732c87deb42a8d69654afb316aabf58a7c80b9ccfc7ba1bdc8c89b6253
  paso 1: cpu=0x080000 lon=0x8 offset=0x280000 estado=banks={1:0x5} rom_size=0x400000 sha256=785b8519af0e9a34dc63140366846ad99837e10f059daed753facb18788e9acf
  paso 2: cpu=0x100000 lon=0x8 offset=0x300000 estado=banks={1:0x5,2:0x6} rom_size=0x400000 sha256=89011bffe3d55e2b67abe7beccb712175b7e51c7875228c86d26685494a6171f
  estado_final: banks={1:0x5,2:0x6} rom_size=0x400000

· SNES LoROM
LECTURA lorom-paxina-a15 :: $808100: dentro da páxina tírase A15, offset $000100 (non $8100) [perfil=snes-lorom cpu=0x808100 lon=0x40]
  estado: rom_size=0x80000 imaxe=fixture:snes-lorom-512kb sha256=63151897936d3277d45a0d7801362e7e1a387cbb68e7d7144800d2de6571bbf2
  segmento 0: cpu=0x808100 lon=0x40 offset=0x000100 rexion=rom
  bytes=64 sha256=07a193112d1944a464444b8c57038345c411d3bb8c134015a9b2e47a8b947f39
RECUSA lorom-io :: $2000-$7FFF dos bancos 00-3D/80-BD é I/O do sistema, non ROM [perfil=snes-lorom codigo=non-rom-region rexion=io detido_en=0x004000 percorridos=0]
  detalle=0x4000 é io do perfil snes-lorom: rexión coñecida sen backing na imaxe (offset interno 0x4000)
RECUSA lorom-ambiguo :: metade baixa A15 do banco $40: as fontes pinadas diverxen, a capa non palpita [perfil=snes-lorom codigo=ambiguous rexion=- detido_en=0x400000 percorridos=0]
  detalle=percorrido detido en 0x400000: banco 0x40 $0x0000 con A15 desconectado: as fontes diverxen (snes9x ROM aliás vs bsnes open bus); o cartucho real decide, o perfil non palpita

· SNES HiROM
LECTURA hirom-banco-c0 :: $C08000: offset = (banco<<16)+A, sen tirar A15, espellado mod 2 MB [perfil=snes-hirom cpu=0xc08000 lon=0x100]
  estado: rom_size=0x200000 imaxe=fixture:snes-hirom-2mb sha256=723967aef3ce92cede29e420a9cc44459d88fce02dd5348b197704c4755168fc
  segmento 0: cpu=0xc08000 lon=0x100 offset=0x008000 rexion=rom
  bytes=256 sha256=e054e8b7717a771ab46ffd7ee666ff9fc9084c05ab66eff18dcf923eb0457a69
RECUSA hirom-espello-wram :: $0000-$1FFF de 00-3D é o espello de WRAM en HiROM, non ROM [perfil=snes-hirom codigo=non-rom-region rexion=wram-mirror detido_en=0x000000 percorridos=0]
  detalle=0x0 é wram-mirror do perfil snes-hirom: rexión coñecida sen backing na imaxe (offset interno 0x0)

· SNES ExHiROM
LECTURA exhirom-area1-c0 :: área 1: A22/A23 desconectados, offset = enderezo mod 4 MB [perfil=snes-exhirom cpu=0xc00000 lon=0x100]
  estado: rom_size=0x600000 imaxe=fixture:snes-exhirom-6mb sha256=a3e91a8c08a4e184983d67e74ae7066fdcbbefc871f676aea6734b3896c94409
  segmento 0: cpu=0xc00000 lon=0x100 offset=0x000000 rexion=rom
  bytes=256 sha256=a7f0ce8ca689c295cb9fb1af38e7919fad0a7dd3679f64a818a26148710308f6
LECTURA exhirom-fronteira-3f-40 :: área 2 modular: o offset BAIXA ao pasar de $3F a $40, e iso son dous segmentos, non un [perfil=snes-exhirom cpu=0x3ffff0 lon=0x20]
  estado: rom_size=0x600000 imaxe=fixture:snes-exhirom-6mb sha256=a3e91a8c08a4e184983d67e74ae7066fdcbbefc871f676aea6734b3896c94409
  segmento 0: cpu=0x3ffff0 lon=0x10 offset=0x5ffff0 rexion=rom
  segmento 1: cpu=0x400000 lon=0x10 offset=0x400000 rexion=rom
  bytes=32 sha256=bfbac24723fc99318558695682de22f39783ae4f403bfddaa5bf904802209ba2
RECUSA exhirom-tamanho-fóra-de-contrato :: ExHiROM só admite 5/6/8 MB: 4 MB é estado inválido, non rango inválido [perfil=snes-exhirom codigo=bad-state rexion=- detido_en=- percorridos=0]
  detalle=snes-exhirom: mapper_state.rom_size 0x400000 fóra do intervalo (0x400000, 0x800000] de snes-exhirom; <=4MB é perfil snes-hirom, >8MB non é enderezable no barramento de 24 bits

· Fronteiras da capa (independentes do perfil)
RECUSA longitude-cero :: unha lectura de cero bytes non é un recurso [perfil=md-linear codigo=invalid-range rexion=- detido_en=- percorridos=0]
  detalle=length debe ser >= 1: unha lectura de cero bytes non é un recurso
RECUSA fora-do-barramento :: $FFFFF0 + 32 sae do barramento de 24 bits: recúsase antes de percorrer [perfil=md-linear codigo=invalid-range rexion=- detido_en=- percorridos=0]
  detalle=lectura de 32 bytes en 0xfffff0 chega a 0x100000f, fóra do barramento de 24 bits
RECUSA limite-de-bytes :: Limits::max_bytes por debaixo do pedido: recúsase antes de reservar [perfil=md-linear codigo=limit-exceeded rexion=- detido_en=- percorridos=0]
  detalle=length 4096 supera Limits::max_bytes 256
RECUSA limite-de-segmentos :: unha lectura que precisa dous corredores con max_segments=1 devolve o primeiro dentro do erro [perfil=md-linear codigo=limit-exceeded rexion=- detido_en=0x200000 percorridos=1]
  detalle=a lectura precisa máis de 1 segmentos; parouse en 0x200000
  percorrido 0: cpu=0x1ffff0 lon=0x10 offset=0x1ffff0 rexion=rom
IMAXE fixture:md-imaxe-truncada bytes=1048576 sha256=9c64d30371e906434d57be2200e535416108d1cdaba3fe5a50c916ac85b954c3 (o estado segue declarando rom_size de 4 MB)
RECUSA imaxe-curta :: $100000 cae fóra da imaxe de 1 MB: o percorrido detense e non se inventan bytes [perfil=md-linear codigo=incompatible-size rexion=- detido_en=0x100000 percorridos=0]
  detalle=percorrido detido en 0x100000: ROM (1048576 bytes) máis curta que rom_size declarado (4194304); trecho faltante a partir do offset 0x100000
RECUSA atestacion-malformada :: sha256_hex de 2 díxitos: sen orixe verificable non hai lectura [perfil=md-linear codigo=bad-attestation rexion=- detido_en=- percorridos=0]
  detalle=image.sha256_hex debe ser SHA-256 en 64 díxitos hex minúsculos (atopado "00")

RESUMO lecturas=13 recusas=14 codigos_de_recusa[ambiguous,bad-attestation,bad-state,incompatible-size,invalid-range,limit-exceeded,non-rom-region]
resumo sha256=27bebc7b4f83cbf66baaff0a9968bb5055729f015da2079e3c04ab7d13774c8f
```

## Que lle interesa ler a quen integra

- **`estado:` en cada lectura.** A saída repite o `rom_size` e os bancos co que
  se leu. Un panel que moste bytes sen isto non podería explicar por que eses
  bytes e non outros.
- **`segmento N` con `cpu`/`lon`/`offset`.** Son tres conceptos distintos: o
  enderezo do barramento, cantos bytes aporta o corredor e o desprazamento
  físico na imaxe. `md-linear-borde-espello` e `exhirom-fronteira-3f-40`
  amosan casos onde **non** hai continuidade física e a capa non a inventa.
- **`bytes=… sha256=…`.** O hash é dos bytes **devoltos**, non da imaxe: é o
  identificador co que un test de integración pode fixar unha lectura.
- **Un coincidencia útil:** `md-linear-alias-espello` e `ssf2-xanela1-banco0`
  dan o mesmo `sha256` (`d8d04ea6…`). Dous camiños distintos ao mesmo corredor
  físico (`offset 0`, 32 bytes) — é a proba de que alias e banco 0 non son o
  mesmo concepto pero si a mesma lectura.
- **`percorridos=N` nunha recusa.** Cando a capa xa leu bytes antes de recusar,
  eses bytes van no erro (renumerados), non se perden: `md-linear-fora-da-xanela`
  e `limite-de-segmentos` din exactamente onde se parou.
- **`rexion=-` non significa "sen rexión":** en `md-linear-fora-da-xanela` é que
  o enderezo non pertence a ningún dispositivo do modelo (open bus), mentres que
  `z80-ram`, `work-ram`, `io` e `wram-mirror` si teñen nome.

## Límites que este exemplo **non** demostran

- Non hai ROM real: as cinco imaxes son fixtures autorais. Os tres perfis SNES
  seguen sendo **só-fixture** (`CLASSIFICACION.md` §9 e límite de corpus).
- Non detecta mapas nin deduce perfis: quen chama entrega `perfil` e `estado`.
- Non modela chips especiais (DSP1, SA-1, CX4, Super FX, BS-X): as súas claves
  están recusadas con `bad-state`, como demostra a batería, non este exemplo.
- A verificación de que o SHA-256 declarado corresponde ao arquivo é do
  adaptador; aquí a imaxe xa está en memoria.
