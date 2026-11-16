import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  WHATSAPP_TEMPLATES,
  buildTemplateVars,
  renderWhatsappBlocks,
  noteEhConfirmacao,
} from "@/lib/whatsapp-templates";

/**
 * Lembrete automático de reunião, contra o no-show.
 *
 * Por que existe: nas 41 reuniões medidas na base, as 22 que receberam
 * alguma confirmação deram 18% de no-show e as 19 que não receberam deram
 * 58%. A mensagem que faz essa diferença já existia escrita; o que faltava
 * era alguém lembrar de mandar na véspera, e isso só acontecia quando a
 * agência abria o CRM no dia certo.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POR QUE UM WEBHOOK NOVO, E NÃO O N8N_WHATSAPP_WEBHOOK_URL QUE JÁ EXISTE
 *
 * Aquele webhook dispara o fluxo de BOAS-VINDAS do n8n, que é a mensagem de
 * primeiro contato ("encontrei vocês numa pesquisa..."). Mandar o payload de
 * lembrete pra ele não faria o n8n mandar um lembrete: faria o n8n mandar
 * uma boas-vindas pra alguém que já tem reunião marcada pra amanhã. É pior
 * do que não mandar nada, porque o lead conclui que ninguém ali sabe quem
 * ele é, e aí ele não aparece mesmo.
 *
 * Então o lembrete usa N8N_LEMBRETE_WEBHOOK_URL, uma variável própria. Sem
 * ela configurada, esta rota não envia nada e devolve "não configurado".
 * Essa é a falha segura: enquanto o fluxo novo não existir no n8n, o pior
 * que acontece é o cron rodar à toa.
 *
 * O TEXTO VAI PRONTO NO PAYLOAD
 *
 * O n8n recebe `mensagem` já renderizada e só entrega. A redação fica aqui,
 * versionada junto com os outros modelos, em vez de duplicada dentro de um
 * nó do n8n onde ninguém revisa e onde ela sairia do ar em silêncio toda vez
 * que o texto daqui mudasse.
 * ──────────────────────────────────────────────────────────────────────────
 */

/** Janela de disparo, em horas a partir de agora.
 *
 * A confirmação que funciona sai na véspera: no dia da reunião a pessoa já
 * organizou a agenda dela e a mensagem vira aviso, não combinação. O piso de
 * 6h evita mandar "até amanhã" pra uma reunião que começa em uma hora, caso
 * ela tenha sido marcada em cima da hora (a mediana de antecedência da base
 * é de 8 horas, então isso acontece). */
const JANELA_MIN_H = 6;
const JANELA_MAX_H = 36;

/** Confirmação manual recente desliga o envio automático. Se a agência
 * acabou de falar com o lead, o robô mandando a mesma coisa logo depois
 * entrega que é robô. */
const JANELA_CONFIRMACAO_MANUAL_H = 24;

/** Marca do envio automático na timeline. Leva a data da reunião dentro,
 * de propósito: se a reunião for remarcada, a marca antiga não serve mais e
 * o lembrete da nova data sai normalmente. */
function marcaLembrete(meetingDatetime: string): string {
  return `Lembrete automático de reunião enviado (reunião de ${meetingDatetime})`;
}

export async function GET(request: NextRequest) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) {
    return NextResponse.json({ error: "CRON_SECRET não configurada" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhook = process.env.N8N_LEMBRETE_WEBHOOK_URL;
  if (!webhook) {
    /* 200 e não 500: não é erro, é "ainda não ligado". O cron rodando todo
       dia contra um 500 vira alerta de falha que ninguém mais lê. */
    return NextResponse.json({
      ok: true,
      enviados: 0,
      aviso:
        "N8N_LEMBRETE_WEBHOOK_URL não configurada. Crie o fluxo de lembrete no n8n e aponte essa variável pra ele. Nada foi enviado.",
    });
  }

  const template = WHATSAPP_TEMPLATES.find((t) => t.id === "lembrete_reuniao");
  if (!template) {
    return NextResponse.json({ error: "modelo lembrete_reuniao não encontrado" }, { status: 500 });
  }

  const supabase = createServiceClient();
  const agora = Date.now();
  const de = new Date(agora + JANELA_MIN_H * 36e5).toISOString();
  const ate = new Date(agora + JANELA_MAX_H * 36e5).toISOString();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, full_name, phone, city, category, meeting_datetime")
    .is("merged_into_lead_id", null)
    .eq("status", "reuniao_marcada")
    .gte("meeting_datetime", de)
    .lte("meeting_datetime", ate);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const candidatos = (leads ?? []).filter((l) => l.phone && l.meeting_datetime);
  if (candidatos.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0, janela: { de, ate } });
  }

  /* Uma consulta só pra todos os candidatos, em vez de uma por lead. */
  const { data: eventos } = await supabase
    .from("lead_events")
    .select("lead_id, type, message, created_at")
    .in(
      "lead_id",
      candidatos.map((l) => l.id)
    )
    .order("created_at", { ascending: false });

  const porLead = new Map<string, { type: string; message: string; created_at: string }[]>();
  for (const e of eventos ?? []) {
    const lista = porLead.get(e.lead_id as string) ?? [];
    lista.push(e as { type: string; message: string; created_at: string });
    porLead.set(e.lead_id as string, lista);
  }

  const resultado: { lead: string; acao: string }[] = [];
  let enviados = 0;

  for (const lead of candidatos) {
    const historico = porLead.get(lead.id) ?? [];
    const marca = marcaLembrete(lead.meeting_datetime as string);

    if (historico.some((e) => e.message === marca)) {
      resultado.push({ lead: lead.id, acao: "ja_enviado" });
      continue;
    }

    const confirmouNaMao = historico.some(
      (e) =>
        e.type === "note" &&
        noteEhConfirmacao(e.message) &&
        agora - new Date(e.created_at).getTime() < JANELA_CONFIRMACAO_MANUAL_H * 36e5
    );
    if (confirmouNaMao) {
      resultado.push({ lead: lead.id, acao: "confirmado_na_mao" });
      continue;
    }

    const quando = new Date(lead.meeting_datetime as string).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const vars = buildTemplateVars(lead, {
      reuniao: quando,
      /* Sem nome configurado a assinatura some sozinha (ver SIGNATURE), e a
         mensagem continua inteira. Melhor isso do que assinar com um nome
         chutado. */
      consultor: process.env.CRM_CONSULTOR_NOME ?? null,
    });
    const { blocks } = renderWhatsappBlocks(template, vars, "pt");
    const mensagem = blocks.join("\n\n");

    try {
      const resposta = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          full_name: lead.full_name,
          telefone: lead.phone,
          cidade: lead.city,
          especialidade: lead.category,
          reuniao: lead.meeting_datetime,
          reuniao_formatada: quando,
          mensagem,
        }),
      });

      if (!resposta.ok) {
        const texto = await resposta.text().catch(() => "");
        console.error(`cron/lembretes: n8n respondeu ${resposta.status} (lead ${lead.id}): ${texto}`);
        resultado.push({ lead: lead.id, acao: `erro_n8n_${resposta.status}` });
        continue;
      }
    } catch (err) {
      console.error(`cron/lembretes: falha de conexão com o n8n (lead ${lead.id}):`, err);
      resultado.push({ lead: lead.id, acao: "erro_conexao" });
      continue;
    }

    /* Só grava depois do envio dar certo. Gravar antes faria um lembrete que
       falhou contar como enviado, e ele nunca mais sairia: a marca existe
       justamente pra impedir o reenvio. */
    await supabase.from("lead_events").insert({
      lead_id: lead.id,
      type: "whatsapp_sent",
      message: marca,
    });
    await supabase.from("lead_events").insert({
      lead_id: lead.id,
      type: "note",
      message: `Mensagem de WhatsApp preparada (modelo "${template.label}"): "${mensagem.slice(0, 200)}${
        mensagem.length > 200 ? "…" : ""
      }"`,
    });

    enviados += 1;
    resultado.push({ lead: lead.id, acao: "enviado" });
  }

  return NextResponse.json({ ok: true, enviados, janela: { de, ate }, resultado });
}
