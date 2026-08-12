"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Não foi possível entrar.");
        setLoading(false);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Erro de conexão. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <Image
          src="/logo.png"
          alt="No Limits"
          width={1000}
          height={300}
          priority
          className="mx-auto mb-6 h-auto w-full max-w-[220px]"
        />
        <h1 className="mb-1 text-center font-serif text-2xl text-neutral-900">
          Acessar o CRM
        </h1>
        <p className="mb-8 text-center text-sm text-neutral-500">
          Gestão de leads, clientes e propostas
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500"
            >
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-neutral-900 outline-none focus:border-neutral-900"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-neutral-900 py-2 text-sm font-medium uppercase tracking-wide text-white transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {loading ? "Entrando..." : "Entrar na plataforma"}
          </button>
        </form>
      </div>
    </div>
  );
}
