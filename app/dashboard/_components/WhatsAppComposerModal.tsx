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
  renderWhatsappTemplate,
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
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logging, setLogging] = useState(false);

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

  const rendered = useMemo(() => renderWhatsappTemplate(template.text, vars), [template.text, vars]);

  // Regera o texto a partir do modelo quando o modelo muda (ou os dados
  // usados nele mudam), mas só enquanto o usuário não tiver editado o
  // texto manualmente, pra nunca sobrescrever uma edição já feita.
  useEffect(() => {
    if (!dirty) setText(rendered.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.text]);

  useEffect(() => {
    setDirty(false);
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

  function handleOpenWhatsapp() {
    if (!digits) return;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    logEvent(text);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

        {rendered.missing.length > 0 && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Faltou preencher: {rendered.missing.map(fieldLabel).join(", ")}.</strong> A(s) frase(s) que
            usava(m) esse(s) campo(s) não entraram na mensagem. Preencha acima (ou edite o texto abaixo à mão).
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          rows={9}
          className="mb-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800"
        />
        {dirty && (
          <button
            type="button"
            onClick={() => setDirty(false)}
            className="mb-3 text-[11px] text-neutral-400 underline decoration-dotted hover:text-neutral-700"
          >
            Restaurar texto do modelo
          </button>
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
