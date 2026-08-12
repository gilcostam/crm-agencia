"use client";

import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Leads", icon: LeadsIcon },
  { href: "/dashboard/clientes", label: "Clientes", icon: ClientsIcon },
  { href: "/dashboard/propostas", label: "Propostas", icon: ProposalsIcon },
  { href: "/dashboard/metricas", label: "Métricas", icon: MetricsIcon },
];

function LeadsIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="4" width="4.2" height="12" rx="1" />
      <rect x="7.9" y="4" width="4.2" height="8" rx="1" />
      <rect x="13.3" y="4" width="4.2" height="15" rx="1" />
    </svg>
  );
}

function ClientsIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="7" cy="6.5" r="2.8" />
      <path d="M2 17c0-3 2.2-5 5-5s5 2 5 5" strokeLinecap="round" />
      <circle cx="15" cy="7.5" r="2.2" />
      <path d="M13.5 12.3c2.3.2 3.8 1.9 3.8 4.7" strokeLinecap="round" />
    </svg>
  );
}

function ProposalsIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5 2.5h7l3 3V17a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" strokeLinejoin="round" />
      <path d="M12 2.5V6h3" strokeLinejoin="round" />
      <path d="M6.5 10h6M6.5 13h4" strokeLinecap="round" />
    </svg>
  );
}

function MetricsIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 17V9M8.5 17V3M14 17v-6M19 17H1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-neutral-200 bg-white md:h-screen md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 px-4 py-4 md:border-b md:border-neutral-200">
        <Image
          src="/logo.png"
          alt="No Limits"
          width={1000}
          height={300}
          priority
          className="h-7 w-auto"
        />
      </div>

      <nav className="flex flex-1 flex-row gap-1 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:py-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === "/dashboard" : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
              }`}
            >
              <Icon />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-neutral-200 px-2 py-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
