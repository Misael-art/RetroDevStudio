//! CLI minimo para o modo DIFERENCIAL documentado (nao faz parte da suíte
//! normal; ver scripts/rex_profiles/codecs/kosinski_runtime/).
//! Uso: cargo run --release --example decode -- <stream.kos> <saida.bin>
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("uso: decode <stream.kos> <saida.bin>");
        std::process::exit(2);
    }
    let st = std::fs::read(&args[1]).expect("leitura da stream");
    match rex_kosinski::decode(&st, usize::MAX / 2, usize::MAX / 4) {
        Ok(d) => {
            let mut f = std::fs::File::create(&args[2]).expect("criacao da saida");
            f.write_all(&d.output).expect("escrita");
            eprintln!(
                "ok consumed={} out_len={}",
                d.bytes_consumed,
                d.output.len()
            );
        }
        Err(e) => {
            eprintln!("erro {e:?}");
            std::process::exit(1);
        }
    }
}
