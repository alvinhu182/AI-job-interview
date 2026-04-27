import { GoogleGenAI } from "@google/genai";
import { Message, EvaluationReport, SetupData } from "../types";

export async function getNextQuestion(
  setup: SetupData,
  history: Message[],
  apiKey: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `
    Você é um Recrutador Sênior especializado na área de ${setup.area}.
    Seu objetivo é conduzir uma entrevista profissional e realista.
    ${setup.linkedin ? `O perfil do candidato (LinkedIn/Experiência) é: ${setup.linkedin}. Use essas informações para fazer perguntas personalizadas e relevantes à trajetória dele.` : ''}
    
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

  return response.text || "Erro ao gerar pergunta.";
}

export async function generateEvaluation(
  setup: SetupData,
  history: Message[],
  apiKey: string
): Promise<EvaluationReport> {
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3.1-pro-preview";
  
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
}
