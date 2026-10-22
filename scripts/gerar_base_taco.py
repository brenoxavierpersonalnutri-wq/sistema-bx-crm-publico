#!/usr/bin/env python3
"""
Gera a base de alimentos da Troca Certa a partir da TACO 4a edicao.

Fonte: TACO (NEPA/UNICAMP, 4a ed.) normalizada pelo projeto brolesi/taco (MIT).
  https://raw.githubusercontent.com/brolesi/taco/main/data/processed/taco/taco_composicao.csv

Aplica as regras do core/ da consultoria Breno Xavier:
  - alimento vetado nunca aparece como OPCAO de substituicao
    (continua consultavel, so nao e oferecido)
  - preparo (cru/cozido/frito/...) fica explicito, nunca implicito no nome
  - macro dominante define o eixo da troca (carbo por carbo, proteina por proteina)

Uso:
  python scripts/gerar_base_taco.py CAMINHO_DO_CSV > src/data/taco-alimentos.json
"""
import csv
import json
import sys
import unicodedata
from datetime import date

# --- regras de veto (core/regras-veto-alimento.md) --------------------------
# Casadas SEM acento: a TACO usa ortografia antiga ("Lingueica" com trema),
# entao comparar com acento deixa embutido passar batido.
VETOS = {
    "embutido": ["linguica", "salsicha", "presunto", "peito de peru", "bacon",
                 "salame", "mortadela", "peperoni", "pepperoni"],
    "maionese": ["maionese"],
    "queijo amarelo/processado": ["queijo, prato", "queijo, cheddar",
                                  "queijo, requeijao", "polenguinho"],
    "atum em oleo": ["atum, conserva em oleo"],
    "salmoura": ["azeitona", "palmito"],
    "tempero industrial": ["shoyu", "molho ingles", "caldo de carne", "caldo de galinha"],
    "instantaneo": ["macarrao instantaneo", "lamen", "sopa, pronta"],
}


def sem_acento(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )


def motivo_veto(descricao: str):
    d = sem_acento(descricao)
    for motivo, termos in VETOS.items():
        if any(t in d for t in termos):
            return motivo
    return None


def num(v, casas=1):
    """TACO traz float longo; NA/Tr viram None."""
    if v is None or v == "" or v in ("NA", "Tr", "*"):
        return None
    try:
        return round(float(v), casas)
    except ValueError:
        return None


def macro_dominante(carbo, prot, gord):
    """Qual macro responde por mais kcal. E o eixo da troca."""
    kcal = {
        "carbo": (carbo or 0) * 4,
        "proteina": (prot or 0) * 4,
        "gordura": (gord or 0) * 9,
    }
    if max(kcal.values()) == 0:
        return None
    return max(kcal, key=kcal.get)


def main(caminho_csv: str):
    alimentos = []
    for r in csv.DictReader(open(caminho_csv, encoding="utf-8")):
        carbo = num(r["carboidrato_g"])
        prot = num(r["proteina_g"])
        gord = num(r["lipideos_g"])
        veto = motivo_veto(r["descricao"])

        alimentos.append({
            "id": int(r["numero_alimento"]),
            "nome": r["descricao"],
            "categoria": r["categoria"],
            # vazio na TACO = alimento sem estado de preparo (fruta in natura, oleo...)
            "preparo": r["preparo"] or None,
            "kcal": num(r["energia_kcal"]),
            "carbo": carbo,
            "prot": prot,
            "gord": gord,
            "fibra": num(r["fibra_g"]),
            "sodio": num(r["sodio_mg"], 0),
            "macro": macro_dominante(carbo, prot, gord),
            "vetado": veto,
        })

    alimentos.sort(key=lambda a: a["nome"])
    json.dump(
        {
            "fonte": "TACO 4a ed. ampliada e revisada (NEPA/UNICAMP), "
                     "normalizada por brolesi/taco (MIT)",
            "gerado_em": date.today().isoformat(),
            "por": "100 g de parte comestivel",
            "total": len(alimentos),
            "alimentos": alimentos,
        },
        sys.stdout, ensure_ascii=False, separators=(",", ":"),
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
