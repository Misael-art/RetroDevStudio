// Infraestrutura de probas do paquete rex-addressing.
//
// Un mesmo módulo é compilado por varios binarios de test, e cada un usa só
// parte del: o `dead_code` aquí sería ruído, non información.
#![allow(dead_code)]
//
// Non é código de produción: só tests. Contén
//  - `json`: un parser JSON mínimo (sen dependencias externas) para consumir
//    os vectores diferenciais tal cal están no disco, sen conversións intermedias;
//  - `sha256`: SHA-256 para verificar procedencia e stream de fixture;
//  - `fixture`: reprodución do PRNG xorshift32 descrito no propio ficheiro de
//    vectores (especificación declarada, non código alleo transplantado);
//  - `vectors`: carga + validación de versión/SHA/counts dos vectores;
//  - `banked`: fixture autoral cuxo contido identifica banco e offset, para
//    auditar a capa de recursos sen chamar a ela;
//  - `windows_engine`: SEGUNDA referencia, un matcher de xanelas declarativas
//    derivado da táboa `windows-generated.json` (extraída mecanicamente do
//    boards.bml de bsnes) e da simulación de táboa de páxinas de GPGX para SSF2.
//    Non reutiliza as fórmulas dos perfis: esperado e observado veñen de camiños
//    de derivación distintos.

pub mod banked;
pub mod conv;
pub mod fixture;
pub mod json;
pub mod sha256;
pub mod vectors;
pub mod windows_engine;
