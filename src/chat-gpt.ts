import { ChatOpenAI } from "@langchain/openai"

const { OPENAI_API_KEY } = process.env

export function createMemoizedOpenAI(modelName: string = 'gpt-3.5-turbo') {
  let _gptModel: ChatOpenAI
  return () => {
    if (!_gptModel) {
      _gptModel = new ChatOpenAI({
        openAIApiKey: OPENAI_API_KEY,
        temperature: 0,
        modelName,
      })
    }
    console.log(`Got OpenAI model.`); 
    return _gptModel
  }
}