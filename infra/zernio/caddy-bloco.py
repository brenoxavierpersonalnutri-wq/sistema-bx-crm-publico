#!/usr/bin/env python3
"""Põe a rota /zernio no bloco SEU_VPS do Caddyfile, sem abrir o n8n.

Uso: python3 -I caddy-bloco.py ENTRADA SAIDA   (rc 0 = mudou, rc 3 = já estava, rc 2 = não achei o bloco)

O bloco atual responde 403 para quem não é o IP do dono e manda o resto ao n8n. Depois desta mudança:
  handle @zernio  (/zernio/v1/*, /zernio/saude, /zernio/webhook) -> headturbo-zernio em 172.18.0.1:7891, aberto
  handle          (todo o resto) -> exatamente o conteúdo antigo do bloco (403 fora do dono + n8n)
`handle` é exclusivo: o que casa com @zernio nunca chega ao n8n, e o n8n continua só para o IP do dono.
"""
import sys

HOST = "SEU_VPS {"
MARCA = "# >>> headturbo-zernio"
ROTA = """    {marca} (infra/zernio/README.md). Aberto: o serviço exige o JWT do CRM; webhook exige HMAC.
    @zernio path /zernio/v1/* /zernio/saude /zernio/webhook
    handle @zernio {{
        uri strip_prefix /zernio
        reverse_proxy 172.18.0.1:7891
    }}
    # <<< headturbo-zernio
""".format(marca=MARCA)


def transformar(texto):
    if MARCA in texto:
        return None
    linhas = texto.split("\n")
    ini = next((i for i, l in enumerate(linhas) if l.strip() == HOST), None)
    if ini is None:
        raise LookupError("bloco SEU_VPS não encontrado")
    prof, fim = 0, None
    for i in range(ini, len(linhas)):
        prof += linhas[i].count("{") - linhas[i].count("}")
        if prof == 0:
            fim = i
            break
    if fim is None:
        raise LookupError("bloco SEU_VPS sem fechamento")
    corpo = linhas[ini + 1:fim]
    encode = [l for l in corpo if l.strip().startswith("encode ")]
    resto = [l for l in corpo if not l.strip().startswith("encode ")]
    while resto and not resto[-1].strip():
        resto.pop()
    novo = [linhas[ini]] + encode + ROTA.rstrip("\n").split("\n") + ["    handle {"]
    novo += [("    " + l) if l.strip() else l for l in resto] + ["    }", linhas[fim]]
    return "\n".join(linhas[:ini] + novo + linhas[fim + 1:])


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    with open(sys.argv[1], encoding="utf-8") as f:
        texto = f.read()
    try:
        novo = transformar(texto)
    except LookupError as e:
        print(f"caddy-bloco: {e}")
        return 2
    if novo is None:
        print("caddy-bloco: rota /zernio já está no Caddyfile")
        return 3
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(novo)
    print("caddy-bloco: rota /zernio acrescentada")
    return 0


if __name__ == "__main__":
    sys.exit(main())
