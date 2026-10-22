import { Link } from "react-router-dom";

export default function ParceriaObrigado() {
  return (
    <div
      style={{ background: "#0a0a0a", color: "#f5f5f5", fontFamily: "Inter, system-ui, sans-serif" }}
      className="min-h-screen flex items-center justify-center px-4"
    >
      <div
        className="max-w-md w-full text-center p-8 space-y-5"
        style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 12 }}
      >
        <p className="text-xs tracking-[0.2em] font-semibold" style={{ color: "#c9a876" }}>
          CANDIDATURA RECEBIDA
        </p>
        <h1 className="text-2xl md:text-3xl font-bold">Recebi sua candidatura.</h1>
        <p style={{ color: "#a3a3a3" }}>
          Nossa equipe vai analisar seu perfil com calma. Se fizer sentido, entramos em contato pelo WhatsApp que você
          informou.
        </p>
        <Link
          to="/parceria"
          className="inline-block text-xs underline-offset-4 hover:underline"
          style={{ color: "#c9a876" }}
        >
          voltar
        </Link>
      </div>
    </div>
  );
}
