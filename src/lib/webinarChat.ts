export interface ChatMessage {
  minute: number;
  sender: string;
  message: string;
}

// Test mode: 10-minute webinar — messages spread across minutes 0-10
export const CHAT_MESSAGES: ChatMessage[] = [
  { minute: 0, sender: "João Silva", message: "Começou! 🔥" },
  { minute: 1, sender: "Maria Santos", message: "Primeira vez aqui!" },
  { minute: 2, sender: "Pedro Costa", message: "Boa noite pessoal" },
  { minute: 3, sender: "Ana Lima", message: "Anotando tudo 📝" },
  { minute: 4, sender: "Carlos Dias", message: "Já apliquei e funcionou!" },
  { minute: 5, sender: "Juliana Mendes", message: "Essa parte é ouro 💎" },
  { minute: 6, sender: "Roberto Alves", message: "Isso muda tudo mesmo" },
  { minute: 7, sender: "Fernanda Costa", message: "Minha vida mudou com isso" },
  { minute: 8, sender: "Breno Xavier", message: "@Fernanda que bom! 🙌" },
  { minute: 9, sender: "Larissa Oliveira", message: "Obrigada Breno!" },
  { minute: 10, sender: "Paulo Santos", message: "Top demais 🚀" },
];

export const HOST_NAMES = new Set(["Breno Xavier"]);
