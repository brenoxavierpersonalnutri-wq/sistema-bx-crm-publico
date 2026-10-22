// Tema escuro do CRM: enquanto o LayoutCRM está montado, o <html> recebe "dark crm-dark" (os portais
// do shadcn moram no <body> e herdam). Ao sair do /crm devolve exatamente o estado anterior.
import { useEffect } from "react";
import "./crm-dark.css";

export function useTemaCRM() {
  useEffect(() => {
    const html = document.documentElement;
    const tinhaDark = html.classList.contains("dark");
    html.classList.add("dark", "crm-dark");
    return () => {
      html.classList.remove("crm-dark");
      html.classList.toggle("dark", tinhaDark);
    };
  }, []);
}
