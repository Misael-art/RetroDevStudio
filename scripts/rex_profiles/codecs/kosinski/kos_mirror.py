#!/usr/bin/env python3
"""Espelho Python do decoder de referência Kosinski (mdcomp src/lib/kosinski.cc).

Compartilhado por gen_vectors.py (auto-validação de goldens) e
build-vectors.sh (verificação de que o espelho reproduz o oráculo koscmp em
todas as streams geradas — calibração contínua, não presunção).
Não é oráculo independente: é modelo derivado da mesma fonte, usado apenas
para construir/validar goldens localmente; a publicação exige o oráculo.

FATOS DO DECODE (fonte: kosinski.cc:44-209 + bitstream.hh ibitstream,
commit 72c6df40):
  - DESCRIPTOR = palavra de 16 bits, 2 bytes lidos little-endian (kosinski.cc
    usa descriptor_t=uint16_t + descriptor_endian_t=LittleEndian +
    DescriptorLittleEndianBits=true, que no ibitstream equivale a consumir os
    bits na ordem LSB->MSB da palavra, i.e. bit0..bit7 do byte par, depois
    bit0..bit7 do byte ímpar). NADA de tag de 8 bits MSB->LSB.
  - A palavra é buscada no início do token quando as 16 posições acabam
    (EarlyRead em bitstream.hh: reabastece quando readbits==0 após o pop);
    bytes de dados são consumidos sequencialmente no ponto de uso.
  - bit 1 -> literal (próximo byte da stream vai para a saída).
  - bits 0,0 inline + 2 bits (h,l) -> len=((h<<1)|l)+2 (2..5);
    dist = 0x100 - próximo byte (byte 0 -> dist 256).
  - bits 0,1 separado: Low, High; Count=High&7;
      Count!=0 -> len=Count+2 (2..9) (forma de 2 bytes)
      Count==0 -> c=próximo byte: 0 -> FIM (o decoder PARA aqui;
                  bytes após o terminator nunca são lidos);
                  c==1 -> 'continue' sem cópia (quirk; consome o byte);
                  senão len=c+1 (3..256) (forma de 3 bytes)
    dist = 0x2000 - (((High&0xF8)<<5)|Low)   (1..0x2000)
  - cópia byte a byte via seekg(tellp()-dist) sobre stringstream de saída:
    dist > histórico já escrito NÃO é validado — seekg negativo faz o read
    retornar 0 no final da stream (comportamento medido, não presumido).
  - sem EOD: loop `while (in.good())` consome até esgotar a stream.

mirror_decode(st) -> (out: bytes | 'ERR-trunc' | 'ERR-off', bytes_consumed)
  'ERR-trunc' marca onde o oráculo real teria comportamento específico
  (lê 0x00 em getbyte após EOF — ver sondas em build-vectors.sh);
  o espelho sinaliza truncamento para o produto, que deve dar erro
  estruturado. Validação de goldens usa apenas streams bem-formadas.

mirror_decode(st, strict=True) impõe o CONTRATO DO PRODUTO (derive dos
requisitos v1, não do oráculo — a referência não valida nada):
  - EOF sem terminator visto (fluxo só termina legalmente no token
    0,1 + c==0) -> 'ERR-trunc' (código do produto: truncated);
  - dist > histórico já escrito -> 'ERR-off' (código: invalid-reference);
    o modo não-strict replica o oráculo (preenche 0, seekg sem validação).
"""


def mirror_decode(st: bytes, strict: bool = False):
    pos = 0
    bitbuf = 0
    bitcnt = 0  # bits restantes na palavra de 16 corrente
    out = bytearray()

    def descbit():
        nonlocal pos, bitbuf, bitcnt
        if bitcnt == 0:
            fetch_word()
        bit = bitbuf & 1  # consumo LSB->MSB da palavra LE
        bitbuf >>= 1
        bitcnt -= 1
        if bitcnt == 0:
            # EARLY FETCH (ibitstream pop+EarlyRead): a próxima palavra de
            # 16 bits é lida IMEDIATAMENTE, antes de quaisquer bytes de dados
            # do token corrente — os 2 bytes caem na stream neste ponto.
            fetch_word()
        return bit

    def fetch_word():
        nonlocal pos, bitbuf, bitcnt
        if pos + 2 > len(st):
            bitbuf = -1  # marca EOF; chamador trata como truncado
            bitcnt = 0
            return
        bitbuf = st[pos] | (st[pos + 1] << 8)  # LE
        pos += 2
        bitcnt = 16

    def getbyte():
        nonlocal pos
        if pos >= len(st):
            return None
        b = st[pos]
        pos += 1
        return b

    consumed = len(st)
    while pos < len(st):
        b = descbit()
        if b is None:
            return "ERR-trunc", consumed
        if b == 1:
            v = getbyte()
            if v is None:
                return "ERR-trunc", consumed
            out.append(v)
            continue
        b = descbit()
        if b is None:
            return "ERR-trunc", consumed
        if b == 1:
            low = getbyte()
            high = getbyte()
            if low is None or high is None:
                return "ERR-trunc", consumed
            count3 = high & 7
            if count3 != 0:
                ln = count3 + 2
            else:
                c = getbyte()
                if c is None:
                    return "ERR-trunc", consumed
                if c == 0:
                    consumed = pos  # decoder para aqui; resto não é consumido
                    return bytes(out), consumed  # terminator visto: ok em strict
                if c == 1:
                    continue  # quirk 'continue': sem cópia
                ln = c + 1
            dist = 0x2000 - (((high & 0xF8) << 5) | low)
        else:
            h = descbit()
            l = descbit()
            if h is None or l is None:
                return "ERR-trunc", consumed
            ln = ((h << 1) | l) + 2
            d = getbyte()
            if d is None:
                return "ERR-trunc", consumed
            dist = 0x100 - d
        if dist <= 0 or dist > 0x2000:
            return "ERR-off", consumed
        # CONTRATO DO PRODUTO (strict): o oráculo NÃO valida histórico — seekg
        # abaixo do início lê 0 (UB medida). Uma referência que cai antes do
        # primeiro byte escrito é entrada malformada; o produto deve retornar
        # invalid-reference.
        if strict and dist > len(out):
            return "ERR-off", consumed
        src = len(out) - dist
        for i in range(ln):
            j = src + i
            out.append(out[j] if j >= 0 else 0)  # seekg negativo -> 0
    # Só se chega aqui por exaustão da stream SEM terminator (todo stream bem
    # formado retorna no ramo c==0). Em strict o contrato exige terminator.
    if strict:
        return "ERR-trunc", consumed
    return bytes(out), consumed
