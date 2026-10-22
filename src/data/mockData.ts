import { Consultation, LeadQuality, ConsultationStatus } from "@/types/consultation";

const names = [
  "Maria Silva", "João Santos", "Ana Oliveira", "Pedro Costa",
  "Carla Souza", "Lucas Lima", "Fernanda Alves", "Rafael Pereira",
  "Juliana Rocha", "Bruno Ferreira", "Patrícia Mendes", "Diego Martins",
];

const observations = [
  "Achou caro demais",
  "Vai pensar e retornar",
  "Não era o que esperava",
  "Decidiu ir com concorrente",
  "Precisa consultar cônjuge",
  "Sem urgência no momento",
  "",
];

const qualities: LeadQuality[] = ["quente", "morno", "frio"];
const statuses: ConsultationStatus[] = ["convertido", "não convertido", "no-show"];

function randomDate(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
  return date.toISOString().split("T")[0];
}

export function generateMockData(): Consultation[] {
  return Array.from({ length: 25 }, (_, i) => {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    return {
      id: `c-${i + 1}`,
      clientName: names[Math.floor(Math.random() * names.length)],
      clientPhone: null,
      date: randomDate(14),
      startTime: null,
      endTime: null,
      status,
      leadQuality: qualities[Math.floor(Math.random() * qualities.length)],
      observation: status === "não convertido"
        ? observations[Math.floor(Math.random() * (observations.length - 1))]
        : "",
      attended: null,
      converted: null,
      closerObservation: "",
      receivedReminderMessages: null,
      via: null,
      ticketValue: null,
      paymentMethod: null,
      gaveSignal: null,
      signalValue: null,
      signalFollowUpDate: null,
      signalResiduePaid: null,
      negotiating: null,
    };
  });
}
