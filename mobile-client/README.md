# Cliente da API do app da aluna

Cliente tipado da `mobile-v1`, pronto para o app React Native.
Não é um pacote publicado: **copie `src/` para o seu projeto**.

```bash
cp -r mobile-client/src <seu-app>/src/api
```

Depende de `@supabase/supabase-js` (para o login) e, se for usar push, dos
módulos `expo-notifications` / `expo-device`. Nada mais — `cliente.ts` usa só
`fetch`, então roda igual no Node, no Expo e no React Native puro.

| arquivo | o que faz |
|---|---|
| `tipos.ts` | o contrato em TypeScript + a classe `ErroApi` |
| `cliente.ts` | `ClienteApi`: um método por endpoint, com timeout e erro tratado |
| `auth.ts` | Supabase Auth adaptado para React Native (storage, sem callback de URL) |
| `push.ts` | permissão, token do Expo, registro no backend e deep link |

O passo a passo de uso está em [`docs/app-nativo.md`](../docs/app-nativo.md).
O contrato completo, em [`docs/mobile-api.yaml`](../docs/mobile-api.yaml).
