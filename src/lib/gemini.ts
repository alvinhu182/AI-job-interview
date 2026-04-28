import { GoogleGenAI } from "@google/genai";
import { Message, EvaluationReport, SetupData } from "../types";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5, initialDelay = 5000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message?.toLowerCase() || "";
      const isRateLimit = errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("limit");
      
      if (isRateLimit && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function getNextQuestion(
  setup: SetupData,
  history: Message[],
  apiKey: string
): Promise<string> {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview";
    
    const systemInstruction = `
      Você é um Recrutador Sênior especializado na área de ${setup.area}.
      Seu objetivo é conduzir uma entrevista profissional e realista.
      ${setup.professionalSummary ? `O Resumo Profissional do candidato é: ${setup.professionalSummary}. Use essas informações para fazer perguntas personalizadas e relevantes à trajetória dele.` : ''}
      
      REGRAS:
      - Adote a postura de um recrutador sênior.
      - Fale estritamente em ${setup.language}.
      - Conduza a entrevista uma pergunta por vez.
      - Seja conciso${setup.modality === 'Voz' ? ' (estilo de voz, perguntas curtas e diretas)' : ''}.
      - Se o usuário fugir do assunto, traga-o de volta ao contexto profissional.
      - O histórico de mensagens será fornecido. Gere apenas a PRÓXIMA pergunta ou interação.
      - Não gere feedbacks durante a entrevista, apenas as perguntas.
    `;

    const chatHistory = history.map(m => ({
      role: m.role === 'interviewer' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const response = await ai.models.generateContent({
      model,
      contents: chatHistory.length > 0 ? chatHistory : [{ role: 'user', parts: [{ text: "Iniciar entrevista" }] }],
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    return response.text || "Erro: A IA não retornou uma resposta válida.";
  });
}

export async function generateEvaluation(
  setup: SetupData,
  history: Message[],
  apiKey: string
): Promise<EvaluationReport> {
  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview";
    
    const prompt = `
      Analise a seguinte entrevista para a área de ${setup.area} conduzida em ${setup.language}.
      
      Histórico da Entrevista:
      ${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
      
      Gere um relatório de desempenho técnico e comportamental no seguinte formato JSON estrito:
      {
        "nota_final": 0 a 10,
        "idioma_dominio": "Avaliação do nível linguístico demonstrado",
        "pros": ["Ponto positivo 1", "Ponto positivo 2"],
        "contras": ["Ponto a melhorar 1", "Ponto a melhorar 2"],
        "feedback_geral": "Texto motivacional e técnico resumido"
      }
    `;

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
      },
    });

    try {
      return JSON.parse(response.text || "{}");
    } catch (e) {
      console.error("Failed to parse evaluation:", e);
      return {
        nota_final: 0,
        idioma_dominio: "Erro na avaliação",
        pros: [],
        contras: [],
        feedback_geral: "Ocorreu um erro ao processar o relatório final."
      };
    }
  });
}
