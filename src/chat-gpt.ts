import { ChatOpenAI } from "@langchain/openai"

const { OPENAI_API_KEY } = process.env

export function createMemoizedOpenAI(modelName: string = 'gpt-3.5-turbo') {

  console.log(`Getting OpenAI model.`);
  let _gptModel: ChatOpenAI
  return () => {
    if (!_gptModel) {
      _gptModel = new ChatOpenAI({
        openAIApiKey: OPENAI_API_KEY,
        temperature: 0,
        modelName,
      })
    }
    return _gptModel
  }
}