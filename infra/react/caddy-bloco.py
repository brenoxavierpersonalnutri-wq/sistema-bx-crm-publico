#!/usr/bin/env python3
"""Põe a rota /react no bloco SEU_VPS do Caddyfile, sem abrir o n8n.

Uso: python3 -I caddy-bloco.py ENTRADA SAIDA   (rc 0 = mudou, rc 3 = já estava, rc 2 = não achei o bloco)

O bloco hoje tem `handle @zernio {...}` (infra/zernio) e um `handle { ... }` final que responde 403 para quem não é
o IP do dono e manda o resto ao n8n. A rota /react entra logo depois da do zernio, como outro `handle` exclusivo:
  handle @react (/react/v1/*, /react/saude) -> headturbo-react em 172.18.0.1:7892, aberto (o serviço exige o JWT
  do CRM; o vídeo pronto, uma assinatura HMAC com prazo)
Sem o bloco do zernio (instalação limpa) faz o mesmo que ele: rota + o conteúdo antigo do bloco dentro de `handle`.
"""
import sys

HOST = "SEU_VPS {"
MARCA = "# >>> headturbo-react"
FIM_ZERNIO = "# <<< headturbo-zernio"
ROTA = """    {marca} (infra/react/README.md). Aberto: o serviço exige o JWT do CRM; o vídeo pronto, assinatura com prazo.
    @react path /react/v1/* /react/saude
    handle @react {{
        uri strip_prefix /react
        reverse_proxy 172.18.0.1:7892 {{
            flush_interval -1
        }}
    }}
    # <<< headturbo-react
""".format(marca=MARCA)


def bloco(linhas):
    ini = next((i for i, l in enumerate(linhas) if l.strip() == HOST), None)
    if ini is None:
        raise LookupError("bloco SEU_VPS não encontrado")
    prof = 0
    for i in range(ini, len(linhas)):
        prof += linhas[i].count("{") - linhas[i].count("}")
        if prof == 0:
            return ini, i
    raise LookupError("bloco SEU_VPS sem fechamento")


def transformar(texto):
    if MARCA in texto:
        return None
    linhas = texto.split("\n")
    ini, fim = bloco(linhas)
    rota = ROTA.rstrip("\n").split("\n")
    zf = next((i for i in range(ini, fim) if linhas[i].strip() == FIM_ZERNIO), None)
    if zf is not None:  # já existe o padrão handle-exclusivo: só encaixa a rota
        return "\n".join(linhas[:zf + 1] + rota + linhas[zf + 1:])
    corpo = linhas[ini + 1:fim]
    encode = [l for l in corpo if l.strip().startswith("encode ")]
    resto = [l for l in corpo if not l.strip().startswith("encode ")]
    while resto and not resto[-1].strip():
        resto.pop()
    novo = [linhas[ini]] + encode + rota + ["    handle {"]
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
        print("caddy-bloco: rota /react já está no Caddyfile")
        return 3
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(novo)
    print("caddy-bloco: rota /react acrescentada")
    return 0


if __name__ == "__main__":
    sys.exit(main())
