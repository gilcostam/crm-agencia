"use client";

import { useEffect, useMemo, useState } from "react";
import { Lead } from "@/lib/types";
import { instagramDirectUrl, instagramProfileUrl } from "@/lib/instagram";
import {
  EDITABLE_EXTRA_KEYS,
  buildTemplateVars,
  defaultTemplateIdForStatus,
  fieldLabel,
  getTemplate,
  getTemplatesForChannel,
  renderWhatsappBlocks,
  templateUsesVar,
} from "@/lib/whatsapp-templates";

const CONSULTANT_NAME_KEY = "nolimits_crm_wa_consultor_nome";

function formatMeetingForMessage(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Composer de mensagem de Instagram Direct — irmão do WhatsAppComposerModal
 * (mesmos modelos, mesma busca de concorrentes, mesmo assistente de envio
 * pausado), adaptado a uma diferença fundamental do Instagram: o deep link
 * de DM (ig.me/m/<handle>) abre a conversa mas NÃO aceita texto
 * pré-preenchido como o wa.me do WhatsApp aceita. Por isso aqui o fluxo é
 * sempre "copiar o bloco" + "abrir o Direct" + colar manualmente — o envio
 * em si é sempre um clique humano, nunca automático.
 *
 * Sempre usa os modelos do canal "ativo" (prospecção ativa) — leads de
 * Instagram só existem nesse canal (ver ACTIVE_PROSPECTING_SOURCES em
 * lib/types.ts).
 */
export default function InstagramComposerModal({
  lead,
  onClose,
  onLogged,
}: {
  lead: Lead;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const handle = lead.instagram;
  const templatesForChannel = useMemo(() => getTemplatesForChannel("ativo"), []);

  const [consultor, setConsultor] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState(() => defaultTemplateIdForStatus(lead.status, "ativo"));
  const [blockTexts, setBlockTexts] = useState<string[]>([]);
  const [blockDirty, setBlockDirty] = useState<boolean[]>([]);
  // Mesmo "assistente" pausado do composer de WhatsApp, só que aqui o gatilho
  // que avança pro próximo bloco é copiar o bloco atual (não "abrir" — abrir
  // o Direct não envia nada sozinho, é só copiar+colar que representa a
  // intenção de já ter mandado aquele bloco).
  const [assistantStep, setAssistantStep] = useState(0);
  const [assistantCountdown, setAssistantCountdown] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);
  const [openedDirect, setOpenedDirect] = useState(false);
  const [logging, setLogging] = useState(false);
  const [searchingCompetitors, setSearchingCompetitors] = useState(false);
  const [competitorSearchError, setCompetitorSearchError] = useState<string | null>(null);
  const [leadProfileNote, setLeadProfileNote] = useState<string | null>(null);
  const [leadSiteNote, setLeadSiteNote] = useState<string | null>(null);
  const [competitorsFound, setCompetitorsFound] = useState<
    Array<{ name: string; ratingText: string | null }>
  >([]);

  useEffect(() => {
    setConsultor(window.localStorage.getItem(CONSULTANT_NAME_KEY) ?? "");
  }, []);

  function handleConsultorChange(value: string) {
    setConsultor(value);
    window.localStorage.setItem(CONSULTANT_NAME_KEY, value);
  }

  function handleExtraChange(key: string, value: string) {
    setExtraValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSearchCompetitors() {
    setSearchingCompetitors(true);
    setCompetitorSearchError(null);
    setLeadProfileNote(null);
    setLeadSiteNote(null);
    setCompetitorsFound([]);
    try {
      const res = await fetch(`/api/leads/${lead.id}/competitors`);
      const data = await res.json();
      if (!res.ok) {
        setCompetitorSearchError(data.error ?? "Não foi possível buscar concorrentes.");
        return;
      }

      const extras: Record<string, string> = {};
      if (data.topCompetitorName) {
        extras.concorrente = data.topCompetitorName;
        extras.avaliacoes_concorrente = data.topCompetitorRatingText ?? "";
      } else {
        setCompetitorSearchError("Nenhum concorrente encontrado pra essa categoria/cidade.");
      }

      if (Array.isArray(data.competitors)) {
        setCompetitorsFound(
          data.competitors.map((c: { name: string; rating: number | null; reviewCount: number | null }) => ({
            name: c.name,
            ratingText:
              c.rating != null
                ? `${c.rating.toFixed(1).replace(".", ",")} estrelas${
                    c.reviewCount != null ? ` (${c.reviewCount} avaliações)` : ""
                  }`
                : null,
          }))
        );
      }

      if (data.leadProfile) {
        if (data.leadProfile.hasProfile) {
          extras.avaliacoes = data.leadProfile.reviewCount != null ? String(data.leadProfile.reviewCount) : "";
          extras.tem_perfil = "sim";
          setLeadProfileNote(
            `Perfil do lead encontrado no Google: ${
              data.leadProfile.ratingText ?? "sem nota/avaliações"
            }. Já tem base pra ranquear, falta otimizar (mensagem vai parabenizar em vez de criticar).`
          );
        } else {
          setLeadProfileNote(
            "Não encontramos perfil desse lead no Google (Maps/Perfil da Empresa). A mensagem vai citar isso como um ponto de atenção genérico, sem revelar o quê, pra despertar curiosidade sobre a reunião."
          );
        }

        if (data.leadProfile.hasWebsite) {
          extras.tem_site = "sim";
        } else {
          setLeadSiteNote(
            "Não encontramos site pra esse negócio. Também vira um ponto de atenção genérico na mensagem, sem citar o que é."
          );
        }
      }

      if (Object.keys(extras).length > 0) {
        setExtraValues((prev) => ({ ...prev, ...extras }));
      }
    } catch {
      setCompetitorSearchError("Erro de conexão ao buscar concorrentes.");
    } finally {
      setSearchingCompetitors(false);
    }
  }

  const template = getTemplate(templateId);

  const extraKeysForTemplate = useMemo(
    () => EDITABLE_EXTRA_KEYS.filter((key) => templateUsesVar(template.text, key)),
    [template.text]
  );

  const vars = useMemo(
    () =>
      buildTemplateVars(
        { full_name: lead.full_name, city: lead.city, category: lead.category },
        { consultor, reuniao: formatMeetingForMessage(lead.meeting_datetime), ...extraValues }
      ),
    [lead.full_name, lead.city, lead.category, lead.meeting_datetime, consultor, extraValues]
  );

  const renderedBlocks = useMemo(() => renderWhatsappBlocks(template, vars), [template, vars]);

  useEffect(() => {
    setBlockTexts((prev) => renderedBlocks.blocks.map((b, i) => (blockDirty[i] ? prev[i] ?? b : b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedBlocks.blocks]);

  useEffect(() => {
    setBlockDirty(new Array(renderedBlocks.blocks.length).fill(false));
    setAssistantStep(0);
    setAssistantCountdown(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  useEffect(() => {
    setAssistantStep((prev) => Math.min(prev, blockTexts.length));
  }, [blockTexts.length]);

  useEffect(() => {
    if (assistantCountdown === null) return;
    if (assistantCountdown <= 0) {
      setAssistantCountdown(null);
      return;
    }
    const timer = setTimeout(() => setAssistantCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [assistantCountdown]);

  async function logEvent(finalText: string) {
    setLogging(true);
    try {
      await fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "note",
          message: `Mensagem de Instagram Direct preparada (modelo "${template.label}"): "${finalText.slice(0, 200)}${
            finalText.length > 200 ? "…" : ""
          }"`,
        }),
      });
      onLogged?.();
    } catch {
      // best-effort, não impede o uso da mensagem
    } finally {
      setLogging(false);
    }
  }

  // Abre a conversa no Direct (sem texto pré-preenchido — limitação do
  // próprio Instagram). Loga só na primeira vez que o consultor abre,
  // independente de quantos blocos existam.
  function handleOpenDirect() {
    if (!handle) return;
    window.open(instagramDirectUrl(handle), "_blank", "noopener,noreferrer");
    if (!openedDirect) {
      setOpenedDirect(true);
      if (blockTexts.length === 1) {
        logEvent(blockTexts[0] ?? "");
      }
    }
  }

  // "Copiar bloco" é o gatilho que avança o assistente (equivalente ao
  // "abrir com este bloco" do WhatsApp) — aqui não existe um envio
  // automático, então o sinal de "esse bloco já foi tratado" é o consultor
  // ter copiado o texto pra colar manualmente no Direct.
  async function handleCopyBlockAndAdvance(index: number) {
    try {
      await navigator.clipboard.writeText(blockTexts[index] ?? "");
      setCopiedBlock(index);
      setTimeout(() => setCopiedBlock((c) => (c === index ? null : c)), 2000);
    } catch {
      // clipboard pode falhar em contexto não seguro, sem tratamento especial
    }
    if (index === 0) {
      logEvent(blockTexts.join("\n\n"));
    }
    if (blockTexts.length > 1) {
      const next = index + 1;
      setAssistantStep(next);
      setAssistantCountdown(next < blockTexts.length ? 7 : null);
    }
  }

  function blockButtonLabel(index: number): string {
    if (index < assistantStep) return "Já copiado";
    if (index === assistantStep) {
      return assistantCountdown !== null ? `Aguarde ${assistantCountdown}s...` : "Copiar este bloco";
    }
    return "Aguardando bloco anterior";
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(blockTexts.join("\n\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard pode falhar em contexto não seguro, sem tratamento especial
    }
  }

  function handleBlockChange(index: number, value: string) {
    setBlockTexts((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setBlockDirty((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
  }

  function handleRestoreBlock(index: number) {
    setBlockDirty((prev) => {
      const next = [...prev];
      next[index] = false;
      return next;
    });
    setBlockTexts((prev) => {
      const next = [...prev];
      next[index] = renderedBlocks.blocks[index] ?? "";
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-serif text-lg text-neutral-900">{lead.full_name || "Sem nome"}</h3>
            {handle ? (
              <a
                href={instagramProfileUrl(handle)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-fuchsia-700 underline decoration-dotted hover:text-fuchsia-900"
              >
                @{handle}
              </a>
            ) : (
              <p className="text-xs text-neutral-400">sem Instagram cadastrado</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none text-neutral-400 hover:text-neutral-900"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="mb-3 rounded-md border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-[11px] text-fuchsia-800">
          ⚠️ O Instagram não permite pré-preencher o texto da mensagem via link (diferente do WhatsApp). Copie o
          bloco abaixo e cole você mesmo na conversa do Direct depois de clicar em &quot;Abrir Direct no
          Instagram&quot;.
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
              Seu nome
            </span>
            <input
              type="text"
              value={consultor}
              onChange={(e) => handleConsultorChange(e.target.value)}
              placeholder="ex.: Gil"
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </label>
          {extraKeysForTemplate.map((key) => (
            <label key={key} className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                {fieldLabel(key)} (opcional)
              </span>
              <input
                type="text"
                value={extraValues[key] ?? ""}
                onChange={(e) => handleExtraChange(key, e.target.value)}
                placeholder="ex.: 150"
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              />
            </label>
          ))}
        </div>

        <div className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 p-2.5">
          <button
            type="button"
            onClick={handleSearchCompetitors}
            disabled={searchingCompetitors || !lead.category || !lead.city}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            {searchingCompetitors ? "Buscando concorrentes..." : "Buscar concorrentes no Google"}
          </button>
          {(!lead.category || !lead.city) && (
            <p className="mt-1 text-[11px] text-neutral-400">
              Cadastre categoria e cidade do lead pra usar essa busca.
            </p>
          )}
          {extraKeysForTemplate.includes("concorrente") ||
          extraKeysForTemplate.includes("avaliacoes_concorrente") ? (
            <p className="mt-1 text-[11px] text-neutral-400">
              Preenche automaticamente os campos de concorrente acima quando encontrar resultado.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-neutral-400">
              O modelo atual não usa esses dados na mensagem, mas o resultado aparece abaixo mesmo assim.
            </p>
          )}
          {competitorSearchError && (
            <p className="mt-1 text-[11px] text-amber-700">{competitorSearchError}</p>
          )}
          {leadProfileNote && <p className="mt-1 text-[11px] text-sky-700">{leadProfileNote}</p>}
          {leadSiteNote && <p className="mt-1 text-[11px] text-sky-700">{leadSiteNote}</p>}
          {competitorsFound.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-600">
              {competitorsFound.map((c, i) => (
                <li key={`${c.name}-${i}`}>
                  {i + 1}. {c.name}
                  {c.ratingText ? ` (${c.ratingText})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>

        {renderedBlocks.missing.length > 0 && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Faltou preencher: {renderedBlocks.missing.map(fieldLabel).join(", ")}.</strong> A(s) frase(s)
            que usava(m) esse(s) campo(s) não entraram na mensagem. Preencha acima (ou edite o texto abaixo à
            mão).
          </div>
        )}

        {blockTexts.length > 1 ? (
          <div className="mb-3 space-y-2">
            <p className="text-[11px] text-neutral-500">
              Mensagem dividida em {blockTexts.length} blocos. Copie bloco por bloco e cole no Direct: liberamos
              o próximo automaticamente depois de ~7s, simulando uma pausa natural de digitação.
            </p>
            {blockTexts.map((blockText, i) => (
              <div key={i} className="rounded-md border border-neutral-200 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                    Bloco {i + 1} de {blockTexts.length}
                  </span>
                  {blockDirty[i] && (
                    <button
                      type="button"
                      onClick={() => handleRestoreBlock(i)}
                      className="text-[10px] text-neutral-400 underline decoration-dotted hover:text-neutral-700"
                    >
                      Restaurar
                    </button>
                  )}
                </div>
                <textarea
                  value={blockText}
                  onChange={(e) => handleBlockChange(i, e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                />
                <div className="mt-1 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={logging || i !== assistantStep || assistantCountdown !== null}
                    onClick={() => handleCopyBlockAndAdvance(i)}
                    className="text-[10px] font-medium text-fuchsia-700 underline decoration-dotted hover:text-fuchsia-900 disabled:opacity-40"
                  >
                    {copiedBlock === i ? "Copiado!" : blockButtonLabel(i)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <textarea
              value={blockTexts[0] ?? ""}
              onChange={(e) => handleBlockChange(0, e.target.value)}
              rows={9}
              className="mb-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800"
            />
            {blockDirty[0] && (
              <button
                type="button"
                onClick={() => handleRestoreBlock(0)}
                className="mb-3 text-[11px] text-neutral-400 underline decoration-dotted hover:text-neutral-700"
              >
                Restaurar texto do modelo
              </button>
            )}
          </>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!handle}
            onClick={handleOpenDirect}
            title={!handle ? "Lead sem Instagram cadastrado" : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-fuchsia-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-fuchsia-700 disabled:opacity-50"
          >
            📷 Abrir Direct no Instagram
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            {copied ? "Copiado!" : "Copiar mensagem completa"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Cancelar
          </button>
        </div>

        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
          Modelo
        </label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="mb-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          {templatesForChannel.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-neutral-400">
          <strong>{template.label}</strong>: {template.description} O texto acima é editável e vale só para esta
          mensagem.
        </p>
      </div>
    </div>
  );
}
