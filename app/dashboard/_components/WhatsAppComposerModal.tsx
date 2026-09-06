"use client";

import { useEffect, useMemo, useState } from "react";
import { Lead } from "@/lib/types";
import { sanitizePhone } from "@/lib/phone";
import {
  EDITABLE_EXTRA_KEYS,
  buildTemplateVars,
  defaultTemplateIdForStatus,
  fieldLabel,
  getTemplate,
  getTemplatesForChannel,
  renderWhatsappBlocks,
  templateUsesVar,
  whatsappChannelForSource,
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
 * Composer de mensagem de WhatsApp com modelos por estágio do funil
 * (ver lib/whatsapp-templates.ts), no mesmo espírito da ferramenta "TNG
 * Pesquisa" já usada na prospecção ativa: mostra um preview editável,
 * avisa quando falta preencher algum dado usado no modelo, e só abre o
 * WhatsApp quando o usuário confirma, em vez de disparar direto um texto
 * fixo e genérico (como fazia o antigo link "Conversar no WhatsApp").
 *
 * Os modelos mudam conforme o canal do lead (ver whatsappChannelForSource):
 * leads de Meta Ads/Trello já recebem uma boas-vindas automática assim que
 * chegam, então pra eles o composer sugere direto o modelo de diagnóstico
 * (2º contato) em vez de uma "primeira abordagem" do zero.
 */
export default function WhatsAppComposerModal({
  lead,
  onClose,
  onLogged,
}: {
  lead: Lead;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const digits = sanitizePhone(lead.phone);
  const channel = useMemo(() => whatsappChannelForSource(lead.source), [lead.source]);
  const templatesForChannel = useMemo(() => getTemplatesForChannel(channel), [channel]);

  const [consultor, setConsultor] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState(() => defaultTemplateIdForStatus(lead.status, channel));
  // Mensagem representada como uma lista de blocos (ver renderWhatsappBlocks
  // em lib/whatsapp-templates.ts). Pra modelos sem `blocks` (a maioria), essa
  // lista sempre tem 1 item só, e a UI se comporta exatamente como antes (uma
  // única textarea). `blockDirty` espelha `blockTexts` pra saber quais blocos
  // o vendedor já editou à mão (e por isso não devem ser sobrescritos quando
  // os dados do lead/extras mudam).
  const [blockTexts, setBlockTexts] = useState<string[]>([]);
  const [blockDirty, setBlockDirty] = useState<boolean[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);
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

  // Automatiza o preenchimento manual de "concorrente" / "avaliacoes_concorrente"
  // (usado no modelo de diagnóstico) buscando no Google/Google Maps, via
  // Serper.dev, quem aparece na frente do lead pra categoria + cidade dele.
  // O botão fica visível pra qualquer lead/modelo (não só o de diagnóstico):
  // os campos extras só aparecem no formulário quando o modelo selecionado
  // os usa, mas o resultado da busca em si (lista de concorrentes, perfil do
  // lead no Google) é útil independentemente do modelo escolhido.
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

      // leadProfile vem da checagem de que o próprio lead tem (ou não) um
      // perfil encontrável no Google, e se esse perfil lista um site.
      // `tem_perfil`/`tem_site` alimentam o modelo de diagnóstico em blocos
      // (ver DIAGNOSTICO_IA_BLOCKS em lib/whatsapp-templates.ts): quando
      // ausentes, o bloco correspondente na mensagem vira um alerta genérico
      // (sem revelar qual é o problema) em vez de citar o dado direto — não
      // ter perfil/site não é um erro, é um achado a favor da venda.
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

  // Só os campos que o modelo selecionado realmente usa aparecem como
  // inputs extras, pra não poluir o composer com campos que a mensagem
  // atual nem referencia.
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

  // Regera os blocos a partir do modelo quando o modelo muda (ou os dados
  // usados nele mudam), mas só pros blocos que o usuário não tiver editado
  // manualmente (por índice), pra nunca sobrescrever uma edição já feita.
  useEffect(() => {
    setBlockTexts((prev) => renderedBlocks.blocks.map((b, i) => (blockDirty[i] ? prev[i] ?? b : b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedBlocks.blocks]);

  useEffect(() => {
    setBlockDirty(new Array(renderedBlocks.blocks.length).fill(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function logEvent(finalText: string) {
    setLogging(true);
    try {
      await fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "note",
          message: `Mensagem de WhatsApp preparada (modelo "${template.label}"): "${finalText.slice(0, 200)}${
            finalText.length > 200 ? "…" : ""
          }"`,
        }),
      });
      onLogged?.();
    } catch {
      // best-effort, não impede o envio da mensagem
    } finally {
      setLogging(false);
    }
  }

  // Abre o WhatsApp já com o 1º bloco preenchido (wa.me só aceita um texto
  // pré-preenchido por link) — os blocos seguintes (quando existem, ver
  // renderWhatsappBlocks) ficam pra colar um a um manualmente, com uma pausa
  // natural entre eles, em vez de mandar tudo de uma vez como um bloco só.
  // O evento registrado na timeline usa a mensagem completa (todos os
  // blocos), pra manter o histórico fiel ao que de fato foi combinado.
  function handleOpenWhatsapp() {
    if (!digits) return;
    const firstBlock = blockTexts[0] ?? "";
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(firstBlock)}`, "_blank", "noopener,noreferrer");
    logEvent(blockTexts.join("\n\n"));
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

  async function handleCopyBlock(index: number) {
    try {
      await navigator.clipboard.writeText(blockTexts[index] ?? "");
      setCopiedBlock(index);
      setTimeout(() => setCopiedBlock((c) => (c === index ? null : c)), 2000);
    } catch {
      // clipboard pode falhar em contexto não seguro, sem tratamento especial
    }
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
            <p className="text-xs text-neutral-400">{lead.phone || "sem telefone"}</p>
            {channel === "pago" && (
              <p className="mt-1 text-[11px] text-emerald-600">
                Tráfego pago: já recebeu a mensagem de boas-vindas automática.
              </p>
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
              Mensagem dividida em {blockTexts.length} blocos. Copie e mande cada um como uma mensagem separada
              no WhatsApp, com uma pequena pausa entre eles, pra soar como uma conversa normal em vez de um
              texto único gigante (e não parecer bot).
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
                    onClick={() => handleCopyBlock(i)}
                    className="text-[10px] font-medium text-neutral-700 underline decoration-dotted hover:text-neutral-900"
                  >
                    {copiedBlock === i ? "Copiado!" : "Copiar este bloco"}
                  </button>
                  {i === 0 && (
                    <button
                      type="button"
                      disabled={!digits || logging}
                      onClick={handleOpenWhatsapp}
                      className="text-[10px] font-medium text-emerald-700 underline decoration-dotted hover:text-emerald-900 disabled:opacity-50"
                    >
                      Abrir WhatsApp com este bloco
                    </button>
                  )}
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
            disabled={!digits || logging}
            onClick={handleOpenWhatsapp}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Abrir WhatsApp
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            {copied ? "Copiado!" : "Copiar"}
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
