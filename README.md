# Quiz ao Vivo

Quiz interativo em tempo real. O apresentador projeta o QR Code e até **250 participantes** entram pelo celular, sem precisar de conta, e respondem ao vivo.

Stack: Node.js 18+ · Express · Socket.IO (WebSocket) · front-end em HTML/JS puro, sem etapa de build.

**O servidor não grava nada em disco.** Os quizzes (com as imagens, já reduzidas) e os resultados ficam salvos no navegador do apresentador; para trocar de computador, use **Backup / Importar** em /admin. Por isso o app roda em hospedagens gratuitas, cujo disco é apagado (ex.: Render Free).

## Rodando localmente

```bash
npm install
ADMIN_PASSWORD=minhasenha npm start
# abra http://localhost:3000/admin
```

Para testar com celulares na mesma rede Wi-Fi, acesse pelo IP da máquina (ex.: `http://192.168.0.10:3000/admin`). Assim o QR Code aponta para um endereço que o celular alcança.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `ADMIN_PASSWORD` | `admin` | Senha da área administrativa. **Troque em produção.** |
| `PUBLIC_URL` | (endereço acessado) | URL pública usada no QR Code, ex.: `https://quiz.suaempresa.com.br` |
| `PORT` | `3000` | Porta HTTP |
| `MAX_PARTICIPANTS` | `250` | Limite por sessão |

## Publicação

O app precisa de **um único processo Node com WebSocket**. Funciona em qualquer VPS, Render, Railway, Fly.io etc.

**Render (gratuito):** New › Web Service › conectar o repositório › Build `npm install` › Start `npm start` › Instance type **Free** › variável `ADMIN_PASSWORD`. O endereço do QR Code é detectado sozinho. O serviço dorme após 15 min sem uso: abra o link 1–2 min antes do evento.

**Docker:**
```bash
docker build -t quiz-ao-vivo .
docker run -d -p 3000:3000 -e ADMIN_PASSWORD=... -e PUBLIC_URL=https://... quiz-ao-vivo
```

- Use HTTPS (a câmera do celular abre links https sem aviso).
- Atrás de Nginx, repasse os cabeçalhos de WebSocket (`Upgrade`/`Connection`).
- Rode **uma instância só**: o estado da sessão ao vivo fica em memória. Uma instância pequena (1 vCPU / 512 MB) aguenta 250 participantes com folga.

## Como usar

1. **/admin**: crie o quiz (ou carregue o quiz de exemplo) (título, descrição, capa, mensagens de abertura e encerramento, perguntas com 2 a 6 alternativas, tempo de 5 a 120 s, pontuação, imagens). Para reordenar as perguntas, arraste pelo ⠿. O editor salva sozinho.
2. **Pré-visualizar**: simula o celular do participante, passo a passo.
3. **Iniciar**: abre a tela do apresentador com QR Code, código da sala e nomes de quem entrou. Ponha em tela cheia (F) no projetor.
4. Os participantes escaneiam o QR Code, digitam o nome e esperam. Também podem acessar `/join` e digitar o código.
5. Para conduzir o quiz, use os botões da barra inferior ou os atalhos: **Espaço/→** avança, **P** pausa ou retoma, **H** oculta os controles. Pelo painel 👥 você remove participantes. Também dá para bloquear novas entradas.
6. No final, exporte para **Excel** ou **CSV**. O resultado também fica salvo no navegador, em /admin › Resultados.

## Regras de pontuação

- **Fixa**: acerto vale a pontuação máxima; erro ou ausência de resposta vale 0.
- **Por tempo**: `pontos = máx × (1 − 0,5 × tempo_gasto / tempo_limite)`. Uma resposta instantânea vale 100% e uma no último segundo vale 50%. Erro vale 0.
- **Várias respostas corretas**: tudo ou nada. Só pontua quem marcar exatamente todas as corretas.
- **Desempate no ranking**: menor tempo somado nas respostas corretas. Pontuações iguais dividem a posição.
- O tempo é medido no servidor, com tolerância de 0,6 s para a latência da rede. Quando todos os conectados respondem, a pergunta fecha sozinha.

## Configurações por quiz

Pontuação por tempo · mostrar a resposta correta · mostrar a pontuação individual no celular · classificação (durante, só no final ou nunca) · tamanho do ranking (Top 3/5/10/20/todos) · embaralhar perguntas · embaralhar alternativas.

## Testes

```bash
npm test                                        # regras de pontuação, validação, CSV
npm run loadtest -- http://localhost:3000 250 senha   # 250 participantes simulados
```

Resultado do teste de carga com 250 clientes: entradas em p95 = 2 ms; respostas em p99 = 3 ms; 1.250/1.250 respostas registradas; 0 erros.

## Reconexão

Se o participante recarregar a página ou perder o sinal, ele volta automaticamente com o mesmo nome e a mesma pontuação (o identificador fica salvo no navegador). Se o servidor reiniciar durante uma sessão, essa sessão se perde; os quizzes e os resultados já encerrados continuam salvos no navegador do apresentador.
