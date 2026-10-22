// APOSENTADA em 17/10/2026. Recebia os eventos da UazAPI; o CRM agora usa só o OpenWA,
// cujos eventos entram por openwa-webhook. Mantida no ar só para responder 410 (Gone)
// a qualquer entrega atrasada da UazAPI, sem gravar nada. O código antigo está no git
// (antes do commit que aposentou a UazAPI). Os dados já gravados continuam no banco.
import { respostaUazapiAposentada } from "../_shared/waProxy.ts";

Deno.serve(() => respostaUazapiAposentada());
