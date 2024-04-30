import fs from 'fs'

import { createMemoizedOpenAI } from '../chat-gpt'

const getGPTModel = createMemoizedOpenAI("gpt-4-turbo");

type LoadTestCasesInput = {
  testName: string
}
type LoadTestCasesOutput = Record<string, string>
export async function loadTestCases(input: LoadTestCasesInput): Promise<LoadTestCasesOutput> {
  const testCases = await fs.promises.readFile(`./test/prompts/${input.testName}.json`, 'utf8')
  return JSON.parse(testCases)
}

type ValidateQueryResultInput = {
  query: string
  expectedResponse: string
  actualResponse: string
}
type ValidateQueryResultOutput = {
  query: string
  answer: string
  score: number
  reason: string
}
export async function validateQueryResult(input: ValidateQueryResultInput): Promise<ValidateQueryResultOutput> {
  const gptModel = getGPTModel()

  const response = await gptModel.invoke([
    [ 'system', 'You are responsible for verifying that prompt provided invoked the correct response from an LLM. Consider the following question and expected answer as well as the prompt\'s answer.' ],
    [ 'system', `The question is: ${input.query}` ],
    [ 'system', `The expected answer is: ${input.expectedResponse}` ],
    [ 'system', `The prompt's answer was: ${input.actualResponse}` ],
    [ 'system', 'Provide a score between 0 and 100 representing how well the prompt did at answering the question correctly.' ],
    [ 'system', 'If the expected answer and the prompt\'s answer are essentially the same, the score should be on the high end.' ],
    [ 'system', 'If key details are missing or incorrect in the prompt\'s answer or irrelevant information is included, the score should be lower.' ],
    [ 'system', 'If the prompt\'s answer is entirely wrong, the score should be 0. Put your score and reasoning inside a JSON object using the keys "score" and "reason"'],
    [ 'system', 'You must never consider your own answers, but instead always determine score based on the expected answer above.' ],
  ], {
    response_format: {
      type: 'json_object'
    }
  })

  const result = JSON.parse(response.content.toString()) as {
    reason: string
    score: number
  };

  return {
    query: input.query,
    answer: input.actualResponse,
    score: result.score,
    reason: result.reason,
  }
}

type SummarizeValidationResultsInput = {
  validationResults: ValidateQueryResultOutput[]
};
type SummarizeValidationResultsOutput = {
  summary: string
  averageScore: number
};

export async function summarizeValidationResults(input: SummarizeValidationResultsInput): Promise<SummarizeValidationResultsOutput> {
  const gptModel = getGPTModel()
  const comments = input.validationResults.map((validation) => validation.reason)
  const averageScore = input.validationResults.reduce((total, validation) => total + validation.score, 0) / input.validationResults.length;
  const response = await gptModel.invoke([
    [ 'system', 'You are responsible for summarizing comments about an LLM prompt\'s effectiveness.' ],
    [ 'system', 'Consider the following comments. Each one was made by a person providing feedback about the quality of a prompt\'s output.' ],
    [ 'system', `Comments:\n${comments.join("\n\n")}` ],
    [ 'system', 'You must provide a concise summary of common patterns in the comments, good or bad.' ],
  ])

  return {
    summary: response.content.toString(),
    averageScore
  }
}