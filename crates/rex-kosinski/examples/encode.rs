//! CLI minimo para o modo DIFERENCIAL documentado (nao faz parte da suite
//! normal; ver scripts/rex_profiles/codecs/kosinski_runtime/).
//! Uso: cargo run --release --example encode -- <plain.bin> <stream.kos>
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("uso: encode <plain.bin> <stream.kos>");
        std::process::exit(2);
    }
    let plain = std::fs::read(&args[1]).expect("leitura do plain");
    let lim = (2 * plain.len() + 4096).max(64); // teto atingivel folgado
    match rex_kosinski::encode(&plain, lim, 1 << 26) {
        Ok(e) => {
            let mut f = std::fs::File::create(&args[2]).expect("escrita da stream");
            f.write_all(&e.stream).expect("escrita");
            eprintln!("ok stream_len={} plain_len={}", e.stream.len(), e.plain_len);
        }
        Err(err) => {
            eprintln!("erro {err:?}");
            std::process::exit(1);
        }
    }
}
