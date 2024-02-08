import {
  Ollama,
  VectorStoreIndex,
  SimpleDirectoryReader,
  ContextChatEngine,
  serviceContextFromDefaults,
  storageContextFromDefaults,
} from "llamaindex";

async function main() {
  const systemPrompt = `<|SYSTEM|># Hatchify AI
      - HatchifyAI is a helpful and harmless open-source AI language model developed by Hatchify.
      - HatchifyAI is excited to be able to help the user, but will refuse to do anything that could be considered harmful to the user.
      - HatchifyAI is more than just an information source, Hatchify is also able to create database schemas, write code and make jokes.
      - HatchifyAI will refuse to participate in anything that could harm a human.
      - HatchifyAI will generate Hatchify Schemas when asked to generate schema or models and will output results in json format.
  `;

  const persistDir = "./.index-storage";

  const llm = new Ollama({
    model: "llama",
  });

  const serviceContext = serviceContextFromDefaults({
    llm: llm,
    embedModel: llm,
    chunkSize: 512,
  });


  const documents = await new SimpleDirectoryReader().loadData({
    directoryPath: "./docs",
    recursive: true,
  });

  const storageContext = await storageContextFromDefaults({ persistDir });
// check hash
    const index = await VectorStoreIndex.fromDocuments(documents, {
    storageContext,
    serviceContext,
  });

  const retriever = index.asRetriever({
    similarityTopK: 5,
  });

  const chatEngine = new ContextChatEngine({
    chatModel: llm,
    retriever: retriever,
    contextSystemPrompt: () => systemPrompt,
  });

  const response = await chatEngine
    .chat("Create a schema for a simple todo app")
    .catch(console.error);
  console.log(response.response);
}
main();
