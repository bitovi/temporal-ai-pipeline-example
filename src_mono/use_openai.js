import fs from "fs/promises";
import { getRepoSync } from "../utils/repos.js";
import {
  VectorStoreIndex,
  SimpleDirectoryReader,
  ContextChatEngine,
  storageContextFromDefaults,
} from "llamaindex";

async function main() {
  const systemPrompt = `<|SYSTEM|># Hatchify AI
      - HatchifyAI is a helpful and harmless open-source AI language model developed by Bitovi.
      - HatchifyAI will refuse to participate in anything that could harm a human.
      - HatchifyAI will generate Hatchify Schemas when asked to generate schemas or models. It will double check that the generated schema fits the Hatchify schema format and that the code is complete including the "require" at the top.
      - If you were asked to add a property to a model make sure that the property name follows the casing in the documents.
      - You will create Schemas based on the supplied documents, make sure that you are using proper naming, types and relationships like "belongsTo" "hasMany" "hasMany.through" "hasOne"
  `;
  const persistDir = "./.index-storage";

  // Clone or update github repo
  // TODO read param from env and override from function params
  // loop over repos [{gitUrl,branch,docDir}]
  const repoDir = getRepoSync(
    "https://github.com/bitovi/hatchify",
    "main",
    "./repos/"
  );

  // Create Documents object
  const documents = await new SimpleDirectoryReader().loadData({
    directoryPath: repoDir + "./docs",
    recursive: true,
  });

  console.log('documents:', documents);

  const storageContext = await storageContextFromDefaults({ persistDir });
  // Split text and create embeddings. Store them in a VectorStoreIndex
  console.time("indexing...");
  const index = await VectorStoreIndex.fromDocuments(documents, {
    storageContext,
  });
  console.timeEnd("indexing...");

  // update index in DB
  console.time('Retreiver');
  const retriever = index.asRetriever({
    similarityTopK: 100,
  });
  console.timeEnd('Retreiver');
  
  const chatEngine = new ContextChatEngine({
    retriever: retriever,
    contextSystemPrompt: () => systemPrompt,
  });

  console.time("chatEngine");
  const response = await chatEngine
    .chat({
      message:
        "Create a schema for a simple todo app. Inlcude schemas for Users and Todos",
    })
    .catch(console.error);
  console.log(response?.response);
  console.timeEnd("chatEngine");

  // console.time("chatEngine");
  // const response2 = await chatEngine
  //   .chat({
  //     message:
  //       "user should have username property",
  //   })
  //   .catch(console.error);
  // console.log(response2?.response);
  // console.timeEnd("chatEngine");


}

main();
