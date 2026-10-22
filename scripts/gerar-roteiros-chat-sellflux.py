#!/usr/bin/env python3
"""Gera a migration dos ROTEIROS DO CHAT do SellFlux (bloco "Roteiros (11)" da lateral do chat).

Entrada (opcional): ~/HEAD TURBO/inteligencia-sellflux/roteiros-chat.json + midias-roteiros/
Saída: supabase/migrations/20261024150000_roteiros_chat_sellflux.sql (+ mídias copiadas para
public/roteiros/sellflux/chat/, servidas em https://equipe.brenoxavier.com.br/roteiros/sellflux/chat/).

Sem o JSON (ou para os nomes que o JSON não trouxer), os 6 roteiros vistos no vídeo entram como
RASCUNHO com um passo vazio "PREENCHER".

Formato aceito do JSON (tolerante, para casar com quem capturar):
  {"roteiros": [ {"nome": "...", "etapa": "contato", "categoria": "avaliacao",
                  "passos": [ {"tipo": "text|image|audio|document", "texto": "...",
                               "midia": "arquivo-em-midias-roteiros.jpg" | "https://...",
                               "nome_arquivo": "...", "rotulo": "..."} ] } ] }
  Também aceita lista no topo e os sinônimos name/titulo, mensagens/steps/itens,
  type, text/conteudo/content/mensagem/legenda, media/arquivo/file/url/media_url.
  Texto com [IMAGEM:url] / [AUDIO:url] / [DOCUMENTO:url] fica como está (o chat entende).

Idempotente (pode rodar a migration quantas vezes quiser):
  * roteiro identificado pelo nome (sem diferenciar maiúscula/espaço);
  * não existe -> cria DESATIVADO (rascunho) com os passos;
  * existe e TODOS os passos estão vazios (rascunho "PREENCHER") -> troca os passos pelo texto novo;
  * existe com conteúdo (o time já editou) -> não mexe.
  Nada é apagado fora desses passos vazios; nenhum roteiro existente é desativado.

Uso: python3 scripts/gerar-roteiros-chat-sellflux.py [--json caminho] [--midias pasta] [--saida arquivo.sql]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE_SF = Path.home() / "HEAD TURBO" / "inteligencia-sellflux"
HOST = "https://equipe.brenoxavier.com.br"
PASTA_PUBLICA = REPO / "public" / "roteiros" / "sellflux" / "chat"
URL_PUBLICA = f"{HOST}/roteiros/sellflux/chat"
MARCA = "Roteiro do chat do SellFlux"
ETAPAS = {"leads", "contato", "agendado", "compareceu", "fechou"}
FUNIS = {"avaliacao", "individual", "geral"}

# Os 6 que aparecem no vídeo do Breno (17/10/2026) e ainda não existiam no CRM.
DO_VIDEO = [
    ("Avaliação | Qual o Valor?", "contato", "avaliacao"),
    ("Dúvidas sobre Desafio/Plataforma", "contato", "geral"),
    ("Confirmação final | 1h", "agendado", "avaliacao"),
    ("1º Contato", "leads", "geral"),
    ("Liberação de Horário", "contato", "avaliacao"),
    ("Nutrição", "contato", "geral"),
]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def pega(d: dict, *chaves, padrao=None):
    for c in chaves:
        if isinstance(d, dict) and d.get(c) not in (None, ""):
            return d[c]
    return padrao


def lit(s) -> str:
    if s is None:
        return "NULL"
    s = str(s)
    tag = "$rc$"
    n = 0
    while tag in s:
        n += 1
        tag = f"$rc{n}$"
    return f"{tag}{s}{tag}"


def tipo_por_ext(nome: str) -> str:
    ext = nome.rsplit(".", 1)[-1].lower() if "." in nome else ""
    if ext in {"jpg", "jpeg", "png", "webp", "gif"}:
        return "image"
    if ext in {"mp3", "ogg", "opus", "m4a", "wav", "aac"}:
        return "audio"
    return "document"


def publicar_midia(ref: str, pasta_midias: Path) -> tuple[str, str]:
    """Arquivo local -> copia para public/roteiros/sellflux/chat e devolve (url, nome). URL fica como está."""
    if re.match(r"https?://", ref):
        if ref.startswith(HOST):
            return ref, ref.rsplit("/", 1)[-1]
        # link externo (CDN do SellFlux expira): baixa só se o arquivo estiver na pasta de mídias
        local = pasta_midias / ref.split("?")[0].rsplit("/", 1)[-1]
        if not local.exists():
            print(f"AVISO: mídia externa sem cópia local, fica o link original: {ref}", file=sys.stderr)
            return ref, ref.rsplit("/", 1)[-1]
        ref = str(local)
    origem = Path(ref)
    if not origem.is_absolute():
        origem = pasta_midias / ref
    if not origem.exists():
        raise SystemExit(f"ERRO: mídia não encontrada: {origem}")
    dig = hashlib.sha256(origem.read_bytes()).hexdigest()[:10]
    base = re.sub(r"[^a-z0-9.-]+", "-", norm(origem.stem)).strip("-") or "midia"
    destino_nome = f"{base}-{dig}{origem.suffix.lower()}"
    PASTA_PUBLICA.mkdir(parents=True, exist_ok=True)
    destino = PASTA_PUBLICA / destino_nome
    if not destino.exists():
        shutil.copyfile(origem, destino)
    return f"{URL_PUBLICA}/{destino_nome}", origem.name


def ler_json(caminho: Path, pasta_midias: Path) -> list[dict]:
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    lista = dados if isinstance(dados, list) else pega(dados, "roteiros", "scripts", "itens", padrao=[])
    saida = []
    for r in lista:
        nome = str(pega(r, "nome", "name", "titulo", "title", padrao="")).strip()
        if not nome:
            continue
        etapa = str(pega(r, "etapa", "stage", padrao="")).strip().lower()
        funil = norm(pega(r, "categoria", "funil", padrao=""))
        conhecido = next((v for v in DO_VIDEO if norm(v[0]) == norm(nome)), None)
        if etapa not in ETAPAS:
            etapa = conhecido[1] if conhecido else "contato"
        if funil not in FUNIS:
            funil = conhecido[2] if conhecido else "geral"
        passos = []
        brutos = pega(r, "passos", "mensagens", "steps", "itens", "messages", padrao=None)
        if brutos is None:  # roteiro de uma mensagem só, campos no próprio objeto
            brutos = [r]
        for i, p in enumerate(brutos, 1):
            if isinstance(p, str):
                p = {"texto": p}
            texto = str(pega(p, "texto", "text", "conteudo", "content", "mensagem", "message", "legenda", "caption", padrao="")).strip()
            ref = pega(p, "midia", "media", "arquivo", "file", "url", "media_url", padrao=None)
            tipo = str(pega(p, "tipo", "type", padrao="")).lower()
            tipo = {"imagem": "image", "foto": "image", "audio": "audio", "áudio": "audio", "documento": "document",
                    "pdf": "document", "texto": "text"}.get(tipo, tipo)
            url = nome_arq = None
            if ref:
                url, nome_arq = publicar_midia(str(ref), pasta_midias)
                if tipo not in {"image", "audio", "document"}:
                    tipo = tipo_por_ext(nome_arq)
                nome_arq = str(pega(p, "nome_arquivo", "file_name", padrao=nome_arq))
            elif tipo not in {"text"}:
                tipo = "text"
            rotulo = str(pega(p, "rotulo", "label", padrao="")).strip() or (f"Mensagem {i}" if len(brutos) > 1 else "Mensagem")
            passos.append({"tipo": tipo, "rotulo": rotulo, "conteudo": texto, "media_url": url, "file_name": nome_arq})
        saida.append({"nome": nome, "stage": etapa, "funil": funil, "passos": passos,
                      "descricao": f"{MARCA} (capturado, texto literal). Revise e ative para aparecer no chat."})
    return saida


def montar(roteiros: list[dict]) -> str:
    vistos = {norm(r["nome"]) for r in roteiros}
    for nome, etapa, funil in DO_VIDEO:
        if norm(nome) not in vistos:
            roteiros.append({
                "nome": nome, "stage": etapa, "funil": funil,
                "descricao": f"{MARCA} (visto no vídeo de 17/10/2026). O texto não veio na captura: PREENCHER e ativar.",
                "passos": [{"tipo": "text", "rotulo": "PREENCHER", "conteudo": "", "media_url": None, "file_name": None}],
            })
    linhas = [
        "-- Roteiros do CHAT do SellFlux (bloco \"Roteiros\" da lateral do chat) como RASCUNHO.",
        "-- GERADO por scripts/gerar-roteiros-chat-sellflux.py. Não editar à mão: rode o gerador de novo.",
        "-- Idempotente: cria só o que não existe (pelo nome); troca passos só de rascunho ainda vazio;",
        "-- roteiro que o time já preencheu não é tocado. Depende de 20261017100000_crm_roteiros_agentes_ia.sql.",
        "DO $seed$",
        "DECLARE r uuid; vazio boolean;",
        "BEGIN",
    ]
    for ordem, ro in enumerate(roteiros, 1):
        nome_limpo = lit(re.sub(r"\s+", " ", ro["nome"]).strip())
        linhas += [
            f"  -- {ro['nome']}",
            f"  SELECT id INTO r FROM public.crm_roteiros WHERE lower(regexp_replace(trim(nome), '\\s+', ' ', 'g')) = lower({nome_limpo}) ORDER BY created_at LIMIT 1;",
            "  IF r IS NULL THEN",
            f"    INSERT INTO public.crm_roteiros (stage, funil, nome, descricao, ordem, ativo) VALUES ({lit(ro['stage'])}, {lit(ro['funil'])}, {lit(ro['nome'])}, {lit(ro['descricao'])}, {100 + ordem}, false) RETURNING id INTO r;",
            "    vazio := true;",
            "  ELSE",
            "    SELECT NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r AND (coalesce(trim(conteudo), '') <> '' OR media_url IS NOT NULL)) INTO vazio;",
            "  END IF;",
        ]
        tem_conteudo = any(p["conteudo"] or p["media_url"] for p in ro["passos"])
        cond = "vazio AND NOT EXISTS (SELECT 1 FROM public.crm_roteiro_passos WHERE roteiro_id = r)" if not tem_conteudo else "vazio"
        valores = ",\n      ".join(
            f"(r, {i}, {lit(p['tipo'])}, {lit(p['rotulo'])}, {lit(p['conteudo'])}, {lit(p['media_url'])}, {lit(p['file_name'])})"
            for i, p in enumerate(ro["passos"], 1)
        )
        linhas += [f"  IF {cond} THEN"]
        if tem_conteudo:
            linhas += ["    DELETE FROM public.crm_roteiro_passos WHERE roteiro_id = r;"]
        if valores:
            linhas += [
                "    INSERT INTO public.crm_roteiro_passos (roteiro_id, ordem, tipo, rotulo, conteudo, media_url, file_name) VALUES",
                f"      {valores};",
            ]
        linhas += ["  END IF;", ""]
    linhas += ["END", "$seed$;", ""]
    return "\n".join(linhas)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", type=Path, default=BASE_SF / "roteiros-chat.json")
    ap.add_argument("--midias", type=Path, default=BASE_SF / "midias-roteiros")
    ap.add_argument("--saida", type=Path, default=REPO / "supabase" / "migrations" / "20261024150000_roteiros_chat_sellflux.sql")
    a = ap.parse_args()
    roteiros = ler_json(a.json, a.midias) if a.json.exists() else []
    if not a.json.exists():
        print(f"AVISO: {a.json} não existe; só os 6 rascunhos do vídeo com passo PREENCHER.", file=sys.stderr)
    sql = montar(roteiros)
    a.saida.write_text(sql, encoding="utf-8")
    n_cap = len(roteiros) - sum(1 for r in roteiros if r["passos"] and r["passos"][0]["rotulo"] == "PREENCHER" and not r["passos"][0]["conteudo"])
    print(f"OK {a.saida} · {len(roteiros)} roteiros ({n_cap} com texto capturado)")


if __name__ == "__main__":
    main()
