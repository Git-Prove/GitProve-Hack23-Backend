import "./envConfig";
import { OpenAI } from "openai";

const orgId = process.env.OPENAI_ORG_ID;
const apiKey = process.env.OPENAI_API_KEY;

if (!orgId || !apiKey) {
  throw new Error("Missing OpenAI credentials");
}

const openai = new OpenAI({
  apiKey: apiKey,
});

export function createFileQuestionsPrompt(fileContent: string) {
  return `
    I have a following JavaScript file:

    ======== FILE STARTS HERE ========
    ${fileContent}
    ======== FILE ENDS HERE ==========

    Based on this file, please generate 4 questions (each in a new line)
    that can be asked in order to test whether I understand the contents of the file.
    `;
}

export async function promptGpt(prompt: string) {
  const resp = await openai.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "gpt-3.5-turbo",
  });
  return resp.choices[0].message;
}
