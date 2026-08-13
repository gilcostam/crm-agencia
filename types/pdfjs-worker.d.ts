// pdfjs-dist não publica tipos para o subpath do build do worker (só é
// consumido via import() dinâmico, nunca importado estaticamente pelo
// pacote em si). Ver uso em app/api/clients/[id]/tasks/import/route.ts —
// registramos o módulo em `globalThis.pdfjsWorker` para que o pdfjs-dist
// use o worker "in-process" ao invés de tentar resolver o caminho do
// arquivo via import() relativo (que quebra dentro do bundle da function).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
