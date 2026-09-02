"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Seletor de mês (input nativo `type="month"`) usado no card "Tráfego pago
 * por mês" da página de Métricas. Ao trocar o mês, navega pra mesma página
 * com `?mes=YYYY-MM` na URL — a página em si é um server component que lê
 * esse parâmetro e recalcula os números, então este componente só precisa
 * empurrar a navegação, sem guardar nenhum estado próprio.
 */
export default function MonthFilter({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const newMonth = event.target.value;
    if (!newMonth) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("mes", newMonth);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <input
      type="month"
      value={month}
      onChange={handleChange}
      aria-label="Selecionar mês"
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 shadow-sm focus:border-neutral-500 focus:outline-none"
    />
  );
}
